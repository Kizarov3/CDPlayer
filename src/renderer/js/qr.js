/*
 * QR Code generator library (TypeScript)
 *
 * Copyright (c) Project Nayuki. (MIT License)
 * https://www.nayuki.io/page/qr-code-generator-library
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
 * the Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions:
 * - The above copyright notice and this permission notice shall be included in
 *   all copies or substantial portions of the Software.
 * - The Software is provided "as is", without warranty of any kind, express or
 *   implied, including but not limited to the warranties of merchantability,
 *   fitness for a particular purpose and noninfringement. In no event shall the
 *   authors or copyright holders be liable for any claim, damages or other
 *   liability, whether in an action of contract, tort or otherwise, arising from,
 *   out of or in connection with the Software or the use or other dealings in the
 *   Software.
 */

// Vendored from https://github.com/nayuki/QR-Code-generator (typescript-javascript/qrcodegen.ts):
// types stripped, namespaces flattened into exports, and trimmed to what encodeText needs
// (no encodeBinary, ECI, kanji); the algorithm is unchanged. qrSvg() at the bottom is ours.

'use strict';

/*---- Data segment class ----*/

// Describes how a segment's data bits are interpreted. Immutable.
class Mode {
  constructor(modeBits, numBitsCharCount) {
    this.modeBits = modeBits; // uint4
    this.numBitsCharCount = numBitsCharCount; // char-count bit widths for three version ranges
  }

  // Bit width of the character count field for a segment in this mode at the given version.
  numCharCountBits(ver) {
    return this.numBitsCharCount[Math.floor((ver + 7) / 17)];
  }
}
Mode.NUMERIC = new Mode(0x1, [10, 12, 14]);
Mode.ALPHANUMERIC = new Mode(0x2, [9, 11, 13]);
Mode.BYTE = new Mode(0x4, [8, 16, 16]);

// A segment of character/binary data in a QR Code symbol. Immutable.
export class QrSegment {
  // Returns a segment representing the given binary data encoded in byte mode.
  static makeBytes(data) {
    const bb = [];
    for (const b of data) appendBits(b, 8, bb);
    return new QrSegment(Mode.BYTE, data.length, bb);
  }

  // Returns a segment representing the given string of decimal digits encoded in numeric mode.
  static makeNumeric(digits) {
    if (!QrSegment.isNumeric(digits)) throw new RangeError('String contains non-numeric characters');
    const bb = [];
    for (let i = 0; i < digits.length; ) { // Consume up to 3 digits per iteration
      const n = Math.min(digits.length - i, 3);
      appendBits(parseInt(digits.substring(i, i + n), 10), n * 3 + 1, bb);
      i += n;
    }
    return new QrSegment(Mode.NUMERIC, digits.length, bb);
  }

  // Returns a segment representing the given text string encoded in alphanumeric mode.
  static makeAlphanumeric(text) {
    if (!QrSegment.isAlphanumeric(text)) throw new RangeError('String contains unencodable characters in alphanumeric mode');
    const bb = [];
    let i;
    for (i = 0; i + 2 <= text.length; i += 2) { // Process groups of 2
      let temp = ALPHANUMERIC_CHARSET.indexOf(text.charAt(i)) * 45;
      temp += ALPHANUMERIC_CHARSET.indexOf(text.charAt(i + 1));
      appendBits(temp, 11, bb);
    }
    if (i < text.length) appendBits(ALPHANUMERIC_CHARSET.indexOf(text.charAt(i)), 6, bb); // 1 character remaining
    return new QrSegment(Mode.ALPHANUMERIC, text.length, bb);
  }

  // Returns a new list of zero or more segments to represent the given Unicode text string.
  static makeSegments(text) {
    if (text === '') return [];
    if (QrSegment.isNumeric(text)) return [QrSegment.makeNumeric(text)];
    if (QrSegment.isAlphanumeric(text)) return [QrSegment.makeAlphanumeric(text)];
    return [QrSegment.makeBytes(toUtf8ByteArray(text))];
  }

  static isNumeric(text) {
    return NUMERIC_REGEX.test(text);
  }

  static isAlphanumeric(text) {
    return ALPHANUMERIC_REGEX.test(text);
  }

  constructor(mode, numChars, bitData) {
    if (numChars < 0) throw new RangeError('Invalid argument');
    this.mode = mode;
    this.numChars = numChars;
    this.bitData = bitData.slice(); // Make defensive copy
  }

