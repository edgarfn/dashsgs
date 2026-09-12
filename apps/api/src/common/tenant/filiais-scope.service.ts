import { Injectable } from '@nestjs/common';
import { AppException } from '../errors/app.exception';

/**
 * Recorte por filial (doc 07 §4.2).
 *
 * `filiais_allowed` vazio = todas as filiais do tenant. Quando a membership restringe, a
 * verificação acontece em DOIS lugares, de propósito:
 *  1. aqui, sobre o parâmetro explícito (`?filiais=3`) → 403 imediato, sem tocar no banco;
 *  2. no repositório, adicionando o filtro à consulta → mesmo sem parâmetro, só vem o permitido.
 *
 * Confiar só no filtro do repositório deixaria a porta aberta para um endpoint novo que esqueça
 * o `WHERE`; confiar só no guard não cobre a listagem sem parâmetro.
 */
export interface FilialScope {
  /** `null` = sem restrição (vê todas as filiais do tenant). */
  filiais: number[] | null;
}

@Injectable()
export class FiliaisScopeService {
  /**
   * Resolve o escopo efetivo a partir da membership e do que foi pedido na requisição.
   * Pedir uma filial fora da allowlist é 403 — e não "lista vazia", porque o usuário precisa
   * saber que o recorte dele não cobre aquilo.
   */
  resolve(allowed: number[], requested?: number[]): FilialScope {
    const semRestricao = allowed.length === 0;

    if (!requested || requested.length === 0) {
      return { filiais: semRestricao ? null : [...allowed] };
    }

    const unicas = [...new Set(requested)];
    if (semRestricao) return { filiais: unicas };

    const proibidas = unicas.filter((filial) => !allowed.includes(filial));
    if (proibidas.length > 0) {
      throw AppException.forbidden({
        reason: 'filial fora do recorte da membership',
        requested: unicas,
        allowed,
      });
    }

    return { filiais: unicas };
  }

  /** Cláusula pronta para o Prisma: `undefined` quando não há restrição. */
  whereClause(scope: FilialScope): { in: number[] } | undefined {
    return scope.filiais ? { in: scope.filiais } : undefined;
  }
}

/** `?filiais=1,2,3` → `[1, 2, 3]`. Entrada inválida é erro de validação, não filtro silencioso. */
export function parseFiliaisParam(raw: string | undefined): number[] | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;

  const parsed = raw.split(',').map((part) => Number(part.trim()));
  if (parsed.some((value) => !Number.isInteger(value) || value <= 0)) {
    throw new AppException('VALIDATION_ERROR', {
      message: 'Parâmetro de filiais inválido: use ids inteiros separados por vírgula.',
      details: [{ path: 'filiais', rule: 'lista_de_inteiros' }],
    });
  }
  if (parsed.length > 200) {
    throw new AppException('VALIDATION_ERROR', {
      message: 'Parâmetro de filiais excede o limite.',
      details: [{ path: 'filiais', rule: 'max_200' }],
    });
  }
  return parsed;
}
