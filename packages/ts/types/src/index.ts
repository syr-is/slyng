// Auto-generated entity schemas + types come from `./generated.ts`,
// which is produced by `cargo run -p syren-types --bin generate-zod`
// from the Rust source of truth in `packages/rust/syren-types/`.
//
// The hand-written survivors here are limited to:
// - `./codecs.ts`     — RecordId / ISO datetime codecs (bidirectional, not derivable)
// - `./permission.ts` — bitmask constants + helper functions (not data shapes)
// - `./ws.ts`         — `WsOp` numeric dictionary in the form consumers already use
// - `./idp.ts`        — syr wire-contract ports (local IdP); syr's schemas are
//                       the canonical shape, so these stay hand-written too
export * from './generated.js';
export * from './codecs.js';
export * from './permission.js';
export * from './ws.js';
export * from './idp.js';
export * from './posts.js';
export * from './clips.js';
export * from './emojis.js';
export * from './gifs.js';
