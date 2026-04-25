import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, searchForWorkspaceRoot } from 'vite';

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
	envDir: searchForWorkspaceRoot(process.cwd()),
	plugins: [tailwindcss(), sveltekit()],
	clearScreen: false,
	server: {
		port: 5176,
		strictPort: true,
		host: host || false,
		hmr: host ? { protocol: 'ws', host, port: 5177 } : undefined,
		fs: { allow: [searchForWorkspaceRoot(process.cwd())] },
		watch: { ignored: ['**/src-tauri/**'] }
	},
	envPrefix: ['VITE_', 'TAURI_'],
	ssr: {
		noExternal: [/^@syren\/(ui|app-core)($|\/)/]
	},
	resolve: {
		// See web/vite.config.ts — same singleton-store duplication concern
		// when @syren/app-core is hard-copied into multiple node_modules.
		dedupe: ['@syren/app-core', '@syren/ui', '@syren/types', 'svelte']
	}
});
