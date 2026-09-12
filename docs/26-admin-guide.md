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
- **Status**: última sincronização por domínio, erros recentes, botão "Testar conexão" e
  "Ressincronizar período".
- Boas práticas: peça à SG um usuário **somente leitura**; solicite escrita apenas se contratar
  o módulo de Ações no ERP.

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
Filtre por pessoa, ação e período; exporte para CSV. Eventos incluem: logins, mudanças de
papel, alterações da conexão, ativação de módulos, aprovações de ações no ERP, exportações e
desmascaramentos. Retenção: 5 anos.

## 6. Sinais de problema e o que fazer
| Sinal | Ação |
|---|---|
| Banner "credencial inválida" | A senha de integração mudou na SG — atualize no cadastro |
| Filial sem dados desde ontem | Teste a conexão; verifique com seu TI se o ERP/link está no ar |
| "Fechamento não gerado" recorrente | Processo interno da loja — cobrar a equipe do retaguarda |
| Divergência sinalizada no fechamento | Ver tela de Status do Fechamento; tratar no ERP; nosso re-sync é automático |
