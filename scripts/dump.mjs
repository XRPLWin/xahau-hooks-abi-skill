#!/usr/bin/env node
/**
 * Reads an account's hooks and every HookState entry it holds, at one validated ledger,
 * into a folder ready for check.mjs.
 *
 *   node scripts/dump.mjs <r-address> [--net mainnet|testnet | --node https://…] [--out DIR]
 *
 * Writes DIR/state/<namespace>.json (one per namespace, all pages) and, when there is
 * none yet, DIR/check.json listing the hooks with their effective namespace and
 * "manifest": null for you to fill in. Default DIR: ./abi-<r-address>.
 *
 * Requests: account_info, account_objects (type hook), one ledger_entry per hook
 * definition without an installation namespace, then account_namespace pages of 400.
 */
import fs from 'node:fs';
import path from 'node:path';

const NODES = { mainnet: 'https://xahau.network', testnet: 'https://xahau-test.net' };
const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const account = args.find((a) => /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(a));
if (!account) {
  console.error('Usage: node scripts/dump.mjs <r-address> [--net mainnet|testnet | --node https://…] [--out DIR]');
  process.exit(2);
}
const node = opt('--node') ?? NODES[opt('--net') ?? 'mainnet'];
if (!node) {
  console.error('Unknown --net; use mainnet or testnet, or give --node.');
  process.exit(2);
}
const out = opt('--out') ?? `abi-${account}`;

async function rpc(method, params) {
  for (let attempt = 1; ; attempt++) {
    //some public nodes refuse a missing or library user agent
    const r = await fetch(node, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'xahau-hooks-abi-skill/1.0' },
      body: JSON.stringify({ method, params: [params] }),
    });
    if ((r.status === 429 || r.status >= 500) && attempt < 4) {
      await new Promise((ok) => setTimeout(ok, 1500 * attempt));
      continue;
    }
    if (!r.ok) throw new Error(`${method}: HTTP ${r.status} from ${node}`);
    const j = await r.json();
    return j.result;
  }
}

const ledger = (await rpc('ledger', { ledger_index: 'validated' })).ledger_index;
const info = await rpc('account_info', { account, ledger_index: ledger });
if (info.error) throw new Error(`account_info: ${info.error_message ?? info.error}`);
const namespaces = (info.account_data?.HookNamespaces ?? []).map((n) => n.toUpperCase());

const objs = await rpc('account_objects', { account, type: 'hook', ledger_index: ledger });
const installed = (objs.account_objects?.[0]?.Hooks ?? []).map((x) => x.Hook).filter((h) => h?.HookHash);
const hooks = [];
for (const h of installed) {
  let ns = h.HookNamespace ?? null;
  if (!ns) {
    const def = await rpc('ledger_entry', { hook_definition: h.HookHash, ledger_index: ledger });
    ns = def.node?.HookNamespace ?? null;
  }
  hooks.push({ hash: h.HookHash.toUpperCase(), namespace: ns ? ns.toUpperCase() : null, manifest: null });
}

fs.mkdirSync(path.join(out, 'state'), { recursive: true });
const state = {};
for (const ns of namespaces) {
  const entries = [];
  let marker;
  do {
    const r = await rpc('account_namespace', { account, namespace_id: ns, limit: 400, ledger_index: ledger, ...(marker ? { marker } : {}) });
    if (r.error) throw new Error(`account_namespace ${ns}: ${r.error_message ?? r.error}`);
    entries.push(...(r.namespace_entries ?? []).map((e) => ({ k: e.HookStateKey, v: e.HookStateData })));
    marker = r.marker;
  } while (marker);
  fs.writeFileSync(path.join(out, 'state', ns + '.json'), JSON.stringify(entries) + '\n');
  state[ns] = 'state/' + ns + '.json';
  console.log(`namespace ${ns}: ${entries.length} entries${hooks.some((h) => h.namespace === ns) ? '' : ' (no hook installed on it)'}`);
}

const cfgFile = path.join(out, 'check.json');
if (fs.existsSync(cfgFile)) {
  console.log(`\n${cfgFile} exists: left as it is. State re-read at ledger ${ledger}.`);
} else {
  fs.writeFileSync(cfgFile, JSON.stringify({ account, network: node, ledger, hooks, state, extra: {} }, null, 2) + '\n');
  console.log(`\nWrote ${cfgFile} at ledger ${ledger}: ${hooks.length} hook(s). Set each hook's "manifest" to its ABI file, then run check.mjs.`);
}
for (const h of hooks) console.log(`  hook ${h.hash.slice(0, 8)}… namespace ${h.namespace ? h.namespace.slice(0, 8) + '…' : '(none)'}`);
