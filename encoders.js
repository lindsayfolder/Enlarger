/* Enlarger encoders: baseline JPEG and PNG written in plain JavaScript.
   Used when the browser cannot hold the whole picture in one canvas
   (iPhone and iPad Safari limit a canvas to about 16.7 megapixels).
   Both write the print resolution (ppi) into the file. */
(function (root) {
  'use strict';

  const ZZ = [0,1,5,6,14,15,27,28,2,4,7,13,16,26,29,42,3,8,12,17,25,30,41,43,9,11,18,24,31,40,44,53,10,19,23,32,39,45,52,54,20,22,33,38,46,51,55,60,21,34,37,47,50,56,59,61,35,36,48,49,57,58,62,63];
  const YQT = [16,11,10,16,24,40,51,61,12,12,14,19,26,58,60,55,14,13,16,24,40,57,69,56,14,17,22,29,51,87,80,62,18,22,37,56,68,109,103,77,24,35,55,64,81,104,113,92,49,64,78,87,103,121,120,101,72,92,95,98,112,100,103,99];
  const UVQT = [17,18,24,47,99,99,99,99,18,21,26,66,99,99,99,99,24,26,56,99,99,99,99,99,47,66,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99];
  const AASF = [1.0,1.387039845,1.306562965,1.175875602,1.0,0.785694958,0.5411961,0.275899379];

  const DC_LUM_N = [0,0,1,5,1,1,1,1,1,1,0,0,0,0,0,0,0];
  const DC_LUM_V = [0,1,2,3,4,5,6,7,8,9,10,11];
  const AC_LUM_N = [0,0,2,1,3,3,2,4,3,5,5,4,4,0,0,1,0x7d];
  const AC_LUM_V = [0x01,0x02,0x03,0x00,0x04,0x11,0x05,0x12,0x21,0x31,0x41,0x06,0x13,0x51,0x61,0x07,0x22,0x71,0x14,0x32,0x81,0x91,0xa1,0x08,0x23,0x42,0xb1,0xc1,0x15,0x52,0xd1,0xf0,0x24,0x33,0x62,0x72,0x82,0x09,0x0a,0x16,0x17,0x18,0x19,0x1a,0x25,0x26,0x27,0x28,0x29,0x2a,0x34,0x35,0x36,0x37,0x38,0x39,0x3a,0x43,0x44,0x45,0x46,0x47,0x48,0x49,0x4a,0x53,0x54,0x55,0x56,0x57,0x58,0x59,0x5a,0x63,0x64,0x65,0x66,0x67,0x68,0x69,0x6a,0x73,0x74,0x75,0x76,0x77,0x78,0x79,0x7a,0x83,0x84,0x85,0x86,0x87,0x88,0x89,0x8a,0x92,0x93,0x94,0x95,0x96,0x97,0x98,0x99,0x9a,0xa2,0xa3,0xa4,0xa5,0xa6,0xa7,0xa8,0xa9,0xaa,0xb2,0xb3,0xb4,0xb5,0xb6,0xb7,0xb8,0xb9,0xba,0xc2,0xc3,0xc4,0xc5,0xc6,0xc7,0xc8,0xc9,0xca,0xd2,0xd3,0xd4,0xd5,0xd6,0xd7,0xd8,0xd9,0xda,0xe1,0xe2,0xe3,0xe4,0xe5,0xe6,0xe7,0xe8,0xe9,0xea,0xf1,0xf2,0xf3,0xf4,0xf5,0xf6,0xf7,0xf8,0xf9,0xfa];
  const DC_CHR_N = [0,0,3,1,1,1,1,1,1,1,1,1,0,0,0,0,0];
  const DC_CHR_V = [0,1,2,3,4,5,6,7,8,9,10,11];
  const AC_CHR_N = [0,0,2,1,2,4,4,3,4,7,5,4,4,0,1,2,0x77];
  const AC_CHR_V = [0x00,0x01,0x02,0x03,0x11,0x04,0x05,0x21,0x31,0x06,0x12,0x41,0x51,0x07,0x61,0x71,0x13,0x22,0x32,0x81,0x08,0x14,0x42,0x91,0xa1,0xb1,0xc1,0x09,0x23,0x33,0x52,0xf0,0x15,0x62,0x72,0xd1,0x0a,0x16,0x24,0x34,0xe1,0x25,0xf1,0x17,0x18,0x19,0x1a,0x26,0x27,0x28,0x29,0x2a,0x35,0x36,0x37,0x38,0x39,0x3a,0x43,0x44,0x45,0x46,0x47,0x48,0x49,0x4a,0x53,0x54,0x55,0x56,0x57,0x58,0x59,0x5a,0x63,0x64,0x65,0x66,0x67,0x68,0x69,0x6a,0x73,0x74,0x75,0x76,0x77,0x78,0x79,0x7a,0x82,0x83,0x84,0x85,0x86,0x87,0x88,0x89,0x8a,0x92,0x93,0x94,0x95,0x96,0x97,0x98,0x99,0x9a,0xa2,0xa3,0xa4,0xa5,0xa6,0xa7,0xa8,0xa9,0xaa,0xb2,0xb3,0xb4,0xb5,0xb6,0xb7,0xb8,0xb9,0xba,0xc2,0xc3,0xc4,0xc5,0xc6,0xc7,0xc8,0xc9,0xca,0xd2,0xd3,0xd4,0xd5,0xd6,0xd7,0xd8,0xd9,0xda,0xe2,0xe3,0xe4,0xe5,0xe6,0xe7,0xe8,0xe9,0xea,0xf2,0xf3,0xf4,0xf5,0xf6,0xf7,0xf8,0xf9,0xfa];

  function huffTable(n, v) {
    const codes = new Uint16Array(256), lens = new Uint8Array(256);
    let code = 0, p = 0;
    for (let k = 1; k <= 16; k++) {
      for (let j = 0; j < n[k]; j++) { codes[v[p]] = code; lens[v[p]] = k; p++; code++; }
      code <<= 1;
    }
    return { codes, lens };
  }
  const HT = {
    ydc: huffTable(DC_LUM_N, DC_LUM_V), yac: huffTable(AC_LUM_N, AC_LUM_V),
    cdc: huffTable(DC_CHR_N, DC_CHR_V), cac: huffTable(AC_CHR_N, AC_CHR_V)
  };

  // category (bit size) and bit pattern for every value in -32767..32767
  const CAT = new Uint8Array(65535), BITS = new Uint16Array(65535);
  (function () {
    let lower = 1, upper = 2;
    for (let cat = 1; cat <= 15; cat++) {
      for (let nr = lower; nr < upper; nr++) { CAT[32767 + nr] = cat; BITS[32767 + nr] = nr; }
      for (let nr = -(upper - 1); nr <= -lower; nr++) { CAT[32767 + nr] = cat; BITS[32767 + nr] = upper - 1 + nr; }
      lower <<= 1; upper <<= 1;
    }
  })();

  class ByteOut {
    constructor(size) { this.buf = new Uint8Array(size); this.len = 0; this.bitBuf = 0; this.bitCnt = 0; }
    grow(n) {
      if (this.len + n <= this.buf.length) return;
      let s = this.buf.length * 2; while (s < this.len + n) s *= 2;
      const b = new Uint8Array(s); b.set(this.buf.subarray(0, this.len)); this.buf = b;
    }
    byte(b) { this.grow(1); this.buf[this.len++] = b; }
    word(w) { this.byte((w >> 8) & 255); this.byte(w & 255); }
    bytes(arr) { this.grow(arr.length); this.buf.set(arr, this.len); this.len += arr.length; }
    bits(code, n) {
      this.bitBuf = (this.bitBuf << n) | (code & ((1 << n) - 1));
      this.bitCnt += n;
      while (this.bitCnt >= 8) {
        const b = (this.bitBuf >> (this.bitCnt - 8)) & 255;
        this.byte(b); if (b === 255) this.byte(0);
        this.bitCnt -= 8;
      }
      this.bitBuf &= (1 << this.bitCnt) - 1;
    }
    flushBits() { if (this.bitCnt > 0) this.bits((1 << (8 - this.bitCnt)) - 1, 8 - this.bitCnt); }
    result() { return this.buf.subarray(0, this.len); }
  }

  function quantTables(quality) {
    quality = Math.max(1, Math.min(100, Math.round(quality)));
    const sf = quality < 50 ? Math.floor(5000 / quality) : Math.floor(200 - quality * 2);
    const yt = new Uint8Array(64), ut = new Uint8Array(64);
    for (let i = 0; i < 64; i++) {
      yt[ZZ[i]] = Math.min(255, Math.max(1, Math.floor((YQT[i] * sf + 50) / 100)));
      ut[ZZ[i]] = Math.min(255, Math.max(1, Math.floor((UVQT[i] * sf + 50) / 100)));
    }
    const fy = new Float32Array(64), fu = new Float32Array(64);
    let k = 0;
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      fy[k] = 1 / (yt[ZZ[k]] * AASF[r] * AASF[c] * 8);
      fu[k] = 1 / (ut[ZZ[k]] * AASF[r] * AASF[c] * 8);
      k++;
    }
    return { yt, ut, fy, fu };
  }

  function fdct(d) {
    for (let o = 0; o < 64; o += 8) {
      const t0 = d[o] + d[o + 7], t7 = d[o] - d[o + 7], t1 = d[o + 1] + d[o + 6], t6 = d[o + 1] - d[o + 6];
      const t2 = d[o + 2] + d[o + 5], t5 = d[o + 2] - d[o + 5], t3 = d[o + 3] + d[o + 4], t4 = d[o + 3] - d[o + 4];
      let a = t0 + t3, b = t0 - t3, c = t1 + t2, e = t1 - t2;
      d[o] = a + c; d[o + 4] = a - c;
      const z1 = (e + b) * 0.707106781; d[o + 2] = b + z1; d[o + 6] = b - z1;
      a = t4 + t5; c = t5 + t6; e = t6 + t7;
      const z5 = (a - e) * 0.382683433, z2 = 0.5411961 * a + z5, z4 = 1.306562965 * e + z5, z3 = c * 0.707106781;
      const z11 = t7 + z3, z13 = t7 - z3;
      d[o + 5] = z13 + z2; d[o + 3] = z13 - z2; d[o + 1] = z11 + z4; d[o + 7] = z11 - z4;
    }
    for (let o = 0; o < 8; o++) {
      const t0 = d[o] + d[o + 56], t7 = d[o] - d[o + 56], t1 = d[o + 8] + d[o + 48], t6 = d[o + 8] - d[o + 48];
      const t2 = d[o + 16] + d[o + 40], t5 = d[o + 16] - d[o + 40], t3 = d[o + 24] + d[o + 32], t4 = d[o + 24] - d[o + 32];
      let a = t0 + t3, b = t0 - t3, c = t1 + t2, e = t1 - t2;
      d[o] = a + c; d[o + 32] = a - c;
      const z1 = (e + b) * 0.707106781; d[o + 16] = b + z1; d[o + 48] = b - z1;
      a = t4 + t5; c = t5 + t6; e = t6 + t7;
      const z5 = (a - e) * 0.382683433, z2 = 0.5411961 * a + z5, z4 = 1.306562965 * e + z5, z3 = c * 0.707106781;
      const z11 = t7 + z3, z13 = t7 - z3;
      d[o + 40] = z13 + z2; d[o + 24] = z13 - z2; d[o + 8] = z11 + z4; d[o + 56] = z11 - z4;
    }
  }

  const DU = new Int32Array(64);
  function block(out, data, ftbl, dcPrev, dc, ac) {
    fdct(data);
    for (let i = 0; i < 64; i++) {
      const v = data[i] * ftbl[i];
      DU[ZZ[i]] = v > 0 ? (v + 0.5) | 0 : (v - 0.5) | 0;
    }
    const diff = DU[0] - dcPrev;
    if (diff === 0) out.bits(dc.codes[0], dc.lens[0]);
    else { const p = 32767 + diff, cat = CAT[p]; out.bits(dc.codes[cat], dc.lens[cat]); out.bits(BITS[p], cat); }
    let end = 63; while (end > 0 && DU[end] === 0) end--;
    if (end === 0) { out.bits(ac.codes[0], ac.lens[0]); return DU[0]; }
    let i = 1;
    while (i <= end) {
      const start = i;
      while (DU[i] === 0 && i <= end) i++;
      let zeros = i - start;
      if (zeros >= 16) { const n = zeros >> 4; for (let k = 0; k < n; k++) out.bits(ac.codes[0xf0], ac.lens[0xf0]); zeros &= 15; }
      const p = 32767 + DU[i], cat = CAT[p], sym = (zeros << 4) + cat;
      out.bits(ac.codes[sym], ac.lens[sym]); out.bits(BITS[p], cat);
      i++;
    }
    if (end !== 63) out.bits(ac.codes[0], ac.lens[0]);
    return DU[0];
  }

  function writeDHT(out, n, v, cls) {
    out.byte(cls);
    for (let k = 1; k <= 16; k++) out.byte(n[k]);
    for (let j = 0; j < v.length; j++) out.byte(v[j]);
  }

  // rgba: Uint8Array/Uint8ClampedArray (w*h*4). quality 1-100. dpi written to JFIF header.
  async function encodeJPEG(rgba, w, h, quality, dpi, onProgress) {
    const q = quantTables(quality);
    const out = new ByteOut(Math.max(1 << 20, Math.floor(w * h * 0.6)));
    out.word(0xffd8);
    out.word(0xffe0); out.word(16); out.bytes([0x4a, 0x46, 0x49, 0x46, 0]); out.byte(1); out.byte(2);
    out.byte(1); out.word(dpi || 72); out.word(dpi || 72); out.byte(0); out.byte(0);
    out.word(0xffdb); out.word(132);
    out.byte(0); for (let i = 0; i < 64; i++) out.byte(q.yt[i]);
    out.byte(1); for (let i = 0; i < 64; i++) out.byte(q.ut[i]);
    out.word(0xffc0); out.word(17); out.byte(8); out.word(h); out.word(w); out.byte(3);
    out.byte(1); out.byte(0x11); out.byte(0); out.byte(2); out.byte(0x11); out.byte(1); out.byte(3); out.byte(0x11); out.byte(1);
    out.word(0xffc4); out.word(0x01a2);
    writeDHT(out, DC_LUM_N, DC_LUM_V, 0x00); writeDHT(out, AC_LUM_N, AC_LUM_V, 0x10);
    writeDHT(out, DC_CHR_N, DC_CHR_V, 0x01); writeDHT(out, AC_CHR_N, AC_CHR_V, 0x11);
    out.word(0xffda); out.word(12); out.byte(3); out.byte(1); out.byte(0); out.byte(2); out.byte(0x11); out.byte(3); out.byte(0x11);
    out.byte(0); out.byte(0x3f); out.byte(0);

    const Y = new Float32Array(64), U = new Float32Array(64), V = new Float32Array(64);
    let dcy = 0, dcu = 0, dcv = 0;
    const rowsOfBlocks = Math.ceil(h / 8);
    let lastYield = performance.now();
    for (let by = 0; by < h; by += 8) {
      for (let bx = 0; bx < w; bx += 8) {
        for (let k = 0; k < 64; k++) {
          const yy = Math.min(h - 1, by + (k >> 3)), xx = Math.min(w - 1, bx + (k & 7));
          const p = (yy * w + xx) * 4, r = rgba[p], g = rgba[p + 1], b = rgba[p + 2];
          Y[k] = 0.299 * r + 0.587 * g + 0.114 * b - 128;
          U[k] = -0.16874 * r - 0.33126 * g + 0.5 * b;
          V[k] = 0.5 * r - 0.41869 * g - 0.08131 * b;
        }
        dcy = block(out, Y, q.fy, dcy, HT.ydc, HT.yac);
        dcu = block(out, U, q.fu, dcu, HT.cdc, HT.cac);
        dcv = block(out, V, q.fu, dcv, HT.cdc, HT.cac);
      }
      const now = performance.now();
      if (now - lastYield > 60) {
        lastYield = now;
        if (onProgress) onProgress((by / 8 + 1) / rowsOfBlocks);
        await new Promise(r => setTimeout(r, 0));
      }
    }
    out.flushBits();
    out.word(0xffd9);
    if (onProgress) onProgress(1);
    return out.result();
  }

  // ---------- PNG ----------
  const CRC = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; }
  function crc32(parts) {
    let c = 0xffffffff;
    for (const a of parts) for (let i = 0; i < a.length; i++) c = CRC[(c ^ a[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function chunk(type, data) {
    const t = new TextEncoder().encode(type);
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length); out.set(t, 4); out.set(data, 8);
    dv.setUint32(8 + data.length, crc32([t, data]));
    return out;
  }
  function physChunk(dpi) {
    const d = new Uint8Array(9), dv = new DataView(d.buffer), ppm = Math.round(dpi / 0.0254);
    dv.setUint32(0, ppm); dv.setUint32(4, ppm); d[8] = 1;
    return chunk('pHYs', d);
  }

  async function encodePNG(rgba, w, h, dpi, onProgress) {
    if (typeof CompressionStream === 'undefined') throw new Error('This browser cannot build large PNG files. Choose JPEG instead.');
    const cs = new CompressionStream('deflate');
    const writer = cs.writable.getWriter();
    const reader = cs.readable.getReader();
    const parts = [];
    const reading = (async () => { for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); } })();
    const row = new Uint8Array(1 + w * 3);
    let lastYield = performance.now();
    for (let y = 0; y < h; y++) {
      row[0] = 1; // Sub filter
      let p = y * w * 4;
      let pr = 0, pg = 0, pb = 0;
      for (let x = 0, o = 1; x < w; x++, p += 4, o += 3) {
        const r = rgba[p], g = rgba[p + 1], b = rgba[p + 2];
        row[o] = (r - pr) & 255; row[o + 1] = (g - pg) & 255; row[o + 2] = (b - pb) & 255;
        pr = r; pg = g; pb = b;
      }
      await writer.write(row.slice());
      const now = performance.now();
      if (now - lastYield > 60) { lastYield = now; if (onProgress) onProgress(y / h); }
    }
    await writer.close();
    await reading;
    const ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer);
    dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    const out = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), physChunk(dpi || 72)];
    for (const p of parts) out.push(chunk('IDAT', p));
    out.push(chunk('IEND', new Uint8Array(0)));
    if (onProgress) onProgress(1);
    return out;
  }

  // ---------- write ppi into files made by the browser ----------
  function setJpegDpi(bytes, dpi) {
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes;
    if (bytes[2] === 0xff && bytes[3] === 0xe0 && bytes[6] === 0x4a && bytes[7] === 0x46 && bytes[8] === 0x49 && bytes[9] === 0x46) {
      const b = bytes.slice();
      b[13] = 1; b[14] = dpi >> 8; b[15] = dpi & 255; b[16] = dpi >> 8; b[17] = dpi & 255;
      return b;
    }
    const app0 = new Uint8Array([0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 2, 1, dpi >> 8, dpi & 255, dpi >> 8, dpi & 255, 0, 0]);
    const b = new Uint8Array(bytes.length + app0.length);
    b.set(bytes.subarray(0, 2), 0); b.set(app0, 2); b.set(bytes.subarray(2), 2 + app0.length);
    return b;
  }

  function setPngDpi(bytes, dpi) {
    // insert pHYs right after IHDR (offset 33) unless one exists
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let off = 8;
    while (off + 8 <= bytes.length) {
      const len = dv.getUint32(off);
      const type = String.fromCharCode(bytes[off + 4], bytes[off + 5], bytes[off + 6], bytes[off + 7]);
      if (type === 'pHYs') {
        const b = bytes.slice(), d = new DataView(b.buffer), ppm = Math.round(dpi / 0.0254);
        d.setUint32(off + 8, ppm); d.setUint32(off + 12, ppm); b[off + 16] = 1;
        d.setUint32(off + 17, crc32([b.subarray(off + 4, off + 17)]));
        return b;
      }
      if (type === 'IDAT') break;
      off += 12 + len;
    }
    const ph = physChunk(dpi);
    const b = new Uint8Array(bytes.length + ph.length);
    b.set(bytes.subarray(0, 33), 0); b.set(ph, 33); b.set(bytes.subarray(33), 33 + ph.length);
    return b;
  }

  root.EnlargerEncoders = { encodeJPEG, encodePNG, setJpegDpi, setPngDpi };
})(typeof self !== 'undefined' ? self : globalThis);
