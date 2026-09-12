/** Contrato dos health checks (doc 18 §3), consumido pelo front e pelos smoke tests. */
export type HealthState = 'ok' | 'degraded' | 'down';

export interface DependencyHealth {
  name: 'postgres' | 'redis' | 'migrations';
  state: HealthState;
  latencyMs?: number;
  detail?: string;
}

export interface ReadinessBody {
  state: HealthState;
  version: string;
  uptimeSeconds: number;
  checks: DependencyHealth[];
}

export interface LivenessBody {
  state: 'ok';
  version: string;
  uptimeSeconds: number;
}
