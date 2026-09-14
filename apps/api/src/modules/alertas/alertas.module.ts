import { Module } from '@nestjs/common';
import { AlertEngine } from './alert-engine.service';
import { AlertFeedService } from './alert-feed.service';
import { AlertRulesService } from './alert-rules.service';
import { AlertasController } from './alertas.controller';
import { NotificacoesService } from './notificacoes.service';

/**
 * Alertas (Fase 8, épico E8).
 *
 * Depende só do espelho e do e-mail: nada aqui fala com o ERP. É o que permite o motor rodar
 * justamente quando a integração está parada — que é o alerta mais importante de todos.
 */
@Module({
  controllers: [AlertasController],
  providers: [AlertRulesService, AlertFeedService, NotificacoesService, AlertEngine],
  exports: [AlertEngine, AlertFeedService, AlertRulesService],
})
export class AlertasModule {}
