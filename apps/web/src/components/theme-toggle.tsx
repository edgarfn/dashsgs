'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { THEME_COOKIE, type Theme } from '@/lib/theme';

const OPCOES: Array<{ valor: Theme; rotulo: string }> = [
  { valor: 'light', rotulo: 'Claro' },
  { valor: 'dark', rotulo: 'Escuro' },
];

/**
 * Único dado puramente client-side do app (doc "Aparência" em /perfil): sem Server Action, sem
 * API — é cor de fundo, não dado de conta. Escreve o atributo na hora (feedback instantâneo) e
 * grava o cookie para o servidor renderizar certo já na próxima navegação; `router.refresh()`
 * só sincroniza o resto desta página (ex.: o meta theme-color) sem esperar um reload inteiro.
 */
export function ThemeToggle({ temaAtual }: { temaAtual: Theme | null }) {
  const router = useRouter();
  const [tema, setTema] = useState(temaAtual);

  function escolher(valor: Theme): void {
    document.documentElement.setAttribute('data-theme', valor);
    document.cookie = `${THEME_COOKIE}=${valor}; Path=/; Max-Age=31536000; SameSite=Lax`;
    setTema(valor);
    router.refresh();
  }

  return (
    <div className="flex gap-2">
      {OPCOES.map((opcao) => (
        <button
          key={opcao.valor}
          type="button"
          aria-pressed={tema === opcao.valor}
          onClick={() => escolher(opcao.valor)}
          className={`rounded-lg border px-4 py-2 text-sm font-medium transition ${
            tema === opcao.valor
              ? 'border-app-accent bg-app-accent/10 text-app-accent'
              : 'border-app-border text-app-fg hover:bg-app-hover'
          }`}
        >
          {opcao.rotulo}
        </button>
      ))}
    </div>
  );
}
