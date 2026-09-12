import { Global, Module } from '@nestjs/common';
import { FiliaisScopeService } from './filiais-scope.service';
import { TenantDatabase } from './tenant-database.service';

/** Infraestrutura de isolamento por tenant (doc 08): contexto de banco e recorte de filiais. */
@Global()
@Module({
  providers: [TenantDatabase, FiliaisScopeService],
  exports: [TenantDatabase, FiliaisScopeService],
})
export class TenantContextModule {}
