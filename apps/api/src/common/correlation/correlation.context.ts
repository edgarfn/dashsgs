import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

/**
 * Contexto de correlação (doc 18 §1): gerado na borda e propagado por todo o request e,
 * mais adiante, pelos jobs (`job_id` + `origin_correlation_id`).
 *
 * Nunca carrega dados de negócio — apenas identificadores.
 */
export interface CorrelationStore {
  correlationId: string;
  /** Definido pelo interceptor de tenant (Fase 4) — nunca vem do cliente. */
  tenantId?: string;
  userId?: string;
  sessionId?: string;
}

const storage = new AsyncLocalStorage<CorrelationStore>();

/** Formato aceito para um id vindo de fora: seguro para log (sem injeção de linha/ANSI). */
const SAFE_ID = /^[A-Za-z0-9_-]{8,64}$/;

export function newCorrelationId(): string {
  return randomUUID();
}

/**
 * Aceita o id de correlação do cliente apenas se for inofensivo; caso contrário gera um novo.
 * Motivo: o valor vai para logs e para o corpo de erro — entrada não validada viraria vetor de
 * poluição/forja de log (doc 09 §1 "Backend").
 */
export function sanitizeCorrelationId(candidate: unknown): string {
  if (typeof candidate === 'string' && SAFE_ID.test(candidate)) return candidate;
  return newCorrelationId();
}

export function runWithCorrelation<T>(store: CorrelationStore, fn: () => T): T {
  return storage.run(store, fn);
}

export function getCorrelationStore(): CorrelationStore | undefined {
  return storage.getStore();
}

export function getCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}

/** Enriquece o contexto corrente (tenant/usuário) sem recriá-lo. */
export function setCorrelationFields(
  fields: Omit<Partial<CorrelationStore>, 'correlationId'>,
): void {
  const store = storage.getStore();
  if (!store) return;
  Object.assign(store, fields);
}
