// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

/**
 * Regras do doc 24 §6 (padrões de código) e do doc 09 (segurança) aplicadas como lint:
 *  - proibido `console.*` (usar o logger estruturado com redaction — doc 18 §1);
 *  - proibido ler `process.env` fora de `config/` (contrato validado por zod — doc 19 §3);
 *  - proibido `SELECT *` em SQL embutido (doc 09 §3 — API3 property authorization);
 *  - proibido cliente HTTP fora da camada de integração (doc 04 §2).
 *
 * O que não dá para expressar em lint (chave de cache sem prefixo de tenant, query sem contexto)
 * é coberto pelos testes de isolamento da Fase 4 (doc 08 §6).
 */
const restrictedEnvAccess = {
  selector: "MemberExpression[object.name='process'][property.name='env']",
  message:
    'Acesso a process.env é permitido apenas em config/ (contrato de ambiente validado por zod — doc 19 §3).',
};

const SELECT_STAR = String.raw`\bselect\s+\*`;

const restrictedSelectStar = [
  {
    selector: `Literal[value=/${SELECT_STAR}/i]`,
    message: 'Proibido `SELECT *`: projete as colunas explicitamente (doc 09 §3 — API3).',
  },
  {
    selector: `TemplateElement[value.raw=/${SELECT_STAR}/i]`,
    message: 'Proibido `SELECT *`: projete as colunas explicitamente (doc 09 §3 — API3).',
  },
];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/*.d.ts',
      'prisma/migrations/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-console': 'error',
      'no-debugger': 'error',
      eqeqeq: ['error', 'smart'],
      'no-restricted-syntax': ['error', restrictedEnvAccess, ...restrictedSelectStar],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'axios', message: 'Use o cliente HTTP da camada de integração (doc 04 §2).' },
            { name: 'node-fetch', message: 'Use o cliente HTTP da camada de integração.' },
            { name: 'undici', message: 'Use o cliente HTTP da camada de integração.' },
          ],
        },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
    },
  },
  // NestJS resolve as dependências do construtor pelos metadados emitidos pelo TypeScript
  // (`emitDecoratorMetadata`). Trocar esses imports por `import type` apaga o valor em runtime
  // e a injeção passa a receber `undefined` — o autofix desta regra quebraria a aplicação.
  {
    files: ['apps/api/src/**/*.ts'],
    rules: { '@typescript-eslint/consistent-type-imports': 'off' },
  },
  // Camadas autorizadas a ler o ambiente bruto e a falar HTTP com o mundo.
  {
    files: [
      'apps/api/src/config/**/*.ts',
      'apps/api/src/integration/**/*.ts',
      'apps/web/next.config.mjs',
      'apps/web/src/middleware.ts',
      'apps/web/src/lib/server/env.ts',
      'prisma/**/*.ts',
      'scripts/**/*.{ts,mjs}',
      'e2e/**/*.ts',
      '**/*.config.{ts,mjs,js}',
    ],
    rules: {
      'no-restricted-syntax': ['error', ...restrictedSelectStar],
      'no-restricted-imports': 'off',
    },
  },
  // Scripts operacionais e seeds falam com o operador pelo stdout.
  {
    files: ['prisma/**/*.ts', 'scripts/**/*.{ts,mjs}'],
    rules: { 'no-console': 'off' },
  },
  // Testes: fixtures podem usar tipos frouxos e precisam montar ambientes.
  {
    files: ['**/*.spec.ts', '**/*.int-spec.ts', '**/test/**/*.ts'],
    languageOptions: { globals: { ...globals.node, ...globals.jest } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-restricted-syntax': ['error', ...restrictedSelectStar],
    },
  },
  // A própria configuração cita o padrão SQL que ela proíbe — não é SQL, é a regra.
  {
    files: ['eslint.config.mjs'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  prettier,
);
