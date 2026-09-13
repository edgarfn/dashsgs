import { Module } from '@nestjs/common';
import { DashboardCache } from './cache.service';
import { DashboardController } from './dashboard.controller';
import { EstoqueService } from './estoque.service';
import { FrescorService } from './frescor.service';
import { HomeService } from './home.service';
import { VendasService } from './vendas.service';

/**
 * Dashboard (Fase 7, épico E7).
 *
 * Só leitura: o módulo não conhece a integração com o ERP nem a fila de sync. O que ele enxerga é
 * o espelho já normalizado e os agregados — e é essa fronteira que mantém o caminho do request
 * curto e previsível.
 */
@Module({
  controllers: [DashboardController],
  providers: [FrescorService, DashboardCache, HomeService, VendasService, EstoqueService],
  exports: [FrescorService],
})
export class DashboardModule {}
