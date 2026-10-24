# The manifest format

A **hook manifest** describes one hook, identified by its HookHash. It has a name and
an icon, a readme, and an ABI: a list of **projections**, one per kind of record the
hook keeps in HookState. Each projection tells the explorer how to split a HookState
entry's key and value into typed columns.

This is the format xahauwin.com stores and serves at
`/repo/hook/{HookHash}/{version}.json`. `scripts/lib/parser.js` is the explorer's
decoder, copied unchanged, so a check run with these scripts gets the explorer's answer.

## Manifest

| Field | Type | Limit | Notes |
|---|---|---|---|
| `name` | string | 100 chars | **Required.** The hook's name everywhere on the explorer. |
| `description` | string | 300 chars | One line, under the name. |
| `readme` | string | 50,000 chars | Markdown (GitHub flavour). Raw HTML shows as text, images become links. |
| `repo` | string or null | 300 chars | http(s) only. The source repository. |
| `license` | string | 64 chars | SPDX id or free text. Empty becomes `Unlicensed`. |
| `publishers` | list | 10 | `{name, type: "individual" \| "organization", url}`. `url` http(s) or null. |
| `namespaces` | object | 256 | `{"<64 hex>": "name"}`: readable names for the namespaces the hook writes. |
| `abi` | object | | `{hookStates: [projection]}`, at most 200 projections. |

Whole manifest: at most 256 KB as JSON. Any other key is dropped on publish. The icon is
not part of the JSON: it is uploaded in the publish dialog (PNG, JPEG, GIF or WebP,
up to 700 KB, square; stored as 128×128).

