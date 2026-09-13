import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { AuditService } from '../../common/audit';
import { type AuthContext, type RequestIdentity } from '../../common/auth';
import { EnvelopeCryptoService } from '../../common/crypto';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantDatabase } from '../../common/tenant';
import { AppConfigService } from '../../config';
import { assertSafeErpUrl } from '../../integration/sg';
import { SgClient, SgError, SgTokenManager, type SgCallContext } from '../../integration/sg';
import { type ErpConnectionInput } from './dto/erp-connection.dto';

export interface ErpConnectionView {
  configurada: boolean;
  baseUrl: string | null;
  isSgCloud: boolean;
  tlsMode: 'https' | 'vpn';
  username: string | null;
  /** A senha **nunca** volta — nem mascarada. Só se substitui (doc 06 §2). */
  senhaCadastrada: boolean;
  maxRps: number;
  status: 'pending' | 'ok' | 'error';
  lastError: string | null;
  lastHealthAt: string | null;
  health: { versao: string | null; revisao: string | null; razaoSocial: string | null } | null;
  routesGranted: string[];
  routesCheckedAt: string | null;
}

/**
 * Conexão com o ERP do tenant: cofre da credencial e ciclo de vida (doc 12 §1, E4-03/E4-07).
 *
 * A senha entra cifrada e sai apenas no instante de pedir o token — decifrada, usada e
 * descartada. Não há endpoint que a devolva, nem em log, nem para o próprio owner: o fluxo de
 * troca é substituir, nunca ler.
 */
