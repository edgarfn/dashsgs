import { expect, test } from '@playwright/test';
import { closeDb, resetSeedAccounts } from './db';
import { alerta, aviso, CONTAS, loginComMfa, resetRateLimits } from './helpers';

/**
 * Governança da plataforma (Fase 9): retenção, offboarding e break-glass pelo navegador.
 *
 * São as três telas que um auditor pede para ver. Cada cenário aqui responde a uma pergunta que
 * alguém de fora vai fazer: "vocês apagam o que prometem?", "como um cliente sai?" e "quem da
 * equipe consegue olhar os dados do meu negócio, e com que autorização?".
 */

test.beforeEach(async () => {
  await resetRateLimits();
  await resetSeedAccounts(Object.values(CONTAS));
});

test.afterAll(async () => {
  await closeDb();
});

test.describe('Retenção', () => {
  test('mostra o catálogo do doc 10 e o placar de hoje', async ({ page }) => {
    await loginComMfa(page, CONTAS.plataforma);
    await page.goto('/plataforma');
    await page.getByRole('link', { name: 'Retenção e descarte' }).click();

    await expect(page.getByRole('heading', { name: 'Retenção e descarte' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Fora do prazo' })).toBeVisible();

    // O catálogo é a matriz do doc 10 §2 em forma de tabela.
    await expect(page.getByRole('cell', { name: 'app_audit_log' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'erp_venda_itens' })).toBeVisible();
  });

  test('executar a purga termina com tudo dentro do prazo', async ({ page }) => {
    await loginComMfa(page, CONTAS.plataforma);
    await page.goto('/plataforma/retencao');

    await page.getByRole('button', { name: 'Executar purga agora' }).click();
    await expect(aviso(page).first()).toContainText('Nada fora da retenção');
  });
});

test.describe('Offboarding', () => {
  test('desligar exige o slug digitado e explica quando a purga acontece', async ({ page }) => {
    await loginComMfa(page, CONTAS.plataforma);
    await page.goto('/plataforma');

    const slug = `teste-saida-${Date.now().toString(36)}`;
    await page.getByLabel('Nome da rede').fill('Rede que sai');
    await page.getByLabel('Slug', { exact: true }).fill(slug);
    await page.getByLabel('E-mail do owner').fill(`dono-${slug}@teste.local`);
    await page.getByRole('button', { name: 'Criar tenant e convidar owner' }).click();
    await expect(aviso(page).first()).toContainText(slug);

    const linha = page.locator('li', { hasText: slug });
    await expect(linha).toContainText('ativo');

    // O formulário mora dentro de um <details>: o estado de aberto é do DOM, não do React, e
    // clicar no resumo duas vezes fecharia de novo. Abrir só quando estiver fechado.
    const abrirDesligamento = async () => {
      const detalhe = linha.locator('details');
      const aberto = await detalhe.evaluate((elemento) => (elemento as HTMLDetailsElement).open);
      if (!aberto) await linha.locator('summary').click();
      await expect(linha.getByLabel('Motivo do desligamento')).toBeVisible();
    };

    await abrirDesligamento();
    await linha.getByLabel('Motivo do desligamento').fill('encerramento de contrato pelo E2E');

    // Slug errado não passa: é a confirmação que separa engano de decisão.
    await linha.getByLabel('Confirme o slug').fill('slug-errado');
    await linha.getByRole('button', { name: 'Desligar' }).click();
    await expect(linha.getByRole('alert')).toContainText('slug');

    await abrirDesligamento();
    await linha.getByLabel('Motivo do desligamento').fill('encerramento de contrato pelo E2E');
    await linha.getByLabel('Confirme o slug').fill(slug);
    await linha.getByRole('button', { name: 'Desligar' }).click();

    // Desligado sai da lista de contratos; a purga física fica agendada.
    await expect(page.locator('li', { hasText: slug })).toHaveCount(0);
  });
});

test.describe('Break-glass', () => {
  test('o pedido fica parado esperando outra pessoa aprovar', async ({ page }) => {
    await loginComMfa(page, CONTAS.plataforma);
    await page.goto('/plataforma/break-glass');

    await expect(page.getByRole('heading', { name: 'Break-glass' })).toBeVisible();

    await page.getByLabel('Chamado').fill(`SUP-${Date.now().toString(36)}`);
    await page
      .getByLabel('Justificativa')
      .fill('Cliente relata divergência no aging; preciso conferir as parcelas duplicadas.');
    await page.getByLabel('Papel concedido').selectOption('viewer');
    await page.getByRole('button', { name: 'Abrir pedido de acesso' }).click();

    await expect(aviso(page).first()).toContainText('outra pessoa');

    // Quem pediu não aprova — e a tela diz isso em vez de esconder o botão sem explicação.
    const pedido = page.locator('li', { hasText: 'aguardando 2ª pessoa' }).first();
    await expect(pedido).toContainText('você pediu, você não aprova');
    await expect(pedido.getByRole('button', { name: /Aprovar/ })).toHaveCount(0);
  });

  test('justificativa curta é recusada antes de virar pedido', async ({ page }) => {
    await loginComMfa(page, CONTAS.plataforma);
    await page.goto('/plataforma/break-glass');

    await page.getByLabel('Chamado').fill('SUP-1');
    await page.getByLabel('Justificativa').fill('suporte');
    await page.getByRole('button', { name: 'Abrir pedido de acesso' }).click();

    await expect(alerta(page).first()).toContainText('20 caracteres');
  });

  test('o relatório do chamado existe desde o primeiro minuto', async ({ page }) => {
    await loginComMfa(page, CONTAS.plataforma);
    await page.goto('/plataforma/break-glass');

    const ticket = `SUP-${Date.now().toString(36)}`;
    await page.getByLabel('Chamado').fill(ticket);
    await page
      .getByLabel('Justificativa')
      .fill('Investigação de inconsistência relatada pelo cliente no fechamento do dia.');
    await page.getByRole('button', { name: 'Abrir pedido de acesso' }).click();
    await expect(aviso(page).first()).toBeVisible();

    await page
      .locator('li', { hasText: ticket })
      .getByRole('link', { name: /Relatório/ })
      .click();

    await expect(page.getByRole('heading', { name: new RegExp(ticket) })).toBeVisible();
    await expect(page.getByText('Nenhuma requisição a dado do cliente')).toBeVisible();
  });
});
