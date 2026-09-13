import { expect, test } from '@playwright/test';
import { closeDb, resetSeedAccounts } from './db';
import { CONTAS, login, loginComMfa, resetRateLimits } from './helpers';

/** O tenant vizinho tem dono próprio: ele entra no reset para o cenário de tenant vazio. */
const OWNER_VIZINHO = 'owner@vizinho.local';

/**
 * Dashboard (épico E7) pelo navegador, sobre os 30 dias sintéticos que o seed grava.
 *
 * Os cenários olham o que a pessoa vê: os cartões do dia, a curva, o diário cupom a cupom e a
 * lista de ruptura. Não conferem valores exatos — isso é papel da suíte de integração —, e sim
 * que a informação certa chega à tela certa, com o selo de frescor e o recorte de cada papel.
 */

test.beforeEach(async () => {
  await resetRateLimits();
  await resetSeedAccounts([...Object.values(CONTAS), OWNER_VIZINHO]);
});

test.afterAll(async () => {
  await closeDb();
});

test.describe('Visão Geral', () => {
  test('a home responde "como está o dia?" sem interação', async ({ page }) => {
    await login(page, CONTAS.gerente);

    await expect(page.getByRole('heading', { name: /^Olá,/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /^Hoje \(/ })).toBeVisible();

    // Os três números do doc 15 §1 aparecem sem clique nenhum.
    await expect(page.getByRole('heading', { name: 'Venda de hoje' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Cupons', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Ticket médio' }).first()).toBeVisible();

    // E vêm com o selo de frescor, marcando o dia corrente como parcial (doc 15 §9).
    await expect(page.getByText('parcial').first()).toBeVisible();
    await expect(page.getByText(/dados de \d{2}\/\d{2}\/\d{4}/).first()).toBeVisible();
  });

  test('a curva do dia traz a tabela equivalente para leitores de tela', async ({ page }) => {
    await login(page, CONTAS.gerente);

    await expect(page.getByRole('heading', { name: 'Curva do dia' })).toBeVisible();
    await expect(page.getByRole('img', { name: /Venda por hora de hoje/ })).toBeVisible();

    await page.getByText('Ver dados da curva').click();
    await expect(page.getByRole('columnheader', { name: 'Hora' })).toBeVisible();
  });

  test('o último dia fechado aparece com margem para quem é gerente', async ({ page }) => {
    await login(page, CONTAS.gerente);

    await expect(page.getByRole('heading', { name: /Último dia fechado/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Margem bruta' })).toBeVisible();
    await expect(page.getByText('Disponível para gerentes e administradores.')).toHaveCount(0);
    await expect(
      page.getByRole('heading', { name: 'Status do fechamento por filial' }),
    ).toBeVisible();
  });

  test('analista vê a venda, mas não o custo', async ({ page }) => {
    await login(page, CONTAS.analista);

    await expect(page.getByRole('heading', { name: /Último dia fechado/ })).toBeVisible();
    // Margem é de manager+ (doc 15 §1): o cartão explica em vez de sumir.
    await expect(page.getByText('Disponível para gerentes e administradores.')).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Status do fechamento por filial' }),
    ).toHaveCount(0);
  });
});

test.describe('Vendas', () => {
  test('o diário lista cupons e permite escolher o dia', async ({ page }) => {
    await login(page, CONTAS.gerente);
    await page.getByRole('link', { name: 'Vendas', exact: true }).click();

    await expect(page.getByRole('heading', { name: /Diário de vendas/ })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Cupom' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /^Cupons \(/ })).toBeVisible();

    const ontem = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    await page.getByLabel('Dia').fill(ontem);
    await page.getByRole('button', { name: 'Aplicar' }).click();

    await expect(page).toHaveURL(new RegExp(`data=${ontem}`));
    await expect(page.getByRole('heading', { name: /Diário de vendas/ })).toBeVisible();
  });

  test('o comparativo mostra série, ranking e dia da semana', async ({ page }) => {
    await login(page, CONTAS.gerente);
    await page.goto('/vendas/comparativos');

    await expect(page.getByRole('heading', { name: 'Comparativos' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Venda por dia' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Ranking de filiais' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Por dia da semana/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Venda por departamento' })).toBeVisible();
  });

  test('exportar CSV baixa o arquivo do dia', async ({ page }) => {
    await login(page, CONTAS.gerente);
    await page.goto('/vendas');

    const download = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Exportar CSV' }).click();
    const arquivo = await download;

    expect(arquivo.suggestedFilename()).toMatch(/^vendas-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});

test.describe('Estoque', () => {
  test('mostra a ruptura priorizada pela curva A', async ({ page }) => {
    await login(page, CONTAS.gerente);
    await page.getByRole('link', { name: 'Estoque', exact: true }).click();

    await expect(page.getByRole('heading', { name: /Ruptura/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Curva A em ruptura' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Cobertura' })).toBeVisible();

    // O seed deixa itens de curva A abaixo do mínimo: a primeira linha é um deles.
    await expect(page.getByRole('cell', { name: 'A', exact: true }).first()).toBeVisible();
  });

  test('troca a situação sem perder o filtro', async ({ page }) => {
    await login(page, CONTAS.gerente);
    await page.goto('/estoque?curva=A');

    await page.getByRole('heading', { name: 'Estoque negativo' }).click();

    await expect(page).toHaveURL(/situacao=negativo/);
    await expect(page).toHaveURL(/curva=A/);
  });
});

test.describe('Tenant sem dados', () => {
  test('explica o que falta em vez de mostrar zero seco', async ({ page }) => {
    // O tenant vizinho existe no seed sem movimento nenhum — é o primeiro dia de um cliente novo.
    await loginComMfa(page, OWNER_VIZINHO);

    await expect(
      page.getByRole('heading', { name: 'Ainda não há dados do seu ERP' }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Ver sincronização' })).toBeVisible();
  });
});
