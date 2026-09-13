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
