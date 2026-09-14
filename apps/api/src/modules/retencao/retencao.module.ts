import { Module } from '@nestjs/common';
import { OffboardingService } from './offboarding.service';
import { RetencaoService } from './retencao.service';

/**
 * Retenção e offboarding (E6-04, docs 08 §5 e 10 §2).
 *
 * Só serviços, de propósito: este módulo é carregado **também** pelo processo de worker, que
 * não tem guards, controllers nem rate limit de requisição. A rota que expõe o painel mora no
 * módulo da plataforma, que é onde vive o guard de operação.
 *
 * Os dois caminhos — o botão do painel e a rodada das 3h20 — chamam o mesmo serviço. O botão
 * não pode fazer nada diferente do que a madrugada faz sozinha, senão um dos dois apodrece sem
 * ninguém notar.
 */
@Module({
  providers: [RetencaoService, OffboardingService],
  exports: [RetencaoService, OffboardingService],
})
export class RetencaoModule {}
