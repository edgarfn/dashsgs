import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Alert } from '@/components/ui';
import { getMe } from '@/lib/server/session';

export const metadata = { title: 'Códigos de recuperação — DashSGS' };

/**
 * Exibe uma única vez os códigos de recuperação recém-gerados. Eles chegam pela URL porque
 * existem apenas neste instante — o banco guarda somente o hash (doc 06 §MFA).
 */
export default async function RecoveryCodesPage({
  searchParams,
}: {
  searchParams: Promise<{ codes?: string }>;
}) {
  const me = await getMe();
  if (!me) redirect('/entrar');

  const { codes } = await searchParams;
  const lista = (codes ?? '').split(',').filter(Boolean);
  if (lista.length === 0) redirect('/perfil');

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold text-app-fg">Guarde seus códigos de recuperação</h1>
        <p className="text-sm text-app-muted">
          Cada código serve uma única vez e substitui o aplicativo se você perder o telefone.
        </p>
      </div>

      <Alert kind="info">Esta é a única vez que eles aparecem. Guarde-os em local seguro.</Alert>

      <ul className="grid grid-cols-2 gap-2 rounded-lg border border-app-border bg-app-hover p-4 font-mono text-sm text-app-fg">
        {lista.map((codigo) => (
          <li key={codigo}>{codigo}</li>
        ))}
      </ul>

      <Link
        href="/"
        className="block w-full rounded-lg bg-app-accent px-4 py-2.5 text-center text-sm font-semibold text-app-accent-fg transition hover:opacity-90"
      >
        Guardei os códigos, continuar
      </Link>
    </div>
  );
}
