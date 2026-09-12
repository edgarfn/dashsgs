import { Injectable } from '@nestjs/common';
import { type Env } from './env.schema';

export interface SgConfig {
  maxRps: number;
  timeoutMs: number;
  heavyTimeoutMs: number;
  mock: boolean;
  allowInsecure: boolean;
}

/**
 * Fachada tipada sobre o ambiente já validado. É injetada onde for preciso — nenhum outro
 * módulo volta a ler `process.env` (doc 24 §6).
 */
@Injectable()
export class AppConfigService {
  constructor(private readonly env: Env) {}

  get nodeEnv(): Env['NODE_ENV'] {
    return this.env.NODE_ENV;
  }

  get isProduction(): boolean {
    return this.env.NODE_ENV === 'production';
  }

  get isDevelopment(): boolean {
    return this.env.NODE_ENV === 'development';
  }

  get version(): string {
    return this.env.APP_VERSION;
  }

  get port(): number {
    return this.env.PORT;
  }

  get appUrl(): string {
    return this.env.APP_URL;
  }

  get apiUrl(): string {
    return this.env.API_URL;
  }

  get logLevel(): Env['LOG_LEVEL'] {
    return this.env.LOG_LEVEL;
  }

  get databaseUrl(): string {
    return this.env.DATABASE_URL;
  }

  get redisUrl(): string {
    return this.env.REDIS_URL;
  }

  get metricsEnabled(): boolean {
    return this.env.METRICS_ENABLED;
  }

  get sg(): SgConfig {
    return {
      maxRps: this.env.SG_DEFAULT_MAX_RPS,
      timeoutMs: this.env.SG_HTTP_TIMEOUT_MS,
      heavyTimeoutMs: this.env.SG_HEAVY_TIMEOUT_MS,
      mock: this.env.SG_MOCK,
      allowInsecure: this.env.ALLOW_INSECURE_ERP,
    };
  }

  get features(): { erpWrite: boolean; clientModule: boolean } {
    return {
      erpWrite: this.env.FEATURE_ERP_WRITE,
      clientModule: this.env.FEATURE_CLIENT_MODULE,
    };
  }

  /** Fotografia segura da configuração para o log de boot — segredos jamais aparecem aqui. */
  safeSnapshot(): Record<string, string | number | boolean> {
    return {
      nodeEnv: this.env.NODE_ENV,
      version: this.env.APP_VERSION,
      port: this.env.PORT,
      appUrl: this.env.APP_URL,
      apiUrl: this.env.API_URL,
      logLevel: this.env.LOG_LEVEL,
      metricsEnabled: this.env.METRICS_ENABLED,
      sgMaxRps: this.env.SG_DEFAULT_MAX_RPS,
      sgMock: this.env.SG_MOCK,
      allowInsecureErp: this.env.ALLOW_INSECURE_ERP,
      featureErpWrite: this.env.FEATURE_ERP_WRITE,
      featureClientModule: this.env.FEATURE_CLIENT_MODULE,
      masterKeyVersion: this.env.MASTER_KEY_VERSION,
    };
  }
}
