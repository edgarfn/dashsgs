/**
 * Aritmética de datas de negócio (`YYYY-MM-DD`), sem biblioteca e sem fuso no meio.
 *
 * Duas regras explicam todas as funções abaixo:
 *
 * 1. **Dia é texto, não instante.** "13/09" numa loja de Manaus e numa de São Paulo são dias
 *    diferentes no relógio, mas o mesmo dia no relatório. Guardar como `Date` convidaria o fuso
 *    do servidor a decidir qual é qual.
 * 2. **A conversão instante → dia acontece uma vez, com o fuso do tenant explícito** (`diaEm`).
 *    Depois disso, soma e diferença são feitas em UTC puro, onde não existe horário de verão.
 */

/** `YYYY-MM-DD` de um instante, no fuso informado (o do tenant — doc 14 §5). */
export function diaEm(data: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(data);
}

/** Soma (ou subtrai) dias a uma data `YYYY-MM-DD`. */
export function somarDias(dia: string, dias: number): string {
  const base = new Date(`${dia}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + dias);
  return base.toISOString().slice(0, 10);
}

/** Diferença em dias entre duas datas `YYYY-MM-DD` (fim − início). */
export function diferencaEmDias(inicio: string, fim: string): number {
  return Math.round(
    (Date.parse(`${fim}T00:00:00Z`) - Date.parse(`${inicio}T00:00:00Z`)) / 86_400_000,
  );
}

/** Dia da semana (0 = domingo), calculado em UTC para não escorregar por fuso. */
export function diaDaSemana(dia: string): number {
  return new Date(`${dia}T00:00:00Z`).getUTCDay();
}

/**
 * Deslocamento do fuso, em minutos, no instante informado.
 *
 * Calculado comparando o mesmo instante formatado no fuso alvo com o UTC — é o jeito de obter o
 * offset real (inclusive horário de verão) sem carregar uma base de fusos: o `Intl` já tem uma.
 */
function offsetEmMinutos(instante: Date, timezone: string): number {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instante);

  const campo = (tipo: string) => Number(partes.find((parte) => parte.type === tipo)?.value ?? 0);

  const comoSeFosseUtc = Date.UTC(
    campo('year'),
    campo('month') - 1,
    campo('day'),
    // `hour12: false` devolve 24 para a meia-noite em alguns runtimes; 24 % 24 = 0.
    campo('hour') % 24,
    campo('minute'),
    campo('second'),
  );

  return (comoSeFosseUtc - instante.getTime()) / 60_000;
}

/**
 * Instante UTC em que um dia começa no fuso do tenant.
 *
 * É o inverso de `diaEm`, e existe porque filtro de data é escolhido por gente: quem digita
 * "de 17/09 até 17/09" na tela quer o dia 17 **da loja**, não a fatia UTC correspondente. Sem
 * isto, perto da virada do dia o filtro devolvia o dia errado (doc 34 §4.5).
 *
 * A segunda passada cobre a fronteira de horário de verão: o offset do palpite inicial pode não
 * ser o offset que de fato vale no instante resultante.
 */
export function inicioDoDiaEm(dia: string, timezone: string): Date {
  const palpite = new Date(`${dia}T00:00:00.000Z`);
  const offset = offsetEmMinutos(palpite, timezone);
  const candidato = new Date(palpite.getTime() - offset * 60_000);

  const offsetReal = offsetEmMinutos(candidato, timezone);
  return offsetReal === offset ? candidato : new Date(palpite.getTime() - offsetReal * 60_000);
}

/**
 * Instante UTC em que um dia **termina** no fuso do tenant — exclusivo.
 *
 * Exclusivo (`< fim`) e não inclusivo com 23:59:59.999: o dia seguinte começa exatamente onde
 * este acaba, e comparar com `<` dispensa escolher uma precisão de milissegundo que a coluna
 * pode não ter.
 */
export function fimDoDiaEm(dia: string, timezone: string): Date {
  return inicioDoDiaEm(somarDias(dia, 1), timezone);
}
