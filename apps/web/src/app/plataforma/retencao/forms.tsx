'use client';

import { useActionState } from 'react';
import { Alert, SubmitButton } from '@/components/ui';
import { type FormState } from '../../(auth)/actions';
import { executarRetencaoAction } from './actions';

/** Antecipar a purga é seguro por construção: ela só apaga o que o catálogo já mandava apagar. */
export function ExecutarRetencaoForm() {
  const [state, action] = useActionState<FormState, FormData>(
    async () => executarRetencaoAction(),
    {},
  );

  return (
    <form action={action} className="space-y-3 border-t border-app-border pt-4">
      {state.error ? <Alert kind="error">{state.error}</Alert> : null}
      {state.success ? <Alert kind="success">{state.success}</Alert> : null}

      <p className="text-xs text-app-muted">
        A rodada automática é diária, às 3h20 (America/Sao_Paulo). Executar agora não muda o que
        será apagado — só antecipa, e confere o resultado logo em seguida.
      </p>

      <SubmitButton variant="ghost">Executar purga agora</SubmitButton>
    </form>
  );
}
