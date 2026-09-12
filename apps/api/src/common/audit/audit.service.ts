import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { type Prisma } from '@prisma/client';
import { PinoLogger } from 'nestjs-pino';
import { getCorrelationStore } from '../correlation/correlation.context';
import { redactObject } from '../logging/redaction';
import { PrismaService } from '../prisma/prisma.service';

export type AuditResult = 'success' | 'denied' | 'error';

export interface AuditEntryInput {
  /** `recurso.ação` no passado: `auth.login.succeeded`, `authz.denied`, `user.invited`. */
  action: string;
  resourceType: string;
  resourceId?: string | null;
  result: AuditResult;
  tenantId?: string | null;
  userId?: string | null;
  sessionId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  /** Diferenças relevantes. Passa por redaction: nunca senha, token ou PII bruta (doc 18 §1). */
  changes?: Record<string, unknown> | null;
}

/**
 * Trilha de auditoria append-only com encadeamento de hash (doc 05 §6 / E6-01).
 *
 * `entry_hash = sha256(prev_hash || linha canônica)`. Quem adulterar uma linha quebra a cadeia de
 * todas as seguintes, e a verificação detecta exatamente onde. UPDATE e DELETE já são impossíveis
 * pelo papel da aplicação (REVOKE + trigger na migração inicial) — o encadeamento cobre o caso de
 * quem tiver acesso direto ao banco.
 */
@Injectable()
export class AuditService {
  /** Chave do advisory lock que serializa a escrita da cadeia. */
  private static readonly CHAIN_LOCK = 4820251;

  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AuditService.name);
  }

  /**
   * Grava um evento. NÃO propaga exceção: auditoria que derruba a operação auditada vira
   * negação de serviço. Falha vira log de erro acionável (o alerta operacional cobre o resto).
   */
  async record(entry: AuditEntryInput): Promise<void> {
    try {
      await this.write(entry);
    } catch (error) {
      this.logger.error(
        { event: 'audit_write_failed', action: entry.action, err: error },
        'audit_write_failed',
      );
    }
  }

  /** Versão que propaga o erro — para fluxos onde não auditar é pior que falhar. */
  async recordOrThrow(entry: AuditEntryInput): Promise<void> {
    await this.write(entry);
  }

  private async write(entry: AuditEntryInput): Promise<void> {
    const store = getCorrelationStore();
    const changes = entry.changes ? (redactObject(entry.changes) as Record<string, unknown>) : null;
    const createdAt = new Date();

    await this.prisma.$transaction(async (tx) => {
      // Serializa os escritores: sem isto, duas inserções simultâneas leriam o mesmo prev_hash
      // e a cadeia nasceria bifurcada.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${AuditService.CHAIN_LOCK}::bigint)`;

      const previous = await tx.auditLog.findFirst({
        orderBy: { id: 'desc' },
        select: { entryHash: true },
      });

      const payload = {
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId ?? null,
        result: entry.result,
        tenantId: entry.tenantId ?? store?.tenantId ?? null,
        userId: entry.userId ?? store?.userId ?? null,
        sessionId: entry.sessionId ?? store?.sessionId ?? null,
        ip: entry.ip ?? null,
        userAgent: entry.userAgent ?? null,
        changes,
        createdAt: createdAt.toISOString(),
      };

      const prevHash = previous?.entryHash ? Buffer.from(previous.entryHash) : null;
      const entryHash = computeEntryHash(prevHash, payload);

      await tx.auditLog.create({
        data: {
          action: payload.action,
          resourceType: payload.resourceType,
          resourceId: payload.resourceId,
          result: payload.result,
          tenantId: payload.tenantId,
          userId: payload.userId,
          sessionId: payload.sessionId,
          ip: payload.ip,
          userAgent: payload.userAgent,
          // O Prisma tipa Json e Bytes com seus próprios tipos; a conversão fica só aqui.
          changes: (changes ?? undefined) as Prisma.InputJsonValue | undefined,
          prevHash: prevHash ? new Uint8Array(prevHash) : null,
          entryHash: new Uint8Array(entryHash),
          createdAt,
        },
      });
    });
  }

  /**
   * Refaz a cadeia e devolve o primeiro ponto quebrado, se houver (teste de tamper — doc 17 §2).
   *
   * `fromId` verifica apenas uma janela (a partir daquele id), ancorando no `prev_hash` do
   * primeiro registro lido — é como a operação confere um período sem reler anos de trilha.
   */
  async verifyChain(
    options: { fromId?: bigint; limit?: number } = {},
  ): Promise<{ ok: boolean; checked: number; brokenAtId?: string }> {
    const entries = await this.prisma.auditLog.findMany({
      where: options.fromId ? { id: { gte: options.fromId } } : undefined,
      orderBy: { id: 'asc' },
      take: options.limit ?? 1000,
      select: {
        id: true,
        action: true,
        resourceType: true,
        resourceId: true,
        result: true,
        tenantId: true,
        userId: true,
        sessionId: true,
        ip: true,
        userAgent: true,
        changes: true,
        prevHash: true,
        entryHash: true,
        createdAt: true,
      },
    });

    let expectedPrev: Buffer | null = null;
    // Linhas gravadas antes do encadeamento existir (ex.: seeds antigos) não têm hash. São
    // aceitas apenas como prefixo: assim que a cadeia começa, qualquer buraco é adulteração.
    let chainStarted = false;

    for (const row of entries) {
      if (!row.entryHash) {
        if (chainStarted)
          return { ok: false, checked: entries.length, brokenAtId: row.id.toString() };
        continue;
      }
      if (!chainStarted) {
        chainStarted = true;
        expectedPrev = row.prevHash ? Buffer.from(row.prevHash) : null;
      }
      const rowPrevHash = row.prevHash ? Buffer.from(row.prevHash) : null;
      const rowEntryHash = row.entryHash ? Buffer.from(row.entryHash) : null;
      const prevMatches = buffersEqual(rowPrevHash, expectedPrev);
      const recomputed = computeEntryHash(expectedPrev, {
        action: row.action,
        resourceType: row.resourceType,
        resourceId: row.resourceId,
        result: row.result,
        tenantId: row.tenantId,
        userId: row.userId,
        sessionId: row.sessionId,
        ip: row.ip,
        userAgent: row.userAgent,
        changes: (row.changes as Record<string, unknown> | null) ?? null,
        createdAt: row.createdAt.toISOString(),
      });

      if (!prevMatches || !buffersEqual(rowEntryHash, recomputed)) {
        return { ok: false, checked: entries.length, brokenAtId: row.id.toString() };
      }
      expectedPrev = rowEntryHash;
    }

    return { ok: true, checked: entries.length };
  }
}

/**
 * Serialização canônica: chaves em ordem fixa e JSON estável. Qualquer mudança neste formato
 * invalida a verificação de cadeias antigas — se um dia for necessário, versione o algoritmo.
 */
export function computeEntryHash(
  prevHash: Buffer | null,
  payload: Record<string, unknown>,
): Buffer {
  const canonical = JSON.stringify(payload, Object.keys(payload).sort());
  const hash = createHash('sha256');
  if (prevHash) hash.update(prevHash);
  hash.update(canonical, 'utf8');
  return hash.digest();
}

function buffersEqual(a: Buffer | null, b: Buffer | null): boolean {
  if (a === null || b === null) return a === b;
  return a.equals(b);
}
