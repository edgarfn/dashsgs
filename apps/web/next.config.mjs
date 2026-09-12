import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Configuração do Next.js (doc 09 §1 "Frontend").
 *
 * Cabeçalhos de segurança ficam aqui e no Caddy (defense in depth: se um deploy subir sem o
 * proxy na frente, a aplicação ainda responde protegida). A CSP com nonce é montada no
 * middleware, porque depende de um valor por requisição.
 */

/**
 * Em dev, o front lê o mesmo `.env` da raiz do monorepo que a API — um arquivo só para o
 * ambiente inteiro. Em produção isso não roda: a configuração vem do container (12-factor).
 */
if (process.env.NODE_ENV !== 'production') {
  const envPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../.env');
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (!match || process.env[match[1]] !== undefined) continue;
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Imagem de container enxuta (doc 19 §2). O modo standalone cria symlinks, o que exige
  // privilégio no Windows — então ele é ligado onde importa (Dockerfile/CI) e fica desligado
  // na máquina do dev, que usa `next dev`.
  output: process.env.NEXT_OUTPUT_STANDALONE === 'true' ? 'standalone' : undefined,
  // Raiz explícita do monorepo: sem isto o Next tenta adivinhar pelo lockfile mais próximo e,
  // numa máquina com outro lockfile acima do projeto, rastreia os arquivos errados.
  outputFileTracingRoot: resolve(dirname(fileURLToPath(import.meta.url)), '../..'),
  reactStrictMode: true,
  poweredByHeader: false,
  // A versão vem do pipeline; aparece no rodapé para correlacionar bug com artefato.
  env: {
    NEXT_PUBLIC_APP_VERSION: process.env.APP_VERSION ?? '0.1.0-dev',
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
          },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
