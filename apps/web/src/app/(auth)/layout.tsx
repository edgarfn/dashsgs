import Link from 'next/link';
import type { ReactNode } from 'react';

/** Moldura das telas públicas de autenticação: um cartão centrado, sem menu nem distração. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-6 py-12">
      <header className="space-y-1">
        <Link
          href="/"
          className="text-xs uppercase tracking-[0.2em] text-app-muted hover:text-app-fg"
        >
          DashSGS
        </Link>
      </header>

      <section className="rounded-xl border border-app-border bg-app-surface p-6 shadow-lg shadow-black/20">
        {children}
      </section>

      <footer className="text-center text-xs text-app-muted">
        Acesso restrito. Todos os eventos de autenticação são registrados.
      </footer>
    </main>
  );
}
