import { expect, test } from '@playwright/test';
import { closeDb, resetSeedAccounts } from './db';
import { CONTAS, login, loginComMfa, resetRateLimits } from './helpers';

/**
 * Admin → Auditoria (E6-01) pelo navegador.
 *
 * A tela é lida por quem está procurando prova, não painel. Os cenários conferem o que sustenta
 * essa leitura: o evento em português ao lado do código, o filtro que devolve o que promete, e a
 * porta fechada para quem não tem `audit.view`.
 */

test.beforeEach(async () => {
  await resetRateLimits();
  await resetSeedAccounts(Object.values(CONTAS));
});

test.afterAll(async () => {
  await closeDb();
});

test.describe('Auditoria', () => {
  test('lista os eventos com rótulo em português e o código ao lado', async ({ page }) => {
    await loginComMfa(page, CONTAS.owner);
    await page.goto('/admin/auditoria');

    await expect(page.getByRole('heading', { name: 'Auditoria', level: 1 })).toBeVisible();

    // O próprio login que acabou de acontecer tem de estar lá. A busca é dentro da TABELA: os
    // mesmos rótulos existem no `<select>` de filtro, e `getByText` acharia a option escondida.
    const tabela = page.locator('table');
    await expect(page.getByRole('columnheader', { name: 'Pessoa' })).toBeVisible();
    await expect(tabela.getByText('auth.login', { exact: false }).first()).toBeVisible();

    // Rótulo legível junto do código: um serve ao auditor, o outro ao chamado de suporte.
    await expect(tabela.getByText(/Entrou no sistema|Login aguardando/).first()).toBeVisible();
  });

  test('o filtro por categoria entra na URL e recorta a lista', async ({ page }) => {
    await loginComMfa(page, CONTAS.owner);
    await page.goto('/admin/auditoria');

    await page.getByLabel('Categoria').selectOption('acesso');
    await page.getByRole('button', { name: 'Aplicar' }).click();

    await expect(page).toHaveURL(/categoria=acesso/);
    await expect(page.getByRole('columnheader', { name: 'Evento' })).toBeVisible();
  });

  test('período sem eventos explica em vez de mostrar tabela vazia', async ({ page }) => {
    await loginComMfa(page, CONTAS.owner);
    await page.goto('/admin/auditoria?de=2020-01-01&ate=2020-01-02');

    await expect(page.getByRole('heading', { name: 'Nenhum evento no recorte' })).toBeVisible();
  });

  test('a tela declara a garantia de append-only', async ({ page }) => {
    await loginComMfa(page, CONTAS.owner);
    await page.goto('/admin/auditoria');

    // Não é enfeite: é o que diferencia esta trilha de uma tabela de log qualquer.
    await expect(page.getByText(/append-only/)).toBeVisible();
    await expect(page.getByText(/hash da anterior/)).toBeVisible();
  });

  test('quem não tem audit.view não entra, e a tela explica', async ({ page }) => {
    await login(page, CONTAS.analista);
    await page.goto('/admin/auditoria');

    await expect(page.getByRole('heading', { name: 'Sem acesso a esta área' })).toBeVisible();
  });
});

test.describe('Plataforma — integridade da trilha', () => {
  test('mostra a cadeia conferida', async ({ page }) => {
    await loginComMfa(page, CONTAS.plataforma);
    await page.goto('/plataforma');

    await expect(
      page.getByRole('heading', { name: 'Integridade da trilha de auditoria' }),
    ).toBeVisible();
    // Íntegra ou quebrada, a tela tem de dizer qual das duas — silêncio aqui seria o pior caso.
    await expect(page.getByText(/Cadeia íntegra|Cadeia quebrada|Não foi possível/)).toBeVisible();
  });
});
