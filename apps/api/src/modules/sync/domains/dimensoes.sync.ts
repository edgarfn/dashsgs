import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { SgClient, SgError } from '../../../integration/sg';
import { TenantDatabase } from '../../../common/tenant';
import { type Coluna, upsertLote } from '../upsert-lote';
import { type ContextoSync, type JobDeSync, type ResultadoSync } from '../sync.types';

/**
 * Dimensões leves: filiais, os seis níveis de departamento, marcas, classes, agrupamentos e
 * unidades de medida (doc 14 §2).
 *
 * Tudo num job só porque são coleções pequenas, que mudam pouco e que o dashboard consome
 * juntas — quebrar em seis jobs multiplicaria locks e execuções sem ganhar nada. A varredura é
 * integral: a API não expõe data de alteração para cadastro de dimensão (doc 33).
 *
 * Rota fora do contrato do tenant **não é erro**: é degradação graciosa (doc 12 §2). O ERP de uma
 * rede pode simplesmente não vender o módulo de agrupamentos, e o resto tem que continuar.
 */

interface Dimensao {
  recurso:
    | 'departamentos/nivel1'
    | 'departamentos/nivel2'
    | 'departamentos/nivel3'
    | 'departamentos/nivel4'
    | 'departamentos/nivel5'
    | 'departamentos/nivel6'
    | 'marcas'
    | 'classes'
    | 'agrupamentos'
    | 'unidadesmedida';
  tabela: string;
  /** Departamentos encadeiam para o nível seguinte; as demais dimensões são planas. */
  hierarquia: boolean;
}

const DIMENSOES: Dimensao[] = [
  { recurso: 'departamentos/nivel1', tabela: 'erp_departamentos_n1', hierarquia: true },
  { recurso: 'departamentos/nivel2', tabela: 'erp_departamentos_n2', hierarquia: true },
  { recurso: 'departamentos/nivel3', tabela: 'erp_departamentos_n3', hierarquia: true },
  { recurso: 'departamentos/nivel4', tabela: 'erp_departamentos_n4', hierarquia: true },
  { recurso: 'departamentos/nivel5', tabela: 'erp_departamentos_n5', hierarquia: true },
  { recurso: 'departamentos/nivel6', tabela: 'erp_departamentos_n6', hierarquia: true },
  { recurso: 'marcas', tabela: 'erp_marcas', hierarquia: false },
  { recurso: 'classes', tabela: 'erp_classes', hierarquia: false },
  { recurso: 'agrupamentos', tabela: 'erp_agrupamentos', hierarquia: false },
  { recurso: 'unidadesmedida', tabela: 'erp_unidades_medida', hierarquia: false },
];

/**
 * Falhas que significam "esta instalação não tem esse recurso": ou a rota está fora do contrato
 * do tenant, ou o ERP responde 404/400 para ela. Nos dois casos o produto segue sem a dimensão,
 * em vez de derrubar o cadastro inteiro por causa de um módulo que a rede não usa.
 */
const INDISPONIVEL = new Set(['rota_nao_contratada', 'nao_encontrado']);

const COLUNAS_FILIAL: Coluna[] = [
  { nome: 'tenant_id', tipo: 'uuid' },
  { nome: 'erp_id', tipo: 'int' },
  { nome: 'razao_social', tipo: 'text' },
  { nome: 'nome_fantasia', tipo: 'text' },
  { nome: 'cnpj', tipo: 'text' },
  { nome: 'municipio_erp_id', tipo: 'int' },
  { nome: 'uf', tipo: 'text' },
  { nome: 'ativa', tipo: 'bool' },
  { nome: 'synced_at', tipo: 'timestamptz' },
];

function colunasDimensao(hierarquia: boolean): Coluna[] {
  const base: Coluna[] = [
    { nome: 'tenant_id', tipo: 'uuid' },
    { nome: 'erp_id', tipo: 'text' },
    { nome: 'descricao', tipo: 'text' },
  ];
  if (hierarquia) base.push({ nome: 'parent_next_level_erp_id', tipo: 'text' });
  base.push({ nome: 'synced_at', tipo: 'timestamptz' });
  return base;
}

