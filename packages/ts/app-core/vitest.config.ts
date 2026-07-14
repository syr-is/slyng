import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		// Pure-logic suites only. The normalization layer's imports are all
		// type-only, so no Svelte-rune or WASM-client transform is needed.
		include: ['src/**/*.test.ts'],
		environment: 'node'
	}
});
