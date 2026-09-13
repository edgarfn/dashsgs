import { Module } from '@nestjs/common';
import { SgModule } from '../../integration/sg';
import { ErpConnectionController } from './erp-connection.controller';
import { ErpConnectionService } from './erp-connection.service';

/** Cofre de credencial e wizard de conexão (épico E4: E4-03 e E4-07). */
@Module({
  imports: [SgModule],
  controllers: [ErpConnectionController],
  providers: [ErpConnectionService],
  exports: [ErpConnectionService],
})
export class ErpConnectionModule {}
