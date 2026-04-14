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
		noExternal: [/^@syren\/ui($|\/)/]
	}
});
