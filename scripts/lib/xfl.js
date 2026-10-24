// Vendored from xrplwin.com (resources/js/win/utils/hookabi/xfl.js), unchanged below
// this header. Used by parser.js for the XFL type.
/**
 * XFL (eXtended Fixed-point Linear): the 64-bit decimal float hooks use for amounts
 * (float_set, float_multiply…). 1 sign bit (set = positive), 8 exponent bits biased by
 * 97, 54 mantissa bits; zero is all zeroes.
 *
 * Ported from the old explorer's winx/utils/xfl.js (XRPLWin, 21.03.2026 - the one the
 * user named as the correct one of their XFL converters), itself adopted from
 * Transia-RnD's binary-models-ts. Stateless and pure: tested with `npm test`.
 *
 * @see https://github.com/Transia-RnD/binary-models-ts/blob/main/src/xfl.ts
 */
import BigNumber from 'bignumber.js';

export default class XFL {
  constructor() {
    this.minMantissa = 1000000000000000n;
    this.maxMantissa = 9999999999999999n;
    this.minExponent = -96;
    this.maxExponent = 80;
  }

  /**
   * Hex as stored (16 hex digits) to its decimal value, as a string.
   * Sample: 617EA49F8D570A54 -> "0.02911015547469409" (LE, how hooks store it).
   * @param {string} hex
   * @param {string} endianness LE (default) or BE
   * @returns {string}
   * @throws Error on an invalid XFL (negative bit pattern)
   */
  hexToDecimal(hex, endianness = 'LE') {
    if (hex === '0000000000000000') return '0';
    hex = endianness === 'LE' ? this.flipHex(hex) : hex;
    const xfl = this.toString(BigInt('0x' + hex));
    return new BigNumber(xfl).toString();
  }

  uint64ToDecimal(uint64) {
    if (uint64 === 0n) return '0';
    return new BigNumber(this.toString(BigInt(uint64))).toString();
  }

  _makeXfl(exponent, mantissa) {
    if (typeof exponent != 'bigint') exponent = BigInt(exponent);
    if (typeof mantissa != 'bigint') mantissa = BigInt(mantissa);

    // canonical zero
    if (mantissa == 0n) return 0n;

    // normalize
    const isNegative = mantissa < 0;
    if (isNegative) mantissa *= -1n;

    while (mantissa > this.maxMantissa) {
      mantissa /= 10n;
      exponent++;
    }
    while (mantissa < this.minMantissa) {
      mantissa *= 10n;
      exponent--;
    }

    // canonical zero on mantissa underflow
    if (mantissa == 0) return 0n;

    // under and overflows: an "invalid" XFL used to propagate errors
    if (exponent > this.maxExponent || exponent < this.minExponent) return -1;

    exponent += 97n;

    let xfl = !isNegative ? 1n : 0n;
    xfl <<= 8n;
    xfl |= BigInt(exponent);
    xfl <<= 54n;
    xfl |= BigInt(mantissa);
    return xfl;
  }

  _getExponent(xfl) {
    if (xfl < 0n) throw new Error('Invalid XFL');
    if (xfl == 0n) return 0n;
    return ((xfl >> 54n) & 0xffn) - 97n;
  }

  _getMantissa(xfl) {
    if (xfl < 0n) throw new Error('Invalid XFL');
    if (xfl == 0n) return 0n;
    return xfl - ((xfl >> 54n) << 54n);
  }

  _isNegative(xfl) {
    if (xfl < 0n) throw new Error('Invalid XFL');
    if (xfl == 0n) return false;
    return ((xfl >> 62n) & 1n) == 0n;
  }

  /** "+mantissaEexponent" / "-…", or "<zero>" - BigNumber reads the former. */
  toString(xfl) {
    if (xfl < 0n) throw new Error('Invalid XFL');
    if (xfl == 0n) return '<zero>';
    return (this._isNegative(xfl) ? '-' : '+') + this._getMantissa(xfl).toString() + 'E' + this._getExponent(xfl).toString();
  }

  /** A decimal to its XFL (BigInt; -1 when out of range). */
  floatToXfl(fl) {
    let e = 0;
    let d = '' + parseFloat('' + fl);
    d = d.toLowerCase();
    let s = d.split('e');
    if (s.length == 2) {
      e = parseInt(s[1]);
      d = s[0];
    }
    s = d.split('.');
    if (s.length == 2) {
      d = d.replace('.', '');
      e -= s[1].length;
    } else if (s.length > 2) d = BigInt(0).toString();
    return this._makeXfl(e, d);
  }

  floatToLEXfl(fl) {
    return this.flipBeLe(this.floatToXfl(fl));
  }

  flipBeLe(endian) {
    const hexString = endian.toString(16).toUpperCase();
    let flipped = '';
    for (let i = hexString.length - 2; i >= 0; i -= 2) flipped += hexString.slice(i, i + 2);
    return flipped;
  }

  flipHex(hexString) {
    let flipped = '';
    for (let i = hexString.length - 2; i >= 0; i -= 2) flipped += hexString.slice(i, i + 2);
    return flipped;
  }
}
