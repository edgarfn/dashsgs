import { Injectable } from '@nestjs/common';
import { type AuthContext } from '../../common/auth';
import { FiliaisScopeService, TenantDatabase } from '../../common/tenant';

export interface FilialView {
  erpId: number;
  razaoSocial: string;
  nomeFantasia: string | null;
  uf: string | null;
  ativa: boolean;
  syncedAt: string;
}

/**
 * Dimensão de filiais (doc 23 §`GET /dim/filiais`).
 *
 * É a primeira leitura de espelho do ERP do produto e serve de molde para as próximas: o dado
 * vem sempre dentro do contexto de tenant (RLS) **e** com o recorte de filiais da membership
 * aplicado na consulta — as duas camadas, como manda o doc 07 §4.2.
 */
@Injectable()
export class FiliaisService {
  constructor(
    private readonly tenantDb: TenantDatabase,
    private readonly scope: FiliaisScopeService,
  ) {}

  async list(auth: AuthContext, tenantId: string, requested?: number[]): Promise<FilialView[]> {
    const membership = auth.memberships.find((item) => item.tenantId === tenantId);
    const escopo = this.scope.resolve(membership?.filiaisAllowed ?? [], requested);

    const filiais = await this.tenantDb.run(tenantId, (tx) =>
      tx.erpFilial.findMany({
        where: { erpId: this.scope.whereClause(escopo) },
        orderBy: { erpId: 'asc' },
        select: {
          erpId: true,
          razaoSocial: true,
          nomeFantasia: true,
          uf: true,
          ativa: true,
          syncedAt: true,
        },
      }),
    );

    return filiais.map((filial) => ({
      erpId: filial.erpId,
      razaoSocial: filial.razaoSocial,
      nomeFantasia: filial.nomeFantasia,
      uf: filial.uf,
      ativa: filial.ativa,
      syncedAt: filial.syncedAt.toISOString(),
    }));
  }
}
