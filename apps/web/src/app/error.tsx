'use client';

/**
 * Fronteira de erro do App Router. Mostra estado útil sem vazar detalhe interno (doc 16 §3):
 * o `digest` é o identificador que o suporte cruza com o log do servidor.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-4 px-6">
      <h1 className="text-2xl font-semibold text-app-fg">Algo deu errado</h1>
      <p className="text-sm text-app-muted">
        A página não pôde ser carregada. Tente novamente; se persistir, informe o código abaixo ao
        suporte.
      </p>
      {error.digest ? (
        <code className="w-fit rounded bg-app-surface px-2 py-1 text-xs text-app-fg">
          {error.digest}
        </code>
      ) : null}
      <button
        type="button"
        onClick={reset}
        className="w-fit rounded-md bg-app-fg px-4 py-2 text-sm font-medium text-app-bg hover:opacity-90"
      >
        Tentar novamente
      </button>
    </main>
  );
}
