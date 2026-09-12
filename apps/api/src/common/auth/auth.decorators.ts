import { type Permission } from '@dashsgs/shared';
import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { AppException } from '../errors/app.exception';
import { type AuthContext, type RequestIdentity } from './auth.types';

/** Rota pública (login, recuperação, convite). Tudo o mais exige sessão — o padrão é fechado. */
export const IS_PUBLIC = 'auth:public';
export const Public = () => SetMetadata(IS_PUBLIC, true);

/**
 * Rota alcançável com sessão PARCIAL (senha ok, MFA pendente): só o necessário para concluir o
 * segundo fator — cadastrar TOTP, verificar código, sair.
 */
export const ALLOW_PENDING_MFA = 'auth:allow-pending-mfa';
export const AllowPendingMfa = () => SetMetadata(ALLOW_PENDING_MFA, true);

/** Permissões exigidas (doc 07 §3). Todas precisam estar presentes. */
export const REQUIRED_PERMISSIONS = 'auth:permissions';
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(REQUIRED_PERMISSIONS, permissions);

/** Ação sensível: exige verificação de MFA nos últimos 15 minutos (doc 07 §4.3). */
export const REQUIRE_RECENT_MFA = 'auth:recent-mfa';
export const RequireRecentMfa = () => SetMetadata(REQUIRE_RECENT_MFA, true);

/** Contexto autenticado da requisição. */
export const CurrentAuth = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthContext => {
    const request = ctx.switchToHttp().getRequest<Request>();
    if (!request.auth) throw new AppException('AUTH_REQUIRED');
    return request.auth;
  },
);

/** IP e user-agent normalizados — usados em auditoria e rate limit. */
export const Identity = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestIdentity => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return {
      // `trust proxy` está ligado no bootstrap: aqui já é o IP real do cliente (doc 19 §2).
      ip: request.ip ?? null,
      userAgent: request.get('user-agent') ?? null,
    };
  },
);
