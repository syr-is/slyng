import { defineConfig } from "tsup";

export default defineConfig({
  // Single entry on purpose: tsup bundles each entry separately, and the
  // wasm-adapter holds module-level WASM state. Multiple entries would give
  // each subpath its own (uninitialized) copy of that state.
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  dts: true,
  // dist/ also holds the wasm-pack output (dist/wasm/**) built beforehand —
  // cleaning would delete it.
  clean: false,
  sourcemap: true,
  target: "es2022",
  splitting: false,
  external: ["@syren/idp-crypto/wasm"],
});
