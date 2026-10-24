# Example: XahauCards (mainnet)

Four hooks on two accounts. The hooks write **big-endian** integers (`UINT32_TO_BUF`,
`UINT64_TO_BUF`) under **short keys** that xahaud pads with zeros on the left. Three
namespaces on the issuer have no hook installed on them, so the explorer tries both of
the issuer's hooks on them: the projections there must rule each other out.

| Account | Hook | HookHash | Installed under | Projections |
|---|---|---|---|---|
| Issuer `rCardMi9ZsS5dBMrtZtaDeZchvW64W38c` | mint | `2E6BCC97…` | `xahaucards.editions` | 2: edition counters, total minted |
| | manager | `52438A0D…` | `xahaucards.editions` | 14: the card table (`xahaucards.table`), settings (`xahaucards.settings`), attestors (`xahaucards.attest`) |
| Shop `rBuyCRWLvnNFu3WAuarhQpgd29C5tLSzCi` | shop | `C650B566…` | `xahaucards.intent` | 1: purchase records |
| | doors | `C16AC4E5…` | `xahaucards.intent` | 1: grant allowance |

Namespace ids are `sha256("xahaucards.<name>")`, so the manifests name them by seed and
the explorer marks them verified.

## Files

- `mint.abi.json`, `manager.abi.json`, `shop.abi.json`, `doors.abi.json`: the ABIs, as pasted into the ABI box.
- `gen.py`: the generator that writes them. Small helpers (`pad`, `lit`, `digits`, `be`)
  keep padding and endianness right across 18 projections.
- `state/`: every live entry, read from mainnet at one ledger (October 2026).
- `check.issuer.json`, `check.shop.json`: the check configs. The shop has no purchase in
  flight, so `check.shop.json` adds one made-up record per status (P, G, F, L).

```sh
cd ../../scripts
node check.mjs ../examples/xahaucards/check.issuer.json
node check.mjs ../examples/xahaucards/check.shop.json
```

## What it shows

| On the ledger | Segments |
|---|---|
| `"PRICE"` padded to 32 bytes | `Null` 27 (exclude) + `VarString` 5 `pattern: "PRICE"` |
| `"S" + "01" + "001"` | `Null` 26 + `VarString` 1 `"S"` (exclude) + 2- and 3-digit `patternRegex` |
| `"XC-01-063"` next to `"MINTCOUNT"` (same length) | literal `"XC-"`, digits, `"-"`, digits: the literals keep MINTCOUNT out |
| An attestor's account ID as the key | `Null` 12 + `AccountID`; the value's 2-digit slot regex keeps short keys out |
| A purchase keyed by a txid | `Hash256`; told apart by the value's length and its status `^[PGFL]$` |
| Length byte + NUL-padded name | `UInt8` (exclude) + `VarString` 12 |
| Drops as a big-endian integer | `UInt64` + `endianness: "BE"`, not `NativeAmount` |
| "On sale" flag, only `1` means open | `UInt8`, not `Bool` |
