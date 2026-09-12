import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FiliaisService } from './filiais.service';
import { MembersService } from './members.service';
import { DimController, TenantController } from './tenant.controller';

/**
 * Módulo do tenant (Fase 4 / épico E3): dados do contrato, gestão de membros e convites, e as
 * dimensões que as telas usam para filtrar. Depende do AuthModule pelo serviço de convites —
 * convite é identidade; o que muda aqui é quem administra.
 */
@Module({
  imports: [AuthModule],
  controllers: [TenantController, DimController],
  providers: [MembersService, FiliaisService],
  exports: [MembersService, FiliaisService],
})
export class TenantModule {}
