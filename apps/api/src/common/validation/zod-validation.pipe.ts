import { Injectable, type ArgumentMetadata, type PipeTransform } from '@nestjs/common';
import { ZodError, type ZodSchema } from 'zod';
import { AppException } from '../errors/app.exception';

/**
 * Validação de entrada por schema zod (doc 09 §1 "Backend": whitelist, tipos e limites em TODAS
 * as rotas). Campos não declarados são rejeitados pelo próprio schema (`.strict()`), que é o
 * equivalente ao `forbidNonWhitelisted` — a diferença é que aqui o contrato é explícito e
 * reaproveitável no front via pacote shared.
 *
 * Uso: `@Body(new ZodValidationPipe(loginSchema)) body: LoginInput`
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown, _metadata: ArgumentMetadata): T {
    try {
      return this.schema.parse(value);
    } catch (error) {
      if (error instanceof ZodError) {
        // Apenas caminho + regra: o valor recusado pode conter senha, token ou PII.
        throw AppException.validation(
          error.issues.map((issue) => ({
            path: issue.path.join('.') || '(raiz)',
            rule: issue.code,
          })),
        );
      }
      throw error;
    }
  }
}
