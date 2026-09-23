import { redirect } from 'next/navigation';
import { PASSWORD_MIN_LENGTH } from '@dashsgs/shared';
import { Alert } from '@/components/ui';
import { previewInvite } from '../actions';
import { AcceptInviteForm } from './accept-form';

export const metadata = { title: 'Aceitar convite — DashSGS' };

const PAPEL_DESCRICAO: Record<string, string> = {
  owner: 'Dono — acesso total, inclusive cobrança',
  admin: 'Administrador — usuários, conexão com o ERP e módulos',
  manager: 'Gerente — dashboards, alertas e propostas de ação',
  analyst: 'Analista — dashboards, relatórios e exportações',
  viewer: 'Visualizador — apenas consulta de dashboards',
  auditor: 'Auditor — consulta de dashboards e trilha de auditoria',
};

export default async function InvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  if (!token) redirect('/entrar');

  const invite = await previewInvite(token);
  if (!invite) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold text-app-fg">Convite indisponível</h1>
        <Alert kind="error">
          Este convite é inválido, expirou ou já foi utilizado. Peça um novo ao administrador do seu
          tenant.
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold text-app-fg">Convite para {invite.tenantName}</h1>
        <p className="text-sm text-app-muted">{PAPEL_DESCRICAO[invite.role] ?? invite.role}</p>
      </div>

      <AcceptInviteForm
        token={token}
        email={invite.email}
        existingUser={invite.existingUser}
        minLength={PASSWORD_MIN_LENGTH}
      />
    </div>
  );
}
