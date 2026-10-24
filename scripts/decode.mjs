#!/usr/bin/env node
/**
 * Decodes one HookState entry with each projection of a manifest and, where a projection
 * does not match, says which segment failed and why. For writing and debugging a
 * projection against one sample.
 *
 *   node scripts/decode.mjs <manifest.json> <HookStateKey hex> <HookStateData hex> [projection name]
 */
import { readJson, projectionsOf, parser as makeParser, row } from './lib/io.js';

const [file, key, value, only] = process.argv.slice(2);
if (!file || !key || value === undefined) {
  console.error('Usage: node scripts/decode.mjs <manifest.json> <HookStateKey hex> <HookStateData hex> [projection name]');
  process.exit(2);
}
const parser = makeParser();
const projections = projectionsOf(readJson(file)).filter((p) => !only || p.name === only);
if (!projections.length) {
  console.error(only ? `No projection named "${only}".` : 'The manifest has no projections.');
  process.exit(2);
}
const K = key.toUpperCase().replace(/^0X/, '');
const V = value.toUpperCase().replace(/^0X/, '');
if (!/^[0-9A-F]{64}$/.test(K)) console.log('Note: a HookStateKey is always 32 bytes (64 hex characters); this one is not, so nothing can match.\n');

let matched = 0;
for (const p of projections) {
  const d = parser.decodeHookState(K, V, p);
  if (d) {
    matched++;
    console.log(`MATCH  ${p.name}\n       ${row(p, d).join('  ')}`);
    continue;
  }
  const why = explain(K, p.selector, 'selector') ?? explain(V, p.data, 'data');
  console.log(`no     ${p.name}\n       ${why}`);
}
console.log(`\n${matched} of ${projections.length} projection(s) match.${matched > 1 ? ' More than one: on the explorer this entry shows in several tables.' : ''}`);

/** The first reason a hex value does not fit its segments, or null when it fits. */
function explain(hex, segments, part) {
  const total = hex.length / 2;
  let offset = 0;
  for (let j = 0; j < segments.length; j++) {
    const s = segments[j];
    const r = parser.decodeAbiSegment(hex, s, offset);
    if (r.value === undefined) {
      const bytes = hex.slice(offset * 2, (offset + (r.bytesRead || 0)) * 2);
      return `${part} #${j} (${s.label}, ${s.type}) at byte ${offset}: ${r.error}${bytes ? ` - bytes ${bytes}` : ''}`;
    }
    offset += r.bytesRead;
  }
  if (offset !== total) return `${part}: the segments cover ${offset} bytes, the value has ${total}. Every byte must be covered, no more.`;
  return null;
}
