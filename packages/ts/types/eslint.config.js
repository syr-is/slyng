import { fileURLToPath } from 'node:url';
import prettier from 'eslint-config-prettier';
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import ts from 'typescript-eslint';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(
	{ ignores: ['dist', 'node_modules', 'eslint.config.js'] },
	js.configs.recommended,
	...ts.configs.recommended,
	prettier,
	{
		languageOptions: {
			parserOptions: {
				project: './tsconfig.eslint.json',
				tsconfigRootDir: __dirname
			}
		},
		rules: {
			'no-undef': 'off',
			'@typescript-eslint/no-unused-vars': [
				'error',
				{
					argsIgnorePattern: '^_',
					varsIgnorePattern: '^_',
					caughtErrorsIgnorePattern: '^_'
				}
			]
		}
	}
);
