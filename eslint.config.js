import prettier from 'eslint-config-prettier';
import path from 'node:path';
import { includeIgnoreFile } from '@eslint/compat';
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import unusedImports from 'eslint-plugin-unused-imports';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';
import svelteConfig from './svelte.config.js';

const gitignorePath = path.resolve(import.meta.dirname, '.gitignore');

export default defineConfig(
	includeIgnoreFile(gitignorePath),
	{
		ignores: ['src/lib/generated/**', 'mcp/**']
	},
	js.configs.recommended,
	ts.configs.recommended,
	svelte.configs.recommended,
	prettier,
	svelte.configs.prettier,
	{
		languageOptions: { globals: { ...globals.browser, ...globals.node } },
		plugins: {
			'unused-imports': unusedImports
		},
		rules: {
			'no-undef': 'off',
			'@typescript-eslint/no-unused-vars': 'off',
			'unused-imports/no-unused-imports': 'error',
			'unused-imports/no-unused-vars': [
				'warn',
				{
					vars: 'all',
					varsIgnorePattern: '^_',
					args: 'after-used',
					argsIgnorePattern: '^_'
				}
			],

			// Require curly braces for all control statements (no bracketless if/else/while/for)
			curly: ['error', 'all'],

			// Disallow the 'as' operator (type assertions)
			'@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],

			// Disallow TypeScript type predicates (value is SomeType) and undefined
			'no-restricted-syntax': [
				'error',
				{
					selector: 'TSTypePredicate',
					message:
						'Type predicates (value is Type) are not allowed. Use type guards with explicit type checking instead.'
				},
				{
					selector: 'Identifier[name="undefined"]',
					message: 'undefined is not allowed. Use null or proper type checking instead.'
				},
				{
					selector: 'TSUndefinedKeyword',
					message: 'undefined type is not allowed. Use null instead.'
				},
				{
					selector: 'CallExpression[callee.name="$effect"]',
					message: '$effect is not allowed. Use a different reactive pattern instead.'
				}
			],

			// Svelte recommended rules that weren't part of the project ruleset.
			'svelte/no-navigation-without-resolve': 'off',
			'svelte/prefer-svelte-reactivity': 'off',
			'svelte/no-useless-children-snippet': 'off',
			'svelte/no-at-html-tags': 'off'
		}
	},
	{
		// Generated config files: skip the project rules that don't apply.
		files: ['svelte.config.js'],
		rules: {
			'no-restricted-syntax': 'off'
		}
	},
	{
		// Dev-only harness routes (guarded by `dev` and excluded from auth):
		// mocking a client requires asserting a narrow stub to the real type.
		files: ['src/routes/dev/**'],
		rules: {
			'@typescript-eslint/consistent-type-assertions': 'off'
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				extraFileExtensions: ['.svelte'],
				parser: ts.parser,
				svelteConfig
			}
		}
	}
);
