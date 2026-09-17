# 26 — Guia do Administrador (do tenant)

## Responsabilidades do admin
Gerenciar pessoas e papéis, manter a conexão com o ERP saudável, decidir módulos opcionais
(com implicações de privacidade) e acompanhar a auditoria.

## 1. Conexão com o ERP (Administração → Conexão ERP)
- **Cadastro**: endereço da API do seu ERP SG (fornecido pela SG/seu TI), usuário e senha de
  integração (fornecidos pelo comercial da SG). Exigimos HTTPS; sem HTTPS, nossa equipe provisiona
  um túnel VPN com seu TI.
- A senha nunca é reexibida — apenas substituída. Alterações exigem seu segundo fator e ficam
  na auditoria.
- **Rotas contratadas**: mostramos o que seu contrato SG libera; recursos fora do contrato
  aparecem desabilitados com o motivo.
- **Status** (Administração → Sincronização): frescor por domínio **e por filial**, últimas
  execuções com contagem de linhas, botão "Sincronizar agora" e carga de histórico (30 dias a
  26 meses). Uma loja em dia e outra parada aparecem separadas — é o caso que um "tudo certo"
  geral esconderia.
- Boas práticas: peça à SG um usuário **somente leitura**; solicite escrita apenas se contratar
  o módulo de Ações no ERP.

## 1.1 Alertas (Alertas → Regras)
- Cada aviso mostra **o que observa**, **quem recebe** e o **limiar** ajustável; a verificação
  roda a cada 5 minutos.
- Ligar/desligar e calibrar limiar é de owner, admin e gerente (`alerts.manage`); reconhecer no
  feed é de quem opera (`alerts.ack`).
- "Avaliar agora" roda as regras na hora — útil depois de ajustar um limiar.
- Um mesmo problema gera **um** aviso por dia e por filial. Ele volta no dia seguinte enquanto
  não for resolvido no ERP.
- Avisos que dependem de dado ainda não sincronizado (financeiro, vencimentos, metas) aparecem
  na seção "Aguardando dados" e ligam sozinhos quando a sincronização correspondente entrar.

## 2. Usuários e papéis (Administração → Usuários)
- Convide por e-mail escolhendo papel (owner, admin, manager, analyst, viewer, auditor — ver
  tabela de permissões na tela) e, opcionalmente, **filiais permitidas**.
- MFA é obrigatório para owner/admin. Remoção de usuário revoga sessões na hora.
- Revise acessos trimestralmente (relatório "última atividade" ajuda).

## 3. Módulos opcionais (Administração → Módulos)
- **Módulo Clientes** (desligado por padrão): sincroniza um subconjunto mínimo do cadastro de
  clientes do ERP para análises de clientes identificados. Ao ativar, você (Controlador LGPD)
  declara a finalidade e aceita o adendo de tratamento; recomendamos registrar um RIPD — modelo
  disponível no doc 28. CPF aparece mascarado; desmascarar é permissão específica e auditada.
- **Ações no ERP** (desligado por padrão): permite criar ofertas, pedidos e acertos a partir do
  DashSGS com fluxo de aprovação (quem propõe não aprova). Exige credencial SG com rotas de
  escrita. Toda execução fica auditada com payload e resultado.

## 4. Alertas (Alertas → Regras)
Ajuste limiares por realidade da sua operação (ex.: perda anormal, meta em risco) e canais
(e-mail; outros canais em roadmap). Crie regras por filial quando os padrões diferirem.

## 5. Auditoria (Administração → Auditoria)
Filtre por período, categoria, evento, resultado e pessoa; exporte para CSV. Eventos incluem
logins e recusas de login, mudanças de papel, convites, alterações da conexão com o ERP,
re-sincronizações, alertas reconhecidos e o próprio export da trilha. Retenção: 5 anos.

Cada linha traz o evento em português e o código técnico ao lado — o primeiro para você, o
segundo para citar num chamado conosco. Eventos que merecem atenção mesmo sem ninguém estar
procurando (recusa de acesso, segundo fator desligado, export da trilha) vêm marcados com ⚑.

A trilha é **append-only**: nem nós conseguimos alterar ou apagar uma linha antes do prazo de
retenção — o banco recusa a operação, e cada entrada carrega o hash da anterior, de modo que
remover uma quebre a cadeia de forma detectável.

Você verá os logins dos membros da sua rede, e apenas deles. Tentativas de login com e-mails que
não existem no sistema não aparecem aqui: são registradas na trilha da plataforma, porque
mostrá-las contaria a você sobre contas que não são suas.

## 6. Sinais de problema e o que fazer
| Sinal | Ação |
|---|---|
| Banner "credencial inválida" | A senha de integração mudou na SG — atualize no cadastro |
| Filial sem dados desde ontem | Teste a conexão; verifique com seu TI se o ERP/link está no ar |
| "Fechamento não gerado" recorrente | Processo interno da loja — cobrar a equipe do retaguarda |
| Divergência sinalizada no fechamento | Ver tela de Status do Fechamento; tratar no ERP; nosso re-sync é automático |
