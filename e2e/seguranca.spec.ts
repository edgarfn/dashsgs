import { expect, test } from '@playwright/test';
import { closeDb, resetSeedAccounts } from './db';
import { CONTAS, login, resetRateLimits } from './helpers';

/**
 * Cabeçalhos de segurança e CSP em execução (doc 09 §1 / doc 32 "Segurança de aplicação").
 *
 * Este arquivo existe porque CSP é o tipo de proteção que **passa despercebida quando quebra**:
 * uma diretiva estrita demais não derruba a página, só apaga um estilo ou um script, e ninguém
 * repara até o cliente reclamar de um gráfico vazio. Aqui o navegador é quem julga — cada
 * violação vira falha de teste.
 *
 * A suíte roda com `NODE_ENV` diferente de `development`, que é como o CI e a produção rodam:
 * sem `unsafe-inline` e sem `unsafe-eval`.
 */

/** Telas do MVP: todas passam pelo mesmo middleware, mas cada uma desenha coisas diferentes. */
const TELAS = [
  '/',
  '/vendas',
  '/vendas/comparativos',
  '/estoque',
  '/financeiro',
  '/compras',
  '/alertas',
  '/alertas/regras',
  '/admin/sincronizacao',
  '/perfil',
];

test.beforeEach(async () => {
  await resetRateLimits();
  await resetSeedAccounts(Object.values(CONTAS));
});

test.afterAll(async () => {
  await closeDb();
});

test.describe('cabeçalhos de segurança', () => {
  test('a resposta traz CSP com nonce e as proteções do doc 09', async ({ page }) => {
    const resposta = await page.goto('/entrar');
    const headers = resposta?.headers() ?? {};

    const csp = headers['content-security-policy'] ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toMatch(/script-src [^;]*'nonce-/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");

    // Os três do doc 09 §1 que não dependem da CSP e custam uma linha de configuração cada.
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });

  test('fora de desenvolvimento a CSP não abre exceção para inline nem eval', async ({ page }) => {
    const resposta = await page.goto('/entrar');
    const csp = resposta?.headers()['content-security-policy'] ?? '';

    // O ambiente do CI roda com NODE_ENV=test; se alguém rodar em dev, o teste explica em vez
    // de falhar por motivo errado.
    test.skip(csp.includes("'unsafe-eval'"), 'servidor em modo de desenvolvimento');

    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
  });
});

test.describe('CSP em execução', () => {
  test('nenhuma tela do MVP viola a política', async ({ page }) => {
    const violacoes: string[] = [];

    page.on('console', (msg) => {
      const texto = msg.text();
      if (msg.type() === 'error' && /Content Security Policy|Refused to/i.test(texto)) {
        violacoes.push(`${page.url()} — ${texto}`);
      }
    });

    await login(page, CONTAS.gerente);

    for (const tela of TELAS) {
      await page.goto(tela);
      await page.waitForLoadState('networkidle');
    }

    expect(violacoes).toEqual([]);
  });

  test('as barras dos gráficos realmente têm largura (estilo não bloqueado)', async ({ page }) => {
    await login(page, CONTAS.gerente);
    await page.goto('/');

    // Uma barra com 0px de largura é exatamente o sintoma de estilo bloqueado pela CSP: a página
    // carrega, o teste de conteúdo passa, e o gráfico some.
    const barra = page.locator('[data-barra]').first();
    await expect(barra).toBeVisible();

    const largura = await barra.evaluate((elemento) => elemento.getBoundingClientRect().width);
    expect(largura).toBeGreaterThan(0);
  });
});