  getData() {
    return this.bitData.slice();
  }

  // Number of bits needed to encode the given segments at the given version.
  // Infinity if a segment has too many characters to fit its length field.
  static getTotalBits(segs, version) {
    let result = 0;
    for (const seg of segs) {
      const ccbits = seg.mode.numCharCountBits(version);
      if (seg.numChars >= (1 << ccbits)) return Infinity;
      result += 4 + ccbits + seg.bitData.length;
    }
    return result;
  }
}

const NUMERIC_REGEX = /^[0-9]*$/;
const ALPHANUMERIC_REGEX = /^[A-Z0-9 $%*+./:-]*$/;
const ALPHANUMERIC_CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

// Returns a new array of bytes representing the given string encoded in UTF-8.
function toUtf8ByteArray(str) {
  str = encodeURI(str);
  const result = [];
  for (let i = 0; i < str.length; i++) {
    if (str.charAt(i) !== '%') result.push(str.charCodeAt(i));
    else {
      result.push(parseInt(str.substring(i + 1, i + 3), 16));
      i += 2;
    }
  }
  return result;
}

// Appends the given number of low-order bits of the given value to the given buffer.
function appendBits(val, len, bb) {
  if (len < 0 || len > 31 || val >>> len !== 0) throw new RangeError('Value out of range');
  for (let i = len - 1; i >= 0; i--) bb.push((val >>> i) & 1);
}

// Returns true iff the i'th bit of x is set to 1.
function getBit(x, i) {
  return ((x >>> i) & 1) !== 0;
}

function assert(cond) {
  if (!cond) throw new Error('Assertion error');
}

/*---- Error correction level ----*/

// The error correction level in a QR Code symbol. Immutable.
export class Ecc {
  constructor(ordinal, formatBits) {
    this.ordinal = ordinal; // 0 to 3
    this.formatBits = formatBits; // 0 to 3
  }
}
Ecc.LOW = new Ecc(0, 1); // tolerates about 7% erroneous codewords
Ecc.MEDIUM = new Ecc(1, 0); // about 15%
Ecc.QUARTILE = new Ecc(2, 3); // about 25%
Ecc.HIGH = new Ecc(3, 2); // about 30%

/*---- QR Code symbol class ----*/

const MIN_VERSION = 1;
const MAX_VERSION = 40;

// For use in getPenaltyScore(), when evaluating which mask is best.
const PENALTY_N1 = 3;
const PENALTY_N2 = 3;
const PENALTY_N3 = 40;
const PENALTY_N4 = 10;

const ECC_CODEWORDS_PER_BLOCK = [
  // Version: (index 0 is for padding, and is set to an illegal value)
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30], // Low
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28], // Medium
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30], // Quartile
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30], // High
];

const NUM_ERROR_CORRECTION_BLOCKS = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25], // Low
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49], // Medium
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68], // Quartile
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81], // High
];

// A QR Code symbol: an immutable square grid of dark and light cells (Model 2, versions 1 to 40).
export class QrCode {
  // Returns a QR Code representing the given Unicode text string at the given error correction level.
  // The smallest possible version is chosen; the ECC level may be raised if it still fits.
  static encodeText(text, ecl) {
    return QrCode.encodeSegments(QrSegment.makeSegments(text), ecl);
  }

