/**
 * Preferência de tema (claro/escuro): cookie simples, não-httpOnly, escrito pelo cliente — é o
 * primeiro dado puramente de UI do app (cosmético, não vinculado à conta), então foge de
 * propósito do padrão "toda mutação passa por Server Action + API" usado no resto do produto.
 * Sem CSRF/sessão envolvida; não há coluna no banco para isto.
 */
export const THEME_COOKIE = 'dashsgs_theme';

export type Theme = 'light' | 'dark';
