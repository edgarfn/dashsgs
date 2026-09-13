/**
 * Seed de desenvolvimento (E1-03). Dados 100% sintéticos — é proibido semear com dado real de
 * cliente (doc 10 / doc 17 §1).
 *
 * Uso: pnpm db:seed
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** Mesmos parâmetros do doc 06 §Senhas usados pela aplicação (HashingService). */
const ARGON2_OPTIONS = { memoryCost: 65_536, timeCost: 3, parallelism: 4 } as const;

const DEMO_TENANT = { slug: 'demo', name: 'Rede Demo (sintética)' };
/** Segundo tenant: o isolamento fica visível já no ambiente de desenvolvimento. */
const VIZINHO_TENANT = { slug: 'vizinho', name: 'Rede Vizinha (sintética)' };

type SeedRole = 'owner' | 'manager' | 'analyst';

const DEMO_USERS: Array<{ email: string; name: string; role: SeedRole; filiais: number[] }> = [
  { email: 'owner@demo.local', name: 'Ana Owner', role: 'owner', filiais: [] },
  { email: 'gerente@demo.local', name: 'Bruno Gerente', role: 'manager', filiais: [] },
  // Recorte de filiais: exercita `filiais_allowed` fim-a-fim (doc 07 §4.2).
  { email: 'analista@demo.local', name: 'Carla Analista', role: 'analyst', filiais: [1, 2] },
];

const VIZINHO_USERS: Array<{ email: string; name: string; role: SeedRole; filiais: number[] }> = [
  { email: 'owner@vizinho.local', name: 'Davi Owner', role: 'owner', filiais: [] },
];

const PLATFORM_ADMIN = { email: 'plataforma@dashsgs.local', name: 'Equipe DashSGS' };

/** Filiais sintéticas. A sincronização real com a API SG chega na Fase 6 (E5-02). */
const FILIAIS = [
  { erpId: 1, sufixo: 'Matriz', fantasia: 'Centro', uf: 'SP' },
  { erpId: 2, sufixo: 'Filial 2', fantasia: 'Zona Sul', uf: 'SP' },
  { erpId: 3, sufixo: 'Filial 3', fantasia: 'Litoral', uf: 'SP' },
  { erpId: 4, sufixo: 'Filial 4', fantasia: 'Interior', uf: 'MG' },
];

function generatePassword(): string {
  return randomBytes(12).toString('base64url');
}

async function upsertTenant(definition: { slug: string; name: string }) {
  return prisma.tenant.upsert({
    where: { slug: definition.slug },
    update: { name: definition.name },
    create: { id: randomUUID(), ...definition, plan: 'dev' },
  });
}

async function upsertMember(
  tenantId: string,
  passwordHash: string,
  member: { email: string; name: string; role: SeedRole; filiais: number[] },
) {
  const user = await prisma.user.upsert({
    where: { email: member.email },
    update: { name: member.name, passwordHash, status: 'active' },
    create: { email: member.email, name: member.name, passwordHash, status: 'active' },
  });

  await prisma.membership.upsert({
    where: { userId_tenantId: { userId: user.id, tenantId } },
    update: { role: member.role, filiaisAllowed: member.filiais },
    create: { userId: user.id, tenantId, role: member.role, filiaisAllowed: member.filiais },
  });
}

/**
 * Filiais são dado de TENANT: a RLS estrita recusa a escrita sem `app.tenant_id` fixado
 * (doc 08 §3). O seed abre o contexto exatamente como a aplicação faz.
 */
async function seedFiliais(tenantId: string, marca: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${tenantId}'`);

    for (const filial of FILIAIS) {
      const razaoSocial = `${marca} Supermercados LTDA — ${filial.sufixo}`;
      const nomeFantasia = `${marca} ${filial.fantasia}`;
      await tx.erpFilial.upsert({
        where: { tenantId_erpId: { tenantId, erpId: filial.erpId } },
        update: { razaoSocial, nomeFantasia, uf: filial.uf },
        create: { tenantId, erpId: filial.erpId, razaoSocial, nomeFantasia, uf: filial.uf },
      });
    }
  });
}

