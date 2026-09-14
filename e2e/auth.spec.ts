import { expect, test } from '@playwright/test';
import { closeDb, resetSeedAccounts } from './db';
import {
  alerta,
  aviso,
  CONTAS,
  SEED_PASSWORD,
  clearMailbox,
  expectLoggedIn,
  login,
  logout,
  totpCode,
  resetRateLimits,
  waitForMailLink,
} from './helpers';

/**
 * Fluxos críticos de autenticação pelo navegador (doc 17 §1 "E2E").
 * Estes testes rodam contra a aplicação real: Next → API → Postgres/Redis/Mailpit.
 */

test.beforeEach(async () => {
  // Ponto de partida conhecido: sem contador de rate limit, sem sessão pendurada e sem MFA
  // herdado do cenário anterior. Sessões duram 12 h — sem isto, um teste vê o estado do outro.
  await resetRateLimits();
  await resetSeedAccounts(Object.values(CONTAS));
});

test.afterAll(async () => {
  await closeDb();
});

test.describe('login', () => {
  test('entra com credenciais válidas e chega à home', async ({ page }) => {
    await login(page, CONTAS.analista);

    await expectLoggedIn(page);
    await expect(page).toHaveURL('/');
    // A home é o painel: quem entra já vê o dia (doc 15 §1).
    await expect(page.getByRole('heading', { name: /^Hoje \(/ })).toBeVisible();
  });

  test('mostra erro genérico para senha errada', async ({ page }) => {
    await login(page, CONTAS.analista, 'senha-errada-porem-longa');

    await expect(alerta(page)).toContainText('Credenciais inválidas');
    await expect(page).toHaveURL(/\/entrar/);
  });

  test('rota protegida sem sessão volta para o login', async ({ page }) => {
    await page.goto('/perfil');
    await expect(page).toHaveURL(/\/entrar/);
  });

  test('sai da aplicação e a sessão deixa de valer', async ({ page }) => {
    await login(page, CONTAS.analista);
    await expectLoggedIn(page);

    await logout(page);
    await expect(page).toHaveURL(/\/entrar/);

    await page.goto('/perfil');
    await expect(page).toHaveURL(/\/entrar/);
  });
});

test.describe('verificação em duas etapas', () => {
  test('owner cadastra o TOTP no primeiro acesso e depois entra com o código', async ({ page }) => {
    await login(page, CONTAS.owner);

    // Papel exige MFA: o login leva direto para o cadastro do segundo fator.
    await expect(page).toHaveURL(/\/mfa\/cadastrar/);
    await expect(page.getByRole('img', { name: /QR code/i })).toBeVisible();

    await page.getByText('Não consigo ler o QR').click();
    const secret = (await page.locator('details p').innerText()).trim();
    expect(secret).toMatch(/^[A-Z2-7]+$/);

    await page.getByLabel('Código do aplicativo').fill(totpCode(secret, CONTAS.owner));
    await page.getByRole('button', { name: 'Ativar verificação' }).click();

    // Os códigos de recuperação aparecem uma única vez.
    await expect(page).toHaveURL(/\/mfa\/codigos/);
    await expect(page.locator('ul li')).toHaveCount(10);
    await page.getByRole('link', { name: /Guardei os códigos/ }).click();
    await expectLoggedIn(page);

    // Novo login agora passa pelo desafio do segundo fator.
    await logout(page);
    await login(page, CONTAS.owner);
    await expect(page).toHaveURL(/\/mfa(?!\/)/);

    await page.getByLabel('Código do aplicativo').fill(totpCode(secret, CONTAS.owner));
    await page.getByRole('button', { name: 'Verificar' }).click();
    await expectLoggedIn(page);
  });

  test('código inválido não abre a sessão', async ({ page }) => {
    // Cadastra o segundo fator para chegar à tela de desafio (o estado é zerado a cada cenário).
    await login(page, CONTAS.owner);
    await expect(page).toHaveURL(/\/mfa\/cadastrar/);
    await page.getByText('Não consigo ler o QR').click();
    const secret = (await page.locator('details p').innerText()).trim();
    await page.getByLabel('Código do aplicativo').fill(totpCode(secret, CONTAS.owner));
    await page.getByRole('button', { name: 'Ativar verificação' }).click();
    await expect(page).toHaveURL(/\/mfa\/codigos/);
    await page.getByRole('link', { name: /Guardei os códigos/ }).click();
    await logout(page);

    await login(page, CONTAS.owner);
    await expect(page).toHaveURL(/\/mfa(?!\/)/);

    await page.getByLabel('Código do aplicativo').fill('000000');
    await page.getByRole('button', { name: 'Verificar' }).click();

    await expect(alerta(page)).toBeVisible();
    await expect(page).toHaveURL(/\/mfa/);
  });
});

test.describe('recuperação de senha', () => {
  test('recebe o link por e-mail, redefine e entra com a senha nova', async ({ page }) => {
    const novaSenha = 'Girassol-Tranquilo-Oitenta-3';
    await clearMailbox();

    await page.goto('/esqueci-senha');
    await page.getByLabel('E-mail').fill(CONTAS.gerente);
    await page.getByRole('button', { name: 'Enviar link' }).click();
    await expect(aviso(page)).toContainText('Se houver uma conta');

    const link = await waitForMailLink(
      CONTAS.gerente,
      /http:\/\/[^\s]+\/redefinir-senha\?token=[^\s]+/,
    );
    await page.goto(link);

    await page.getByLabel('Nova senha', { exact: true }).fill(novaSenha);
    await page.getByLabel('Confirme a nova senha').fill(novaSenha);
    await page.getByRole('button', { name: 'Salvar nova senha' }).click();

    await expect(page).toHaveURL(/\/entrar\?redefinida=1/);
    await expect(aviso(page)).toContainText('Senha redefinida');

    await login(page, CONTAS.gerente, novaSenha);
    await expectLoggedIn(page);

    // Devolve a senha do seed para não quebrar os demais cenários.
    await page.goto('/perfil');
    await page.getByLabel('Senha atual').fill(novaSenha);
    await page.getByLabel('Nova senha', { exact: true }).fill(SEED_PASSWORD);
    await page.getByLabel('Confirme a nova senha').fill(SEED_PASSWORD);
    await page.getByRole('button', { name: 'Trocar senha' }).click();
    await expect(aviso(page)).toContainText('Senha alterada');
  });

  test('senha fraca é recusada com explicação', async ({ page }) => {
    await clearMailbox();
    await page.goto('/esqueci-senha');
    await page.getByLabel('E-mail').fill(CONTAS.analista);
    await page.getByRole('button', { name: 'Enviar link' }).click();

    const link = await waitForMailLink(
      CONTAS.analista,
      /http:\/\/[^\s]+\/redefinir-senha\?token=[^\s]+/,
    );
    await page.goto(link);

    await page.getByLabel('Nova senha', { exact: true }).fill('senha12345678');
    await page.getByLabel('Confirme a nova senha').fill('senha12345678');
    await page.getByRole('button', { name: 'Salvar nova senha' }).click();

    await expect(alerta(page)).toBeVisible();
    await expect(page).toHaveURL(/\/redefinir-senha/);
  });
});

test.describe('perfil', () => {
  test('lista dispositivos conectados e encerra outra sessão', async ({ page, browser }) => {
    await login(page, CONTAS.analista);
    await expectLoggedIn(page);

    // Segundo "dispositivo": outro contexto de navegador com a mesma conta.
    const outroContexto = await browser.newContext();
    const outraAba = await outroContexto.newPage();
    await login(outraAba, CONTAS.analista);
    await expectLoggedIn(outraAba);

    await page.goto('/perfil');
    const linhas = page.locator('section:has-text("Dispositivos conectados") li');
    await expect(linhas).toHaveCount(2);

    await page.getByRole('button', { name: 'Encerrar' }).first().click();
    await expect(linhas).toHaveCount(1);

    // A sessão encerrada perde o acesso na próxima navegação.
    await outraAba.goto('/perfil');
    await expect(outraAba).toHaveURL(/\/entrar/);
    await outroContexto.close();
  });

  test('troca de senha exige a senha atual', async ({ page }) => {
    await login(page, CONTAS.analista);
    await page.goto('/perfil');

    await page.getByLabel('Senha atual').fill('senha-errada-porem-longa');
    await page.getByLabel('Nova senha', { exact: true }).fill('Bicicleta-Verde-Quarenta-1');
    await page.getByLabel('Confirme a nova senha').fill('Bicicleta-Verde-Quarenta-1');
    await page.getByRole('button', { name: 'Trocar senha' }).click();

    await expect(alerta(page)).toContainText('Senha atual incorreta');
  });
});
