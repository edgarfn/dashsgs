import { defineConfig, devices } from '@playwright/test';

/**
 * E2E dos fluxos críticos (doc 17 §1): login + MFA, recuperação de senha, convite e perfil.
 *
 * Os testes rodam contra a aplicação de verdade — API, banco, Redis e Mailpit do compose. A
 * suíte assume `pnpm db:migrate && SEED_SYNTHETIC_DATA=true pnpm db:seed` executados com
 * `SEED_PASSWORD` conhecida — os 30 dias sintéticos de vendas são o que os cenários de dashboard
 * olham (doc 15), e `SEED_SYNTHETIC_DATA` está desligada por padrão desde 19/09/2026.
 */
const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  // Sem isto, o ambiente fica pior por ter rodado os testes: a última conta que cadastrou MFA
  // continuaria pedindo um código que só existia dentro do teste.
  globalTeardown: './e2e/global-teardown.ts',
  // Fluxos de autenticação compartilham contas do seed: em paralelo, um derruba a sessão do outro.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: WEB_URL,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