/**
 * Vendas sintéticas dos últimos 30 dias (Fase 7).
 *
 * Sem elas o dashboard de um ambiente recém-criado abre vazio, e ninguém consegue revisar a tela
 * sem antes montar uma integração. Os números são gerados por uma função determinística — o
 * mesmo dia sempre produz o mesmo valor — para que os testes possam afirmar coisas sobre eles.
 *
 * É dado **sintético**, como todo o resto deste arquivo: nada aqui sai de cliente nenhum.
 */
const DIAS_DE_HISTORICO = 30;
const PRODUTOS_DEMO = [
  { erpId: 1001, descricao: 'ARROZ TIPO 1 5KG', dep: '1', preco: 24.9, custo: 19.4, curva: 'A' },
  { erpId: 1002, descricao: 'FEIJAO CARIOCA 1KG', dep: '1', preco: 8.49, custo: 6.2, curva: 'A' },
  { erpId: 1003, descricao: 'DETERGENTE NEUTRO', dep: '2', preco: 2.99, custo: 1.95, curva: 'B' },
  { erpId: 1004, descricao: 'CAFE TORRADO 500G', dep: '1', preco: 18.9, custo: 14.1, curva: 'A' },
  { erpId: 1005, descricao: 'SABAO EM PO 1KG', dep: '2', preco: 15.5, custo: 11.9, curva: 'C' },
];
const DEPARTAMENTOS_DEMO = [
  { erpId: '1', descricao: 'MERCEARIA' },
  { erpId: '2', descricao: 'LIMPEZA' },
];

/** Ruído determinístico: o mesmo par (dia, filial) devolve sempre o mesmo fator. */
function fator(dia: string, filial: number): number {
  const semente = [...`${dia}:${filial}`].reduce((total, letra) => total + letra.charCodeAt(0), 0);
  return 0.75 + (semente % 50) / 100;
}

function diaISO(offset: number): string {
  const data = new Date();
  data.setUTCDate(data.getUTCDate() - offset);
  return data.toISOString().slice(0, 10);
}

