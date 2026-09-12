import { Global, Module } from '@nestjs/common';
import { EnvelopeCryptoService } from './envelope-crypto.service';
import { HashingService } from './hashing.service';

/** Primitivos de segurança compartilhados: cifra de envelope e hashes de identidade. */
@Global()
@Module({
  providers: [EnvelopeCryptoService, HashingService],
  exports: [EnvelopeCryptoService, HashingService],
})
export class CryptoModule {}
