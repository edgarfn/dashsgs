import 'server-only';

/**
 * Ambiente do front — lado servidor apenas.
 *
 * Regra do doc 09 §1: o navegador não recebe segredo nenhum. Só variáveis com prefixo
 * `NEXT_PUBLIC_` chegam ao cliente, e elas são, por definição, públicas.
 * `INTERNAL_API_URL` é o endereço da API dentro da rede privada e nunca é exposto.
 */
export interface WebEnv {
  internalApiUrl: string;
  appName: string;
  appVersion: string;
  isProduction: boolean;
}

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Variável de ambiente ausente no front: ${name} (ver .env.example)`);
  }
  return value;
}

export function getWebEnv(): WebEnv {
  return {
    internalApiUrl: required('INTERNAL_API_URL', process.env.INTERNAL_API_URL),
    appName: process.env.NEXT_PUBLIC_APP_NAME ?? 'DashSGS',
    appVersion: process.env.NEXT_PUBLIC_APP_VERSION ?? '0.1.0-dev',
    isProduction: process.env.NODE_ENV === 'production',
  };
}
