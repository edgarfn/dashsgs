import Link from 'next/link';
import { Alert } from '@/components/ui';
import { LoginForm } from './login-form';

export const metadata = { title: 'Entrar — DashSGS' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redefinida?: string; convite?: string; expirada?: string }>;
}) {
  const params = await searchParams;

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold text-white">Entrar</h1>
        <p className="text-sm text-slate-400">Use a conta que recebeu por convite.</p>
      </div>

      {params.redefinida ? (
        <Alert kind="success">Senha redefinida. Entre com a nova senha.</Alert>
      ) : null}
      {params.convite ? <Alert kind="success">Convite aceito. Entre para continuar.</Alert> : null}
      {params.expirada ? <Alert kind="info">Sua sessão expirou. Entre novamente.</Alert> : null}

      <LoginForm />

      <p className="text-sm text-slate-400">
        <Link href="/esqueci-senha" className="text-sky-300 underline-offset-4 hover:underline">
          Esqueci minha senha
        </Link>
      </p>
    </div>
  );
}
