import { expect, test } from '@playwright/test';
import { closeDb, resetSeedAccounts } from './db';
import { CONTAS, login, resetRateLimits } from './helpers';

/**
 * Metas (E7-03) pelo navegador, sobre a previsão sintética do seed.
 *
 * A tela tem uma armadilha própria: quase tudo nela é uma divisão, e divisão errada não quebra a
 * página — devolve um número com cara de certo. Por isso os cenários conferem o **texto** que o
 * usuário lê (acima/abaixo da meta, base da projeção), e não só a presença dos blocos.
 */

test.beforeEach(async () => {
  await resetRateLimits();
  await resetSeedAccounts(Object.values(CONTAS));
});

test.afterAll(async () => {
  await closeDb();
});

test.describe('Metas', () => {
  test('mostra ritmo por filial, projeção e a base do cálculo', async ({ page }) => {
    await login(page, CONTAS.gerente);
    await page.getByRole('link', { name: 'Metas', exact: true }).click();

    await expect(page.getByRole('heading', { name: /^Metas — / })).toBeVisible();

    await expect(page.getByRole('heading', { name: 'Projeção do mês' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Meta do mês' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Esperado até hoje' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Ritmo por filial' })).toBeVisible();

    // O seed calibra a filial 3 abaixo da meta: a tela tem de dizer isso com PALAVRA, não só com
    // cor — é o requisito de acessibilidade do doc 16 §5.
    await expect(page.getByText('abaixo da meta').first()).toBeVisible();

    // O seed também lança a curva diária, então a projeção não é a proporcional.
    await expect(page.getByText(/segue a curva diária lançada no ERP/)).toBeVisible();
  });

  test('a tabela alternativa repete os números do gráfico', async ({ page }) => {
    await login(page, CONTAS.gerente);
    await page.goto('/metas');

    // Todo gráfico do produto tem "ver dados" ao lado (doc 16 §5): quem usa leitor de tela lê a
    // tabela, não a barra.
    await page.getByText('Ver dados').click();

    await expect(page.getByRole('columnheader', { name: 'Ritmo' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Projeção' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Atingimento' })).toBeVisible();
  });

  test('competência sem previsão explica em vez de mostrar zeros', async ({ page }) => {
    await login(page, CONTAS.gerente);

    // O seed lança só o mês corrente e o anterior; um mês antigo não tem meta nenhuma.
    await page.goto('/metas?competencia=2026-01');

    await expect(
      page.getByRole('heading', { name: 'Nenhuma meta lançada para este mês' }),
    ).toBeVisible();
    await expect(page.getByText(/previsão de vendas do ERP/)).toBeVisible();
  });

  test('o filtro de competência entra na URL — o link carrega o contexto', async ({ page }) => {
    await login(page, CONTAS.gerente);
    await page.goto('/metas');

    const mesPassado = new Date();
    mesPassado.setUTCDate(1);
    mesPassado.setUTCMonth(mesPassado.getUTCMonth() - 1);
    const competencia = mesPassado.toISOString().slice(0, 7);

    await page.getByLabel('Competência').fill(competencia);
    await page.getByRole('button', { name: 'Aplicar' }).click();

    await expect(page).toHaveURL(new RegExp(`competencia=${competencia}`));
    await expect(page.getByRole('heading', { name: /^Metas — / })).toBeVisible();
  });
});
