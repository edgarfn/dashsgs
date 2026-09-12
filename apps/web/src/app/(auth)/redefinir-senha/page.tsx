import { redirect } from 'next/navigation';
import { PASSWORD_MIN_LENGTH } from '@dashsgs/shared';
import { ResetForm } from './reset-form';

export const metadata = { title: 'Definir nova senha — DashSGS' };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  if (!token) redirect('/esqueci-senha');

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold text-white">Definir nova senha</h1>
        <p className="text-sm text-slate-400">
          Ao concluir, todas as sessões abertas nesta conta serão encerradas.
        </p>
      </div>

      <ResetForm token={token} minLength={PASSWORD_MIN_LENGTH} />
    </div>
  );
}
