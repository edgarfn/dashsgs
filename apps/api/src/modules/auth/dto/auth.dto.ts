import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, ROLES } from '@dashsgs/shared';
import { z } from 'zod';

/**
 * Contratos de entrada da autenticação (doc 09 §1: validação com whitelist em TODAS as rotas).
 * `.strict()` rejeita campo não declarado — nada de mass assignment.
 */

const email = z.string().trim().toLowerCase().email().max(255);
const password = z.string().min(1).max(PASSWORD_MAX_LENGTH);
/** Senha nova passa pela política completa (tamanho aqui, força no PasswordPolicyService). */
const newPassword = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);
const totpCode = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'código TOTP tem 6 dígitos');
const opaqueToken = z.string().trim().min(20).max(200);

export const loginSchema = z
  .object({
    email,
    password,
    /** Enviado junto quando o usuário já sabe que tem MFA — evita uma ida e volta. */
    totp: totpCode.optional(),
    /** Token do widget Cloudflare Turnstile (doc 06). Ausente/inválido = login recusado — a
     * obrigatoriedade de fato vem do CaptchaService, não daqui (permite chave de teste em
     * dev/CI sem precisar mexer neste contrato). */
    captchaToken: z.string().optional(),
  })
  .strict();
export type LoginInput = z.infer<typeof loginSchema>;

export const totpVerifySchema = z
  .object({
    /** Código do app autenticador OU código de recuperação — um dos dois. */
    totp: totpCode.optional(),
    recoveryCode: z.string().trim().min(8).max(40).optional(),
  })
  .strict()
  .refine((value) => Boolean(value.totp) !== Boolean(value.recoveryCode), {
    message: 'informe o código TOTP ou um código de recuperação, não ambos',
  });
export type TotpVerifyInput = z.infer<typeof totpVerifySchema>;

export const totpEnableSchema = z.object({ totp: totpCode }).strict();
export type TotpEnableInput = z.infer<typeof totpEnableSchema>;

export const totpDisableSchema = z.object({ password, totp: totpCode }).strict();
export type TotpDisableInput = z.infer<typeof totpDisableSchema>;

export const passwordForgotSchema = z.object({ email }).strict();
export type PasswordForgotInput = z.infer<typeof passwordForgotSchema>;

export const passwordResetSchema = z.object({ token: opaqueToken, password: newPassword }).strict();
export type PasswordResetInput = z.infer<typeof passwordResetSchema>;

export const passwordChangeSchema = z
  .object({ currentPassword: password, newPassword })
  .strict()
  .refine((value) => value.currentPassword !== value.newPassword, {
    message: 'a nova senha precisa ser diferente da atual',
    path: ['newPassword'],
  });
export type PasswordChangeInput = z.infer<typeof passwordChangeSchema>;

export const inviteCreateSchema = z
  .object({
    email,
    name: z.string().trim().min(2).max(120).optional(),
    role: z.enum(ROLES),
    /** Vazio = todas as filiais do tenant (doc 05 §1). */
    filiaisAllowed: z.array(z.number().int().positive()).max(200).default([]),
  })
  .strict();
export type InviteCreateInput = z.infer<typeof inviteCreateSchema>;

export const inviteAcceptSchema = z
  .object({
    token: opaqueToken,
    name: z.string().trim().min(2).max(120).optional(),
    /** Obrigatória apenas para quem ainda não tem conta — validado no serviço. */
    password: newPassword.optional(),
  })
  .strict();
export type InviteAcceptInput = z.infer<typeof inviteAcceptSchema>;

export const selectTenantSchema = z.object({ tenantId: z.string().uuid() }).strict();
export type SelectTenantInput = z.infer<typeof selectTenantSchema>;