  // Returns a QR Code representing the given segments with the given encoding parameters.
  static encodeSegments(segs, ecl, minVersion = 1, maxVersion = 40, mask = -1, boostEcl = true) {
    if (!(MIN_VERSION <= minVersion && minVersion <= maxVersion && maxVersion <= MAX_VERSION) || mask < -1 || mask > 7)
      throw new RangeError('Invalid value');

    // Find the minimal version number to use
    let version;
    let dataUsedBits;
    for (version = minVersion; ; version++) {
      const dataCapacityBits = QrCode.getNumDataCodewords(version, ecl) * 8; // Number of data bits available
      const usedBits = QrSegment.getTotalBits(segs, version);
      if (usedBits <= dataCapacityBits) {
        dataUsedBits = usedBits;
        break; // This version number is found to be suitable
      }
      if (version >= maxVersion) throw new RangeError('Data too long');
    }

    // Increase the error correction level while the data still fits in the current version number
    for (const newEcl of [Ecc.MEDIUM, Ecc.QUARTILE, Ecc.HIGH]) { // From low to high
      if (boostEcl && dataUsedBits <= QrCode.getNumDataCodewords(version, newEcl) * 8) ecl = newEcl;
    }

    // Concatenate all segments to create the data bit string
    const bb = [];
    for (const seg of segs) {
      appendBits(seg.mode.modeBits, 4, bb);
      appendBits(seg.numChars, seg.mode.numCharCountBits(version), bb);
      for (const b of seg.getData()) bb.push(b);
    }
    assert(bb.length === dataUsedBits);

    // Add terminator and pad up to a byte if applicable
    const dataCapacityBits = QrCode.getNumDataCodewords(version, ecl) * 8;
    assert(bb.length <= dataCapacityBits);
    appendBits(0, Math.min(4, dataCapacityBits - bb.length), bb);
    appendBits(0, (8 - (bb.length % 8)) % 8, bb);
    assert(bb.length % 8 === 0);

    // Pad with alternating bytes until data capacity is reached
    for (let padByte = 0xEC; bb.length < dataCapacityBits; padByte ^= 0xEC ^ 0x11) appendBits(padByte, 8, bb);

    // Pack bits into bytes in big endian
    const dataCodewords = [];
    while (dataCodewords.length * 8 < bb.length) dataCodewords.push(0);
    bb.forEach((b, i) => { dataCodewords[i >>> 3] |= b << (7 - (i & 7)); });

    return new QrCode(version, ecl, dataCodewords, mask);
  }

  // Creates a new QR Code with the given version number, error correction level, data codeword bytes
  // and mask number. Low level: most callers use encodeText().
  constructor(version, errorCorrectionLevel, dataCodewords, msk) {
    if (version < MIN_VERSION || version > MAX_VERSION) throw new RangeError('Version value out of range');
    if (msk < -1 || msk > 7) throw new RangeError('Mask value out of range');
    this.version = version;
    this.errorCorrectionLevel = errorCorrectionLevel;
    this.size = version * 4 + 17;

    // Initialize both grids to be size*size arrays of false
    this.modules = []; // false = light, true = dark
    this.isFunction = []; // function modules are not subjected to masking; discarded at the end
    const row = [];
    for (let i = 0; i < this.size; i++) row.push(false);
    for (let i = 0; i < this.size; i++) {
      this.modules.push(row.slice());
      this.isFunction.push(row.slice());
    }

    // Compute ECC, draw modules
    this.drawFunctionPatterns();
    const allCodewords = this.addEccAndInterleave(dataCodewords);
    this.drawCodewords(allCodewords);

    // Do masking
    if (msk === -1) { // Automatically choose best mask
      let minPenalty = 1000000000;
      for (let i = 0; i < 8; i++) {
        this.applyMask(i);
        this.drawFormatBits(i);
        const penalty = this.getPenaltyScore();
        if (penalty < minPenalty) {
          msk = i;
          minPenalty = penalty;
        }
        this.applyMask(i); // Undoes the mask due to XOR
      }
    }
    assert(msk >= 0 && msk <= 7);
    this.mask = msk;
    this.applyMask(msk); // Apply the final choice of mask
    this.drawFormatBits(msk); // Overwrite old format bits

    this.isFunction = [];
  }

  // The color of the module at the given coordinates: false for light, true for dark.
  // The top left corner is (x=0, y=0). Out of bounds is light.
  getModule(x, y) {
    return x >= 0 && x < this.size && y >= 0 && y < this.size && this.modules[y][x];
  }

  /*-- Drawing function modules --*/

  drawFunctionPatterns() {
    // Draw horizontal and vertical timing patterns
    for (let i = 0; i < this.size; i++) {
      this.setFunctionModule(6, i, i % 2 === 0);
      this.setFunctionModule(i, 6, i % 2 === 0);
    }

    // Draw 3 finder patterns (all corners except bottom right; overwrites some timing modules)
    this.drawFinderPattern(3, 3);
    this.drawFinderPattern(this.size - 4, 3);
    this.drawFinderPattern(3, this.size - 4);

    // Draw numerous alignment patterns
    const alignPatPos = this.getAlignmentPatternPositions();
    const numAlign = alignPatPos.length;
    for (let i = 0; i < numAlign; i++) {
      for (let j = 0; j < numAlign; j++) {
        // Don't draw on the three finder corners
        if (!((i === 0 && j === 0) || (i === 0 && j === numAlign - 1) || (i === numAlign - 1 && j === 0)))
          this.drawAlignmentPattern(alignPatPos[i], alignPatPos[j]);
      }
    }

    // Draw configuration data
    this.drawFormatBits(0); // Dummy mask value; overwritten later in the constructor
    this.drawVersion();
  }

