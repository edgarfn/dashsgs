import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditoriaPlataformaController } from './auditoria.controller';
import { BreakGlassController } from './break-glass.controller';
import { BreakGlassService } from './break-glass.service';
import { PlatformAdminGuard } from './platform-admin.guard';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';
import { RetencaoController } from './retencao.controller';
import { RetencaoModule } from '../retencao/retencao.module';

/** Administração da plataforma: contas separadas, MFA recente e tudo auditado (doc 07 §2). */
@Module({
  imports: [AuthModule, RetencaoModule],
  controllers: [
    PlatformController,
    BreakGlassController,
    RetencaoController,
    AuditoriaPlataformaController,
  ],
  providers: [PlatformService, PlatformAdminGuard, BreakGlassService],
  exports: [PlatformAdminGuard, PlatformService, BreakGlassService],
})
export class PlatformModule {}
