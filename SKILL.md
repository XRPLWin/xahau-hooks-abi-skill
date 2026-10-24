---
name: xahau-hooks-abi
description: Write and test a hook manifest for xahauwin.com - the ABI (abi.hookStates projections) that decodes a Xahau hook's HookState into readable tables, plus its name, readme, license, publishers and namespace names. Use when asked to create, fix, review or extend a hook ABI or hook manifest, to make a hook's state readable on xahauwin.com, or to describe what a hook stores.
---

# Xahau hook ABIs for xahauwin.com

A hook manifest tells xahauwin.com what a hook is called and how to read what it keeps
in HookState. Its ABI is a list of **projections**; each one splits a HookState entry's
32-byte key (`selector`) and its value (`data`) into typed, labelled columns. The
explorer's account **Namespaces** tab shows each projection as a table.

The goal is an ABI where **every entry the hook can write is decoded by exactly one
projection**, with correct types, byte order and labels, and that passes the
explorer's validation. That is only known by testing, so test with the scripts here:
they use the explorer's own decoder (`scripts/lib/parser.js`, copied unchanged) and a
port of its server-side validator.

## Read first

- `reference/format.md`: the manifest, projection and segment format, every type, the limits.
- `reference/reader.md`: how the explorer applies projections. **Read the listing rule**:
  on a namespace with no hook installed, every hook of the account is tried.
- `reference/patterns.md`: hook C idioms and the segments that read them, and how to
  keep projections from matching each other's entries.
- `reference/publishing.md`: how the person publishes the result.
- `examples/`: two complete, tested cases. `xahaucards/` writes big-endian with short
  padded keys; `governance-game/` writes little-endian with prefix-first keys, and keeps
  short keys out of an account-ID projection.

## Workflow

Set up the scripts once: `cd scripts && npm install` (Node 18+).

1. **Collect the inputs.** The hook source (C, or whatever builds the WASM), the
   HookHash of each hook, the account(s) and network where it is installed, the
   namespace seeds. Ask for what is missing; without the source, every layout is a
   guess from bytes, so say so in the result.

2. **List every record kind from the source.** Find every `state_set`,
   `state_foreign_set` (and the keys `state`/`state_foreign` read). For each, write
   down:
   - the key: its length as passed (xahaud left-pads keys shorter than 32 bytes with
     zeros), and each part's bytes and meaning;
   - the value: each field's size, type and **byte order**. Native integers (`SVAR`,
     `&n, sizeof n`, struct fields) are little-endian; `UINT16/32/64_TO_BUF` and
     `INT64_TO_BUF` are big-endian;
   - which namespace and which account it lands in, and which hook writes it.

3. **Read the live state**, when the hook is running:
   `node scripts/dump.mjs <r-address> --net mainnet|testnet --out work/<name>`.
   It writes `state/<namespace>.json` per namespace and a `check.json` listing the
   hooks with their effective namespaces. Then
   `node scripts/groups.mjs work/<name>/state/<ns>.json` groups the entries by key
   shape and value length. **Every group must match a record kind from step 2**; a
   group you cannot explain means the source reading is incomplete.

4. **Write the projections.** One per record kind, in the manifest of the hook that
   writes it. For many similar kinds, write a small generator script (see
   `examples/xahaucards/gen.py`) rather than JSON by hand: padding counts go wrong by
   hand. Rules:
   - the selector covers exactly 32 bytes; padding is `Null` with `exclude: true`;
   - literals (kind letters, prefixes) are `pattern`, usually `exclude: true`;
   - every integer, `Timestamp`, `LedgerIndex` and `XFL` written big-endian gets
     `"endianness": "BE"`;
   - drops stored as an integer are `UInt64`, never `NativeAmount`;
   - a flag byte is `UInt8` unless the hook treats any non-zero byte as true;
   - `exclude` hides only padding and fixed literals, never a value that varies;
   - labels say what the value is ("Copies minted", "Signatures left"), not its type;
     descriptions give units (drops, ledger time, basis points) and meaning.

5. **Debug single entries** with
   `node scripts/decode.mjs <file.abi.json> <key hex> <value hex>`: it shows which
   projections match and, for the rest, the segment that failed and why.

6. **Check the whole account**: set each hook's `"manifest"` in `check.json`, then
   `node scripts/check.mjs work/<name>/check.json`. It reproduces the explorer's
   listing rule and fails on any entry decoded zero times or more than once. For a
   record kind with no live entry, build one from the source layout and add it under
   `"extra"` with a `"note"`; never leave a projection untested. Without live state
   (a hook not deployed yet), build `check.json` by hand with made-up entries for every
   kind. Repeat until it prints "Every entry decodes, by exactly one projection".
   Read the sample rows it prints: a value that looks wrong (a huge number that should
   be small: wrong byte order) is wrong even when it matches.

7. **Validate**: `node scripts/validate.mjs <file>` for each `.abi.json` and
   `.manifest.json`. Fix every ERROR. Resolve or explain each warning. Its "changed on
   publish" lines are what the server would alter silently.

8. **Write the rest of the manifest** (`<hook>.manifest.json`): `name` (what the hook
   is, 100 chars), `description` (one line, 300), `readme` (Markdown: what fires it,
   what one transaction does, its HookParameters with types and units, a State
   section naming each namespace and record kind), `repo`, `license`, `publishers`,
   and `namespaces` as `{"<hash>": "<seed>"}` so the explorer can verify them. Keep
   network-specific values (accounts, prices) out of the readme, or say which network
   they belong to.

9. **Hand over** per hook: `<hook>.abi.json` (the bare `hookStates` array for the ABI
   box), `<hook>.manifest.json`, the check and validate output, and the publishing
   steps from `reference/publishing.md`. The person publishes; you cannot.

## Hard rules

- Never edit `scripts/lib/parser.js` to make a projection match. It is the explorer's
  decoder; change the projection.
- Never guess byte order from data alone. Read the source; check with sample rows.
- Never put one record kind in two hooks' manifests.
- Never ship a projection the check has not seen match at least one entry (live or made
  up), or an account where any entry is undecoded or decoded twice. If something cannot
  be decoded (layout unknown), say which entries and why.
- An ABI belongs to one HookHash (one build). A rebuilt hook needs its manifest
  re-checked and published for the new hash.
