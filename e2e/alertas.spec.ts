import { expect, test } from '@playwright/test';
import { closeDb, limparAlertas, resetSeedAccounts } from './db';
import { CONTAS, aviso, login, resetRateLimits } from './helpers';

/**
 * Alertas (épico E8) pelo navegador.
 *
 * O roteiro é o do cliente: avaliar as regras, ver o que apareceu, abrir o contexto e reconhecer.
 * O seed deixa itens de curva A abaixo do mínimo, então a avaliação tem o que encontrar — não é
 * um teste sobre dado inventado na hora, é sobre o mesmo caminho que roda a cada 5 minutos.
 */

test.beforeEach(async () => {
  await resetRateLimits();
  await resetSeedAccounts(Object.values(CONTAS));
  await limparAlertas();
});

test.afterAll(async () => {
  await closeDb();
});

test.describe('Alertas', () => {
  test('avaliar agora traz os alertas do estado atual da rede', async ({ page }) => {
    await login(page, CONTAS.gerente);
    await page.getByRole('link', { name: 'Alertas' }).click();

    await expect(page.getByRole('heading', { name: 'Nenhum alerta aberto 🎉' })).toBeVisible();

    await page.getByRole('button', { name: 'Avaliar agora' }).click();
    await expect(aviso(page).filter({ hasText: 'Avaliação concluída' })).toBeVisible();

    // O seed deixa produtos de curva A em ruptura: é o alerta que precisa aparecer.
    await expect(
      page.getByRole('heading', { name: 'Ruptura de item curva A' }).first(),
    ).toBeVisible();
    await expect(page.getByText(/de curva A em ruptura/).first()).toBeVisible();
  });

  test('o alerta leva ao contexto e pode ser reconhecido', async ({ page }) => {
    await login(page, CONTAS.gerente);
    await page.goto('/alertas');
    await page.getByRole('button', { name: 'Avaliar agora' }).click();
    await expect(aviso(page).filter({ hasText: 'Avaliação concluída' })).toBeVisible();

    // "Ver contexto" abre a lista que originou o alerta.
    const daRuptura = page.locator('li', { hasText: 'Ruptura de item curva A' }).first();
    await daRuptura.getByRole('link', { name: 'Ver contexto' }).click();
    await expect(page).toHaveURL(/\/estoque\?situacao=ruptura/);

    await page.goto('/alertas');
    const abertosAntes = await page.getByRole('button', { name: 'Reconhecer' }).count();

    await page
      .locator('li', { hasText: 'Ruptura de item curva A' })
      .first()
      .getByRole('button', { name: 'Reconhecer' })
      .click();

    // O alerta reconhecido sai da lista de abertos — é para isso que o botão serve.
    await expect(page.getByRole('button', { name: 'Reconhecer' })).toHaveCount(abertosAntes - 1);

    // E aparece no filtro de reconhecidos, marcado com quem assumiu.
    await page.getByRole('link', { name: 'Reconhecidos', exact: true }).click();
    await expect(page.getByText('· reconhecido').first()).toBeVisible();
  });

  test('a home avisa que há alertas abertos', async ({ page }) => {
    await login(page, CONTAS.gerente);
    await page.goto('/alertas');
    await page.getByRole('button', { name: 'Avaliar agora' }).click();
    await expect(aviso(page).filter({ hasText: 'Avaliação concluída' })).toBeVisible();

    await page.goto('/');
    await expect(page.getByText(/alertas? abertos?/).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Ver alertas' })).toBeVisible();
  });

  test('quem só consulta não recebe alertas', async ({ page }) => {
    await login(page, CONTAS.analista);

    // O analista tem alerts.ack pela matriz do doc 07 — ele vê o feed.
    await page.goto('/alertas');
    await expect(page.getByRole('heading', { name: 'Alertas' })).toBeVisible();

    // Mas não configura avisos: isso é de owner, admin e manager.
    await page.goto('/alertas/regras');
    await expect(
      page.getByText('Configurar avisos é tarefa de quem administra a rede.'),
    ).toBeVisible();
  });
});

test.describe('Alertas — Regras', () => {
  test('mostra o que cada aviso observa e o que ainda depende de sync', async ({ page }) => {
    await login(page, CONTAS.gerente);
    await page.goto('/alertas/regras');

    await expect(page.getByRole('heading', { name: 'Avisos' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Ruptura de item curva A' })).toBeVisible();

    // Regras sem dado aparecem separadas, com o motivo — não somem da tela.
    await expect(page.getByRole('heading', { name: 'Aguardando dados' })).toBeVisible();
    // Com o financeiro sincronizado, o que resta aguardando é previsão, perdas e vencimentos.
    await expect(page.getByText(/depende de sincronização de vencimentos/).first()).toBeVisible();
  });

  test('desligar um aviso impede que ele volte a disparar', async ({ page }) => {
    await login(page, CONTAS.gerente);
    await page.goto('/alertas/regras');

    const cartao = page.locator('article', { hasText: 'Ruptura de item curva A' });
    await cartao.getByRole('button', { name: 'Desligar aviso' }).click();
    await expect(cartao.getByText('• desligado')).toBeVisible();

    await page.goto('/alertas');
    await page.getByRole('button', { name: 'Avaliar agora' }).click();
    await expect(aviso(page).filter({ hasText: 'Avaliação concluída' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Ruptura de item curva A' })).toHaveCount(0);

    // Devolve o estado do seed para os próximos cenários.
    await page.goto('/alertas/regras');
    await page
      .locator('article', { hasText: 'Ruptura de item curva A' })
      .getByRole('button', { name: 'Ligar aviso' })
      .click();
  });
});
