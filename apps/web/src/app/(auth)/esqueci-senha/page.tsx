import Link from 'next/link';
import { ForgotForm } from './forgot-form';

export const metadata = { title: 'Recuperar senha — DashSGS' };

export default function ForgotPasswordPage() {
  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold text-app-fg">Recuperar senha</h1>
        <p className="text-sm text-app-muted">
          Enviamos um link de redefinição válido por 30 minutos.
        </p>
      </div>

      <ForgotForm />

      <p className="text-sm text-app-muted">
        <Link href="/entrar" className="text-app-accent underline-offset-4 hover:underline">
          Voltar para o login
        </Link>
      </p>
    </div>
  );
}
