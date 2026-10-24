// Vendored from xrplwin.com (resources/js/win/utils/hookabi/parser.js), unchanged below
// this header: the decoder xahauwin.com runs in the browser, so a check here gives the
// explorer's answer. Do not edit it to make a projection match - fix the projection.
/**
 * The HookState ABI decoder: a key/value pair of hex, and a projection's segments,
 * to typed values - or undefined when the pair is not what the projection describes.
 *
 * Ported from the old explorer's winx/utils/hookabi/parser.js (XW_HookAbiParser, the
 * "literal field-by-field" rewrite). Same segment format and results, so every manifest
 * published on the old explorer decodes here. Changes, each fixing something:
 *  - an unbounded VarString is the rest of the value, by rule (the old length-prefix
 *    guess referenced an undefined variable, so it only ever took the rest by accident);
 *  - containers (Array/STArray/STObject) size their items by `byteLength` when an item
 *    has one, and a container with an item that does not decode does not decode;
 *  - a numeric ASCII pattern ("14") is encoded in the segment's endianness, not always LE;
 *  - the first segment that fails ends the decode (the result was already a failure),
 *    and the value is turned into bytes once per decode, not once per segment.
 *
 * Pure: the node is never asked. Tested with `npm test` (test/js/hookabi.test.mjs).
 *
 * Segment: { type, label, byteLength?, pattern?, patternRegex?, patternEncoding?:
 * 'ascii'|'hex', exclude?, description?, renderer?, endianness?: 'LE'|'BE', items?,
 * repeat? }. Integers, Timestamp, LedgerIndex and XFL are little-endian unless the
 * segment says BE: hooks write native WASM (LE) integers.
 */
import { Buffer } from 'buffer';
import { BinaryParser } from 'xahau-binary-codec/dist/serdes/binary-parser.js';
import { Amount } from 'xahau-binary-codec/dist/types/amount.js';
import XFL from './xfl.js';

/** Fixed byte lengths; VarString, Blob and Null take `byteLength`. */
export const TYPE_LENGTHS = Object.freeze({
  UInt8: 1, Int8: 1,
  UInt16: 2, Int16: 2,
  UInt32: 4, Int32: 4,
  UInt64: 8, Int64: 8,
  Bool: 1,
  AccountID: 20,
  Hash128: 16, Hash160: 20, Hash256: 32, Hash512: 64,
  XFL: 8,
  Amount: 8, //a native amount; an issued one is IOUAmount
  NativeAmount: 8,
  IOUAmount: 48,
  Timestamp: 4,
  LedgerIndex: 4,
});

/** Every type the decoder knows, containers included. */
export const TYPES = Object.freeze([
  ...Object.keys(TYPE_LENGTHS), 'VarString', 'Blob', 'Null', 'Array', 'STArray', 'STObject',
]);

const NUMERIC = ['UInt8', 'Int8', 'UInt16', 'Int16', 'UInt32', 'Int32', 'UInt64', 'Int64'];

export default class HookAbiParser {
  /**
   * @param {{encodeAccountID?: function(Uint8Array): string}} deps - AccountID bytes to
   *   an r-address; the page's ledger library (window.xrpl) by default
   */
  constructor(deps = {}) {
    this.encodeAccountID = deps.encodeAccountID ?? ((bytes) => window.xrpl.encodeAccountID(bytes));
    this.xfl = new XFL();
    this._regex = new Map(); //patternRegex -> RegExp, compiled once
  }

  /**
   * A HookState entry through a projection.
   * @param {string} keyHex - HookStateKey, 32 bytes
   * @param {string} valueHex - HookStateData
   * @param {{selector: Array, data: Array}} projection
   * @returns {{HookStateKey: Array, HookStateData: Array}|undefined} each an array of
   *   {value, bytesRead}, one per segment; undefined when the entry does not fit
   */
  decodeHookState(keyHex, valueHex, projection) {
    if (typeof keyHex !== 'string' || keyHex.length !== 64) return undefined;
    const key = this.decodeAbiValue(keyHex, projection?.selector ?? []);
    if (key.some((v) => v === undefined)) return undefined;
    const data = this.decodeAbiValue(valueHex ?? '', projection?.data ?? []);
    if (data.some((v) => v === undefined)) return undefined;
    return { HookStateKey: key, HookStateData: data };
  }

  /**
   * One hex value through a list of segments. Each result is {value, bytesRead}; a
   * segment that fails is `undefined` and ends the decode, and bytes left over (or
   * missing) add a trailing `undefined` - so any `undefined` means "does not fit".
   * @param {string} hex
   * @param {Array} segments
   * @returns {Array}
   */
  decodeAbiValue(hex, segments = []) {
    const buf = this._buffer(hex);
    if (buf === null) return [undefined];
    const results = [];
    let offset = 0;
    for (const segment of segments) {
      const r = this._segment(buf, segment, offset);
      if (r.value === undefined) {
        results.push(undefined);
        return results;
      }
      results.push({ value: r.value, bytesRead: r.bytesRead });
      offset += r.bytesRead;
    }
    if (offset !== buf.length) results.push(undefined);
    return results;
  }

