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
  apiPathPrefix: string;
  authHeaderMode: 'raw' | 'bearer';
  pageSize: number | null;
  pageSizePorRota: Record<string, number>;
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
          <label htmlFor="campo-tlsMode" className="block text-sm font-medium text-app-fg">
            Transporte
          </label>
          <select
            id="campo-tlsMode"
            name="tlsMode"
            defaultValue={atual.tlsMode}
            className="w-full rounded-lg border border-app-border bg-app-surface px-3 py-2.5 text-app-fg outline-none focus:border-app-accent/60 focus:ring-2 focus:ring-app-accent/30"
          >
            <option value="https" className="bg-app-bg">
              HTTPS (recomendado)
            </option>
            <option value="vpn" className="bg-app-bg">
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

      <label className="flex items-center gap-2 text-sm text-app-fg">
        <input
          type="checkbox"
          name="isSgCloud"
          defaultChecked={atual.isSgCloud}
          className="h-4 w-4 rounded border-app-border bg-app-surface"
        />
        O ERP roda no SG Cloud
      </label>

      {/*
        Ajustes que existem porque a SG ainda não respondeu (doc 34 Q2/Q4/Q5). Ficam recolhidos:
        o padrão funciona na homologação, e quem abre o wizard para cadastrar uma loja não deve
        tropeçar neles. Quem precisa, precisa de verdade — e aí o campo está aqui, com o motivo
        escrito ao lado em vez de escondido num arquivo de código.
      */}
      <details className="rounded-lg border border-app-border bg-app-surface p-4">
        <summary className="cursor-pointer text-sm text-app-fg">
          Ajustes avançados do protocolo
        </summary>

        <p className="mt-3 text-xs text-app-muted">
          Estes campos cobrem pontos que a SG Sistemas ainda não confirmou. Os padrões são o que se
          observa na homologação — mexa apenas se a sua instalação se comportar diferente.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field
            label="Prefixo das rotas"
            name="apiPathPrefix"
            defaultValue={atual.apiPathPrefix}
            hint="Vazio = só a autorização do SG Cloud usa /public. Se a sua instalação exigir o prefixo em todas as rotas, informe /public."
          />

          <div className="space-y-1.5">
            <label htmlFor="campo-authHeaderMode" className="block text-sm font-medium text-app-fg">
              Formato do token
            </label>
            <select
              id="campo-authHeaderMode"
              name="authHeaderMode"
              defaultValue={atual.authHeaderMode}
              className="w-full rounded-lg border border-app-border bg-app-surface px-3 py-2.5 text-app-fg outline-none focus:border-app-accent/60 focus:ring-2 focus:ring-app-accent/30"
            >
              <option value="raw" className="bg-app-bg">
                JWT puro
              </option>
              <option value="bearer" className="bg-app-bg">
                Bearer &lt;jwt&gt;
              </option>
            </select>
            <p className="text-xs text-app-muted">
              O sistema descobre sozinho na primeira recusa e passa a usar o que funcionou.
            </p>
          </div>

          <Field
            label="Itens por página"
            name="pageSize"
            type="number"
            defaultValue={atual.pageSize === null ? '' : String(atual.pageSize)}
            hint="Em branco usa o padrão da instalação. Endpoint que recusar o tamanho é reduzido automaticamente."
          />
        </div>

        {Object.keys(atual.pageSizePorRota).length > 0 ? (
          <div className="mt-4 space-y-1">
            <p className="text-xs text-app-muted">
              Limites que o sistema aprendeu sozinho com a sua instalação:
            </p>
            <ul className="space-y-0.5 text-xs text-app-muted">
              {Object.entries(atual.pageSizePorRota).map(([rota, teto]) => (
                <li key={rota} className="font-mono">
                  {rota} — máximo {teto} itens por página
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </details>

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

      <p className="text-sm text-app-muted">
        O teste autentica no ERP, lê as rotas que o seu contrato com a SG libera e consulta a versão
        da instalação. Nada é sincronizado ainda.
      </p>

      <SubmitButton variant="ghost">Testar conexão</SubmitButton>
    </form>
  );
}
