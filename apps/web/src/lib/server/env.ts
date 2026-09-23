import 'server-only';

/**
 * Ambiente do front — lado servidor apenas.
 *
 * Regra do doc 09 §1: o navegador não recebe segredo nenhum. Só variáveis com prefixo
 * `NEXT_PUBLIC_` chegam ao cliente, e elas são, por definição, públicas.
 * `INTERNAL_API_URL` é o endereço da API dentro da rede privada e nunca é exposto.
 */
/** Site key "sempre aprova" da Cloudflare (doc do Cloudflare, "Testing") — nenhum ambiente
 * local precisa de conta real para ver a tela de login renderizar o widget. */
const TURNSTILE_TEST_SITE_KEY = '1x00000000000000000000AA';

export interface WebEnv {
  internalApiUrl: string;
  appName: string;
  appVersion: string;
  isProduction: boolean;
  /** Site key do widget Turnstile na tela de login — pública por design (doc 06). */
  turnstileSiteKey: string;
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
    turnstileSiteKey: process.env.TURNSTILE_SITE_KEY ?? TURNSTILE_TEST_SITE_KEY,
  };
}

/**
 * Só o NODE_ENV, sem validar o resto do contrato (`getWebEnv` exige `INTERNAL_API_URL`, que não
 * existe em tempo de build do Next — usar `getWebEnv()` aqui quebraria `next build`).
 */
export function isWebProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}