  // Draws two copies of the format bits (with their own error correction code).
  drawFormatBits(mask) {
    const data = (this.errorCorrectionLevel.formatBits << 3) | mask; // errCorrLvl is uint2, mask is uint3
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412; // uint15
    assert(bits >>> 15 === 0);

    // Draw first copy
    for (let i = 0; i <= 5; i++) this.setFunctionModule(8, i, getBit(bits, i));
    this.setFunctionModule(8, 7, getBit(bits, 6));
    this.setFunctionModule(8, 8, getBit(bits, 7));
    this.setFunctionModule(7, 8, getBit(bits, 8));
    for (let i = 9; i < 15; i++) this.setFunctionModule(14 - i, 8, getBit(bits, i));

    // Draw second copy
    for (let i = 0; i < 8; i++) this.setFunctionModule(this.size - 1 - i, 8, getBit(bits, i));
    for (let i = 8; i < 15; i++) this.setFunctionModule(8, this.size - 15 + i, getBit(bits, i));
    this.setFunctionModule(8, this.size - 8, true); // Always dark
  }

  // Draws two copies of the version bits (with their own error correction code), iff 7 <= version <= 40.
  drawVersion() {
    if (this.version < 7) return;

    let rem = this.version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
    const bits = (this.version << 12) | rem; // uint18
    assert(bits >>> 18 === 0);

    for (let i = 0; i < 18; i++) {
      const color = getBit(bits, i);
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.setFunctionModule(a, b, color);
      this.setFunctionModule(b, a, color);
    }
  }

