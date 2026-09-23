import Image from 'next/image';
import { redirect } from 'next/navigation';
import { Alert } from '@/components/ui';
import { getPendingMe } from '@/lib/server/session';
import { startTotpSetupAction } from '../../actions';
import { EnrollForm } from './enroll-form';

export const metadata = { title: 'Cadastrar verificação em duas etapas — DashSGS' };

/**
 * Cadastro do TOTP. O segredo é gerado no servidor a cada visita e só vira permanente quando a
 * pessoa prova que o aplicativo está configurado (doc 06 §MFA).
 */
export default async function EnrollMfaPage() {
  const me = await getPendingMe();
  if (!me) redirect('/entrar');
  if (me.mfa.enabled) redirect('/mfa');

  const setup = await startTotpSetupAction();
  if ('error' in setup) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold text-app-fg">Verificação em duas etapas</h1>
        <Alert kind="error">{setup.error}</Alert>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold text-app-fg">Ative a verificação em duas etapas</h1>
        <p className="text-sm text-app-muted">
          Seu papel exige segundo fator. Aponte o aplicativo autenticador para o QR abaixo e
          confirme com o código gerado.
        </p>
      </div>

      <div className="flex flex-col items-center gap-3 rounded-lg border border-app-border bg-app-surface p-4">
        {/* O QR vem como data: URI — permitido pela CSP (img-src 'self' data:). Fundo branco
            fixo de propósito: QR code precisa de contraste real para ser lido pela câmera,
            independente do tema da página. */}
        <Image
          src={setup.qrCodeDataUrl}
          alt="QR code para configurar o aplicativo autenticador"
          width={200}
          height={200}
          unoptimized
          className="rounded bg-white p-2"
        />
        <details className="w-full text-center">
          <summary className="cursor-pointer text-xs text-app-muted">Não consigo ler o QR</summary>
          <p className="mt-2 break-all rounded bg-app-hover px-2 py-1.5 font-mono text-xs text-app-fg">
            {setup.secret}
          </p>
        </details>
      </div>

      <EnrollForm />
    </div>
  );
}
