import type { Metadata, Viewport } from 'next';
import { cookies, headers } from 'next/headers';
import type { ReactNode } from 'react';
import { THEME_COOKIE, type Theme } from '@/lib/theme';
import './globals.css';

export const metadata: Metadata = {
  title: 'DashSGS',
  description: 'Painel analítico sobre o ERP SG Sistemas',
  // Nada de indexação: o produto é autenticado (doc 09 §1).
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f8fafc' },
    { media: '(prefers-color-scheme: dark)', color: '#020617' },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // O nonce vem do middleware; qualquer estilo/script inline precisa carregá-lo (doc 09 §1).
  const nonce = (await headers()).get('x-nonce') ?? undefined;

  // Sem cookie ainda (primeira visita): não escreve o atributo, e a media query de
  // `globals.css` decide sozinha, por navegador — sem palpite do servidor, sem risco de
  // hydration mismatch.
  const cookieTheme = (await cookies()).get(THEME_COOKIE)?.value;
  const theme: Theme | undefined =
    cookieTheme === 'light' || cookieTheme === 'dark' ? cookieTheme : undefined;

  return (
    <html lang="pt-BR" data-theme={theme}>
      <body className="min-h-screen bg-app-bg text-app-fg antialiased" nonce={nonce}>
        {children}
      </body>
    </html>
  );
}
