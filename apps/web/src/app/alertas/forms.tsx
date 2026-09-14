'use client';

import { useActionState } from 'react';
import { Alert, SubmitButton } from '@/components/ui';
import { type FormState } from '../(auth)/actions';
import {
  ajustarRegraAction,
  alternarRegraAction,
  avaliarAgoraAction,
  reconhecerAction,
} from './actions';

/** Reconhecer é assumir o alerta, não resolvê-lo — o texto do botão diz isso. */
export function ReconhecerForm({ id }: { id: string }) {
  const [state, action] = useActionState<FormState, FormData>(reconhecerAction, {});

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      {state.error ? <Alert kind="error">{state.error}</Alert> : null}
      <SubmitButton variant="ghost">Reconhecer</SubmitButton>
    </form>
  );
}

export function AvaliarAgoraForm() {
  const [state, action] = useActionState<FormState, FormData>(async () => avaliarAgoraAction(), {});

  return (
    <form action={action} className="space-y-2">
      {state.error ? <Alert kind="error">{state.error}</Alert> : null}
      {state.success ? <Alert kind="success">{state.success}</Alert> : null}
      <SubmitButton variant="ghost">Avaliar agora</SubmitButton>
    </form>
  );
}

export function AlternarRegraForm({ id, ligada }: { id: string; ligada: boolean }) {
  const [state, action] = useActionState<FormState, FormData>(alternarRegraAction, {});

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="ligar" value={ligada ? 'false' : 'true'} />
      {state.error ? <Alert kind="error">{state.error}</Alert> : null}
      <SubmitButton variant="ghost">{ligada ? 'Desligar aviso' : 'Ligar aviso'}</SubmitButton>
    </form>
  );
}

/** Rótulos dos limiares — em português de loja, não com o nome do campo. */
const ROTULOS: Record<string, string> = {
  minimoDeItens: 'Avisar a partir de quantos itens',
  horaLimite: 'Hora limite para o fechamento',
  percentualMinimo: 'Avisar abaixo de (% da média)',
  horaDeCorte: 'Só avisar depois das (hora)',
  atrasoMinutos: 'Atraso tolerado (minutos)',
  dias: 'Dias de antecedência',
  desviosPadrao: 'Desvios-padrão acima da média',
  diaDoMes: 'A partir do dia do mês',
  valorMinimo: 'Valor mínimo (R$)',
};

export function AjustarRegraForm({
  id,
  params,
  canalEmail,
}: {
  id: string;
  params: Record<string, number>;
  canalEmail: boolean;
}) {
  const [state, action] = useActionState<FormState, FormData>(ajustarRegraAction, {});
  const campos = Object.entries(params);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={id} />

      {state.error ? <Alert kind="error">{state.error}</Alert> : null}
      {state.success ? <Alert kind="success">{state.success}</Alert> : null}

      {campos.length > 0 ? (
        <div className="flex flex-wrap gap-3">
          {campos.map(([campo, valor]) => (
            <div key={campo} className="space-y-1.5">
              <label htmlFor={`regra-${id}-${campo}`} className="block text-xs text-slate-400">
                {ROTULOS[campo] ?? campo}
              </label>
              <input
                id={`regra-${id}-${campo}`}
                type="number"
                name={`param.${campo}`}
                defaultValue={String(valor)}
                min={0}
                className="w-44 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-400/60"
              />
            </div>
          ))}
        </div>
      ) : null}

      <label className="flex items-center gap-2 text-sm text-slate-300">
        <input
          type="checkbox"
          name="canalEmail"
          defaultChecked={canalEmail}
          className="h-4 w-4 rounded border-white/20 bg-white/5"
        />
        Também enviar por e-mail
      </label>

      <SubmitButton variant="ghost">Salvar ajustes</SubmitButton>
    </form>
  );
}
