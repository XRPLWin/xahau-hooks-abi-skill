/**
 * A hook manifest checked the way xahauwin.com checks it on publish.
 *
 * normalise() is a port of the server's validator (xrplwin.com,
 * app/Win/Utilities/HookManifest.php): the same limits, the same refusals, the same
 * silent clean-up. It throws ManifestError where the server answers 422, and records in
 * `notes` what the server would change without saying so (a dropped key, a text cut to
 * its limit, a label filled in).
 *
 * lint() goes further than the server: it finds projections that publish fine but can
 * never match an entry (a selector that cannot be 32 bytes, a pattern longer than its
 * segment, an unbounded VarString before the end) and type choices that decode wrongly.
 */
import { TYPES, TYPE_LENGTHS } from './parser.js';

export const RENDERERS = ['unixTimeToISO', 'rippleTimeToISO', 'unixTimeToRelative', 'rippleTimeToRelative'];
export const LIMITS = Object.freeze({
  projections: 200,
  segments: 256,
  publishers: 10,
  namespaces: 256,
  bytes: 262144,
  name: 100,
  description: 300,
  readme: 50000,
  license: 64,
  url: 300,
  projectionName: 100,
  projectionDescription: 500,
  label: 100,
  segmentDescription: 300,
  namespaceName: 64,
  pattern: 512,
});

const MANIFEST_KEYS = ['name', 'description', 'readme', 'repo', 'license', 'publishers', 'abi', 'namespaces'];
const PROJECTION_KEYS = ['name', 'description', 'selector', 'data'];
const SEGMENT_KEYS = ['type', 'label', 'byteLength', 'pattern', 'patternRegex', 'patternEncoding', 'exclude', 'description', 'renderer', 'endianness', 'repeat', 'items'];
const CONTAINERS = ['Array', 'STArray', 'STObject'];

export class ManifestError extends Error {}

/**
 * @param {object|Array} input a whole manifest, or a bare `hookStates` array (what the
 *   publish dialog's ABI box takes)
 * @returns {{manifest: object, notes: string[]}}
 */
export function normalise(input, { strict = true } = {}) {
  const notes = [];
  const bare = Array.isArray(input);
  const m = bare ? { name: 'x', abi: { hookStates: input } } : input;
  if (!m || typeof m !== 'object') throw new ManifestError('The manifest is not a JSON object.');
  if (!bare) unknownKeys(m, MANIFEST_KEYS, 'The manifest', notes, ['icon', '_this_version', '_available_versions']);

  const name = text(m.name, LIMITS.name, false, 'name', notes);
  if (name === '' && strict) throw new ManifestError('The hook name is required.');
  const description = text(m.description, LIMITS.description, false, 'description', notes);

  const publishers = [];
  for (const p of Array.isArray(m.publishers) ? m.publishers : []) {
    if (!p || typeof p !== 'object') continue;
    const pname = text(p.name, LIMITS.name, false, 'publisher name', notes);
    if (pname === '') { notes.push('A publisher without a name is left out.'); continue; }
    if (p.type !== 'organization' && p.type !== 'individual') notes.push(`Publisher "${pname}": type becomes "individual" (it is "individual" or "organization").`);
    publishers.push({ name: pname, type: p.type === 'organization' ? 'organization' : 'individual', url: url(p.url, 'Publisher URL', notes) });
    if (publishers.length > LIMITS.publishers) throw new ManifestError(`At most ${LIMITS.publishers} publishers.`);
  }

  const states = m.abi?.hookStates ?? [];
  if (!Array.isArray(states)) throw new ManifestError('abi.hookStates must be a list of projections.');
  if (states.length > LIMITS.projections) throw new ManifestError(`At most ${LIMITS.projections} projections.`);
  const hookStates = states.map((p, i) => projection(p, i, notes));

  const out = {
    name,
    description,
    readme: text(m.readme, LIMITS.readme, true, 'readme', notes),
    repo: url(m.repo, 'Repository URL', notes),
    license: text(m.license, LIMITS.license, false, 'license', notes) || 'Unlicensed',
    publishers,
    abi: { hookStates },
    namespaces: namespaceNames(m.namespaces, notes),
  };
  if (Buffer.byteLength(JSON.stringify(out)) > LIMITS.bytes) {
    throw new ManifestError(`The manifest is too large (at most ${LIMITS.bytes / 1024}KB).`);
  }
  return { manifest: bare ? out.abi.hookStates : out, notes };
}

