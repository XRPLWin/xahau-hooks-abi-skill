# Publishing a manifest

Publishing is done by a person, in the browser, signed in to the explorer. An agent
prepares the files and the steps; it cannot publish for them.

## What to hand over

For each hook:

- `<hook>.abi.json`: the bare `hookStates` array. This is what goes into the ABI box.
- `<hook>.manifest.json`: the whole manifest (name, description, readme, repo,
  license, publishers, namespaces, `abi.hookStates`), as the record of what to type
  into the other fields, and for `validate.mjs`.
- The icon file, if there is one: square, 256×256 or larger, PNG, JPEG, GIF or WebP,
  at most 700 KB.
- The output of `validate.mjs` and `check.mjs`, so the person knows it was tested.

## Steps

1. Open the explorer for the network the hook runs on: **xahauwin.com** (mainnet) or
   **testnet.xahauwin.com**. Each keeps its own manifests: publish on each network
   separately.
2. Go to an account where the hook is installed and open the **Namespaces** tab:
   `https://xahauwin.com/account/{r-address}#namespaces`.
3. Open a namespace the hook writes, then the hook's tab (named by its hash, or by its
   current name).
4. Click the **pencil** on the hook's card ("Edit and publish this hook's manifest").
   Sign in when asked: Google or Xaman. The name shown as author can be changed in the
   dialog.
5. Fill in the dialog from `<hook>.manifest.json`:
   - **Hook name**, **Short description**, **Readme** (Markdown), **Repository URL**,
     **License**.
   - **Hook icon**: upload the file (leave empty to keep the current one).
   - **Publishers**: one row each, type, name and URL.
   - **Namespaces**: the seed for each namespace listed (a green check means it
     hashes to the namespace).
   - **ABI**: open "View / edit the ABI as JSON (advanced)", select everything in the
     box and replace it with the contents of `<hook>.abi.json`.
6. Click **Publish**. The reader reloads with the new version selected. Open each
   projection and compare the rows with what the hook should hold.

Publishing again replaces that author's version for the hook. At most 30 publishes per
hour per author.

The hook page (`/hook/{HookHash}`) has a quicker edit (the pencil next to the name) for
the name, icon and, under "Advanced details", the other text fields. It keeps the
projections as they are, so the ABI can only be published from the Namespaces tab.

## A hook nobody has installed yet

The Namespaces tab needs an account with the hook installed. To publish before going
live, install the build on a testnet account, publish there, and keep the JSON for
mainnet. For a projection with no live entries, the reader's "Still in development?"
form under the undecoded states builds one from a pasted sample key and value.

## After publishing

```
https://xahauwin.com/repo/hook/{HookHash}/latest.json     the version shown
https://xahauwin.com/repo/hook/{HookHash}/user{id}.json   a given author's
```

The response is the stored manifest. Compare its `abi.hookStates` with the file:
the server adds `patternEncoding: "ascii"` to patterns without one and drops anything it
does not know. `validate.mjs --print` shows the same result in advance.

The explorer shows the best weighted version. Weight is set by the explorer's admins;
if another author's version is shown instead of the hook developer's, ask them at
xahauwin.com.
