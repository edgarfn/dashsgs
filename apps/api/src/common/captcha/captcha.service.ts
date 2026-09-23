import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { ENV, TURNSTILE_TEST_SECRET_ALWAYS_PASS, type Env } from '../../config';

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TIMEOUT_MS = 5000;

interface SiteverifyResponse {
  success?: boolean;
}

/**
 * Verificação do desafio Cloudflare Turnstile na tela de login (doc 06).
 *
 * Fail-closed de propósito: ao contrário do rate limiter (que tem o lockout em `app_users` como
 * rede de segurança — doc do RateLimiterService), este é hoje o único filtro contra automação
 * neste ponto. Cloudflare fora do ar vira login recusado, não um bypass silencioso.
 */
@Injectable()
export class CaptchaService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(CaptchaService.name);
  }

  async verify(token: string | undefined, remoteIp: string | null | undefined): Promise<boolean> {
    const secret = this.env.TURNSTILE_SECRET_KEY;

    // Atalho de dev/teste: a chave "sempre aprova" da Cloudflare não faz chamada de rede —
    // nenhum ambiente local precisa de conta real no Cloudflare para rodar o login.
    if (this.env.NODE_ENV !== 'production' && secret === TURNSTILE_TEST_SECRET_ALWAYS_PASS) {
      return true;
    }

    if (!token) return false;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const body = new URLSearchParams({ secret, response: token });
      if (remoteIp) body.set('remoteip', remoteIp);

      const response = await fetch(VERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: controller.signal,
      });

      const payload = (await response.json()) as SiteverifyResponse;
      return payload.success === true;
    } catch (error) {
      this.logger.error({ event: 'captcha_verify_failed', err: error }, 'captcha_verify_failed');
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}
