import { SyncQueueService, type JobSync } from '../../src/modules/sync/queue/sync-queue.service';

/**
 * `enfileirar` (E5-01) tem um id de job determinístico de propósito — mas o Lua do BullMQ
 * (`addStandardJob`) recusa reenfileirar um id que já exista em Redis em **qualquer** estado,
 * inclusive `completed`/`failed`, até a limpeza apagar a chave. Sem o tratamento abaixo, a
 * primeira falha de um domínio travava toda tentativa seguinte — cadência ou "Sincronizar
 * agora" — por até 3 dias (`removeOnFail`), e o painel ficava preso em "nunca rodou" mesmo com
 * a causa original já corrigida.
 *
 * O teste chama o método real via `.call` sobre um `this` fake: exercita a lógica de
 * `enfileirar` sem abrir conexão nenhuma com Redis (o construtor da classe abriria uma de
 * verdade, o que tornaria isto um teste de integração disfarçado).
 */
describe('SyncQueueService.enfileirar — id determinístico', () => {
  const job: JobSync = { tipo: 'dominio', tenantId: 't1', domain: 'produtos' };
  const idEsperado = 't1--produtos--geral--auto';

  function instanciaFake(estadoExistente?: string) {
    const jobExistente = estadoExistente
      ? {
          getState: jest.fn().mockResolvedValue(estadoExistente),
          remove: jest.fn().mockResolvedValue(undefined),
        }
      : undefined;

    const sync = {
      getJob: jest.fn().mockResolvedValue(jobExistente),
      add: jest.fn().mockResolvedValue(undefined),
    };
    const logger = { info: jest.fn() };
    const instancia = { sync, logger } as unknown as SyncQueueService;

    return { instancia, sync, logger, jobExistente };
  }

  it('não existe job com esse id: enfileira normalmente', async () => {
    const { instancia, sync } = instanciaFake(undefined);

    await SyncQueueService.prototype.enfileirar.call(instancia, job);

    expect(sync.add).toHaveBeenCalledWith(
      'produtos',
      job,
      expect.objectContaining({ jobId: idEsperado }),
    );
  });

  it.each(['completed', 'failed'])(
    'job anterior já %s: remove e reenfileira, em vez de desistir',
    async (estado) => {
      const { instancia, sync, jobExistente } = instanciaFake(estado);

      await SyncQueueService.prototype.enfileirar.call(instancia, job);

      expect(jobExistente?.remove).toHaveBeenCalledTimes(1);
      expect(sync.add).toHaveBeenCalledWith(
        'produtos',
        job,
        expect.objectContaining({ jobId: idEsperado }),
      );
    },
  );

  it.each(['waiting', 'active', 'delayed', 'prioritized', 'waiting-children'])(
    'job anterior ainda %s: não mexe nele nem duplica',
    async (estado) => {
      const { instancia, sync, jobExistente } = instanciaFake(estado);

      await SyncQueueService.prototype.enfileirar.call(instancia, job);

      expect(jobExistente?.remove).not.toHaveBeenCalled();
      expect(sync.add).not.toHaveBeenCalled();
    },
  );

  it('o id do job ignora ":" e usa os separadores certos (BullMQ recusa ":")', async () => {
    const { instancia, sync } = instanciaFake(undefined);

    await SyncQueueService.prototype.enfileirar.call(instancia, {
      tipo: 'dominio',
      tenantId: 't1',
      domain: 'vendas_hoje',
      filialErpId: 2,
      data: '2026-09-01',
    });

    expect(sync.add).toHaveBeenCalledWith(
      'vendas_hoje',
      expect.anything(),
      expect.objectContaining({ jobId: 't1--vendas_hoje--2--2026-09-01' }),
    );
  });
});
