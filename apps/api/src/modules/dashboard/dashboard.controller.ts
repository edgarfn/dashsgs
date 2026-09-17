import { Controller, Get, Header, Query, Res } from '@nestjs/common';
import { type Response } from 'express';
import { CurrentAuth, RequirePermissions, type AuthContext } from '../../common/auth';
import { AppException } from '../../common/errors/app.exception';
import { MetricsService } from '../../common/metrics/metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { FiliaisScopeService, parseFiliaisParam } from '../../common/tenant';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { DashboardCache, TTL } from './cache.service';
import {
  type ComparativoView,
  type EstoqueView,
  type HomeView,
  type VendasDiaView,
} from './dashboard.types';
import { gerarCsv, nomeDeArquivo } from './csv';
import {
  comparativoQuerySchema,
  homeQuerySchema,
  periodoQuerySchema,
  rupturaQuerySchema,
  vendasDiaQuerySchema,
  type ComparativoQuery,
  type HomeQuery,
  type PeriodoQuery,
  type RupturaQuery,
  type VendasDiaQuery,
} from './dto/dashboard.dto';
import { ComprasService, type ComprasView } from './compras.service';
import { EstoqueService } from './estoque.service';
import { FinanceiroService, type FinanceiroView } from './financeiro.service';
import { HomeService } from './home.service';
import { VendasService } from './vendas.service';

/** Papéis que enxergam custo e margem (doc 15 §1: "manager+"). */
const PAPEIS_COM_MARGEM = new Set(['owner', 'admin', 'manager']);

/** Teto de linhas num export síncrono; acima disso o caminho é o assíncrono da E6-06. */
const MAX_LINHAS_CSV = 20_000;

/**
 * Leitura do dashboard (doc 15 / doc 23 §Dashboard).
 *
 * Nenhuma rota aqui fala com o ERP: tudo vem do espelho e dos agregados que o sync preparou
 * (doc 04 §3.1). O caminho é sempre o mesmo — resolver o recorte de filiais da membership,
 * consultar com cache e devolver junto o **frescor** do dado, para que a tela nunca apresente
 * um número velho como se fosse de agora.
 */
