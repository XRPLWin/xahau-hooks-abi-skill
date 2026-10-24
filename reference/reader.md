# How the explorer uses a manifest

Knowing what the explorer does with projections explains most of the rules.

## Where manifests show

- **Hook page** (`/hook/{HookHash}`): the name and icon in the header, and the About
  tab's "Metadata & Manifest" card with the description, readme, repository,
  license, publishers, namespace names, the projections, and every published version.
- **Every mention of the hook**: name and icon instead of the bare hash.
- **An account's Namespaces tab** (`/account/{r-address}#namespaces`): the namespace
  reader, which decodes the account's HookState with the projections.

## The namespace reader, step by step

1. It reads the account's namespaces (`AccountRoot.HookNamespaces`) and installed
   hooks. Each hook's **effective namespace** is its installation's `HookNamespace`,
   or else its definition's.
2. It loads each hook's manifest (the best weighted one).
3. When a namespace is opened, it reads every entry (`account_namespace`), then tries
   **every projection of every listed hook on every entry**.
4. **Which hooks are listed** under a namespace:
   - the hooks whose effective namespace it is;
   - **if there are none, every hook installed on the account.** This happens for
     namespaces written with `state_foreign_set` (another account's or another
     namespace's state), for a namespace whose hook was removed, and for namespaces a
     hook writes without being installed under them.
5. Each listed hook gets a tab with its projections as buttons, each with the count of
   entries it decodes. A projection is a table: one column per segment that is not
   `exclude`d, with CSV and Excel downloads. Projections that match nothing are hidden
   once the whole namespace has been read.
6. "All states (raw)" lists every entry as hex. "Add projection" shows how many
   entries no projection decodes.

## What follows from it

**Every entry should be decoded by exactly one projection.**

- **Zero:** the entry shows only as raw hex.
- **Two or more:** the entry shows as a row in each table, read wrongly in all but one.
  The common cause is short keys. xahaud pads a key shorter than 32 bytes with zeros on
  the left, so a 2-byte key `"MC"` (`00…004D43`) also fits a projection for 20-byte
  account-ID keys (12 zero bytes + AccountID). The decoder turns the 20 bytes
  `00…004D43` into a valid r-address, and the entry matches both projections. See
  `examples/governance-game/`.

So projections must **rule each other out**: by literal prefixes (`pattern`), by
regular expressions (`patternRegex`), by padding length (`Null`), and by value length.
And because of rule 4, projections of *different* hooks on the same account can meet
on one namespace. Put each record kind in **one** hook's manifest only: the hook that
owns the record. Otherwise its rows show in both hooks' tabs.

## Versions and weight

Anyone signed in can publish a manifest for any hook; each author has one version per
hook (`user{id}`), and publishing again replaces it. The explorer shows the **best
weighted** version (weight is set by the explorer's admins), then the most recently
updated one. Readers can switch versions ("Manifest by …"). Check a published version
with:

```
GET https://xahauwin.com/repo/hook/{HookHash}/user{id}.json      (mainnet)
GET https://testnet.xahauwin.com/repo/hook/{HookHash}/user{id}.json
GET https://xahauwin.com/repo/hook/{HookHash}/latest.json         (the one shown)
```

A manifest belongs to a HookHash, and a HookHash identifies one exact build. A new
build has a new HookHash and needs its own manifest.

Each network's explorer keeps its own manifests: xahauwin.com (mainnet) and
testnet.xahauwin.com do not share them. The same build on both networks has the same
HookHash, so the same JSON can be published on each; keep it free of network-specific
details (accounts, ledger numbers, prices) or say which network they belong to.