  // Draws a 9*9 finder pattern including the border separator, with the center module at (x, y).
  drawFinderPattern(x, y) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy)); // Chebyshev/infinity norm
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && xx < this.size && yy >= 0 && yy < this.size) this.setFunctionModule(xx, yy, dist !== 2 && dist !== 4);
      }
    }
  }

  // Draws a 5*5 alignment pattern, with the center module at (x, y).
  drawAlignmentPattern(x, y) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) this.setFunctionModule(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }

  // Sets the color of a module and marks it as a function module.
  setFunctionModule(x, y, isDark) {
    this.modules[y][x] = isDark;
    this.isFunction[y][x] = true;
  }

  /*-- Codewords and masking --*/

  // Returns the given data with the appropriate error correction codewords appended, interleaved.
  addEccAndInterleave(data) {
    const ver = this.version;
    const ecl = this.errorCorrectionLevel;
    if (data.length !== QrCode.getNumDataCodewords(ver, ecl)) throw new RangeError('Invalid argument');

    // Calculate parameter numbers
    const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[ecl.ordinal][ver];
    const blockEccLen = ECC_CODEWORDS_PER_BLOCK[ecl.ordinal][ver];
    const rawCodewords = Math.floor(QrCode.getNumRawDataModules(ver) / 8);
    const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
    const shortBlockLen = Math.floor(rawCodewords / numBlocks);

    // Split data into blocks and append ECC to each block
    const blocks = [];
    const rsDiv = QrCode.reedSolomonComputeDivisor(blockEccLen);
    for (let i = 0, k = 0; i < numBlocks; i++) {
      const dat = data.slice(k, k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1));
      k += dat.length;
      const ecc = QrCode.reedSolomonComputeRemainder(dat, rsDiv);
      if (i < numShortBlocks) dat.push(0);
      blocks.push(dat.concat(ecc));
    }

    // Interleave (not concatenate) the bytes from every block into a single sequence
    const result = [];
    for (let i = 0; i < blocks[0].length; i++) {
      blocks.forEach((block, j) => {
        // Skip the padding byte in short blocks
        if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) result.push(block[i]);
      });
    }
    assert(result.length === rawCodewords);
    return result;
  }

  // Draws the given sequence of 8-bit codewords onto the entire data area of this QR Code.
  drawCodewords(data) {
    if (data.length !== Math.floor(QrCode.getNumRawDataModules(this.version) / 8)) throw new RangeError('Invalid argument');
    let i = 0; // Bit index into the data
    // Do the funny zigzag scan
    for (let right = this.size - 1; right >= 1; right -= 2) { // Index of right column in each column pair
      if (right === 6) right = 5;
      for (let vert = 0; vert < this.size; vert++) { // Vertical counter
        for (let j = 0; j < 2; j++) {
          const x = right - j; // Actual x coordinate
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? this.size - 1 - vert : vert; // Actual y coordinate
          if (!this.isFunction[y][x] && i < data.length * 8) {
            this.modules[y][x] = getBit(data[i >>> 3], 7 - (i & 7));
            i++;
          }
          // Remainder bits (0 to 7) stay light
        }
      }
    }
    assert(i === data.length * 8);
  }

  // XORs the codeword modules with the given mask pattern. Calling it twice with the same mask undoes it.
  applyMask(mask) {
    if (mask < 0 || mask > 7) throw new RangeError('Mask value out of range');
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        let invert;
        switch (mask) {
          case 0: invert = (x + y) % 2 === 0; break;
          case 1: invert = y % 2 === 0; break;
          case 2: invert = x % 3 === 0; break;
          case 3: invert = (x + y) % 3 === 0; break;
          case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
          case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
          case 7: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; break;
          default: throw new Error('Unreachable');
        }
        if (!this.isFunction[y][x] && invert) this.modules[y][x] = !this.modules[y][x];
      }
    }
  }

  // The penalty score of the current modules, used by the automatic mask choice.
  getPenaltyScore() {
    let result = 0;

    // Adjacent modules in row having same color, and finder-like patterns
    for (let y = 0; y < this.size; y++) {
      let runColor = false;
      let runX = 0;
      const runHistory = [0, 0, 0, 0, 0, 0, 0];
      for (let x = 0; x < this.size; x++) {
        if (this.modules[y][x] === runColor) {
          runX++;
          if (runX === 5) result += PENALTY_N1;
          else if (runX > 5) result++;
        } else {
          this.finderPenaltyAddHistory(runX, runHistory);
          if (!runColor) result += this.finderPenaltyCountPatterns(runHistory) * PENALTY_N3;
          runColor = this.modules[y][x];
          runX = 1;
        }
      }
      result += this.finderPenaltyTerminateAndCount(runColor, runX, runHistory) * PENALTY_N3;
    }
    // Adjacent modules in column having same color, and finder-like patterns
    for (let x = 0; x < this.size; x++) {
      let runColor = false;
      let runY = 0;
      const runHistory = [0, 0, 0, 0, 0, 0, 0];
      for (let y = 0; y < this.size; y++) {
        if (this.modules[y][x] === runColor) {
          runY++;
          if (runY === 5) result += PENALTY_N1;
          else if (runY > 5) result++;
        } else {
          this.finderPenaltyAddHistory(runY, runHistory);
          if (!runColor) result += this.finderPenaltyCountPatterns(runHistory) * PENALTY_N3;
          runColor = this.modules[y][x];
          runY = 1;
        }
      }
      result += this.finderPenaltyTerminateAndCount(runColor, runY, runHistory) * PENALTY_N3;
    }

    // 2*2 blocks of modules having same color
    for (let y = 0; y < this.size - 1; y++) {
      for (let x = 0; x < this.size - 1; x++) {
        const color = this.modules[y][x];
        if (color === this.modules[y][x + 1] && color === this.modules[y + 1][x] && color === this.modules[y + 1][x + 1])
          result += PENALTY_N2;
      }
    }

    // Balance of dark and light modules
    let dark = 0;
    for (const row of this.modules) dark = row.reduce((sum, color) => sum + (color ? 1 : 0), dark);
    const total = this.size * this.size; // size is odd, so dark/total != 1/2
    // Smallest integer k >= 0 such that (45-5k)% <= dark/total <= (55+5k)%
    const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    assert(k >= 0 && k <= 9);
    result += k * PENALTY_N4;
    assert(result >= 0 && result <= 2568888);
    return result;
  }

  /*-- Helper functions --*/

  // Ascending positions of alignment patterns for this version number (used on both axes).
  getAlignmentPatternPositions() {
    if (this.version === 1) return [];
    const numAlign = Math.floor(this.version / 7) + 2;
    const step = Math.floor((this.version * 8 + numAlign * 3 + 5) / (numAlign * 4 - 4)) * 2;
    const result = [6];
    for (let pos = this.size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
    return result;
  }

  // Number of data bits that fit in a QR Code of the given version, after all function modules are excluded.
  static getNumRawDataModules(ver) {
    if (ver < MIN_VERSION || ver > MAX_VERSION) throw new RangeError('Version number out of range');
    let result = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      const numAlign = Math.floor(ver / 7) + 2;
      result -= (25 * numAlign - 10) * numAlign - 55;
      if (ver >= 7) result -= 36;
    }
    assert(result >= 208 && result <= 29648);
    return result;
  }

  // Number of 8-bit data (not error correction) codewords in any QR Code of the given version and level.
  static getNumDataCodewords(ver, ecl) {
    return Math.floor(QrCode.getNumRawDataModules(ver) / 8) -
      ECC_CODEWORDS_PER_BLOCK[ecl.ordinal][ver] * NUM_ERROR_CORRECTION_BLOCKS[ecl.ordinal][ver];
  }

  // Returns a Reed-Solomon ECC generator polynomial for the given degree.
  static reedSolomonComputeDivisor(degree) {
    if (degree < 1 || degree > 255) throw new RangeError('Degree out of range');
    // Coefficients are stored from highest to lowest power, excluding the leading term which is always 1.
    const result = [];
    for (let i = 0; i < degree - 1; i++) result.push(0);
    result.push(1); // Start off with the monomial x^0

    // Compute the product (x - r^0) * (x - r^1) * ... * (x - r^{degree-1}), dropping the 1x^degree term.
    // r = 0x02, a generator element of GF(2^8/0x11D).
    let root = 1;
    for (let i = 0; i < degree; i++) {
      for (let j = 0; j < result.length; j++) {
        result[j] = QrCode.reedSolomonMultiply(result[j], root);
        if (j + 1 < result.length) result[j] ^= result[j + 1];
      }
      root = QrCode.reedSolomonMultiply(root, 0x02);
    }
    return result;
  }

  // Returns the Reed-Solomon error correction codewords for the given data and divisor polynomials.
  static reedSolomonComputeRemainder(data, divisor) {
    const result = divisor.map(() => 0);
    for (const b of data) { // Polynomial division
      const factor = b ^ result.shift();
      result.push(0);
      divisor.forEach((coef, i) => { result[i] ^= QrCode.reedSolomonMultiply(coef, factor); });
    }
    return result;
  }

  // Product of two field elements modulo GF(2^8/0x11D); arguments and result are unsigned 8-bit integers.
  static reedSolomonMultiply(x, y) {
    if (x >>> 8 !== 0 || y >>> 8 !== 0) throw new RangeError('Byte out of range');
    // Russian peasant multiplication
    let z = 0;
    for (let i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11D);
      z ^= ((y >>> i) & 1) * x;
    }
    assert(z >>> 8 === 0);
    return z;
  }

  // Can only be called immediately after a light run is added; returns 0, 1 or 2.
  finderPenaltyCountPatterns(runHistory) {
    const n = runHistory[1];
    assert(n <= this.size * 3);
    const core = n > 0 && runHistory[2] === n && runHistory[3] === n * 3 && runHistory[4] === n && runHistory[5] === n;
    return (core && runHistory[0] >= n * 4 && runHistory[6] >= n ? 1 : 0) +
      (core && runHistory[6] >= n * 4 && runHistory[0] >= n ? 1 : 0);
  }

  // Must be called at the end of a line (row or column) of modules.
  finderPenaltyTerminateAndCount(currentRunColor, currentRunLength, runHistory) {
    if (currentRunColor) { // Terminate dark run
      this.finderPenaltyAddHistory(currentRunLength, runHistory);
      currentRunLength = 0;
    }
    currentRunLength += this.size; // Add light border to final run
    this.finderPenaltyAddHistory(currentRunLength, runHistory);
    return this.finderPenaltyCountPatterns(runHistory);
  }

  // Pushes the given value to the front and drops the last value.
  finderPenaltyAddHistory(currentRunLength, runHistory) {
    if (runHistory[0] === 0) currentRunLength += this.size; // Add light border to initial run
    runHistory.pop();
    runHistory.unshift(currentRunLength);
  }
}

/*---- Ours: drawing the code as SVG ----*/

// An <svg> string for the text at error correction M: a white square with the dark modules as one <path>.
// `border` is the quiet zone in modules (the QR standard asks for 4).
export function qrSvg(text, { border = 4 } = {}) {
  const qr = QrCode.encodeText(text, Ecc.MEDIUM);
  const parts = [];
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (qr.getModule(x, y)) parts.push(`M${x + border},${y + border}h1v1h-1z`);
    }
  }
  const side = qr.size + border * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}" shape-rendering="crispEdges">` +
    `<rect width="100%" height="100%" fill="#fff"/><path d="${parts.join(' ')}" fill="#000"/></svg>`;
}
