import { expect, test, type Page } from '@playwright/test';
import { closeDb, resetErpConnections, resetSeedAccounts } from './db';
import { alerta, aviso, CONTAS, login, loginComMfa, resetRateLimits } from './helpers';

/**
 * Wizard de conexão com o ERP (E4-07) pelo navegador.
 *
 * A aplicação roda com `SG_MOCK=true`: as fixtures respondem no lugar do ERP, então o fluxo
 * completo — salvar, testar, ver rotas contratadas — é exercido sem depender da SG.
 */

/** Usuário/senha que o transporte de mock aceita. */
const USUARIO_SG = 'homologacao';
const SENHA_SG = 'homologacao-senha-de-teste';
/** Host público reservado para documentação (RFC 2606): passa no guarda anti-SSRF. */
const BASE_URL_ERP = 'http://example.com:8201';

test.beforeEach(async () => {
  await resetRateLimits();
  await resetSeedAccounts(Object.values(CONTAS));
  await resetErpConnections();
});

/** O rótulo do campo muda ("Senha" → "Nova senha…") conforme já exista credencial no cofre. */
const campoSenha = (page: Page) => page.getByLabel(/senha/i).first();

test.afterAll(async () => {
  await closeDb();
});

test.describe('Admin — Conexão ERP', () => {
  test('quem não administra a conexão não vê a tela', async ({ page }) => {
    await login(page, CONTAS.analista);
    await expect(page.getByRole('link', { name: 'Conexão ERP' })).toHaveCount(0);

    await page.goto('/admin/conexao-erp');
    await expect(page.getByRole('heading', { name: 'Sem acesso a esta área' })).toBeVisible();
  });

  test('owner configura, testa e vê as rotas contratadas', async ({ page }) => {
    await loginComMfa(page, CONTAS.owner);

    await page.getByRole('link', { name: 'Conexão ERP' }).click();
    await expect(page.getByRole('heading', { name: 'Conexão com o ERP' })).toBeVisible();
    await expect(page.getByText('não testado')).toBeVisible();

    await page.getByLabel('Endereço do ERP').fill(BASE_URL_ERP);
    await page.getByLabel('Usuário de integração').fill(USUARIO_SG);
    await campoSenha(page).fill(SENHA_SG);
    await page.getByRole('button', { name: 'Salvar conexão' }).click();

    await expect(aviso(page).first()).toContainText('Conexão salva');

    await page.getByRole('button', { name: 'Testar conexão' }).click();
    await expect(aviso(page).first()).toContainText('Conexão OK');
    await expect(page.getByText('conectado')).toBeVisible();

    // O contrato com a SG fica visível: é ele que define quais painéis o produto pode oferecer.
    await expect(page.getByRole('heading', { name: /Rotas contratadas/ })).toBeVisible();
    await expect(page.getByText('GET /FILIAIS', { exact: true })).toBeVisible();
    // A versão do ERP aparece no cartão de estado (o aviso de sucesso também a cita).
    await expect(page.getByText('2026.03 · rev 1187')).toBeVisible();
  });

  test('endereço de rede interna é recusado com explicação', async ({ page }) => {
    await loginComMfa(page, CONTAS.owner);
    await page.goto('/admin/conexao-erp');

    await page.getByLabel('Endereço do ERP').fill('http://169.254.169.254/latest/meta-data');
    await page.getByLabel('Usuário de integração').fill(USUARIO_SG);
    await campoSenha(page).fill(SENHA_SG);
    await page.getByRole('button', { name: 'Salvar conexão' }).click();

    await expect(alerta(page).first()).toContainText('rede interna');
  });

  test('credencial errada deixa a conexão em erro, com motivo na tela', async ({ page }) => {
    await loginComMfa(page, CONTAS.owner);
    await page.goto('/admin/conexao-erp');

    await page.getByLabel('Endereço do ERP').fill(BASE_URL_ERP);
    await page.getByLabel('Usuário de integração').fill(USUARIO_SG);
    await campoSenha(page).fill('senha-que-nao-vale');
    await page.getByRole('button', { name: 'Salvar conexão' }).click();
    await expect(aviso(page).first()).toContainText('Conexão salva');

    await page.getByRole('button', { name: 'Testar conexão' }).click();
    await expect(alerta(page).first()).toContainText('credenciais');
    await expect(page.getByText('com erro')).toBeVisible();

    // Corrigir a senha volta tudo ao lugar — sem precisar reconfigurar o resto.
    await campoSenha(page).fill(SENHA_SG);
    await page.getByRole('button', { name: 'Salvar conexão' }).click();
    await page.getByRole('button', { name: 'Testar conexão' }).click();
    await expect(aviso(page).first()).toContainText('Conexão OK');
  });

  test('a senha nunca é devolvida para a tela', async ({ page }) => {
    await loginComMfa(page, CONTAS.owner);
    await page.goto('/admin/conexao-erp');

    await page.getByLabel('Endereço do ERP').fill(BASE_URL_ERP);
    await page.getByLabel('Usuário de integração').fill(USUARIO_SG);
    await campoSenha(page).fill(SENHA_SG);
    await page.getByRole('button', { name: 'Salvar conexão' }).click();
    await expect(aviso(page).first()).toContainText('Conexão salva');

    await page.reload();
    // O campo passa a ser "nova senha" e chega vazio; o HTML inteiro não contém o segredo.
    await expect(campoSenha(page)).toHaveValue('');
    expect(await page.content()).not.toContain(SENHA_SG);
  });
});
