import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';
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
  themeColor: '#0b1220',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // O nonce vem do middleware; qualquer estilo/script inline precisa carregá-lo (doc 09 §1).
  const nonce = (await headers()).get('x-nonce') ?? undefined;

  return (
    <html lang="pt-BR">
      <body className="min-h-screen bg-slate-950 text-slate-100 antialiased" nonce={nonce}>
        {children}
      </body>
    </html>
  );
}
