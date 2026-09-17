import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AuditService } from '../../common/audit';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { PlatformAdminGuard } from './platform-admin.guard';

const verificacaoQuerySchema = z
  .object({
    /** Quantas entradas conferir, a partir da mais antiga da janela. */
    limite: z.coerce.number().int().min(100).max(50_000).default(5_000),
    /** Id inicial; ausente = as `limite` entradas mais recentes. */
    desdeId: z.coerce.number().int().min(1).optional(),
  })
  .strict();
type VerificacaoQuery = z.infer<typeof verificacaoQuerySchema>;

export interface VerificacaoDaCadeia {
  ok: boolean;
  /** Quantas entradas foram reconferidas nesta passada. */
  conferidas: number;
  /** Id da primeira entrada que não fecha com a anterior — o ponto de adulteração. */
  quebradaEm: string | null;
  /** Total de entradas na trilha, para dar escala ao que foi conferido. */
  total: number;
  janela: { desdeId: string; ateId: string } | null;
  verificadoEm: string;
}

/**
 * Verificação da cadeia de hash da trilha (E6-01, doc 32 "hash chain verificada").
 *
 * Mora na plataforma, e **não** na tela de auditoria do tenant, porque a cadeia é uma só para a
 * instalação inteira: cada entrada encadeia na anterior por `id`, sem separar por cliente.
 * Verificar "só a parte do tenant A" não significaria nada — o elo que falta pode ser de B.
 *
 * Por isso a tela do tenant não promete integridade verificada: ela explica a garantia
 * (append-only por privilégio revogado + trigger) e deixa a conferência para quem enxerga a
 * trilha inteira. Prometer ao cliente uma verificação que não se pode fazer no recorte dele
 * seria pior do que não prometer nada.
 */
@Controller('platform/auditoria')
@UseGuards(PlatformAdminGuard)
export class AuditoriaPlataformaController {
  constructor(
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('verificacao')
  async verificar(
    @Query(new ZodValidationPipe(verificacaoQuerySchema)) query: VerificacaoQuery,
  ): Promise<VerificacaoDaCadeia> {
    const total = await this.prisma.auditLog.count();

    // Sem `desdeId`, conferimos a cauda: é o trecho que mudou desde a última vez que alguém
    // olhou, e conferir cinco anos de trilha a cada clique tornaria o botão inútil.
    const desdeId = query.desdeId ? BigInt(query.desdeId) : await this.inicioDaCauda(query.limite);

    const resultado = await this.audit.verifyChain({
      fromId: desdeId ?? undefined,
      limit: query.limite,
    });

    const janela = await this.janela(desdeId, query.limite);

    return {
      ok: resultado.ok,
      conferidas: resultado.checked,
      quebradaEm: resultado.brokenAtId ?? null,
      total,
      janela,
      verificadoEm: new Date().toISOString(),
    };
  }

  /** Id a partir do qual as últimas `limite` entradas começam. */
  private async inicioDaCauda(limite: number): Promise<bigint | null> {
    const cauda = await this.prisma.auditLog.findMany({
      orderBy: { id: 'desc' },
      take: limite,
      select: { id: true },
    });
    return cauda.at(-1)?.id ?? null;
  }

  private async janela(
    desdeId: bigint | null,
    limite: number,
  ): Promise<VerificacaoDaCadeia['janela']> {
    if (desdeId === null) return null;

    const entradas = await this.prisma.auditLog.findMany({
      where: { id: { gte: desdeId } },
      orderBy: { id: 'asc' },
      take: limite,
      select: { id: true },
    });

    const primeira = entradas.at(0);
    const ultima = entradas.at(-1);
    if (!primeira || !ultima) return null;

    return { desdeId: primeira.id.toString(), ateId: ultima.id.toString() };
  }
}
