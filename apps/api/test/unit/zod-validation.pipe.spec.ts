import type { ArgumentMetadata } from '@nestjs/common';
import { z } from 'zod';
import { AppException } from '../../src/common/errors/app.exception';
import { ZodValidationPipe } from '../../src/common/validation/zod-validation.pipe';

const metadata: ArgumentMetadata = { type: 'body' };

const loginSchema = z
  .object({
    email: z.string().email(),
    senha: z.string().min(8),
  })
  .strict();

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(loginSchema);

  it('devolve o valor já tipado quando o payload é válido', () => {
    const result = pipe.transform({ email: 'a@b.com', senha: 'senha-forte' }, metadata);
    expect(result).toEqual({ email: 'a@b.com', senha: 'senha-forte' });
  });

  it('rejeita campos não declarados (whitelist — doc 09 §1)', () => {
    expect(() =>
      pipe.transform({ email: 'a@b.com', senha: 'senha-forte', isAdmin: true }, metadata),
    ).toThrow(AppException);
  });

  it('reporta caminho e regra, nunca o valor recebido', () => {
    expect.assertions(3);
    try {
      pipe.transform({ email: 'nao-e-email', senha: '123' }, metadata);
    } catch (error) {
      const appError = error as AppException;
      expect(appError.code).toBe('VALIDATION_ERROR');
      expect(appError.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: 'senha' })]),
      );
      expect(JSON.stringify(appError.details)).not.toContain('123');
    }
  });

  it('deixa passar erro que não é de validação', () => {
    const explodingSchema = {
      parse: () => {
        throw new RangeError('falha de infraestrutura');
      },
    } as unknown as z.ZodSchema<unknown>;

    expect(() => new ZodValidationPipe(explodingSchema).transform({}, metadata)).toThrow(
      RangeError,
    );
  });
});