function namespaceNames(input, notes) {
  if (!input || typeof input !== 'object') return {};
  const out = {};
  const entries = Array.isArray(input) ? input.map((v) => [v?.namespace, v?.name]) : Object.entries(input);
  for (const [k, v] of entries) {
    if (typeof k !== 'string' || !/^[0-9A-Fa-f]{64}$/.test(k)) throw new ManifestError('A namespace to name must be 32 bytes of hex (64 characters).');
    const name = text(v, LIMITS.namespaceName, false, 'namespace name', notes);
    if (name === '') continue;
    out[k.toUpperCase()] = name;
    if (Object.keys(out).length > LIMITS.namespaces) throw new ManifestError(`At most ${LIMITS.namespaces} namespace names.`);
  }
  return out;
}

function projection(p, i, notes) {
  let where = `Projection #${i}`;
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw new ManifestError(`${where} is not an object.`);
  const name = text(p.name, LIMITS.projectionName, false, `${where} name`, notes);
  if (name === '') throw new ManifestError(`${where} needs a name.`);
  where += ` ("${name}")`;
  unknownKeys(p, PROJECTION_KEYS, where, notes);
  for (const part of ['selector', 'data']) {
    if (!Array.isArray(p[part])) throw new ManifestError(`${where}: ${part} must be a list of segments.`);
  }
  if (!p.selector.length) throw new ManifestError(`${where}: the selector (HookStateKey) is empty.`);
  return {
    name,
    description: text(p.description, LIMITS.projectionDescription, false, `${where} description`, notes),
    selector: segments(p.selector, `${where} selector`, 0, notes),
    data: segments(p.data, `${where} data`, 0, notes),
  };
}

function segments(list, where, depth, notes) {
  if (list.length > LIMITS.segments) throw new ManifestError(`${where}: at most ${LIMITS.segments} segments.`);
  return list.map((s, j) => segment(s, `${where} #${j}`, depth, notes));
}

function segment(s, where, depth, notes) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) throw new ManifestError(`${where} is not an object.`);
  if (typeof s.type !== 'string' || !TYPES.includes(s.type)) {
    throw new ManifestError(`${where}: unknown type${typeof s.type === 'string' ? ` "${s.type.slice(0, 40)}"` : ''}.`);
  }
  unknownKeys(s, SEGMENT_KEYS, where, notes);
  let label = text(s.label, LIMITS.label, false, `${where} label`, notes);
  if (label === '') { label = s.type; notes.push(`${where}: no label, so the column is called "${s.type}".`); }

  const out = { type: s.type, label };
  if (s.byteLength !== undefined && s.byteLength !== null) {
    const n = Number(s.byteLength);
    if (!Number.isInteger(n) || n < 1 || n > 65535) throw new ManifestError(`${where}: byteLength must be 1-65535.`);
    out.byteLength = n;
  }
  for (const k of ['pattern', 'patternRegex']) {
    if (s[k] !== undefined && s[k] !== null && s[k] !== '') {
      if (typeof s[k] === 'object') throw new ManifestError(`${where}: ${k} must be text.`);
      const v = String(s[k]);
      if (Buffer.byteLength(v) > LIMITS.pattern) throw new ManifestError(`${where}: ${k} is too long.`);
      out[k] = v;
    }
  }
  if (out.pattern !== undefined || out.patternRegex !== undefined) {
    out.patternEncoding = s.patternEncoding === 'hex' ? 'hex' : 'ascii';
    if (s.patternEncoding !== undefined && s.patternEncoding !== 'hex' && s.patternEncoding !== 'ascii') {
      notes.push(`${where}: patternEncoding "${s.patternEncoding}" becomes "ascii".`);
    }
  }
  if (s.exclude) out.exclude = true;
  const description = text(s.description, LIMITS.segmentDescription, false, `${where} description`, notes);
  if (description !== '') out.description = description;
  if (s.renderer !== undefined) {
    if (RENDERERS.includes(s.renderer)) out.renderer = s.renderer;
    else notes.push(`${where}: renderer "${s.renderer}" is unknown and dropped (known: ${RENDERERS.join(', ')}).`);
  }
  if (s.endianness === 'BE') out.endianness = 'BE';
  else if (s.endianness !== undefined && s.endianness !== 'LE') notes.push(`${where}: endianness "${s.endianness}" is dropped: little-endian applies.`);
  if (s.repeat !== undefined && s.repeat !== null) {
    const n = Number(s.repeat);
    if (!Number.isInteger(n) || n < 1 || n > 1024) throw new ManifestError(`${where}: repeat must be 1-1024.`);
    out.repeat = n;
  }
  if (s.items !== undefined) {
    if (!CONTAINERS.includes(s.type)) throw new ManifestError(`${where}: only containers have items.`);
    if (depth >= 2) throw new ManifestError(`${where}: containers nest at most two deep.`);
    if (!Array.isArray(s.items) || !s.items.length) throw new ManifestError(`${where}: items must be a list of segments.`);
    out.items = segments(s.items, `${where} items`, depth + 1, notes);
  }
  return out;
}

