# Example: the Governance Game (mainnet genesis account)

The Governance Game hook (`govern.c` in
[xahaud/hook/genesis](https://github.com/Xahau/xahaud/blob/dev/hook/genesis/govern.c),
HookHash `5EDF6439…`) runs on the genesis account `rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh`
under the all-zero namespace. It writes **native little-endian** values (`SVAR(x)`) and
mixes two kinds of key:

- short keys xahaud pads on the left: `"MC"`, `"RR"`, `"RD"`, a 1-byte seat number, a
  20-byte account ID;
- 32-byte keys it builds itself, prefix first: `{'V', topic, id, layer, 0…, voter}` and
  `{'C', topic, id, layer, …value}`.

## Files

- `governance.manifest.json`: the whole manifest, as published on xahauwin.com.
- `state.json`: all 31 live entries at ledger 26133735.
- `check.json`: the check config, with six made-up entries for the vote kinds that had
  nothing live (each with a `note`).

```sh
cd ../../scripts
node check.mjs ../examples/governance-game/check.json
```

## What it shows

| On the ledger | Segments |
|---|---|
| `"MC"` padded to 32 bytes, 1-byte count | `Null` 30 (exclude) + `VarString` 2 `pattern: "MC"`; data `UInt8` |
| `"RR"` / `"RD"`, an XFL stored natively | `Null` 30 + `VarString` 2 pattern; data `XFL` (little-endian, the default) |
| A 1-byte seat number as the key | `Null` 31 (exclude) + `UInt8` |
| A member's 20-byte account ID as the key | `Null` 12 (exclude) + `AccountID` with `patternRegex: "^(?!0{36})[0-9A-F]{40}$"` (hex) |
| `{'V','S', seat, layer, 0…, voter}` | `VarString` 2 `"VS"` + `UInt8` + `UInt8` + `Null` 8 (exclude) + `AccountID` |
| `{'C','H', position, layer, hash bytes 5-32}` | `VarString` 2 `"CH"` + `UInt8` + `UInt8` + `Blob` 28 |
| `{'C','R','R', layer, 0×20, XFL}` | `VarString` 3 `"CRR"` + `UInt8` + `Null` 20 (exclude) + `XFL` |

**Why the account-ID key has a regex.** `MC` is a 2-byte key, so xahaud stores it as 30
zero bytes + `4D43`. Without the regex, "Account Place" (12 zero bytes + AccountID) would
match it too: `00…004D43` is a valid account ID, and both values are 1 byte. The regex
refuses an account ID starting with 18 zero bytes. No real account has one, and every
short key up to 2 bytes does. `scripts/test.mjs` checks that the checker reports this
overlap when the regex is missing.

An entry whose "Voted for" is `rrrrrrrrrrrrrrrrrrrrrhoLvTp` is 20 zero bytes: a vote to
empty the seat.
