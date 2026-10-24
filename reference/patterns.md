# From hook source to segments

Each row starts from what the hook does in C and gives the segments that read it. The
examples are real: `examples/xahaucards/` (big-endian, short padded keys) and
`examples/governance-game/` (little-endian, prefix-first keys).

## Keys

xahaud turns the key a hook passes to `state_set` / `state_foreign_set` into 32 bytes:
**a key shorter than 32 bytes is padded with zeros on the left.** A hook that builds a
full 32-byte buffer itself controls every byte (usually prefix first, zeros after).

| Hook writes the key as | Selector |
|---|---|
| A short string, `state_set(…, "PRICE", 5)` | `Null` 27 (exclude) + `VarString` 5 `pattern: "PRICE"` |
| A 32-byte buffer, prefix first: `{'V','S', seat, layer, 0…, accid}` | `VarString` 2 `pattern: "VS"` + `UInt8` + `UInt8` + `Null` 8 (exclude) + `AccountID` |
| A kind letter and ASCII digits, `"S" "01" "001"` | `Null` 26 (exclude) + `VarString` 1 `pattern: "S"` (exclude) + `VarString` 2 `patternRegex: "^[0-9]{2}$"` + `VarString` 3 `patternRegex: "^[0-9]{3}$"` |
| A kind letter and a binary number, `{'P', seat}` | `Null` 30 (exclude) + `VarString` 1 `pattern: "P"` + `UInt8` |
| A 20-byte account ID, `state_set(…, accid, 20)` | `Null` 12 (exclude) + `AccountID` with `patternRegex: "^(?!0{36})[0-9A-F]{40}$"`, `patternEncoding: "hex"` (see the trap below) |
| A single byte, `state_set(…, &seat, 1)` | `Null` 31 (exclude) + `UInt8` |
| A full 32-byte hash (a txid, a namespace, a URI hash) | `Hash256` (one segment, 32 bytes). It matches any key, so the **data** must tell these entries apart. |
| A code with separators, `"XC-01-063"` | `Null` 23 (exclude) + `VarString` 3 `pattern: "XC-"` (exclude) + digits regex + `VarString` 1 `pattern: "-"` (exclude) + digits regex |

**Count the padding from the source, then check it against a live key.** The padding is
32 minus the key length the hook passes. Getting it wrong by one makes the projection
match nothing.

## Values

| Hook writes the value as | Data segment |
|---|---|
| A native integer: `state_set(&n, sizeof(n), …)`, `SVAR(n)` | `UInt8`/`UInt16`/`UInt32`/`UInt64` (or `Int…`), **little-endian** (the default) |
| `UINT16_TO_BUF`, `UINT32_TO_BUF`, `UINT64_TO_BUF`, `INT64_TO_BUF` | the same types with `"endianness": "BE"` |
| Drops as a plain integer | `UInt64` (BE if written with `UINT64_TO_BUF`). **Not `NativeAmount`**, which expects a serialized amount with flag bits and shows nonsense |
| An amount copied from a transaction field (`otxn_field(…, sfAmount)`) | `NativeAmount` (8 bytes) or `IOUAmount` (48 bytes), or `Amount` with `byteLength` when it can be either |
| An XFL float (`float_set`, `float_multiply`, …) | `XFL`: little-endian when stored natively, `"endianness": "BE"` when through `INT64_TO_BUF` |
| An account ID, `hook_account`, `otxn_field(…, sfAccount)` | `AccountID` |
| A ledger sequence, `ledger_seq()` | `LedgerIndex` (UInt32, mind endianness) |
| A time, `ledger_last_time()` | `Timestamp` with `renderer: "rippleTimeToISO"` (ledger time counts from 2000-01-01). A Unix time uses `unixTimeToISO` |
| A flag byte, `1` = on | `UInt8`, not `Bool` (Bool shows any non-zero byte as True). Use `Bool` only when the hook writes exactly 0 or 1 and reads any non-zero as true |
| A fixed-width, NUL-padded string | `VarString` with `byteLength` = the width. The NULs stay in the value (invisible on the page, present in CSV) |
| A length byte, then a fixed-width string | `UInt8` "Length" (exclude) + `VarString` `byteLength` = width |
| A string to the end of the value | `VarString` without `byteLength`, as the **last** segment |
| Raw bytes (a public key, a signature) | `Blob` with `byteLength`, or `Hash…` of that size |
| A struct written whole, `state_set(&s, sizeof(s), …)` | one segment per field, in order, **including the compiler's padding bytes** (`Null` or `Blob`); fields are little-endian |
| An empty value (presence is the information) | `data: []` |

## Telling record kinds apart

Projections must rule each other out (see `reader.md`). In order of preference:

1. **A literal** in the key: `pattern` on the kind letter or prefix, usually `exclude`d.
2. **The padding length**: a `Null` of the right size refuses longer keys, because
   their bytes are not zero.
3. **A regular expression**: `patternRegex` on digits, letters, or hex. Anchor it with
   `^…$`. On hex it is tested against UPPERCASE text.
4. **The value length**: an entry whose value is longer or shorter than the data
   segments never matches.
5. **A pattern in the data**: a status letter `^[PGFL]$`, a slot `^[0-9]{2}$`.

### The short-key trap

A projection for account-ID keys (`Null` 12 + `AccountID`) also fits **every** key
shorter than 21 bytes, because those keys are mostly zeros on the left too and any 20
bytes make a valid r-address. If the hook also writes short keys (`"MC"`, `"PRICE"`)
in the same namespace, refuse them in the AccountID segment:

```json
{ "type": "AccountID", "label": "Account",
  "patternRegex": "^(?!0{36})[0-9A-F]{40}$", "patternEncoding": "hex" }
```

The regex refuses an account ID starting with 18 zero bytes: no real account has
one, every short key of up to 2 bytes does. Widen `0{36}` to cover longer short keys
(`0{30}` refuses keys up to 5 bytes). The value length or a data pattern works too
(the XahauCards attestor roll requires its 2-digit slot in the value).

The same applies to any selector without a literal: `Hash256`, a lone `UInt8` after
padding, a bare `Blob`. Check them with `scripts/check.mjs`.

## Foreign state and shared namespaces

A hook that writes with `state_foreign_set` puts entries in a namespace (or on an
account) where it may not be installed. On that namespace the reader lists every hook
of the account (`reader.md`, rule 4), so those entries meet every hook's projections.
Put the projection in the manifest of the hook that writes the record, make it
specific, and run the check over that namespace.

## Records with nothing live

A record kind the source writes but the ledger does not hold yet (a purchase in flight,
an error state) still needs a projection, and it still needs testing. Build an entry by
hand from the source's layout and add it to `check.json` under `extra`, with a note.