function unknownKeys(obj, known, where, notes, quiet = []) {
  for (const k of Object.keys(obj)) {
    if (!known.includes(k) && !quiet.includes(k)) notes.push(`${where}: key "${k}" is not part of the format and is dropped.`);
  }
}

/** Trimmed text without control characters (tab and newlines kept when multiline), capped. */
function text(v, max, multiline, what, notes) {
  if (v === undefined || v === null || typeof v === 'object') return '';
  let s = String(v);
  s = multiline ? s.replace(/\r\n/g, '\n').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') : s.replace(/[\x00-\x1F\x7F]/g, ' ');
  s = s.trim();
  const chars = [...s];
  if (chars.length > max) {
    notes.push(`${what}: cut to ${max} characters (it has ${chars.length}).`);
    s = chars.slice(0, max).join('');
  }
  return s;
}

/** An http(s) URL, or null for none; anything else is refused. */
function url(v, what, notes) {
  const s = text(v, LIMITS.url, false, what, notes);
  if (s === '') return null;
  let u;
  try { u = new URL(s); } catch { u = null; }
  if (!u || !['http:', 'https:'].includes(u.protocol) || !u.hostname) throw new ManifestError(`${what} must be an http(s) address.`);
  return s;
}

// ─── Lint: what publishes but cannot work ────────────────────────────

/** A segment's length when it does not depend on the data (parser.js fixedLength). */
export function fixedLength(s) {
  if (s.byteLength) return s.byteLength;
  if (s.type === 'Null') return s.repeat || 1;
  if (s.items && s.items.length) {
    let one = 0;
    for (const item of s.items) {
      const n = fixedLength(item);
      if (!n) return undefined;
      one += n;
    }
    return one * (s.repeat || 1);
  }
  return TYPE_LENGTHS[s.type];
}

/**
 * @param {Array} hookStates normalised projections
 * @returns {{errors: string[], warnings: string[]}} errors: the projection can never
 *   match; warnings: it matches but may show the wrong thing
 */
export function lint(hookStates) {
  const errors = [];
  const warnings = [];
  const names = new Map();
  hookStates.forEach((p, i) => {
    const where = `Projection #${i} ("${p.name}")`;
    if (names.has(p.name)) warnings.push(`${where}: same name as projection #${names.get(p.name)} - the reader shows two buttons with one name.`);
    else names.set(p.name, i);
    for (const part of ['selector', 'data']) {
      const list = p[part];
      let total = 0;
      let open = false;
      list.forEach((s, j) => {
        const at = `${where} ${part} #${j} (${s.label})`;
        segmentLint(s, at, errors, warnings);
        const n = s.type === 'VarString' && !s.byteLength ? undefined : fixedLength(s);
        if (n === undefined) {
          if (s.type === 'VarString' && !s.byteLength) {
            if (j !== list.length - 1) errors.push(`${at}: a VarString without byteLength takes the rest of the value, so nothing after it can match. Give it a byteLength or move it last.`);
            open = true;
          } else {
            errors.push(`${at}: its length cannot be told (${s.type} needs a byteLength${s.items ? ', or every item a fixed length' : ''}).`);
          }
        } else {
          total += n;
        }
      });
      if (part === 'selector') {
        if (!open && total !== 32) errors.push(`${where}: the selector covers ${total} bytes; a HookStateKey is always 32. Pad it with Null segments (a key shorter than 32 bytes is zero-padded on the left).`);
        if (open && total > 32) errors.push(`${where}: the selector's fixed segments already cover ${total} bytes, more than the key's 32.`);
        if (!list.some((s) => s.pattern || s.patternRegex || s.type === 'Null')) {
          warnings.push(`${where}: the selector has no pattern and no Null padding, so it matches any key of the right shape. Make sure the data (length, patterns) tells its entries apart, or other kinds of entries will show in this table.`);
        }
      }
      if (part === 'data' && !list.length) warnings.push(`${where}: data is empty, so it matches only entries whose value is empty.`);
    }
  });
  return { errors, warnings };
}

