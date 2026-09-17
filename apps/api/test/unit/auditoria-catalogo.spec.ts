import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AUDIT_ACOES, AUDIT_CATEGORIAS, AUDIT_CATEGORIA_LABEL } from '@dashsgs/shared';

const SRC = resolve(__dirname, '../../src');
/**
 * O seed também já gravou na trilha no passado (`seed.executed`, hoje extinto). Varrê-lo junto
 * fecha o buraco: ação escrita fora de `apps/api/src` continua sendo ação que aparece na tela.
 */
const RAIZES = [SRC, resolve(__dirname, '../../../../prisma')];

/** Todos os arquivos `.ts` do código de produção. */
function fontes(diretorio: string): string[] {
  return readdirSync(diretorio, { withFileTypes: true }).flatMap((entrada) => {
    const caminho = join(diretorio, entrada.name);
    if (entrada.isDirectory()) return fontes(caminho);
    return entrada.name.endsWith('.ts') ? [caminho] : [];
  });
}

/**
 * Ações que o código realmente grava na trilha.
 *
 * Lidas do fonte, e não de uma lista escrita à mão: uma segunda lista envelheceria em silêncio,
 * que é exatamente o defeito que este teste existe para impedir.
 */
function acoesEmitidas(): Map<string, string> {
  const encontradas = new Map<string, string>();

  for (const arquivo of RAIZES.flatMap(fontes)) {
    const conteudo = readFileSync(arquivo, 'utf8');
    // Toda ação da trilha é pontuada (`auth.login.failed`). Exigir o ponto elimina os dois
    // falsos positivos que a busca por `action:` encontraria: `orderBy: { action: 'asc' }` e o
    // `frameguard: { action: 'deny' }` do helmet.
    for (const [, acao] of conteudo.matchAll(/action:\s*'([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+)'/g)) {
      encontradas.set(acao as string, arquivo);
    }
    for (const [, a, b] of conteudo.matchAll(
      /action:\s*\w+\s*\?\s*'([a-z][a-z0-9_.]+)'\s*:\s*'([a-z][a-z0-9_.]+)'/g,
    )) {
      encontradas.set(a as string, arquivo);
      encontradas.set(b as string, arquivo);
    }
  }

  return encontradas;
}

/**
 * O catálogo é o que a tela de auditoria mostra ao auditor (E6-01). Uma ação gravada sem entrada
 * nele aparece como código cru — `auth.mfa.disable_denied` numa coluna não diz a ninguém se
 * aquilo é um problema. E ninguém descobre até um auditor perguntar o que significa.
 */
describe('catálogo de auditoria', () => {
  it('cobre toda ação que o código grava', () => {
    const emitidas = acoesEmitidas();
    expect(emitidas.size).toBeGreaterThan(20);

    const semRotulo = [...emitidas.entries()]
      .filter(([acao]) => !AUDIT_ACOES[acao])
      .map(([acao, arquivo]) => `${acao} (${arquivo.replace(SRC, 'src')})`);

    expect(semRotulo).toEqual([]);
  });

  it('não descreve ação que o código não grava mais', () => {
    const emitidas = acoesEmitidas();
    const orfas = Object.keys(AUDIT_ACOES).filter((acao) => !emitidas.has(acao));

    // Rótulo de evento extinto na tela é pior que nada: sugere que aquilo ainda pode acontecer.
    expect(orfas).toEqual([]);
  });

  it('toda ação tem categoria conhecida e rótulo em português legível', () => {
    const invalidas = Object.entries(AUDIT_ACOES).filter(
      ([, info]) =>
        !AUDIT_CATEGORIAS.includes(info.categoria) ||
        info.label.trim().length < 5 ||
        // Rótulo que é só o código traduzido não ajuda ninguém.
        info.label.includes('.'),
    );

    expect(invalidas.map(([acao]) => acao)).toEqual([]);
  });

  it('toda categoria tem rótulo', () => {
    const semRotulo = AUDIT_CATEGORIAS.filter((categoria) => !AUDIT_CATEGORIA_LABEL[categoria]);
    expect(semRotulo).toEqual([]);
  });
});