**Namespace names.** A namespace is usually `sha256(seed)` of a string the developer chose
(hooks-toolkit's `hexNamespace`). Give the **seed**, not the hash, as the name: when its
SHA-256 (or SHA-512Half) equals the namespace, the explorer marks the name verified.
Any other name shows as a plain label.

## Projection

```json
{
  "name": "Edition counters",
  "description": "Copies minted per card subject. Key XC-<set>-<subject>.",
  "selector": [ /* segments over the 32-byte HookStateKey */ ],
  "data":     [ /* segments over the HookStateData */ ]
}
```

| Field | Limit | Notes |
|---|---|---|
| `name` | 100 chars | **Required.** The projection's button and table title. Keep names unique. |
| `description` | 500 chars | Shown above its table. |
| `selector` | 1-256 segments | Decodes the key. **Must cover exactly 32 bytes.** |
| `data` | 0-256 segments | Decodes the value. **Must cover exactly the value's length.** |

An entry **matches** a projection only if every segment of `selector` decodes, every
segment of `data` decodes, and both use up their bytes exactly: no byte left over,
none missing. A projection that does not match an entry simply skips it, so the length
of the value is itself a filter.

## Segment

```json
{ "type": "UInt32", "label": "Copies minted", "endianness": "BE", "description": "…" }
```

| Field | Notes |
|---|---|
| `type` | **Required.** One of the types below. |
| `label` | Column title, 100 chars. Missing: the type's name is used. Keep labels unique within a projection. |
| `byteLength` | 1-65535. Required for `VarString` (except last, see below), `Blob`, `Null`; overrides nothing on fixed types (do not set it to something else). |
| `pattern` | A literal the bytes must equal. ASCII text by default; hex with `patternEncoding: "hex"`; for an integer type, a decimal number (`"14"`), encoded in the segment's endianness. Its byte length must equal the segment's. |
| `patternRegex` | A JavaScript regular expression tested against the bytes as ASCII text, or as **UPPERCASE** hex with `patternEncoding: "hex"`. Anchor it: `^…$`. Takes precedence over `pattern`. |
| `patternEncoding` | `"ascii"` (default) or `"hex"`. |
| `exclude` | `true` hides the column. **The segment is still decoded and its pattern still checked**: use it for padding and fixed literals, never to hide a value that varies. |
| `description` | 300 chars, shown as the column's tooltip. |
| `endianness` | `"BE"` for big-endian. Anything else means little-endian, the default. Applies to integers, `Timestamp`, `LedgerIndex`, `XFL`. |
| `renderer` | How to display the value: `unixTimeToISO`, `rippleTimeToISO`, `unixTimeToRelative`, `rippleTimeToRelative`. For `Timestamp` (UInt32 seconds). |
| `items`, `repeat` | Containers only (`Array`, `STArray`, `STObject`); `repeat` 1-1024 also counts `Null` bytes. Nest at most two deep. |

## Types

| Type | Bytes | Shown as | Notes |
|---|---|---|---|
| `UInt8` / `Int8` | 1 | number | Use `UInt8` for a flag byte when only `0x01` means on. |
| `UInt16` / `Int16` | 2 | number | LE unless `endianness: "BE"`. |
| `UInt32` / `Int32` | 4 | number | LE unless BE. |
| `UInt64` / `Int64` | 8 | number (as text, full precision) | LE unless BE. Drops stored as a plain integer are `UInt64`. |
| `Bool` | 1 | True / False | **Any non-zero byte is True.** |
| `Timestamp` | 4 | number, or a date with `renderer` | UInt32 seconds. Ledger time counts from 2000-01-01 (`rippleTime…` renderers), Unix time from 1970 (`unixTime…`). |
| `LedgerIndex` | 4 | a link to the ledger | UInt32 ledger sequence. |
| `AccountID` | 20 | r-address, with name and avatar | The raw 20-byte account ID. |
| `Hash128` / `Hash160` / `Hash256` / `Hash512` | 16 / 20 / 32 / 64 | hex | |
| `XFL` | 8 | decimal | Hooks' float (`float_set`, `float_multiply`…). LE unless BE: `*(int64_t*)buf = xfl` is LE; `INT64_TO_BUF` is BE. |
| `NativeAmount` | 8 | drops | A **serialized** native STAmount (bit 62 set for positive). Not a plain integer. |
| `IOUAmount` | 48 | value, currency, issuer | A serialized issued STAmount: 8-byte amount, 20-byte currency, 20-byte issuer. |
| `Amount` | 8 or `byteLength` | either of the above | Serialized STAmount of either kind. |
| `VarString` | `byteLength`, or the rest | UTF-8 text | **Without `byteLength` it takes the rest of the value**, so it must be the last segment and cannot sit in a container. NUL padding is kept (invisible on the page, present in CSV). |
| `Blob` | `byteLength` | hex | Raw bytes. |
| `Null` | `byteLength` (or `repeat`) | hidden | **Matches only if every byte is zero.** The tool for key padding. Usually `exclude: true`. |
| `Array` / `STArray` | items × `repeat` | list | `items` are segments with fixed lengths; one item gives a flat list. |
| `STObject` | sum of items | object | `{label: value}` of its items. |

## Little-endian is the default

Integers, `Timestamp`, `LedgerIndex` and `XFL` are read **little-endian** unless the
segment says `"endianness": "BE"`. That is how a hook stores a native WASM integer
(`state_set(&value, sizeof(value), …)`, `SVAR(x)`). The hook API's buffer macros
(`UINT16_TO_BUF`, `UINT32_TO_BUF`, `UINT64_TO_BUF`, `INT64_TO_BUF`) write **big-endian**:
every integer written through them needs `"endianness": "BE"`. Read the hook source;
do not guess from the bytes (`01000000` and `00000001` are both plausible).

## Limits the server enforces on publish

| | Limit |
|---|---|
| Projections | 200 |
| Segments per selector, data or items | 256 |
| Container nesting | 2 |
| `byteLength` | 1-65535 |
| `repeat` | 1-1024 |
| `pattern`, `patternRegex` | 512 bytes |
| Publishers | 10 |
| Namespace names | 256, each 64 chars |
| Manifest JSON | 256 KB |

Texts are trimmed, control characters replaced (the readme keeps newlines and tabs), and
cut to their limit. `scripts/validate.mjs` applies the same rules and lists every change
the server would make.
