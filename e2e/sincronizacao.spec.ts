import { expect, test } from '@playwright/test';
import { closeDb, resetBackfill, resetSeedAccounts } from './db';
import { CONTAS, aviso, login, loginComMfa, resetRateLimits } from './helpers';

/**
 * Painel de sincronização (E5-12) pelo navegador.
 *
 * O teste não espera o worker terminar nada: o que a tela promete é **mostrar o estado** e
 * **enfileirar pedidos**. Depender do processamento aqui tornaria o E2E lento e instável — a
 * execução em si é coberta pela suíte de integração.
 */

test.beforeEach(async () => {
  await resetRateLimits();
  await resetSeedAccounts(Object.values(CONTAS));
  await resetBackfill();
});

test.afterAll(async () => {
  await closeDb();
});

test.describe('Admin — Sincronização', () => {
  test('quem não administra a conexão não vê a tela', async ({ page }) => {
    await login(page, CONTAS.analista);
    await expect(page.getByRole('link', { name: 'Sincronização' })).toHaveCount(0);

    await page.goto('/admin/sincronizacao');
    await expect(page.getByRole('heading', { name: 'Sem acesso a esta área' })).toBeVisible();
  });

  test('owner vê o frescor de cada domínio e de cada filial', async ({ page }) => {
    await loginComMfa(page, CONTAS.owner);

    await page.getByRole('link', { name: 'Sincronização' }).click();
    await expect(page.getByRole('heading', { name: 'Sincronização' })).toBeVisible();

    // Cada domínio do catálogo vira um cartão, com a explicação em português de loja.
    await expect(page.getByRole('heading', { name: 'Vendas de hoje' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Cadastros' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Resumo diário' })).toBeVisible();

    // Domínio com recorte por filial mostra uma linha por loja; os demais, "Toda a rede".
    await expect(page.getByText('Toda a rede').first()).toBeVisible();
  });

  test('pedir sincronização agora devolve resposta imediata', async ({ page }) => {
    await loginComMfa(page, CONTAS.owner);
    await page.goto('/admin/sincronizacao');

    await page.getByRole('button', { name: 'Sincronizar agora' }).first().click();

    // A tela confirma o enfileiramento — ela não segura o usuário esperando o ERP responder.
    // O filtro é pelo texto, não pela posição: a página pode ter outro aviso no topo (o de
    // "informação atrasada"), e a ordem dos alertas não é o que este teste verifica.
    await expect(aviso(page).filter({ hasText: 'fila' })).toBeVisible();
  });

  test('a carga histórica é pedida com profundidade escolhida', async ({ page }) => {
    await loginComMfa(page, CONTAS.owner);
    await page.goto('/admin/sincronizacao');

    await expect(page.getByRole('heading', { name: 'Histórico' })).toBeVisible();
    await page.getByLabel('Profundidade do histórico').selectOption('30');
    await page.getByRole('button', { name: 'Carregar histórico' }).click();

    await expect(aviso(page).filter({ hasText: '30 dias' })).toBeVisible();
  });
});
