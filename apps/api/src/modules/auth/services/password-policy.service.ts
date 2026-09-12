import { PASSWORD_MIN_LENGTH, PASSWORD_MIN_SCORE, type PasswordFeedback } from '@dashsgs/shared';
import { Injectable } from '@nestjs/common';
import { zxcvbnOptions, zxcvbnAsync } from '@zxcvbn-ts/core';
import * as zxcvbnCommon from '@zxcvbn-ts/language-common';
import * as zxcvbnPtBr from '@zxcvbn-ts/language-pt-br';
import { AppException } from '../../../common/errors/app.exception';

/**
 * Política de senha do doc 06 §Senhas, alinhada ao NIST 800-63B:
 * tamanho mínimo de 12, força mínima (zxcvbn ≥ 3), **sem** regras de composição e **sem**
 * expiração periódica. Exigir símbolo e trocar a cada 90 dias produz `Senha@2026!` — pior senha,
 * mais atrito, nenhuma segurança.
 */

/** Termos do próprio produto: "dashsgs2026" é adivinhação de primeira tentativa. */
const PRODUCT_TERMS = ['dashsgs', 'dash', 'sgsistemas', 'sg', 'supermercado', 'erp', 'varejo'];

@Injectable()
export class PasswordPolicyService {
  constructor() {
    zxcvbnOptions.setOptions({
      translations: zxcvbnPtBr.translations,
      graphs: zxcvbnCommon.adjacencyGraphs,
      dictionary: {
        ...zxcvbnCommon.dictionary,
        ...zxcvbnPtBr.dictionary,
      },
    });
  }

  /** Avalia sem lançar — usado pelo endpoint que alimenta o medidor de força na UI. */
  async evaluate(password: string, userInputs: string[] = []): Promise<PasswordFeedback> {
    const result = await zxcvbnAsync(password, [...PRODUCT_TERMS, ...userInputs]);
    const longEnough = password.length >= PASSWORD_MIN_LENGTH;

    return {
      score: result.score,
      acceptable: longEnough && result.score >= PASSWORD_MIN_SCORE,
      warning: longEnough
        ? (result.feedback.warning ?? undefined)
        : `A senha precisa de pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`,
      suggestions: result.feedback.suggestions ?? [],
    };
  }

  /**
   * Valida e lança VALIDATION_ERROR quando a senha não serve. O motivo vai em `details` como
   * caminho + regra; a sugestão do zxcvbn vai na mensagem, que é segura (não cita a senha).
   */
  async assertAcceptable(password: string, userInputs: string[] = []): Promise<void> {
    const feedback = await this.evaluate(password, userInputs);
    if (feedback.acceptable) return;

    throw new AppException('VALIDATION_ERROR', {
      message:
        feedback.warning ??
        'Senha muito previsível. Use uma frase longa e sem relação com seus dados.',
      details: [{ path: 'password', rule: 'password_policy' }],
    });
  }
}
