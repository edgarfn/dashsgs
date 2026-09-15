import { closeDb, resetSeedAccounts } from './db';
import { CONTAS } from './helpers';

/**
 * Devolve as contas do seed ao estado de primeiro acesso quando a suíte termina.
 *
 * Os cenários já fazem isso **antes** de cada teste, mas ninguém fazia depois do último — e o
 * último costuma ser um que cadastrou MFA. O segredo do autenticador vive só dentro do teste,
 * então quem abrisse o navegador depois de rodar a suíte recebia a tela pedindo um código de 6
 * dígitos que não existe em lugar nenhum, sem caminho de volta pela interface (os códigos de
 * recuperação também ficaram no teste).
 *
 * O ambiente de desenvolvimento não pode ficar pior por ter rodado os testes.
 */
export default async function globalTeardown(): Promise<void> {
  try {
    await resetSeedAccounts(Object.values(CONTAS));
  } finally {
    await closeDb();
  }
}
