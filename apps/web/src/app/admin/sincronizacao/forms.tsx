'use client';

import { useActionState } from 'react';
import { classeMedida } from '@/components/medidas';
import { Alert, SubmitButton } from '@/components/ui';
import { type FormState } from '../../(auth)/actions';
import { cancelarBackfillAction, iniciarBackfillAction, ressincronizarAction } from './actions';

/** Pede a sincronização de um domínio agora, sem esperar a próxima cadência. */
export function RessincronizarForm({
  domain,
  filialErpId,
  rotulo,
}: {
  domain: string;
  filialErpId: number;
  rotulo: string;
}) {
  const [state, action] = useActionState<FormState, FormData>(ressincronizarAction, {});

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="domain" value={domain} />
      <input type="hidden" name="filialErpId" value={filialErpId} />

      {state.error ? <Alert kind="error">{state.error}</Alert> : null}
      {state.success ? <Alert kind="success">{state.success}</Alert> : null}

      <SubmitButton variant="ghost">{rotulo}</SubmitButton>
    </form>
  );
}

/**
 * Carga histórica: pedir e acompanhar.
 *
 * As mensagens ficam **fora** do trecho que troca de forma. Assim que a carga começa, o bloco
 * vira barra de progresso — e a confirmação do pedido precisa continuar visível, senão o clique
 * parece não ter feito nada.
 */
export function BackfillForm({ ativo, percentual }: { ativo: boolean; percentual: number }) {
  const [inicio, iniciar] = useActionState<FormState, FormData>(iniciarBackfillAction, {});
  const [cancelamento, cancelar] = useActionState<FormState, FormData>(
    async () => cancelarBackfillAction(),
    {},
  );

  const erro = inicio.error ?? cancelamento.error;
  const sucesso = inicio.success ?? cancelamento.success;

  return (
    <div className="space-y-3">
      {erro ? <Alert kind="error">{erro}</Alert> : null}
      {sucesso ? <Alert kind="success">{sucesso}</Alert> : null}

      {ativo ? (
        <form action={cancelar} className="space-y-3">
          <div className="space-y-1">
            <div className="h-2 w-full overflow-hidden rounded-full bg-app-hover">
              <div
                data-barra
                className={`h-full rounded-full bg-app-accent transition-all medida-largura ${classeMedida(
                  percentual,
                )}`}
              />
            </div>
            <p className="text-sm text-app-muted">{percentual}% do histórico carregado.</p>
          </div>

          <SubmitButton variant="ghost">Interromper carga</SubmitButton>
        </form>
      ) : (
        <form action={iniciar} className="space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="campo-dias" className="block text-sm font-medium text-app-fg">
              Profundidade do histórico
            </label>
            <select
              id="campo-dias"
              name="dias"
              defaultValue="90"
              className="w-full rounded-lg border border-app-border bg-app-surface px-3 py-2.5 text-app-fg outline-none focus:border-app-accent/60 focus:ring-2 focus:ring-app-accent/30 sm:w-64"
            >
              <option value="30" className="bg-app-bg">
                Últimos 30 dias
              </option>
              <option value="90" className="bg-app-bg">
                Últimos 90 dias (recomendado)
              </option>
              <option value="365" className="bg-app-bg">
                Último ano
              </option>
              <option value="800" className="bg-app-bg">
                26 meses (comparativo ano a ano)
              </option>
            </select>
            <p className="text-xs text-app-muted">
              A carga vai do dia mais recente para trás e pode levar horas. Ela tem prioridade menor
              que a sincronização do dia, para não pesar no ERP da loja.
            </p>
          </div>

          <SubmitButton>Carregar histórico</SubmitButton>
        </form>
      )}
    </div>
  );
}