@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly home: HomeService,
    private readonly vendas: VendasService,
    private readonly estoque: EstoqueService,
    private readonly financeiro: FinanceiroService,
    private readonly compras: ComprasService,
    private readonly escopo: FiliaisScopeService,
    private readonly cache: DashboardCache,
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
  ) {}

  @Get('home')
  @RequirePermissions('dashboard.view')
  async visaoGeral(
    @Query(new ZodValidationPipe(homeQuerySchema)) query: HomeQuery,
    @CurrentAuth() auth: AuthContext,
  ): Promise<HomeView> {
    const { tenantId, filiais, timezone } = await this.contexto(auth, query.filiais);
    const podeVerMargem = this.podeVerMargem(auth, tenantId);

    return this.cache.lembrar(
      tenantId,
      'home',
      { filiais, custo: query.custo, margem: podeVerMargem },
      TTL.hoje,
      () =>
        this.home.montar({
          tenantId,
          timezone,
          filiais,
          baseDeCusto: query.custo,
          podeVerMargem,
        }),
    );
  }

  @Get('vendas/dia')
  @RequirePermissions('dashboard.view')
  async vendasDoDia(
    @Query(new ZodValidationPipe(vendasDiaQuerySchema)) query: VendasDiaQuery,
    @CurrentAuth() auth: AuthContext,
  ): Promise<VendasDiaView> {
    const { tenantId, filiais, timezone } = await this.contexto(auth, query.filiais);
    const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date());

    return this.cache.lembrar(
      tenantId,
      'vendas-dia',
      {
        filiais,
        data: query.data,
        caixa: query.caixa,
        canceladas: query.canceladas,
        pagina: query.pagina,
        itens: query.itensPorPagina,
      },
      // O dia corrente muda a cada sincronização; dia fechado não muda mais.
      query.data >= hoje ? TTL.hoje : TTL.historico,
      () =>
        this.vendas.doDia({
          tenantId,
          data: query.data,
          filiais,
          caixa: query.caixa,
          canceladas: query.canceladas,
          pagina: query.pagina,
          itensPorPagina: query.itensPorPagina,
        }),
    );
  }

  @Get('vendas/comparativo')
  @RequirePermissions('dashboard.view')
  async comparativo(
    @Query(new ZodValidationPipe(comparativoQuerySchema)) query: ComparativoQuery,
    @CurrentAuth() auth: AuthContext,
  ): Promise<ComparativoView> {
    const { tenantId, filiais } = await this.contexto(auth, query.filiais);
    const podeVerMargem = this.podeVerMargem(auth, tenantId);

    return this.cache.lembrar(
      tenantId,
      'comparativo',
      { filiais, de: query.de, ate: query.ate, custo: query.custo, margem: podeVerMargem },
      TTL.historico,
      () =>
        this.vendas.comparativo({
          tenantId,
          de: query.de,
          ate: query.ate,
          filiais,
          baseDeCusto: query.custo,
          podeVerMargem,
        }),
    );
  }

  @Get('estoque')
  @RequirePermissions('dashboard.view')
  async estoqueSituacao(
    @Query(new ZodValidationPipe(rupturaQuerySchema)) query: RupturaQuery,
    @CurrentAuth() auth: AuthContext,
  ): Promise<EstoqueView> {
    const { tenantId, filiais } = await this.contexto(auth, query.filiais);

    return this.cache.lembrar(
      tenantId,
      'estoque',
      {
        filiais,
        situacao: query.situacao,
        curva: query.curva,
        pagina: query.pagina,
        itens: query.itensPorPagina,
      },
      TTL.historico,
      () =>
        this.estoque.situacao({
          tenantId,
          filiais,
          situacao: query.situacao,
          curva: query.curva,
          pagina: query.pagina,
          itensPorPagina: query.itensPorPagina,
        }),
    );
  }

  /**
   * Financeiro (doc 15 §5).
   *
   * Exige `manager+` porque aqui está o caixa da rede — aging, despesas e taxas de cartão são o
   * material mais sensível do produto (doc 02, classificação FINANCIAL). Quem só acompanha venda
   * não precisa ver a dívida da empresa.
   */
  @Get('financeiro')
  @RequirePermissions('dashboard.view')
  async financeiroView(
    @Query(new ZodValidationPipe(periodoQuerySchema)) query: PeriodoQuery,
    @CurrentAuth() auth: AuthContext,
  ): Promise<FinanceiroView> {
    const { tenantId, filiais } = await this.contexto(auth, query.filiais);
    this.exigirPapelFinanceiro(auth, tenantId);

    return this.cache.lembrar(
      tenantId,
      'financeiro',
      { filiais, de: query.de, ate: query.ate },
      TTL.historico,
      () => this.financeiro.montar({ tenantId, filiais, de: query.de, ate: query.ate }),
    );
  }

  @Get('compras')
  @RequirePermissions('dashboard.view')
  async comprasView(
    @Query(new ZodValidationPipe(periodoQuerySchema)) query: PeriodoQuery,
    @CurrentAuth() auth: AuthContext,
  ): Promise<ComprasView> {
    const { tenantId, filiais } = await this.contexto(auth, query.filiais);

    return this.cache.lembrar(
      tenantId,
      'compras',
      { filiais, de: query.de, ate: query.ate },
      TTL.historico,
      () => this.compras.montar({ tenantId, filiais, de: query.de, ate: query.ate }),
    );
  }

  /**
   * Export do diário de vendas (doc 16 §4).
   *
   * Exige `reports.export` — permissão separada de propósito: consultar na tela e levar o dado
   * embora são atos diferentes, e o segundo sai do nosso controle (doc 10 §3). Sem cache: o
   * arquivo é sempre o estado atual, e o volume não justifica guardar.
   */
  @Get('vendas/dia/export')
  @RequirePermissions('reports.export')
  @Header('Cache-Control', 'no-store')
  async exportarDia(
    @Query(new ZodValidationPipe(vendasDiaQuerySchema)) query: VendasDiaQuery,
    @CurrentAuth() auth: AuthContext,
    @Res() res: Response,
  ): Promise<void> {
    const { tenantId, filiais } = await this.contexto(auth, query.filiais);

    const pagina = await this.vendas.doDia({
      tenantId,
      data: query.data,
      filiais,
      caixa: query.caixa,
      canceladas: query.canceladas,
      pagina: 1,
      itensPorPagina: 200,
    });

    if (pagina.paginacao.total > MAX_LINHAS_CSV) {
      // Recusa por tamanho é desfecho, não erro de servidor: contada à parte porque é ela que
      // diz quando o export assíncrono (E6-06) deixou de ser opcional.
      this.metrics.observeExport('muito_grande');
      throw new AppException('VALIDATION_ERROR', {
        message: `O período tem ${pagina.paginacao.total} cupons e o limite do export direto é ${MAX_LINHAS_CSV}. Filtre por filial ou caixa.`,
        details: [{ path: 'data', rule: 'export_muito_grande' }],
      });
    }

    // Uma página só não basta para um arquivo: percorremos todas antes de montar o CSV.
    const linhas = [...pagina.cupons];
    for (let numero = 2; numero <= pagina.paginacao.paginas; numero += 1) {
      const proxima = await this.vendas.doDia({
        tenantId,
        data: query.data,
        filiais,
        caixa: query.caixa,
        canceladas: query.canceladas,
        pagina: numero,
        itensPorPagina: 200,
      });
      linhas.push(...proxima.cupons);
    }

    const csv = gerarCsv(
      [
        { cabecalho: 'Data', valor: (linha) => linha.data },
        { cabecalho: 'Filial', valor: (linha) => linha.filialNome },
        { cabecalho: 'Caixa', valor: (linha) => linha.caixa },
        { cabecalho: 'Cupom', valor: (linha) => linha.cupom },
        { cabecalho: 'Horário', valor: (linha) => linha.horario },
        { cabecalho: 'Itens', valor: (linha) => linha.itens },
        { cabecalho: 'Valor', valor: (linha) => linha.valorTotal },
        { cabecalho: 'Desconto', valor: (linha) => linha.desconto },
        { cabecalho: 'Cancelada', valor: (linha) => linha.cancelada },
        { cabecalho: 'Identificada', valor: (linha) => linha.identificada },
        { cabecalho: 'Formas de pagamento', valor: (linha) => linha.formas.join(' + ') },
      ],
      linhas,
    );

    this.metrics.observeExport('ok');

    res
      .status(200)
      .setHeader('Content-Type', 'text/csv; charset=utf-8')
      .setHeader(
        'Content-Disposition',
        `attachment; filename="${nomeDeArquivo('vendas', query.data)}"`,
      )
      .send(csv);
  }

  /** Tenant ativo + recorte de filiais efetivo + fuso (para saber que dia é "hoje"). */
  private async contexto(
    auth: AuthContext,
    filiaisParam?: string,
  ): Promise<{ tenantId: string; filiais: number[] | null; timezone: string }> {
    const tenantId = exigirTenant(auth);
    const membership = auth.memberships.find((item) => item.tenantId === tenantId);

    const escopo = this.escopo.resolve(
      membership?.filiaisAllowed ?? [],
      parseFiliaisParam(filiaisParam),
    );

    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { timezone: true },
    });

    return { tenantId, filiais: escopo.filiais, timezone: tenant.timezone };
  }

  /** O painel financeiro é de manager+ (doc 16 §2: "Financeiro — A pagar/receber | manager+"). */
  private exigirPapelFinanceiro(auth: AuthContext, tenantId: string): void {
    if (!this.podeVerMargem(auth, tenantId)) {
      throw AppException.forbidden({ reason: 'painel financeiro exige papel de gestão' });
    }
  }

  private podeVerMargem(auth: AuthContext, tenantId: string): boolean {
    const membership = auth.memberships.find((item) => item.tenantId === tenantId);
    return membership ? PAPEIS_COM_MARGEM.has(membership.role) : false;
  }
}

function exigirTenant(auth: AuthContext): string {
  if (!auth.activeTenantId) {
    throw new AppException('VALIDATION_ERROR', {
      message: 'Selecione um tenant antes de continuar.',
      details: [{ path: 'tenant', rule: 'required' }],
    });
  }
  return auth.activeTenantId;
}
