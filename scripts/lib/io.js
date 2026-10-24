/** Reading the files the scripts share: manifests, state dumps, the check config. */
import fs from 'node:fs';
import path from 'node:path';
import { encodeAccountID, decodeAccountID } from 'xahau-address-codec';
import HookAbiParser from './parser.js';

export { encodeAccountID, decodeAccountID };

export function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`${file}: ${e.code === 'ENOENT' ? 'no such file' : e.message}`);
  }
}

/** The projections of a manifest file: a whole manifest, or a bare hookStates array. */
export function projectionsOf(json) {
  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.abi?.hookStates)) return json.abi.hookStates;
  throw new Error('Not a manifest: expected a hookStates array or an object with abi.hookStates.');
}

/**
 * State entries as {k, v} (HookStateKey, HookStateData hex): accepts a list of {k, v},
 * a list of account_namespace entries, or an account_namespace result.
 */
export function entriesOf(json) {
  const list = Array.isArray(json) ? json : json?.namespace_entries ?? json?.result?.namespace_entries;
  if (!Array.isArray(list)) throw new Error('Not a state dump: expected a list of entries.');
  return list.map((e) => ({ k: String(e.k ?? e.HookStateKey ?? '').toUpperCase(), v: String(e.v ?? e.HookStateData ?? '').toUpperCase() }));
}

export function parser() {
  return new HookAbiParser({ encodeAccountID: (bytes) => encodeAccountID(Uint8Array.from(bytes)) });
}

export function rel(base, file) {
  return path.isAbsolute(file) ? file : path.join(path.dirname(base), file);
}

/** The value columns of a decoded entry, as `label=value`: what the explorer's table shows. */
export function row(projection, decoded) {
  return [
    ...projection.selector.map((s, j) => [s, decoded.HookStateKey[j]]),
    ...projection.data.map((s, j) => [s, decoded.HookStateData[j]]),
  ].filter(([s]) => !s.exclude).map(([s, v]) => s.label + '=' + JSON.stringify(v.value));
}
