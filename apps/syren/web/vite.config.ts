import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, searchForWorkspaceRoot } from 'vite';

const workspaceRoot = searchForWorkspaceRoot(process.cwd());

export default defineConfig({
	envDir: workspaceRoot,
	plugins: [tailwindcss(), sveltekit()],
	server: {
		port: 5174,
		strictPort: true,
		fs: {
			allow: [searchForWorkspaceRoot(process.cwd())]
		},
		proxy: {
			'/api': 'http://localhost:5175',
			'/ws': {
				target: 'http://localhost:5175',
				ws: true
			}
		}
	},
	preview: {
		port: 5174,
		strictPort: true
	},
	ssr: {
		noExternal: [/^@syren\/(ui|app-core)($|\/)/]
	},
	resolve: {
		// In production, the Docker build sets `inject-workspace-packages=true`
		// which hard-copies @syren/app-core into every consumer's node_modules.
		// Without dedupe, the bundle ends up with two module instances and
		// every singleton `$state` store (servers, presence, profiles, …) gets
		// duplicated — so e.g. setServers() writes to instance A and
		// ServerList reads from instance B. Force a single resolution per
		// workspace package name so all callers share the same module.
		dedupe: ['@syren/app-core', '@syren/ui', '@syren/types', 'svelte']
	}
});
