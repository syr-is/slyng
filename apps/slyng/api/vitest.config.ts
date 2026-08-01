import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		// Pure-logic suites only. Nothing here boots a Nest module or touches
		// SurrealDB — `common/permission-fold` is deliberately dependency-free,
		// which is what makes it unit-testable at all.
		include: ['src/**/*.test.ts'],
		environment: 'node'
	}
});
