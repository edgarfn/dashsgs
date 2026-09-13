'use client';

import { useActionState } from 'react';
import { Alert, Field, SubmitButton } from '@/components/ui';
import { type FormState } from '../../(auth)/actions';
import { salvarConexaoAction, testarConexaoAction } from './actions';

interface ValoresAtuais {
  baseUrl: string;
  username: string;
  isSgCloud: boolean;
  tlsMode: 'https' | 'vpn';
  maxRps: number;
  senhaCadastrada: boolean;
}

export function ConexaoForm({ atual }: { atual: ValoresAtuais }) {
  const [state, action] = useActionState<FormState, FormData>(salvarConexaoAction, {});

  return (
    <form action={action} className="space-y-4" noValidate>
      {state.error ? <Alert kind="error">{state.error}</Alert> : null}
      {state.success ? <Alert kind="success">{state.success}</Alert> : null}

      <Field
        label="Endereço do ERP"
        name="baseUrl"
        defaultValue={atual.baseUrl}
        autoComplete="off"
        hint="URL pública do ERP, como https://erp.suarede.com.br:8201. Endereços de rede interna são recusados."
      />

      <Field
        label="Usuário de integração"
        name="username"
        defaultValue={atual.username}
        autoComplete="off"
        hint="Fornecido pelo comercial da SG. Peça um usuário somente-leitura."
      />

      <Field
        label={atual.senhaCadastrada ? 'Nova senha (deixe em branco para manter)' : 'Senha'}
        name="senha"
        type="password"
        required={!atual.senhaCadastrada}
        autoComplete="new-password"
        hint="Guardada cifrada. Não é exibida nem para você — só pode ser substituída."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="campo-tlsMode" className="block text-sm font-medium text-slate-200">
            Transporte
          </label>
          <select
            id="campo-tlsMode"
            name="tlsMode"
            defaultValue={atual.tlsMode}
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-slate-100 outline-none focus:border-sky-400/60 focus:ring-2 focus:ring-sky-400/30"
          >
            <option value="https" className="bg-slate-900">
              HTTPS (recomendado)
            </option>
            <option value="vpn" className="bg-slate-900">
              VPN provisionada pela plataforma
            </option>
          </select>
        </div>

        <Field
          label="Limite de requisições por segundo"
          name="maxRps"
          type="number"
          defaultValue={String(atual.maxRps)}
          hint="Protege o servidor da loja. 4 é o padrão conservador."
        />
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-300">
        <input
          type="checkbox"
          name="isSgCloud"
          defaultChecked={atual.isSgCloud}
          className="h-4 w-4 rounded border-white/20 bg-white/5"
        />
        O ERP roda no SG Cloud
      </label>

      <SubmitButton>Salvar conexão</SubmitButton>
    </form>
  );
}

export function TestarConexaoForm() {
  const [state, action] = useActionState<FormState, FormData>(
    async () => testarConexaoAction(),
    {},
  );

  return (
    <form action={action} className="space-y-3">
      {state.error ? <Alert kind="error">{state.error}</Alert> : null}
      {state.success ? <Alert kind="success">{state.success}</Alert> : null}

      <p className="text-sm text-slate-400">
        O teste autentica no ERP, lê as rotas que o seu contrato com a SG libera e consulta a versão
        da instalação. Nada é sincronizado ainda.
      </p>

      <SubmitButton variant="ghost">Testar conexão</SubmitButton>
    </form>
  );
}
