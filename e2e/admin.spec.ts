import { expect, test } from '@playwright/test';
import { closeDb, resetSeedAccounts } from './db';
import {
  alerta,
  aviso,
  CONTAS,
  clearMailbox,
  expectLoggedIn,
  login,
  loginComMfa,
  resetRateLimits,
  waitForMailLink,
} from './helpers';

/**
 * Administração pelo navegador (Fase 4): gestão de acessos do tenant e painel da plataforma.
 * Os dois exigem MFA — são as telas que mexem em quem entra e em quais contratos existem.
 */

test.beforeEach(async () => {
  await resetRateLimits();
  await resetSeedAccounts(Object.values(CONTAS));
});

test.afterAll(async () => {
  await closeDb();
});

test.describe('Admin — Usuários', () => {
  test('quem não administra não vê a tela', async ({ page }) => {
    await login(page, CONTAS.analista);
    await expectLoggedIn(page);

    // O atalho não aparece…
    await expect(page.getByRole('link', { name: 'Usuários' })).toHaveCount(0);

    // …e a rota direta responde com um 403 amigável, sem revelar nada.
    await page.goto('/admin/usuarios');
    await expect(page.getByRole('heading', { name: 'Sem acesso a esta área' })).toBeVisible();
  });

  test('owner convida, vê o convite pendente e revoga', async ({ page }) => {
    await clearMailbox();
    await loginComMfa(page, CONTAS.owner);

    await page.getByRole('link', { name: 'Usuários' }).click();
    await expect(page).toHaveURL(/\/admin\/usuarios/);
    await expect(page.getByRole('heading', { name: 'Usuários e acessos' })).toBeVisible();

    const convidado = `convidado-${Date.now().toString(36)}@teste.local`;
    await page.getByLabel('E-mail').fill(convidado);
    await page.getByLabel('Papel').last().selectOption('viewer');
    await page.getByRole('button', { name: 'Enviar convite' }).click();

    await expect(aviso(page).first()).toContainText('Convite enviado');

    // O e-mail aparece no aviso e na lista; a asserção é sobre a lista.
    const pendentes = page.locator('section', { hasText: 'Convites pendentes' });
    await expect(pendentes.getByText(convidado)).toBeVisible();

    // O e-mail saiu de verdade.
    const link = await waitForMailLink(convidado, /http:\/\/[^\s]+\/convite\?token=[^\s]+/);
    expect(link).toContain('/convite?token=');

    await pendentes
      .locator('li', { hasText: convidado })
      .getByRole('button', { name: 'Revogar' })
      .click();
    await expect(pendentes.getByText(convidado)).toHaveCount(0);
  });

  test('owner ajusta o recorte de filiais de um membro', async ({ page }) => {
    await loginComMfa(page, CONTAS.owner);
    await page.goto('/admin/usuarios');

    const linha = page.locator('li', { hasText: CONTAS.analista });
    await linha.getByLabel('Filiais').fill('1,3');
    await linha.getByRole('button', { name: 'Salvar' }).click();

    await expect(page.getByLabel('Filiais').first()).toBeVisible();
    await page.reload();
    await expect(
      page.locator('li', { hasText: CONTAS.analista }).getByLabel('Filiais'),
    ).toHaveValue('1,3');

    // Devolve o recorte do seed para não mudar o estado dos outros cenários.
    const restaurar = page.locator('li', { hasText: CONTAS.analista });
    await restaurar.getByLabel('Filiais').fill('1,2');
    await restaurar.getByRole('button', { name: 'Salvar' }).click();
  });

  test('ninguém edita o próprio vínculo', async ({ page }) => {
    await loginComMfa(page, CONTAS.owner);
    await page.goto('/admin/usuarios');

    const propriaLinha = page.locator('li', { hasText: 'você' });
    await expect(propriaLinha).toContainText('Você não edita o próprio vínculo');
  });
});

test.describe('Painel da plataforma', () => {
  test('conta de tenant não encontra o painel', async ({ page }) => {
    await login(page, CONTAS.analista);
    await page.goto('/plataforma');
    await expect(page.getByRole('heading', { name: 'Página não encontrada' })).toBeVisible();
  });

  test('operação cria, suspende e reativa um contrato', async ({ page }) => {
    await clearMailbox();
    await loginComMfa(page, CONTAS.plataforma);

    await page.getByRole('link', { name: 'Plataforma' }).click();
    await expect(page.getByRole('heading', { name: 'Tenants' })).toBeVisible();

    const slug = `teste-e2e-${Date.now().toString(36)}`;
    await page.getByLabel('Nome da rede').fill('Rede E2E');
    await page.getByLabel('Slug').fill(slug);
    await page.getByLabel('E-mail do owner').fill(`dono-${slug}@teste.local`);
    await page.getByRole('button', { name: 'Criar tenant e convidar owner' }).click();

    await expect(aviso(page).first()).toContainText(slug);
    const criado = page.locator('li', { hasText: slug });
    await expect(criado).toContainText('ativo');
    await expect(criado).toContainText('1 convite(s) pendente(s)');

    // Suspender exige motivo — ele vai para a auditoria.
    await criado.getByRole('button', { name: 'Suspender' }).click();
    await expect(alerta(page).first()).toContainText('motivo');

    await criado.getByLabel('Motivo').fill('teste de suspensão pelo E2E');
    await criado.getByRole('button', { name: 'Suspender' }).click();

    const suspenso = page.locator('li', { hasText: slug });
    await expect(suspenso).toContainText('suspenso');
    await expect(suspenso).toContainText('teste de suspensão pelo E2E');

    await suspenso.getByRole('button', { name: 'Reativar' }).click();
    await expect(page.locator('li', { hasText: slug })).toContainText('ativo');
  });

  test('suspender um tenant tira os membros do ar na hora', async ({ page, browser }) => {
    // Gerente logado no tenant demo, em outro "dispositivo".
    const contextoGerente = await browser.newContext();
    const abaGerente = await contextoGerente.newPage();
    await login(abaGerente, CONTAS.gerente);
    await expectLoggedIn(abaGerente);

    await loginComMfa(page, CONTAS.plataforma);
    await page.goto('/plataforma');

    const demo = page.locator('li', { hasText: '(demo)' });
    await demo.getByLabel('Motivo').fill('corte temporário pelo E2E');
    await demo.getByRole('button', { name: 'Suspender' }).click();
    await expect(page.locator('li', { hasText: '(demo)' })).toContainText('suspenso');

    // A sessão que já estava aberta perde o acesso.
    await abaGerente.goto('/perfil');
    await expect(abaGerente).toHaveURL(/\/entrar/);

    // E um novo login é recusado com mensagem clara.
    await login(abaGerente, CONTAS.gerente);
    await expect(alerta(abaGerente)).toContainText('suspenso');

    // Reativa para deixar o ambiente como estava.
    await page
      .locator('li', { hasText: '(demo)' })
      .getByRole('button', { name: 'Reativar' })
      .click();
    await expect(page.locator('li', { hasText: '(demo)' })).toContainText('ativo');

    await login(abaGerente, CONTAS.gerente);
    await expectLoggedIn(abaGerente);
    await contextoGerente.close();
  });
});
