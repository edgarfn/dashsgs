export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-3 px-6">
      <h1 className="text-2xl font-semibold text-app-fg">Página não encontrada</h1>
      <p className="text-sm text-app-muted">O endereço acessado não existe nesta instalação.</p>
    </main>
  );
}
