// Mirrors the pattern in @syr-is/crypto: wasm-pack --target nodejs
// emits a CommonJS module, but Vite SSR + modern Node want ESM. Wrap
// it in a tiny .mjs that uses createRequire to load the CJS file and
// re-exports each bound symbol.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distNode = resolve(__dirname, '..', 'dist', 'wasm', 'node');
const cjsPath = resolve(distNode, 'syren_client.js');
const dtsPath = resolve(distNode, 'syren_client.d.ts');
const outPath = resolve(distNode, 'syren_client_esm.mjs');

if (!existsSync(cjsPath)) {
	console.error(`expected ${cjsPath} to exist (run build:wasm:node first)`);
	process.exit(1);
}

const dts = existsSync(dtsPath) ? readFileSync(dtsPath, 'utf8') : '';
// Pull names from `export class ...` and `export function ...` /
// `export const ...` lines. wasm-pack emits both forms.
const names = new Set();
for (const m of dts.matchAll(/^export\s+(?:declare\s+)?(?:class|function|const|let)\s+(\w+)/gm)) {
	names.add(m[1]);
}

const lines = [
	'import { createRequire } from "module";',
	'const require = createRequire(import.meta.url);',
	'const mod = require("./syren_client.js");',
	'',
	...[...names].sort().map((n) => `export const ${n} = mod.${n};`),
	'export default mod;',
	''
];

writeFileSync(outPath, lines.join('\n'), 'utf8');
console.log(`wrote ${outPath} with ${names.size} re-exports`);
