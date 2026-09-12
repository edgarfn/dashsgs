import { expect, type Page } from '@playwright/test';
import * as OTPAuth from 'otpauth';

/** Apoio dos testes E2E: dados do seed e utilitários de Mailpit/TOTP. */

export const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://127.0.0.1:8025';

/** A senha do seed é conhecida nos ambientes de teste (`SEED_PASSWORD`). */
export const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'Senha-Demo-Muito-Longa-2026';

export const CONTAS = {
  /** Papel sem exigência de MFA: entra direto. */
  analista: 'analista@demo.local',
  gerente: 'gerente@demo.local',
  /** Papel que exige segundo fator (doc 06 §MFA). */
  owner: 'owner@demo.local',
  /** Operação da plataforma: papel global, sem vínculo com tenant (doc 07 §2). */
  plataforma: 'plataforma@dashsgs.local',
} as const;

export async function login(page: Page, email: string, password = SEED_PASSWORD): Promise<void> {
  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  // O Server Action responde com redirecionamento; sem esperar, o teste navega antes do cookie.
  await page.waitForLoadState('networkidle');
}

/**
 * Entra numa conta que exige segundo fator, cadastrando o TOTP no caminho.
 *
 * O estado de MFA é zerado antes de cada cenário, então o fluxo é sempre o de cadastro — que é
 * também o primeiro acesso real de um owner ou de uma conta de plataforma.
 */
export async function loginComMfa(
  page: Page,
  email: string,
  password = SEED_PASSWORD,
): Promise<void> {
  await login(page, email, password);
  await expect(page).toHaveURL(/\/mfa\/cadastrar/);

  await page.getByText('Não consigo ler o QR').click();
  const secret = (await page.locator('details p').innerText()).trim();
  await page.getByLabel('Código do aplicativo').fill(totpCode(secret, email));
  await page.getByRole('button', { name: 'Ativar verificação' }).click();

  await expect(page).toHaveURL(/\/mfa\/codigos/);
  await page.getByRole('link', { name: /Guardei os códigos/ }).click();
  await expectLoggedIn(page);
}

/** Sai da aplicação e espera o redirecionamento concluir antes de seguir. */
export async function logout(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Sair' }).click();
  await page.waitForURL(/\/entrar/);
}

export function totpCode(secret: string, email: string): string {
  return new OTPAuth.TOTP({
    issuer: 'DashSGS',
    label: email,
    secret: OTPAuth.Secret.fromBase32(secret),
  }).generate();
}

/** Espera um e-mail chegar ao Mailpit e devolve o link que casar com o padrão. */
export async function waitForMailLink(to: string, pattern: RegExp, attempts = 30): Promise<string> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const search = await fetch(
      `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`,
    );
    if (search.ok) {
      const payload = (await search.json()) as { messages: Array<{ ID: string }> };
      const [message] = payload.messages ?? [];
      if (message) {
        const detail = (await (
          await fetch(`${MAILPIT_URL}/api/v1/message/${message.ID}`)
        ).json()) as { Text: string };
        const match = detail.Text.match(pattern);
        if (match) return match[0];
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`nenhum e-mail para ${to} casou com ${pattern} em ${attempts} tentativas`);
}

/** Limpa a caixa do Mailpit para que um teste não leia o e-mail do anterior. */
export async function clearMailbox(): Promise<void> {
  await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: 'DELETE' }).catch(() => undefined);
}

/**
 * Avisos da própria aplicação.
 *
 * O Next mantém um `<div role="alert">` invisível para anunciar mudança de rota; buscar por
 * papel na página inteira casaria com ele. Os nossos avisos vivem dentro de `<main>`.
 */
export function alerta(page: Page) {
  return page.locator('main').getByRole('alert');
}

export function aviso(page: Page) {
  return page.locator('main').getByRole('status');
}

export async function expectLoggedIn(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: /^Olá,/ })).toBeVisible();
}

/**
 * Zera os contadores de rate limit no Redis.
 *
 * A suíte inteira sai do mesmo IP e estouraria o limite de 10 logins/min (doc 06 §Fluxos) —
 * testando a si mesma, não o produto. O limite tem um cenário próprio, onde é o objeto do teste.
 */
export async function resetRateLimits(): Promise<void> {
  const { default: Redis } = await import('ioredis');
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });

  try {
    await redis.connect();
    const keys = await redis.keys('rl:*');
    if (keys.length > 0) await redis.del(...keys);
  } finally {
    redis.disconnect();
  }
}
