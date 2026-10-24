# xahau-hooks-abi-skill

Make your Xahau hook's state readable on [xahauwin.com](https://xahauwin.com).

A Xahau hook keeps its data in HookState as raw bytes. A **hook manifest** tells the
explorer what your hook is called and how to split each state entry into named, typed
columns, so anyone can open an account's **Namespaces** tab and read your hook's
records as tables (with CSV and Excel downloads) instead of hex.

This repository is an **agent skill**: instructions, a format reference and test
scripts that let an AI coding assistant write that manifest from your hook's source,
test it against your live state with the explorer's own decoder, and hand you files
ready to publish.

## What you get

For each hook:

- `<hook>.abi.json`: the projections, to paste into the explorer's ABI box;
- `<hook>.manifest.json`: name, description, readme, license, publishers, namespace
  names and the ABI;
- a test report: every state entry on your account decoded by exactly one projection,
  and the manifest accepted by the explorer's validation rules.

## Use it

**Claude Code**: copy or clone this folder into your project's `.claude/skills/`
(or `~/.claude/skills/` for every project):

```sh
git clone https://github.com/XRPLWin/xahau-hooks-abi-skill .claude/skills/xahau-hooks-abi
```

Then ask, for example: *"Write the xahauwin ABI for my hook in `hook/src/`. It is
installed on rXXXX on testnet."*

**Other assistants** (Cursor, Codex, Gemini, …): clone the repository anywhere and
tell the assistant to read `SKILL.md` and follow it.

The scripts need **Node.js 18 or newer**:

```sh
cd scripts && npm install
```

## The scripts

All of them run without the AI too.

| Script | What it does |
|---|---|
| `dump.mjs <r-address> [--net testnet]` | Reads an account's hooks and all its HookState at one ledger into a work folder, with a `check.json` to fill in. |
| `groups.mjs <state.json>` | Groups state entries by key shape and value length: one group per record kind. |
| `decode.mjs <abi.json> <key> <value>` | Decodes one entry with every projection and says why each non-match failed. |
| `check.mjs <check.json>` | Decodes every entry the way the explorer does and fails unless each one is decoded exactly once. |
| `validate.mjs <file>` | Applies the explorer's publish rules and lints for projections that can never match. |

`scripts/lib/parser.js` is the explorer's decoder, copied unchanged from xahauwin.com,
so a passing check means the explorer shows the same rows.

Try them on the examples:

```sh
cd scripts
node check.mjs ../examples/xahaucards/check.issuer.json
node check.mjs ../examples/governance-game/check.json
node validate.mjs ../examples/xahaucards/manager.abi.json
npm test
```

## Publishing

You publish on the explorer, signed in with Google or Xaman: open an account where the
hook is installed, the Namespaces tab, the hook's tab, then the pencil on its card.
Full steps: [reference/publishing.md](reference/publishing.md). Mainnet
(xahauwin.com) and testnet (testnet.xahauwin.com) keep separate manifests.

## Contents

```
SKILL.md                 the instructions the assistant follows
reference/format.md      the manifest format: projections, segments, types, limits
reference/reader.md      how the explorer applies projections
reference/patterns.md    hook C idioms and the segments that read them
reference/publishing.md  how to publish, and check what was published
templates/               a manifest to start from
scripts/                 dump, groups, decode, check, validate
examples/xahaucards/     big-endian, short padded keys, 4 hooks on 2 accounts
examples/governance-game/ little-endian, prefix-first keys, short keys kept apart
```

## License

MIT, see [LICENSE](LICENSE). `scripts/lib/parser.js` and `scripts/lib/xfl.js` come from
the XRPLWin explorer; `xfl.js` adapts Transia-RnD's
[binary-models-ts](https://github.com/Transia-RnD/binary-models-ts).