@Injectable()
export class DimensoesSync implements JobDeSync {
  readonly domain = 'dimensoes' as const;

  constructor(
    private readonly sg: SgClient,
    private readonly tenantDb: TenantDatabase,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(DimensoesSync.name);
  }

  async executar(contexto: ContextoSync): Promise<ResultadoSync> {
    const agora = new Date();
    let items = 0;
    let invalid = 0;
    let apiCalls = 0;
    const semContrato: string[] = [];
    const duplicadas: string[] = [];

    /** Chave repetida pelo ERP na mesma coleção: o upsert resolve, mas alguém precisa saber. */
    const anotarDuplicadas =
      (recurso: string) =>
      (chaves: string[]): void => {
        duplicadas.push(`${recurso} (${chaves.join(', ')})`);
        this.logger.warn(
          {
            event: 'sync_dimensao_chave_duplicada',
            tenant_id: contexto.tenantId,
            recurso,
            chaves,
          },
          'sync_dimensao_chave_duplicada',
        );
      };

    // Filiais primeiro: é a dimensão que todos os outros domínios usam para saber onde procurar.
    const filiais = await this.sg.listFiliais(contexto.sg);
    apiCalls += 1;
    invalid += filiais.invalidos;

    items += await this.tenantDb.run(contexto.tenantId, (tx) =>
      upsertLote(
        tx,
        {
          tabela: 'erp_filiais',
          colunas: COLUNAS_FILIAL,
          chave: ['tenant_id', 'erp_id'],
          aoDuplicar: anotarDuplicadas('filiais'),
        },
        filiais.itens.map((filial) => ({
          tenant_id: contexto.tenantId,
          erp_id: filial.erpId,
          razao_social: filial.razaoSocial,
          nome_fantasia: filial.nomeFantasia,
          cnpj: filial.cnpj,
          municipio_erp_id: filial.municipioErpId,
          uf: filial.uf,
          ativa: filial.ativa,
          synced_at: agora,
        })),
      ),
    );

    for (const dimensao of DIMENSOES) {
      try {
        const coleta = await this.sg.listDimensao(contexto.sg, dimensao.recurso);
        apiCalls += 1;
        invalid += coleta.invalidos;

        items += await this.tenantDb.run(contexto.tenantId, (tx) =>
          upsertLote(
            tx,
            {
              tabela: dimensao.tabela,
              colunas: colunasDimensao(dimensao.hierarquia),
              chave: ['tenant_id', 'erp_id'],
              aoDuplicar: anotarDuplicadas(dimensao.recurso),
            },
            coleta.itens.map((item) => ({
              tenant_id: contexto.tenantId,
              erp_id: item.erpId,
              descricao: item.descricao,
              parent_next_level_erp_id: dimensao.hierarquia
                ? (item.parentNextLevelErpId ?? null)
                : undefined,
              synced_at: agora,
            })),
          ),
        );
      } catch (erro) {
        if (erro instanceof SgError && INDISPONIVEL.has(erro.falha)) {
          semContrato.push(dimensao.recurso);
          continue;
        }
        throw erro;
      }
    }

    if (semContrato.length > 0) {
      this.logger.info(
        {
          event: 'sync_dimensao_sem_contrato',
          tenant_id: contexto.tenantId,
          recursos: semContrato,
        },
        'sync_dimensao_sem_contrato',
      );
    }

    // As duas notas convivem: uma rede pode ter um módulo fora do contrato E um cadastro com
    // chave repetida, e esconder a segunda deixaria o operador sem saber por que o total de
    // itens não bate com o que ele vê no ERP.
    const notas = [
      semContrato.length > 0 ? `fora do contrato: ${semContrato.join(', ')}` : null,
      duplicadas.length > 0 ? `chave repetida no ERP: ${duplicadas.join('; ')}` : null,
    ].filter((nota): nota is string => nota !== null);

    return {
      items,
      invalid,
      apiCalls,
      pages: apiCalls,
      watermarkTs: agora,
      observacao: notas.length > 0 ? notas.join(' · ') : undefined,
    };
  }
}
