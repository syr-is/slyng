import { beforeAll } from "vitest";
import { initCryptoWasm } from "../wasm-adapter.js";

beforeAll(async () => {
  await initCryptoWasm();
});
