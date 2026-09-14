# 25 — Guia do Usuário

## Primeiros passos
1. Você recebe um convite por e-mail → defina sua senha (mínimo 12 caracteres) e, se solicitado,
   configure o segundo fator (aplicativo autenticador — escaneie o QR e guarde os códigos de
   recuperação).
2. Ao entrar, a **Visão Geral** mostra o dia de hoje: vendas em tempo quase-real (atualiza a cada
   ~5 minutos), comparativo com ontem/semana passada e o atingimento da meta do mês.
3. O seletor no topo filtra **filiais** e **período** em todas as telas. O selo "dados de HH:MM"
   indica o horário da última sincronização com o ERP.

## Entendendo os números
- **Tempo real vs consolidado**: o dia corrente vem da frente de caixa e pode sofrer pequenos
  ajustes após o fechamento diário do ERP (cancelamentos, correções). O dia "fecha" quando o ERP
  gera as vendas diárias — a partir daí o valor é definitivo.
- **Ticket médio** = venda ÷ cupons. **Margem** usa o custo escolhido pelo administrador
  (real, médio ou com encargos) — o critério aparece no tooltip.
- **Meta** vem da Previsão de Vendas cadastrada no próprio ERP.

## Tarefas comuns
| Quero… | Caminho |
|---|---|
| Ver como está a venda agora | Visão Geral (ou celular → mesmo endereço) |
| Comparar filiais no mês | Vendas → Comparativos → agrupar por filial |
| Saber o que está em ruptura | Estoque → Ruptura (itens curva A primeiro) |
| Ver o que vence esta semana | Estoque → Vencimentos → 7 dias |
| Acompanhar perdas | Estoque → Perdas & Trocas |
| Ver contas a vencer | Financeiro → A Pagar → aging |
| Conferir taxas de cartão | Financeiro → Cartões |
| Exportar uma tabela | botão Exportar (CSV) — se não aparecer, peça a permissão ao admin |
| Ver o que exige ação | Alertas → feed (ordenado por severidade; "Ver contexto" abre a tela do problema) |
| Receber alertas | Alertas → Regras (admins/gerentes configuram canais) |
| Silenciar um alerta tratado | Alertas → feed → "Reconhecer" |

## Perfil e segurança
- **Perfil → Sessões ativas**: veja onde sua conta está conectada e desconecte aparelhos.
- Troque a senha em Perfil → Senha. Nunca compartilhe credenciais; cada pessoa tem o seu acesso.
- Esqueceu a senha? "Esqueci minha senha" no login — o link vale 30 minutos.

## Perguntas frequentes
- **Os números não batem com o relatório do ERP de agora há pouco.** Verifique o selo de horário;
  sincronizamos em ciclos. Diferenças no dia corrente se resolvem no fechamento.
- **Uma filial aparece desatualizada.** Há um aviso amarelo com o horário do último dado; o
  administrador pode verificar a conexão em Administração → Conexão ERP.
- **Não vejo uma filial/tela.** Seu acesso é limitado por papel e filiais — fale com o
  administrador da sua empresa.
