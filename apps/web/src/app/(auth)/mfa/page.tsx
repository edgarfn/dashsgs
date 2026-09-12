import { redirect } from 'next/navigation';
import { getPendingMe } from '@/lib/server/session';
import { MfaForm } from './mfa-form';

export const metadata = { title: 'Verificação em duas etapas — DashSGS' };

export default async function MfaPage() {
  const me = await getPendingMe();
  if (!me) redirect('/entrar');
  // Quem ainda não cadastrou o segundo fator precisa passar pelo cadastro, não pelo desafio.
  if (!me.mfa.enabled) redirect('/mfa/cadastrar');

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold text-white">Verificação em duas etapas</h1>
        <p className="text-sm text-slate-400">
          Digite o código de 6 dígitos do seu aplicativo autenticador.
        </p>
      </div>

      <MfaForm />
    </div>
  );
}