  /**
   * One segment at an offset: {value, bytesRead, error?}. value is undefined when the
   * bytes do not match. Kept for callers of the old API; decodeAbiValue is the entry.
   */
  decodeAbiSegment(hex, segment, offset = 0) {
    const buf = this._buffer(hex);
    if (buf === null) return { value: undefined, bytesRead: 0, error: 'Not hex' };
    return this._segment(buf, segment, offset);
  }

  /** A type's fixed length in bytes, or `fallback` for one without. */
  getByteLengthForType(type, fallback = undefined) {
    return TYPE_LENGTHS[type] || fallback;
  }

  /** How many bytes a segment covers at this offset, or undefined when it cannot be told. */
  segmentLength(segment, buf, offset) {
    if (!segment.byteLength && segment.type === 'VarString') return buf.length - offset; //the rest, by rule
    return this.fixedLength(segment);
  }

  /**
   * A segment's length where it does not depend on the data: its byteLength, Null's
   * repeat, a container's items times its repeat, else its type's. Undefined for an
   * unbounded VarString - which is why one cannot sit inside a container.
   */
  fixedLength(segment) {
    if (segment.byteLength) return segment.byteLength;
    if (segment.type === 'Null') return segment.repeat || 1;
    if (segment.items && segment.items.length > 0) {
      let one = 0;
      for (const item of segment.items) {
        const n = this.fixedLength(item);
        if (!n) return undefined;
        one += n;
      }
      return one * (segment.repeat || 1);
    }
    return TYPE_LENGTHS[segment.type];
  }

  /** A hex value as printable ASCII text, or `fallback` (the hex itself by default). */
  tryDecodeHexToString(hex, fallback) {
    try {
      const decoded = Buffer.from(hex.startsWith('0x') ? hex.slice(2) : hex, 'hex').toString('utf8');
      if (decoded.length > 0 && /^[\x20-\x7E]*$/.test(decoded)) return decoded;
    } catch (e) {
      //not hex
    }
    return fallback !== undefined ? fallback : hex;
  }

  // ─── internals ─────────────────────────────────────────────────────

  _buffer(hex) {
    if (typeof hex !== 'string') return null;
    const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
    if (clean.length % 2 !== 0 || !/^[0-9A-Fa-f]*$/.test(clean)) return null;
    return Buffer.from(clean, 'hex');
  }

  _fail(bytesRead, error) {
    return { value: undefined, bytesRead, error };
  }

  _segment(buf, segment, offset) {
    if (!segment || typeof segment.type !== 'string') return this._fail(0, 'Segment without a type');
    const byteLength = this.segmentLength(segment, buf, offset);
    if (!byteLength) return this._fail(0, `Unknown byte length for ${segment.type}`);
    if (offset + byteLength > buf.length) {
      return this._fail(byteLength, `Insufficient data: need ${byteLength} bytes, have ${buf.length - offset}`);
    }
    const bytes = buf.subarray(offset, offset + byteLength);

    // Filters: a regular expression over the bytes as ASCII or hex, or a literal value.
    // Excluded segments are checked too - they are how a projection recognises its
    // entries (a prefix, padding); `exclude` only hides them from the table.
    if (segment.patternRegex) {
      const text = segment.patternEncoding === 'hex' ? bytes.toString('hex').toUpperCase() : bytes.toString('ascii');
      const re = this._compile(segment.patternRegex);
      if (re === null || !re.test(text)) return this._fail(byteLength, 'Regex pattern mismatch');
    } else if (segment.pattern !== undefined && segment.pattern !== null && segment.pattern !== '') {
      const expected = this._patternBytes(segment);
      if (expected === null) return this._fail(0, 'Invalid pattern');
      if (expected.length !== byteLength) return this._fail(0, 'Invalid pattern: length mismatch');
      if (!bytes.equals(expected)) return this._fail(byteLength, 'Pattern mismatch');
    }

    if (segment.items && segment.items.length > 0) return this._container(buf, segment, offset, byteLength);

    const value = this._value(segment, bytes, byteLength);
    if (value === undefined) return this._fail(byteLength, `Cannot decode ${segment.type}`);
    return { value, bytesRead: byteLength };
  }

  _container(buf, segment, offset, byteLength) {
    if (segment.type === 'Array' || segment.type === 'STArray') {
      const items = [];
      let at = offset;
      for (let i = 0; i < (segment.repeat || 1); i++) {
        const row = [];
        for (const item of segment.items) {
          const r = this._segment(buf, item, at);
          if (r.value === undefined) return this._fail(byteLength, 'Container item does not decode');
          row.push(r.value);
          at += r.bytesRead;
        }
        items.push(row.length === 1 ? row[0] : row);
      }
      return { value: items, bytesRead: at - offset };
    }
    if (segment.type === 'STObject') {
      const obj = {};
      let at = offset;
      for (const item of segment.items) {
        const r = this._segment(buf, item, at);
        if (r.value === undefined) return this._fail(byteLength, 'Container item does not decode');
        if (item.label) obj[item.label] = r.value;
        at += r.bytesRead;
      }
      return { value: obj, bytesRead: at - offset };
    }
    return this._fail(byteLength, `${segment.type} cannot have items`);
  }

