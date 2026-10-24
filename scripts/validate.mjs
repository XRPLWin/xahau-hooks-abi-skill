#!/usr/bin/env node
/**
 * Validates a manifest (or a bare hookStates array) the way xahauwin.com does on publish,
 * then lints it for projections that publish but can never match.
 *
 *   node scripts/validate.mjs <file.json> [--print]
 *
 * Exit 0: it publishes and nothing can never match (warnings may remain). Exit 1:
 * the server would refuse it, or a projection can never match. --print writes the
 * normalised JSON - exactly what the server stores - to stdout.
 */
import { normalise, lint, ManifestError } from './lib/manifest.js';
import { readJson } from './lib/io.js';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
if (!file) {
  console.error('Usage: node scripts/validate.mjs <manifest.json | hookStates.json> [--print]');
  process.exit(2);
}

let result;
try {
  result = normalise(readJson(file));
} catch (e) {
  console.error(e instanceof ManifestError ? `REFUSED by the server's rules: ${e.message}` : e.message);
  process.exit(1);
}
const states = Array.isArray(result.manifest) ? result.manifest : result.manifest.abi.hookStates;
const { errors, warnings } = lint(states);

if (args.includes('--print')) {
  console.log(JSON.stringify(result.manifest, null, 2));
  process.exit(errors.length ? 1 : 0);
}

console.log(`${file}: ${states.length} projection${states.length === 1 ? '' : 's'}, passes the server's rules.`);
for (const n of result.notes) console.log(`  changed on publish: ${n}`);
for (const w of warnings) console.log(`  warning: ${w}`);
for (const e of errors) console.log(`  ERROR: ${e}`);
console.log(errors.length ? `\n${errors.length} projection error(s): these can never match an entry.` : '\nOK');
process.exit(errors.length ? 1 : 0);
