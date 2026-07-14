import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, searchForWorkspaceRoot } from 'vite';

const workspaceRoot = searchForWorkspaceRoot(process.cwd());

// Dev proxy target for the API. Defaults to the host-run API on :5175;
// override with SLYNG_API_PROXY so the web can run in a container and reach
// the API on the Docker host (e.g. http://host.docker.internal:5175).
const apiProxy = process.env.SLYNG_API_PROXY || 'http://localhost:5175';

export default defineConfig({
	envDir: workspaceRoot,
	plugins: [tailwindcss(), sveltekit()],
	server: {
		port: 5174,
		strictPort: true,
		// Bind all interfaces so the dev server is reachable from outside a
		// container / from other devices on the LAN.
		host: true,
		// Reached via the machine's mDNS hostname (<host>.local) and LAN IPs,
		// not just localhost. Vite's Host-header check 403s unknown hostnames;
		// this is a LAN-facing dev server, so accept any host.
		allowedHosts: true,
		fs: {
			allow: [searchForWorkspaceRoot(process.cwd())]
		},
		proxy: {
			'/api': apiProxy,
			// syr discovery endpoints — served by the API at the site root so
			// federated consumers can resolve local identities
			'/.well-known': apiProxy,
			'/ws': {
				target: apiProxy,
				ws: true
			}
		}
	},
	preview: {
		port: 5174,
		strictPort: true
	},
	ssr: {
		noExternal: [/^@slyng\/(ui|app-core|client)($|\/)/]
	},
	resolve: {
		// In production, the Docker build sets `inject-workspace-packages=true`
		// which hard-copies @slyng/app-core into every consumer's node_modules.
		// Without dedupe, the bundle ends up with two module instances and
		// every singleton `$state` store (servers, presence, profiles, …) gets
		// duplicated — so e.g. setServers() writes to instance A and
		// ServerList reads from instance B. Force a single resolution per
		// workspace package name so all callers share the same module.
		dedupe: ['@slyng/app-core', '@slyng/ui', '@slyng/types', '@slyng/client', 'svelte']
	}
});
