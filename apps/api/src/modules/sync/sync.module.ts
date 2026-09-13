import { Module } from '@nestjs/common';
import { SgModule } from '../../integration/sg/sg.module';
import { ErpConnectionModule } from '../erp-connection/erp-connection.module';
import { AggregatesService } from './aggregates.service';
import { BackfillService } from './backfill.service';
import { DimensoesSync } from './domains/dimensoes.sync';
import { ProdutosSync } from './domains/produtos.sync';
import { ResumoFilialSync } from './domains/resumo-filial.sync';
import { VendasDiaSync } from './domains/vendas-dia.sync';
import { VendasHojeSync } from './domains/vendas-hoje.sync';
import { VendasPersistencia } from './domains/vendas.persistencia';
import { SyncQueueService } from './queue/sync-queue.service';
import { SyncSchedulerService } from './queue/sync-scheduler.service';
import { SyncController } from './sync.controller';
import { SyncLockService } from './sync-lock.service';
import { SyncRunService } from './sync-run.service';
import { SyncStatusService } from './sync-status.service';
import { SyncService } from './sync.service';
import { WatermarkService } from './watermark.service';

/**
 * Sincronização (Fase 6, épico E5).
 *
 * O módulo é o mesmo na API e no worker — o que muda é quem consome a fila. A API importa daqui
 * o produtor e o painel; o processo de worker adiciona `SyncWorker` (ver `worker.module.ts`) e
 * passa a executar. Um módulo só evita a armadilha clássica de o worker divergir da API e
 * sincronizar com regra diferente da que a tela mostra.
 */
@Module({
  imports: [SgModule, ErpConnectionModule],
  controllers: [SyncController],
  providers: [
    WatermarkService,
    SyncLockService,
    SyncRunService,
    AggregatesService,
    VendasPersistencia,
    DimensoesSync,
    ProdutosSync,
    VendasHojeSync,
    VendasDiaSync,
    ResumoFilialSync,
    SyncService,
    BackfillService,
    SyncStatusService,
    SyncQueueService,
    SyncSchedulerService,
  ],
  exports: [
    SyncService,
    BackfillService,
    SyncQueueService,
    SyncSchedulerService,
    SyncStatusService,
  ],
})
export class SyncModule {}
