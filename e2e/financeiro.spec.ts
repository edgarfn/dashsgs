import { expect, test } from '@playwright/test';
import { closeDb, resetSeedAccounts } from './db';
import { CONTAS, login, resetRateLimits } from './helpers';

/**
 * Financeiro e Compras (E7-08) pelo navegador, sobre os dados sintéticos do seed.
 *
 * O que os cenários verificam é o que distingue estas telas das demais: elas mostram dívida,
 * custo e taxa — e por isso ficam com quem tem papel de gestão.
 */

test.beforeEach(async () => {
  await resetRateLimits();
  await resetSeedAccounts(Object.values(CONTAS));
});

test.afterAll(async () => {
  await closeDb();
});

test.describe('Financeiro', () => {
  test('mostra aging, fluxo, despesas e cartões', async ({ page }) => {
    await login(page, CONTAS.gerente);
    await page.getByRole('link', { name: 'Financeiro', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Financeiro' })).toBeVisible();

    // Aging dos dois lados, com a faixa de vencido destacada.
    await expect(page.getByRole('heading', { name: 'A pagar' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'A receber' })).toBeVisible();
    await expect(page.getByText('Vencido').first()).toBeVisible();

    await expect(page.getByRole('heading', { name: 'Fluxo previsto por semana' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Despesas do período' })).toBeVisible();

    // Cartões com a taxa média efetiva e o que está sem conciliar.
    await expect(page.getByRole('heading', { name: 'Cartões' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Taxa média efetiva' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Não conciliados' })).toBeVisible();
  });

  test('analista não entra no financeiro, e a tela explica', async ({ page }) => {
    await login(page, CONTAS.analista);

    // O atalho aparece (é dashboard.view), mas a API recusa e a tela justifica.
    await page.goto('/financeiro');
    await expect(page.getByText(/fica com quem tem papel de gestão/)).toBeVisible();
  });
});

test.describe('Compras', () => {
  test('mostra pedidos por situação, lead time e pedidos parados', async ({ page }) => {
    await login(page, CONTAS.gerente);
    await page.getByRole('link', { name: 'Compras', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Compras' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Lead time médio' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Pedidos por situação' })).toBeVisible();

    // O seed deixa pedidos parados há semanas: é a lista que o comprador usa para cobrar.
    await expect(page.getByRole('heading', { name: 'Pedidos parados' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Dias parado' })).toBeVisible();
  });

  test('o período filtra os pedidos', async ({ page }) => {
    await login(page, CONTAS.gerente);
    await page.goto('/compras');

    const ontem = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    await page.getByLabel('Pedidos de').fill(ontem);
    await page.getByRole('button', { name: 'Aplicar' }).click();

    await expect(page).toHaveURL(new RegExp(`de=${ontem}`));
    // Sem pedidos no recorte de um dia, a tela explica em vez de mostrar zeros.
    await expect(page.getByRole('heading', { name: 'Nenhum pedido no período' })).toBeVisible();
  });
});