@Injectable()
export class ErpConnectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantDb: TenantDatabase,
    private readonly crypto: EnvelopeCryptoService,
    private readonly sg: SgClient,
    private readonly tokens: SgTokenManager,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ErpConnectionService.name);
  }

  async view(tenantId: string): Promise<ErpConnectionView> {
    const conexao = await this.buscar(tenantId);

    if (!conexao) {
      return {
        configurada: false,
        baseUrl: null,
        isSgCloud: false,
        tlsMode: 'https',
        username: null,
        senhaCadastrada: false,
        maxRps: this.config.sg.maxRps,
        status: 'pending',
        lastError: null,
        lastHealthAt: null,
        health: null,
        routesGranted: [],
        routesCheckedAt: null,
      };
    }

    const health = conexao.healthPayload as Record<string, string | null> | null;

    return {
      configurada: true,
      baseUrl: conexao.baseUrl,
      isSgCloud: conexao.isSgCloud,
      tlsMode: conexao.tlsMode,
      username: conexao.username,
      senhaCadastrada: true,
      maxRps: conexao.maxRps,
      status: conexao.status,
      lastError: conexao.lastError,
      lastHealthAt: conexao.lastHealthAt?.toISOString() ?? null,
      health: health
        ? {
            versao: health.versao ?? null,
            revisao: health.revisao ?? null,
            razaoSocial: health.razaoSocial ?? null,
          }
        : null,
      routesGranted: conexao.routesGranted,
      routesCheckedAt: conexao.routesCheckedAt?.toISOString() ?? null,
    };
  }

  /**
   * Cria ou substitui a conexão. A senha é opcional na edição: quem só corrige a URL não
   * precisa redigitar o segredo (e não teria como — ele nunca foi exibido).
   */
  async upsert(
    auth: AuthContext,
    tenantId: string,
    input: ErpConnectionInput,
    identity: RequestIdentity,
  ): Promise<ErpConnectionView> {
    const existente = await this.buscar(tenantId);

    // Anti-SSRF antes de gravar: endereço que aponta para rede interna nem chega ao banco.
    await assertSafeErpUrl(input.baseUrl, {
      tlsMode: input.tlsMode,
      allowInsecure: this.config.sg.allowInsecure,
      vpnCidr: this.config.sg.vpnCidr,
    });

    // Na criação a senha é obrigatória; na edição, ausente significa "mantenha a que está no
    // cofre" — afinal ela nunca foi exibida para ser redigitada.
    const segredo = input.senha ? this.crypto.seal(input.senha) : null;
    if (!existente && !segredo) {
      throw new AppException('VALIDATION_ERROR', {
        message: 'Informe a senha do usuário de integração fornecido pela SG.',
        details: [{ path: 'senha', rule: 'required' }],
      });
    }

    await this.tenantDb.run(
      tenantId,
      async (tx) => {
        const dados = {
          baseUrl: input.baseUrl.trim().replace(/\/+$/, ''),
          isSgCloud: input.isSgCloud,
          tlsMode: input.tlsMode,
          username: input.username.trim(),
          maxRps: input.maxRps,
          authPathOverride: input.authPathOverride?.trim() || null,
          syncWindowStart: input.syncWindowStart ?? null,
          syncWindowEnd: input.syncWindowEnd ?? null,
          // Qualquer mudança volta o estado para "pendente": só o teste diz que está de pé.
          status: 'pending' as const,
          lastError: null,
          ...(segredo
            ? {
                secretCiphertext: new Uint8Array(segredo.ciphertext),
                secretKeyVersion: segredo.keyVersion,
              }
            : {}),
        };

        // Update e create separados de propósito: o payload de `create` de um `upsert` é
        // avaliado sempre, e ele exige a senha — que não existe quando a edição só mexe na URL.
        if (existente || !segredo) {
          await tx.erpConnection.update({ where: { tenantId }, data: dados });
          return;
        }

        await tx.erpConnection.create({
          data: {
            tenantId,
            ...dados,
            secretCiphertext: new Uint8Array(segredo.ciphertext),
            secretKeyVersion: segredo.keyVersion,
          },
        });
      },
      { userId: auth.user.id },
    );

    // Token antigo morre junto com a credencial antiga.
    await this.tokens.invalidate(tenantId);

    await this.audit.record({
      action: existente ? 'erp_connection.updated' : 'erp_connection.created',
      resourceType: 'erp_connection',
      resourceId: tenantId,
      result: 'success',
      tenantId,
      userId: auth.user.id,
      sessionId: auth.session.id,
      ip: identity.ip,
      userAgent: identity.userAgent,
      // A senha não entra aqui nem cifrada: o que interessa é que ela mudou.
      changes: {
        baseUrl: input.baseUrl,
        isSgCloud: input.isSgCloud,
        tlsMode: input.tlsMode,
        username: input.username,
        maxRps: input.maxRps,
        senhaAlterada: Boolean(input.senha),
      },
    });

    return this.view(tenantId);
  }

  /**
   * Testa a conexão de ponta a ponta (runbook 22 §1, passo 3): autentica, captura as rotas
   * contratadas e consulta o status do ERP. É o que transforma "configurado" em "funcionando".
   */
  async testar(
    auth: AuthContext,
    tenantId: string,
    identity: RequestIdentity,
  ): Promise<ErpConnectionView & { rotasAdicionadas: string[]; rotasRemovidas: string[] }> {
    const conexao = await this.exigirConexao(tenantId);

    // Teste sempre autentica de novo: testar com token cacheado não prova que a senha atual vale.
    await this.tokens.invalidate(tenantId);

    try {
      const token = await this.tokens.getToken({
        conexao: this.contextoDe(conexao),
        credenciais: () => this.credenciais(tenantId),
      });

      const rotasAntes = conexao.routesGranted;
      const rotasAdicionadas = token.routes.filter((rota) => !rotasAntes.includes(rota));
      const rotasRemovidas = rotasAntes.filter((rota) => !token.routes.includes(rota));

      const status = await this.sg.getStatus({
        conexao: { ...this.contextoDe(conexao), routesGranted: token.routes },
        credenciais: () => this.credenciais(tenantId),
        prioridade: 'interativo',
      });

      await this.tenantDb.run(tenantId, (tx) =>
        tx.erpConnection.update({
          where: { tenantId },
          data: {
            status: 'ok',
            lastError: null,
            lastHealthAt: new Date(),
            lastTokenExpiresAt: token.expiresAt,
            healthPayload: {
              versao: status.versao,
              revisao: status.revisao,
              razaoSocial: status.razaoSocial,
              cnpj: status.cnpj,
            },
            routesGranted: token.routes,
            routesCheckedAt: new Date(),
          },
        }),
      );

      // Mudança no contrato com a SG altera o que o produto consegue oferecer (doc 12 §2).
      if (rotasAdicionadas.length > 0 || rotasRemovidas.length > 0) {
        await this.audit.record({
          action: 'erp_connection.routes_changed',
          resourceType: 'erp_connection',
          resourceId: tenantId,
          result: 'success',
          tenantId,
          userId: auth.user.id,
          sessionId: auth.session.id,
          ip: identity.ip,
          userAgent: identity.userAgent,
          changes: { adicionadas: rotasAdicionadas, removidas: rotasRemovidas },
        });
      }

      await this.audit.record({
        action: 'erp_connection.tested',
        resourceType: 'erp_connection',
        resourceId: tenantId,
        result: 'success',
        tenantId,
        userId: auth.user.id,
        sessionId: auth.session.id,
        ip: identity.ip,
        userAgent: identity.userAgent,
        changes: { rotas: token.routes.length, versaoErp: status.versao },
      });

      return { ...(await this.view(tenantId)), rotasAdicionadas, rotasRemovidas };
    } catch (erro) {
      const motivo =
        erro instanceof SgError
          ? `${erro.falha}${erro.detalhe.mensagemOrigem ? `: ${erro.detalhe.mensagemOrigem}` : ''}`
          : 'falha inesperada';

      await this.tenantDb.run(tenantId, (tx) =>
        tx.erpConnection.update({
          where: { tenantId },
          data: { status: 'error', lastError: motivo.slice(0, 300), lastHealthAt: new Date() },
        }),
      );

      await this.audit.record({
        action: 'erp_connection.tested',
        resourceType: 'erp_connection',
        resourceId: tenantId,
        result: 'error',
        tenantId,
        userId: auth.user.id,
        sessionId: auth.session.id,
        ip: identity.ip,
        userAgent: identity.userAgent,
        changes: { motivo },
      });

      throw erro instanceof SgError ? erro.toAppException() : erro;
    }
  }

  /**
   * Health-check não interativo (doc 14 §2, domínio `health`).
   *
   * Mesma verificação do botão "Testar conexão", sem ator humano: renova o token, captura as
   * rotas contratadas e consulta o status do ERP. Não gera trilha de auditoria — auditoria é
   * registro de ação de pessoa (doc 09 §4); um cron a cada 10 minutos só encheria a trilha e
   * esconderia o que importa nela.
   */
  async verificarSaude(tenantId: string): Promise<{
    status: 'ok' | 'error';
    versao: string | null;
    rotas: number;
    rotasAdicionadas: string[];
    rotasRemovidas: string[];
    motivo?: string;
  }> {
    const conexao = await this.exigirConexao(tenantId);
    const rotasAntes = conexao.routesGranted;

    try {
      const token = await this.tokens.getToken({
        conexao: this.contextoDe(conexao),
        credenciais: () => this.credenciais(tenantId),
      });

      const status = await this.sg.getStatus({
        conexao: { ...this.contextoDe(conexao), routesGranted: token.routes },
        credenciais: () => this.credenciais(tenantId),
      });

      await this.tenantDb.run(tenantId, (tx) =>
        tx.erpConnection.update({
          where: { tenantId },
          data: {
            status: 'ok',
            lastError: null,
            lastHealthAt: new Date(),
            lastTokenExpiresAt: token.expiresAt,
            healthPayload: {
              versao: status.versao,
              revisao: status.revisao,
              razaoSocial: status.razaoSocial,
              cnpj: status.cnpj,
            },
            routesGranted: token.routes,
            routesCheckedAt: new Date(),
          },
        }),
      );

      const rotasAdicionadas = token.routes.filter((rota) => !rotasAntes.includes(rota));
      const rotasRemovidas = rotasAntes.filter((rota) => !token.routes.includes(rota));

      // Contrato que muda sozinho altera o que o produto consegue oferecer (doc 12 §2): some do
      // log de negócio, some do painel — e a Fase 8 transforma isso em alerta ao admin.
      if (rotasAdicionadas.length > 0 || rotasRemovidas.length > 0) {
        this.logger.warn(
          {
            event: 'erp_routes_changed',
            tenant_id: tenantId,
            adicionadas: rotasAdicionadas,
            removidas: rotasRemovidas,
          },
          'erp_routes_changed',
        );
      }

      return {
        status: 'ok',
        versao: status.versao,
        rotas: token.routes.length,
        rotasAdicionadas,
        rotasRemovidas,
      };
    } catch (erro) {
      const motivo =
        erro instanceof SgError
          ? `${erro.falha}${erro.detalhe.mensagemOrigem ? `: ${erro.detalhe.mensagemOrigem}` : ''}`
          : 'falha inesperada';

      await this.tenantDb.run(tenantId, (tx) =>
        tx.erpConnection.update({
          where: { tenantId },
          data: { status: 'error', lastError: motivo.slice(0, 300), lastHealthAt: new Date() },
        }),
      );

      this.logger.error({ event: 'erp_health_failed', tenant_id: tenantId, motivo }, 'erp_health');
      return {
        status: 'error',
        versao: null,
        rotas: rotasAntes.length,
        rotasAdicionadas: [],
        rotasRemovidas: [],
        motivo,
      };
    }
  }

  /** Conexão pronta para sincronizar? O scheduler pergunta isto antes de enfileirar qualquer job. */
  async prontaParaSync(tenantId: string): Promise<boolean> {
    const conexao = await this.buscar(tenantId);
    return Boolean(conexao) && conexao?.status !== 'error';
  }

  /**
   * Contexto pronto para os jobs de sincronização (Fase 6) chamarem a API SG em nome do tenant.
   */
  async callContext(tenantId: string): Promise<SgCallContext> {
    const conexao = await this.exigirConexao(tenantId);
    return {
      conexao: { ...this.contextoDe(conexao), routesGranted: conexao.routesGranted },
      credenciais: () => this.credenciais(tenantId),
    };
  }

  /**
   * Recifra a senha com a chave mestra corrente (runbook 22 §5). Idempotente: quem já está na
   * versão atual é ignorado.
   */
  async rewrap(tenantId: string): Promise<{ recifrada: boolean }> {
    const conexao = await this.exigirConexao(tenantId);
    const cifrado = Buffer.from(conexao.secretCiphertext);

    if (!this.crypto.needsRewrap(cifrado)) return { recifrada: false };

    const segredo = this.crypto.seal(this.crypto.open(cifrado));
    await this.tenantDb.run(tenantId, (tx) =>
      tx.erpConnection.update({
        where: { tenantId },
        data: {
          secretCiphertext: new Uint8Array(segredo.ciphertext),
          secretKeyVersion: segredo.keyVersion,
        },
      }),
    );

    this.logger.info(
      { event: 'erp_secret_rewrapped', tenant_id: tenantId },
      'erp_secret_rewrapped',
    );
    return { recifrada: true };
  }

  /** Decifra a credencial. É o único ponto do sistema que vê a senha do ERP em claro. */
  private async credenciais(tenantId: string): Promise<{ usuario: string; senha: string }> {
    const conexao = await this.exigirConexao(tenantId);
    return {
      usuario: conexao.username,
      senha: this.crypto.open(Buffer.from(conexao.secretCiphertext)),
    };
  }

  private contextoDe(conexao: {
    tenantId: string;
    baseUrl: string;
    tlsMode: 'https' | 'vpn';
    maxRps: number;
    isSgCloud: boolean;
    authPathOverride: string | null;
    authHeaderMode: 'raw' | 'bearer';
  }) {
    return {
      tenantId: conexao.tenantId,
      baseUrl: conexao.baseUrl,
      tlsMode: conexao.tlsMode,
      maxRps: conexao.maxRps,
      isSgCloud: conexao.isSgCloud,
      authPathOverride: conexao.authPathOverride,
      authHeaderMode: conexao.authHeaderMode,
      routesGranted: [] as string[],
    };
  }

  private async buscar(tenantId: string) {
    return this.tenantDb.run(tenantId, (tx) =>
      tx.erpConnection.findUnique({ where: { tenantId } }),
    );
  }

  private async exigirConexao(tenantId: string) {
    const conexao = await this.buscar(tenantId);
    if (!conexao) {
      throw new AppException('VALIDATION_ERROR', {
        message: 'Configure a conexão com o ERP antes de continuar.',
        details: [{ path: 'erpConnection', rule: 'required' }],
      });
    }
    return conexao;
  }
}
