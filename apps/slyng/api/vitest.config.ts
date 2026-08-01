import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		// Two kinds of suite: dependency-free modules under `common/`, and
		// services driven directly through their injected repositories. Neither
		// boots a Nest module or opens a DB connection, so no test container,
		// no `Test.createTestingModule`, and no fixture teardown.
		include: ['src/**/*.test.ts'],
		environment: 'node'
	}
});
