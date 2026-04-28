# `@syren/types`

Shared types and Zod schemas for the syren chat platform.

> **Every entity type and Zod schema in this package is generated from
> Rust.** The canonical source of truth is `packages/rust/syren-types/`
> — Rust structs annotated with `#[derive(ZodSchema, Tsify, Serialize,
> Deserialize)]`. The TypeScript code in `src/generated.ts` is
> machine-emitted from those structs by `cargo run -p syren-types
> --bin generate-zod`.
>
> **Don't edit `src/generated.ts` by hand.** Edit the Rust struct and
> regenerate.

## What lives where

| File | Hand-written? | Contents |
|---|---|---|
| `src/generated.ts` | **No — generated** | Every entity schema (`ServerSchema`, `ChannelSchema`, …), every input shape (`CreateServerInputSchema`, `BanMemberInputSchema`, …), every WS payload, every pagination wrapper, plus the inferred TS types via `z.infer`. |
| `src/codecs.ts` | Yes | `stringToRecordId`, `isoDatetimeToDate`. Bidirectional Zod codecs. Not derivable from a Rust shape — they encode runtime conversion behaviour. |
| `src/permission.ts` | Yes | `Permissions` bitmask constants, `DEFAULT_PERMISSIONS`, `hasPermission` / `addPermission` / `removePermission`. Not data shapes — bitwise helpers. |
| `src/ws.ts` | Yes | `WsOp` numeric dictionary in `UPPERCASE_SNAKE_CASE` form. Mirrors `packages/rust/syren-types/src/ws.rs::WsOp`, but kept in this hand-rolled shape because every existing consumer (api gateway, app-core stores, ui components) addresses ops as `WsOp.MESSAGE_CREATE` / etc. |
| `src/index.ts` | Yes | Barrel re-export of the four files above. |

That's the whole package. Everything that describes the wire shape of
an entity, an input body, or a WS payload comes through Rust.

## Workflow

### Editing a type

1. Open the matching Rust file in `packages/rust/syren-types/src/`
   (e.g. `server.rs` for `Server`, `CreateServerInput`, etc.).
2. Add or modify the struct. Make sure it has the four derives:
   ```rust
   #[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
   #[cfg_attr(target_arch = "wasm32", derive(Tsify))]
   #[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
   ```
3. If the struct is new, register it in
   `packages/rust/syren-types/src/bin/generate-zod.rs` so the codegen
   knows to emit it:
   ```rust
   g.add_schema::<MyNewInput>("MyNewInput");
   ```
4. From `packages/ts/types/`:
   ```bash
   pnpm gen   # regenerate src/generated.ts
   pnpm build # rebuild dist/
   ```
   …or `pnpm build:fresh` to do both in one step.
5. Commit `src/generated.ts` along with the Rust change. Production
   builds don't run cargo (the Docker image has no Rust toolchain), so
   they consume whatever `generated.ts` is at the commit being built.

### Why the build script doesn't auto-regen

`pnpm build` is intentionally **just** `tsup`. It does **not** call
`pnpm gen`. Two reasons:

1. **Docker images.** `apps/syren/api` (and the syren web image) build
   in a Node-only Alpine container with no Rust toolchain. Calling
   cargo there fails with `cargo: not found`.
2. **CI determinism.** The committed `generated.ts` is what runs in
   prod, period. If a contributor edits a Rust struct without running
   `pnpm gen`, every downstream `tsc` complains until they do — that's
   the intended forcing function.

If you want tighter enforcement, a CI step that runs `pnpm gen` and
fails on a dirty `git status` would catch stale `generated.ts` before
it lands. (Not currently wired.)

## Post-processing of `generated.ts`

`zod_gen`'s default output gets two passes by `generate-zod.rs` before
landing on disk:

- **`.nullable()` → `.optional()`** — Rust `Option<T>` paired with
  `#[serde(skip_serializing_if = "Option::is_none", default)]` is
  sent over the wire as a missing key, not as explicit null. We emit
  `.optional()` (accepts missing / undefined) so the inferred Zod
  type lines up with downstream service signatures (`T | undefined`).
  Wire contract: clients **omit** optional fields, they don't send
  `null`. A `field: null` body gets a 400.
- **`z.union([z.literal('a'), z.literal('b')])` → `z.enum(['a','b'])`** —
  for unit-only string unions. Consumers (`AuditActionSchema.options`,
  for example) need `.options` to enumerate values, and that property
  exists on `z.enum` but not on `z.union`.

## Why a `WsOp` dictionary instead of a generated enum

The Rust source has `WsOp` as a numeric enum (`Identify = 1, Heartbeat
= 2, …`). Tsify would emit it as a TS enum with PascalCase variants
(`WsOp.Identify`). But every existing call site in this codebase
addresses ops as `WsOp.IDENTIFY`, `WsOp.MESSAGE_CREATE`, etc.

Renaming ~40 call sites across `apps/syren/api`, `packages/ts/ui`, and
`packages/ts/app-core` for cosmetic alignment isn't worth it. So
`src/ws.ts` keeps the dictionary form by hand. The numeric values are
the wire contract; they match Rust's `WsOp` exactly. The Rust source
is still the source of truth for *which numbers exist*; this file
just spells the JS-side names.