  _compile(source) {
    if (!this._regex.has(source)) {
      let re = null;
      try {
        re = new RegExp(source);
      } catch (e) {
        re = null; //an invalid expression matches nothing
      }
      this._regex.set(source, re);
    }
    return this._regex.get(source);
  }

  /** A literal pattern as bytes: hex, ASCII text, or a decimal number for an integer. */
  _patternBytes(segment) {
    const encoding = segment.patternEncoding === 'hex' ? 'hex' : 'ascii';
    const pattern = String(segment.pattern);
    if (encoding === 'hex') {
      if (pattern.length % 2 !== 0 || !/^[0-9A-Fa-f]+$/.test(pattern)) return null;
      return Buffer.from(pattern, 'hex');
    }
    if (NUMERIC.includes(segment.type) && /^-?\d+$/.test(pattern.trim())) {
      const n = TYPE_LENGTHS[segment.type];
      const bits = BigInt(n * 8);
      const signed = segment.type.startsWith('Int');
      const min = signed ? -(1n << (bits - 1n)) : 0n;
      const max = signed ? (1n << (bits - 1n)) - 1n : (1n << bits) - 1n;
      const v = BigInt(pattern.trim());
      if (v < min || v > max) return null;
      const out = Buffer.alloc(n);
      const be = segment.endianness === 'BE';
      switch (segment.type) {
        case 'Int8': out.writeInt8(Number(v), 0); break;
        case 'UInt8': out.writeUInt8(Number(v), 0); break;
        case 'Int16': be ? out.writeInt16BE(Number(v), 0) : out.writeInt16LE(Number(v), 0); break;
        case 'UInt16': be ? out.writeUInt16BE(Number(v), 0) : out.writeUInt16LE(Number(v), 0); break;
        case 'Int32': be ? out.writeInt32BE(Number(v), 0) : out.writeInt32LE(Number(v), 0); break;
        case 'UInt32': be ? out.writeUInt32BE(Number(v), 0) : out.writeUInt32LE(Number(v), 0); break;
        case 'Int64': be ? out.writeBigInt64BE(v, 0) : out.writeBigInt64LE(v, 0); break;
        case 'UInt64': be ? out.writeBigUInt64BE(v, 0) : out.writeBigUInt64LE(v, 0); break;
      }
      return out;
    }
    const out = Buffer.from(pattern, 'ascii');
    return out.length ? out : null;
  }

  /** The bytes of one segment as its type, or undefined. */
  _value(segment, bytes, byteLength) {
    const be = segment.endianness === 'BE';
    switch (segment.type) {
      case 'UInt8': return bytes.readUInt8(0);
      case 'Int8': return bytes.readInt8(0);
      case 'UInt16': return be ? bytes.readUInt16BE(0) : bytes.readUInt16LE(0);
      case 'Int16': return be ? bytes.readInt16BE(0) : bytes.readInt16LE(0);
      case 'UInt32':
      case 'Timestamp':
      case 'LedgerIndex':
        return be ? bytes.readUInt32BE(0) : bytes.readUInt32LE(0);
      case 'Int32': return be ? bytes.readInt32BE(0) : bytes.readInt32LE(0);
      //64-bit values are strings: they overflow Number
      case 'UInt64': return (be ? bytes.readBigUInt64BE(0) : bytes.readBigUInt64LE(0)).toString();
      case 'Int64': return (be ? bytes.readBigInt64BE(0) : bytes.readBigInt64LE(0)).toString();
      case 'Bool': return bytes[0] !== 0;
      case 'AccountID':
        try {
          return this.encodeAccountID(bytes);
        } catch (e) {
          return undefined;
        }
      case 'Amount':
      case 'NativeAmount':
      case 'IOUAmount': {
        const want = segment.type === 'IOUAmount' ? 'object' : 'string';
        if (segment.type !== 'Amount' && byteLength !== TYPE_LENGTHS[segment.type]) return undefined;
        try {
          const json = Amount.fromParser(new BinaryParser(bytes.toString('hex').toUpperCase())).toJSON();
          if (segment.type === 'Amount') return json;
          return typeof json === want ? json : undefined;
        } catch (e) {
          return undefined;
        }
      }
      case 'VarString': return bytes.toString('utf8');
      case 'Hash128':
      case 'Hash160':
      case 'Hash256':
      case 'Hash512':
      case 'Blob':
        return bytes.toString('hex').toUpperCase();
      case 'XFL':
        try {
          return this.xfl.hexToDecimal(bytes.toString('hex').toUpperCase(), be ? 'BE' : 'LE');
        } catch (e) {
          return undefined;
        }
      case 'Null': return bytes.every((b) => b === 0) ? null : undefined;
      default: return undefined;
    }
  }
}
