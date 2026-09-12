import { type AppException } from '../../src/common/errors/app.exception';
import { PasswordPolicyService } from '../../src/modules/auth/services/password-policy.service';
import { lockMinutesFor } from '../../src/modules/auth/services/auth.service';
import { generateRecoveryCode } from '../../src/modules/auth/services/totp.service';

describe('política de senha (doc 06 §Senhas)', () => {
  const policy = new PasswordPolicyService();

  it('aceita frase longa e imprevisível', async () => {
    const feedback = await policy.evaluate('trombone azul quarenta e sete');
    expect(feedback.acceptable).toBe(true);
    expect(feedback.score).toBeGreaterThanOrEqual(3);
  });

  it('recusa senha curta mesmo que pareça forte', async () => {
    const feedback = await policy.evaluate('Xk7!aZ2q');
    expect(feedback.acceptable).toBe(false);
    expect(feedback.warning).toContain('12 caracteres');
  });

  it.each([
    ['senha comum', 'senha123456789'],
    ['sequência', 'abcdefghijklm'],
    ['repetição', 'aaaaaaaaaaaaaa'],
    ['termo do produto repetido', 'dashsgsdashsgs'],
  ])('recusa %s', async (_caso, password) => {
    const feedback = await policy.evaluate(password);
    expect(feedback.acceptable).toBe(false);
  });

  /**
   * O modelo do zxcvbn aceita `dashsgs2026dashsgs` (≈10^8 tentativas). Seguimos a régua do
   * doc 06 (score ≥ 3, sem regra de composição própria) — registrado aqui para que a próxima
   * pessoa saiba que é escolha, não esquecimento. Se um dia virar problema real, a decisão de
   * banir termos do produto por regra dura passa por ADR.
   */
  it('segue a régua do zxcvbn mesmo quando o resultado surpreende', async () => {
    const feedback = await policy.evaluate('dashsgs2026dashsgs');
    expect(feedback.score).toBeGreaterThanOrEqual(3);
  });

  it('considera o contexto do usuário (e-mail e nome não viram senha)', async () => {
    const feedback = await policy.evaluate('joao.silva@empresa.com.br', [
      'joao.silva@empresa.com.br',
      'João Silva',
    ]);
    expect(feedback.acceptable).toBe(false);
  });

  it('lança VALIDATION_ERROR com o motivo, sem ecoar a senha', async () => {
    expect.assertions(3);
    try {
      await policy.assertAcceptable('senha123456789');
    } catch (error) {
      const appError = error as AppException;
      expect(appError.code).toBe('VALIDATION_ERROR');
      expect(appError.details).toEqual([{ path: 'password', rule: 'password_policy' }]);
      expect(JSON.stringify(appError.details) + appError.message).not.toContain('senha123456789');
    }
  });
});

describe('bloqueio incremental (doc 06 §Fluxos)', () => {
  it.each([
    [0, 0],
    [4, 0],
    [5, 1],
    [6, 2],
    [7, 4],
    [8, 8],
    [9, 15],
    [20, 15],
  ])('%i falhas → %i minuto(s) de bloqueio', (falhas, minutos) => {
    expect(lockMinutesFor(falhas)).toBe(minutos);
  });
});

describe('códigos de recuperação', () => {
  it('seguem o formato legível e não repetem', () => {
    const codigos = Array.from({ length: 200 }, () => generateRecoveryCode());

    for (const codigo of codigos) {
      expect(codigo).toMatch(/^[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}$/);
    }
    // Sem caracteres ambíguos (i, l, o, 0, 1) — o código é ditado por telefone.
    expect(codigos.join('')).not.toMatch(/[ilo01]/);
    expect(new Set(codigos).size).toBe(codigos.length);
  });
});
