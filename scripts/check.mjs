#!/usr/bin/env node
/**
 * Decodes every state entry of an account through the manifests of its hooks, the way
 * xahauwin.com's Namespaces tab does, and fails unless every entry is decoded by exactly
 * one projection.
 *
 *   node scripts/check.mjs <check.json> [--samples N]
 *
 * check.json (dump.mjs writes one; paths are relative to it):
 *   {
 *     "account": "r…",
 *     "hooks": [ {"hash": "64 hex", "namespace": "64 hex", "manifest": "mint.abi.json"} ],
 *     "state": { "<namespace>": "state/<namespace>.json" },
 *     "extra": { "<namespace>": [ {"k": "…", "v": "…", "note": "made up: no live record"} ] }
 *   }
 * `namespace` is the hook's effective namespace (its installation's HookNamespace, else
 * its definition's). `manifest` may be null for a hook without one. `extra` adds made-up
 * entries for record kinds with nothing live.
 *
 * The explorer's rule: a namespace lists the hooks whose namespace it is; when there are
 * none (a namespace written with state_foreign_set, or by a hook since removed), it lists
 * every hook of the account. Every projection of every listed hook is tried on every
 * entry, so projections must rule each other out.
 */
import { readJson, projectionsOf, entriesOf, parser as makeParser, rel, row } from './lib/io.js';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const samples = Number(args[args.indexOf('--samples') + 1]) || 1;
if (!file) {
  console.error('Usage: node scripts/check.mjs <check.json> [--samples N]');
  process.exit(2);
}

const cfg = readJson(file);
const parser = makeParser();
const hooks = (cfg.hooks ?? []).map((h) => ({
  hash: String(h.hash).toUpperCase(),
  namespace: h.namespace ? String(h.namespace).toUpperCase() : null,
  name: h.name ?? (h.manifest ? h.manifest.replace(/^.*\//, '').replace(/\.json$/, '') : String(h.hash).slice(0, 8)),
  projections: h.manifest ? projectionsOf(readJson(rel(file, h.manifest))) : [],
}));
if (!hooks.length) {
  console.error('check.json lists no hooks.');
  process.exit(2);
}

let problems = 0;
const unused = new Map(hooks.flatMap((h) => h.projections.map((p) => [h.name + ': ' + p.name, true])));
const upper = (o) => Object.fromEntries(Object.entries(o ?? {}).map(([k, v]) => [k.toUpperCase(), v]));
const stateFiles = upper(cfg.state);
const extras = upper(cfg.extra);
//a namespace with made-up entries only (a hook not deployed yet) is checked too
for (const ns of [...new Set([...Object.keys(stateFiles), ...Object.keys(extras)])]) {
  const live = stateFiles[ns] ? entriesOf(readJson(rel(file, stateFiles[ns]))) : [];
  const extra = entriesOf(extras[ns] ?? []).map((e) => ({ ...e, made: true }));
  const entries = [...live, ...extra];
  const own = hooks.filter((h) => h.namespace === ns);
  const listed = own.length ? own : hooks;

  const hits = new Map();
  const counts = new Map();
  const shown = new Map();
  for (const h of listed) {
    for (const p of h.projections) {
      const tag = h.name + ': ' + p.name;
      counts.set(tag, 0);
      for (const e of entries) {
        const d = parser.decodeHookState(e.k, e.v, p);
        if (!d) continue;
        counts.set(tag, counts.get(tag) + 1);
        unused.delete(tag);
        hits.set(e, [...(hits.get(e) ?? []), tag]);
        const list = shown.get(tag) ?? [];
        if (list.length < samples) shown.set(tag, [...list, (e.made ? '(made up) ' : '') + row(p, d).join('  ')]);
      }
    }
  }

  console.log(`\n== namespace ${ns.slice(0, 8)}… (${live.length} live${extra.length ? ` + ${extra.length} made up` : ''}) - ${own.length ? 'installed' : 'no hook installed, so every hook is listed'}: ${listed.map((h) => h.name).join(', ')}`);
  for (const [tag, n] of counts) {
    if (!n) continue;
    console.log(`  ${String(n).padStart(5)}  ${tag}`);
    for (const s of shown.get(tag)) console.log(`         e.g. ${s}`);
  }
  const none = entries.filter((e) => !hits.has(e));
  const multi = entries.filter((e) => hits.get(e)?.length > 1);
  if (none.length) {
    problems++;
    console.log(`  UNDECODED ${none.length} entr${none.length === 1 ? 'y' : 'ies'} (shown only as raw state). First ${Math.min(3, none.length)}:`);
    for (const e of none.slice(0, 3)) console.log(`    key ${e.k}\n    val ${e.v || '(empty)'}`);
  }
  if (multi.length) {
    problems++;
    console.log(`  MATCHED MORE THAN ONCE ${multi.length} entr${multi.length === 1 ? 'y' : 'ies'} (shown in several tables). First ${Math.min(3, multi.length)}:`);
    for (const e of multi.slice(0, 3)) console.log(`    key ${e.k}  by ${hits.get(e).join(' | ')}`);
  }
}

if (unused.size) {
  console.log(`\nProjections that matched nothing (the explorer hides them; fine for a record kind with no live entry, else add a made-up entry under "extra" to test it):`);
  for (const tag of unused.keys()) console.log(`  ${tag}`);
}
console.log(problems ? `\n${problems} problem(s).` : '\nEvery entry decodes, by exactly one projection.');
process.exit(problems ? 1 : 0);
