#!/usr/bin/env node
/**
 * Groups a namespace's entries by shape, so every kind of record gets a projection:
 * leading zero bytes of the key, the key's printable text, and the value length.
 *
 *   node scripts/groups.mjs <state.json> [--samples N]
 *
 * Read the groups against the hook source: each group should be one record kind (one
 * projection); a kind the source writes but no group shows has nothing live yet.
 */
import { readJson, entriesOf } from './lib/io.js';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const samples = Number(args[args.indexOf('--samples') + 1]) || 2;
if (!file) {
  console.error('Usage: node scripts/groups.mjs <state.json> [--samples N]');
  process.exit(2);
}

const groups = new Map();
for (const e of entriesOf(readJson(file))) {
  const key = Buffer.from(e.k, 'hex');
  let zeros = 0;
  while (zeros < key.length && key[zeros] === 0) zeros++;
  const rest = key.subarray(zeros);
  const printable = (b) => b >= 32 && b < 127;
  //a text key by its first character and the shape of the rest (A letter, 9 digit, . other),
  //so "S01001" and "S01002" group;
  //a binary key by its leading text, when it has two characters or more ("VS" + bytes)
  let kind;
  if (rest.length && rest.every(printable)) {
    kind = `text "${String.fromCharCode(rest[0])}" + ` + ([...rest.subarray(1)].map((b) => ((b | 32) >= 97 && (b | 32) <= 122 ? 'A' : b >= 48 && b <= 57 ? '9' : '.')).join('') || '(nothing)');
  } else {
    let n = 0;
    while (n < rest.length && printable(rest[n])) n++;
    kind = 'binary' + (n >= 2 ? ` starting "${rest.subarray(0, n).toString('latin1')}"` : '');
  }
  const id = `key ${32 - zeros}B after ${zeros} zero bytes, ${kind}; value ${e.v.length / 2}B`;
  const g = groups.get(id) ?? { n: 0, samples: [] };
  g.n++;
  if (g.samples.length < samples) g.samples.push(e);
  groups.set(id, g);
}

const total = [...groups.values()].reduce((a, g) => a + g.n, 0);
console.log(`${total} entries in ${groups.size} group(s):\n`);
for (const [id, g] of [...groups].sort((a, b) => b[1].n - a[1].n)) {
  console.log(`${String(g.n).padStart(6)}  ${id}`);
  for (const e of g.samples) {
    const text = Buffer.from(e.k, 'hex').toString('latin1').replace(/[^\x20-\x7e]/g, '·');
    console.log(`          key ${e.k}  "${text.replace(/^·+/, '')}"\n          val ${e.v || '(empty)'}`);
  }
}
