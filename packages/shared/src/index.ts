export * from './errors';
export * from './pagination';
export * from './tenancy';
export * from './authz';
export * from './auth';
export * from './health';

/** Prefixo único da API interna (doc 23). */
export const API_PREFIX = '/api/v1';
/** Header de correlação propagado da borda até os jobs (doc 18 §1). */
export const CORRELATION_ID_HEADER = 'x-correlation-id';
/** Header anti-CSRF em mutações (double-submit — doc 09 §1). */
export const CSRF_HEADER = 'x-csrf-token';