async function seedVendas(tenantId: string): Promise<void> {
  const hoje = diaISO(0);

  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${tenantId}'`);

      for (const departamento of DEPARTAMENTOS_DEMO) {
        await tx.erpDepartamentoN1.upsert({
          where: { tenantId_erpId: { tenantId, erpId: departamento.erpId } },
          update: { descricao: departamento.descricao },
          create: { tenantId, erpId: departamento.erpId, descricao: departamento.descricao },
        });
      }

      for (const filial of FILIAIS) {
        for (const produto of PRODUTOS_DEMO) {
          // Um item em ruptura por filial (o de curva A), para a tela de estoque ter conteúdo.
          const emRuptura = produto.curva === 'A' && produto.erpId % 2 === 1;
          const dados = {
            descricao: produto.descricao,
            dep1ErpId: produto.dep,
            ativo: true,
            curvaAbc: produto.curva,
            custoMedio: produto.custo,
            custoReal: produto.custo,
            precoVenda1: produto.preco,
            estoqueAtual: emRuptura ? 3 : 120,
            estoqueMinimo: 20,
            estoqueMaximo: 400,
            vendaMediaDiaria: 12,
          };

          await tx.erpProduto.upsert({
            where: {
              tenantId_filialErpId_erpId: {
                tenantId,
                filialErpId: filial.erpId,
                erpId: produto.erpId,
              },
            },
            update: dados,
            create: { tenantId, filialErpId: filial.erpId, erpId: produto.erpId, ...dados },
          });
        }
      }

      // Limpa o histórico anterior do seed antes de reescrever (idempotência).
      await tx.erpVendaItem.deleteMany({});
      await tx.erpVendaCupom.deleteMany({});
      await tx.erpFinalizadoraLancamento.deleteMany({});
      await tx.erpFilialVendaResumo.deleteMany({});
      await tx.aggVendasHora.deleteMany({});
      await tx.aggVendasDiaDep.deleteMany({});

      for (let offset = DIAS_DE_HISTORICO; offset >= 0; offset -= 1) {
        const dia = diaISO(offset);
        const ehHoje = dia === hoje;

        for (const filial of FILIAIS) {
          const peso = fator(dia, filial.erpId);
          // O dia corrente está "em andamento": menos cupons, e marcados como provisórios.
          const cupons = Math.round((ehHoje ? 6 : 18) * peso);
          let vendaDoDia = 0;
          let custoDoDia = 0;
          const porHora = new Map<number, { valor: number; cupons: number; itens: number }>();
          const porDep = new Map<string, { valor: number; qtd: number; custo: number }>();

          for (let indice = 0; indice < cupons; indice += 1) {
            const produto = PRODUTOS_DEMO[indice % PRODUTOS_DEMO.length]!;
            const quantidade = 1 + (indice % 3);
            const valor = Number((produto.preco * quantidade).toFixed(2));
            const custo = Number((produto.custo * quantidade).toFixed(2));
            const hora = 8 + (indice % 12);
            const horario = `${String(hora).padStart(2, '0')}:${String((indice * 7) % 60).padStart(2, '0')}`;
            const cancelada = indice > 0 && indice % 17 === 0;

            await tx.erpVendaCupom.create({
              data: {
                tenantId,
                filialErpId: filial.erpId,
                data: new Date(`${dia}T00:00:00Z`),
                caixa: 1 + (indice % 3),
                cupom: 100_000 + offset * 100 + indice,
                horario,
                valorTotal: valor,
                cancelada,
                identificada: indice % 5 === 0,
                isRealtime: ehHoje,
              },
            });

            await tx.erpVendaItem.create({
              data: {
                tenantId,
                filialErpId: filial.erpId,
                data: new Date(`${dia}T00:00:00Z`),
                caixa: 1 + (indice % 3),
                cupom: 100_000 + offset * 100 + indice,
                ordem: 1,
                produtoErpId: produto.erpId,
                quantidade,
                precoVenda: produto.preco,
                cancelado: cancelada,
                isRealtime: ehHoje,
              },
            });

            await tx.erpFinalizadoraLancamento.create({
              data: {
                tenantId,
                filialErpId: filial.erpId,
                data: new Date(`${dia}T00:00:00Z`),
                caixa: 1 + (indice % 3),
                cupom: 100_000 + offset * 100 + indice,
                ordem: 1,
                especie: indice % 3 === 0 ? 'DINHEIRO' : indice % 3 === 1 ? 'CARTAO DEBITO' : 'PIX',
                valor,
                cancelada,
                isRealtime: ehHoje,
              },
            });

            if (cancelada) continue;

            vendaDoDia += valor;
            custoDoDia += custo;

            const acumuladoHora = porHora.get(hora) ?? { valor: 0, cupons: 0, itens: 0 };
            porHora.set(hora, {
              valor: acumuladoHora.valor + valor,
              cupons: acumuladoHora.cupons + 1,
              itens: acumuladoHora.itens + quantidade,
            });

            const acumuladoDep = porDep.get(produto.dep) ?? { valor: 0, qtd: 0, custo: 0 };
            porDep.set(produto.dep, {
              valor: acumuladoDep.valor + valor,
              qtd: acumuladoDep.qtd + quantidade,
              custo: acumuladoDep.custo + custo,
            });
          }

          for (const [hora, valores] of porHora) {
            await tx.aggVendasHora.create({
              data: {
                tenantId,
                filialErpId: filial.erpId,
                data: new Date(`${dia}T00:00:00Z`),
                hora,
                valor: Number(valores.valor.toFixed(2)),
                cupons: valores.cupons,
                itens: valores.itens,
              },
            });
          }

          for (const [dep, valores] of porDep) {
            await tx.aggVendasDiaDep.create({
              data: {
                tenantId,
                filialErpId: filial.erpId,
                data: new Date(`${dia}T00:00:00Z`),
                dep1ErpId: dep,
                valor: Number(valores.valor.toFixed(2)),
                quantidade: valores.qtd,
                custo: Number(valores.custo.toFixed(2)),
                margem: Number((valores.valor - valores.custo).toFixed(2)),
              },
            });
          }

          // O resumo diário só existe para dias fechados — é ele que libera a consolidação.
          if (!ehHoje) {
            await tx.erpFilialVendaResumo.create({
              data: {
                tenantId,
                filialErpId: filial.erpId,
                data: new Date(`${dia}T00:00:00Z`),
                valor: Number(vendaDoDia.toFixed(2)),
                custoMedio: Number(custoDoDia.toFixed(2)),
                custoReal: Number((custoDoDia * 1.02).toFixed(2)),
                custoComEncargos: Number((custoDoDia * 1.08).toFixed(2)),
                custoFiscalMedio: Number((custoDoDia * 0.99).toFixed(2)),
                custoSemIcms: Number((custoDoDia * 0.88).toFixed(2)),
                qtdClientes: cupons,
                qtdUnidades: cupons * 2,
                atualizouEstoque: true,
                gerouVendasDiaria: true,
                exportouVendas: offset % 5 !== 0,
                possuiDivergencia: offset === 3,
              },
            });
          }
        }
      }
    },
    { timeout: 120_000, maxWait: 20_000 },
  );
}