function segmentLint(s, at, errors, warnings) {
  if (s.exclude && s.type !== 'Null' && s.pattern === undefined && s.patternRegex === undefined) {
    warnings.push(`${at}: excluded, but it is not padding or a fixed literal - a value that varies is hidden from the table and the CSV.`);
  }
  if (s.pattern !== undefined) {
    const n = fixedLength(s);
    const bytes = patternLength(s);
    if (bytes === null) errors.push(`${at}: pattern "${s.pattern}" is not valid ${s.patternEncoding === 'hex' ? 'hex' : 'for this type'}, so nothing matches.`);
    else if (n !== undefined && bytes !== n) errors.push(`${at}: pattern "${s.pattern}" is ${bytes} bytes but the segment is ${n}; the decoder refuses it, so nothing matches.`);
  }
  if (s.patternRegex !== undefined) {
    try { new RegExp(s.patternRegex); } catch { errors.push(`${at}: patternRegex is not a valid regular expression, so nothing matches.`); }
    if (!/^\^.*\$$/.test(s.patternRegex)) warnings.push(`${at}: patternRegex "${s.patternRegex}" is not anchored with ^…$, so it also matches values that only contain it.`);
    if (s.patternEncoding === 'hex' && /[a-f]/.test(s.patternRegex.replace(/\\[a-z]/gi, ''))) warnings.push(`${at}: hex patternRegex is tested against UPPERCASE hex; lowercase letters in it never match.`);
  }
  if (s.type === 'Null' && (s.pattern || s.patternRegex)) warnings.push(`${at}: a Null segment matches only zero bytes; its pattern adds nothing.`);
  if (s.type === 'Bool') warnings.push(`${at}: Bool shows any non-zero byte as True. If only 0x01 means on, use UInt8.`);
  if (s.type === 'NativeAmount' || s.type === 'Amount') warnings.push(`${at}: ${s.type} reads a serialized ledger amount (flag bits set). A hook that stores drops as a plain integer needs UInt64 (mind endianness).`);
  if (s.renderer && s.type !== 'Timestamp') warnings.push(`${at}: renderer "${s.renderer}" is offered for Timestamp segments; on ${s.type} it still applies.`);
  if (s.endianness === 'BE' && !['UInt16', 'Int16', 'UInt32', 'Int32', 'UInt64', 'Int64', 'Timestamp', 'LedgerIndex', 'XFL'].includes(s.type)) {
    warnings.push(`${at}: endianness has no effect on ${s.type}.`);
  }
  for (const item of s.items ?? []) segmentLint(item, `${at} item (${item.label})`, errors, warnings);
}

/** The byte length of a literal pattern as the decoder builds it, or null when invalid. */
function patternLength(s) {
  const p = String(s.pattern);
  if (s.patternEncoding === 'hex') return p.length % 2 === 0 && /^[0-9A-Fa-f]+$/.test(p) ? p.length / 2 : null;
  if (['UInt8', 'Int8', 'UInt16', 'Int16', 'UInt32', 'Int32', 'UInt64', 'Int64'].includes(s.type) && /^-?\d+$/.test(p.trim())) {
    const n = TYPE_LENGTHS[s.type];
    const bits = BigInt(n * 8);
    const signed = s.type.startsWith('Int');
    const v = BigInt(p.trim());
    const min = signed ? -(1n << (bits - 1n)) : 0n;
    const max = signed ? (1n << (bits - 1n)) - 1n : (1n << bits) - 1n;
    return v < min || v > max ? null : n;
  }
  //Buffer.from(p, 'ascii'): one byte per UTF-16 unit
  return p.length || null;
}