async function main(): Promise<void> {
  const password = process.env.SEED_PASSWORD ?? generatePassword();
  const passwordHash = await hash(password, ARGON2_OPTIONS);

  const demo = await upsertTenant(DEMO_TENANT);
  const vizinho = await upsertTenant(VIZINHO_TENANT);

  for (const member of DEMO_USERS) await upsertMember(demo.id, passwordHash, member);
  for (const member of VIZINHO_USERS) await upsertMember(vizinho.id, passwordHash, member);

  await seedFiliais(demo.id, 'Demo');
  await seedFiliais(vizinho.id, 'Vizinha');

  // Só o tenant demo recebe movimento: o vizinho existe para provar isolamento, e um tenant
  // vazio ao lado de um cheio é justamente o contraste que denuncia vazamento.
  await seedVendas(demo.id);

  // Conta de operação da plataforma: papel global, sem membership em tenant nenhum (doc 07 §2).
  await prisma.user.upsert({
    where: { email: PLATFORM_ADMIN.email },
    update: { name: PLATFORM_ADMIN.name, passwordHash, status: 'active', platformAdmin: true },
    create: {
      email: PLATFORM_ADMIN.email,
      name: PLATFORM_ADMIN.name,
      passwordHash,
      status: 'active',
      platformAdmin: true,
    },
  });

  console.log('');
  console.log('Seed concluído (dados sintéticos).');
  console.log(`  tenant : ${demo.name} (${demo.slug}) — ${FILIAIS.length} filiais`);
  console.log(
    `  tenant : ${vizinho.name} (${vizinho.slug}) — ${FILIAIS.length} filiais (sem movimento)`,
  );
  console.log(`  vendas : ${DIAS_DE_HISTORICO} dias sintéticos no tenant demo`);
  for (const user of [...DEMO_USERS, ...VIZINHO_USERS]) {
    const recorte = user.filiais.length > 0 ? ` — filiais ${user.filiais.join(', ')}` : '';
    console.log(`  usuário: ${user.email} — papel ${user.role}${recorte}`);
  }
  console.log(`  usuário: ${PLATFORM_ADMIN.email} — administração da plataforma`);
  console.log(`  senha  : ${password}`);
  console.log('');
  console.log('  O papel owner exige cadastrar MFA no primeiro acesso (doc 06 §MFA).');
  console.log('  E-mails de convite/reset aparecem no Mailpit: http://localhost:8025');
  console.log('');
}

main()
  .catch((error: unknown) => {
    console.error('Falha no seed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
