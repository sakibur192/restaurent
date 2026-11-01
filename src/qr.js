// High-quality square QR codes at an exact physical size: PNG (with DPI metadata), SVG (vector) or PDF (print-ready), plus a simple ZIP writer.
const QRCode = require('qrcode');
const { PNG } = require('pngjs');
const zlib = require('zlib');

const UNITS = { mm: 1 / 25.4, cm: 1 / 2.54, in: 1 };
function toInches(size, unit) { return Number(size) * (UNITS[unit] || UNITS.cm); }

// CRC32 (for PNG chunks and ZIP entries)
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

function matrix(text, ecl) {
  const q = QRCode.create(text, { errorCorrectionLevel: ['L', 'M', 'Q', 'H'].includes(ecl) ? ecl : 'M' });
  return { n: q.modules.size, get: (x, y) => q.modules.get(y, x) };
}
function parseColor(hex, def) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '')); const h = m ? m[1] : def;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

// opts: { size, unit, dpi, margin (modules), ecl, fg, bg }
function png(text, opts) {
  const m = matrix(text, opts.ecl);
  const margin = Math.max(0, Math.min(10, opts.margin ?? 2));
  const total = m.n + margin * 2;
  const dpi = Math.max(72, Math.min(1200, Number(opts.dpi) || 300));
  let px = Math.round(toInches(opts.size, opts.unit) * dpi);
  px = Math.max(total, Math.min(12000, px));
  const fg = parseColor(opts.fg, '000000'), bg = parseColor(opts.bg, 'ffffff');
  const img = new PNG({ width: px, height: px, colorType: 2 });
  const col = new Int32Array(px); for (let i = 0; i < px; i++) col[i] = Math.floor(i * total / px) - margin;   // pixel → module index
  for (let y = 0; y < px; y++) {
    const my = col[y];
    for (let x = 0; x < px; x++) {
      const mx = col[x];
      const dark = mx >= 0 && my >= 0 && mx < m.n && my < m.n && m.get(mx, my);
      const c = dark ? fg : bg; const o = (y * px + x) << 2;
      img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
    }
  }
  const buf = PNG.sync.write(img, { colorType: 2 });
  // insert pHYs chunk so printers/Photoshop know the real size
  const ppm = Math.round(dpi / 0.0254);
  const data = Buffer.alloc(9); data.writeUInt32BE(ppm, 0); data.writeUInt32BE(ppm, 4); data[8] = 1;
  const type = Buffer.from('pHYs');
  const chunk = Buffer.concat([Buffer.alloc(4), type, data, Buffer.alloc(4)]);
  chunk.writeUInt32BE(9, 0); chunk.writeUInt32BE(crc32(Buffer.concat([type, data])), 17);
  const ihdrEnd = 8 + 25;
  return { buffer: Buffer.concat([buf.slice(0, ihdrEnd), chunk, buf.slice(ihdrEnd)]), px, dpi };
}

function runs(m, cb) {   // merge horizontal dark modules into rectangles
  for (let y = 0; y < m.n; y++) { let x = 0; while (x < m.n) { if (m.get(x, y)) { let w = 1; while (x + w < m.n && m.get(x + w, y)) w++; cb(x, y, w); x += w; } else x++; } }
}
function svg(text, opts) {
  const m = matrix(text, opts.ecl); const margin = Math.max(0, Math.min(10, opts.margin ?? 2)); const total = m.n + margin * 2;
  const u = ['mm', 'cm', 'in'].includes(opts.unit) ? opts.unit : 'cm'; const size = Number(opts.size) || 5;
  const fg = '#' + parseColor(opts.fg, '000000').map(v => v.toString(16).padStart(2, '0')).join('');
  const bg = '#' + parseColor(opts.bg, 'ffffff').map(v => v.toString(16).padStart(2, '0')).join('');
  let d = ''; runs(m, (x, y, w) => { d += `M${x + margin} ${y + margin}h${w}v1h-${w}z`; });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${size}${u}" height="${size}${u}" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="${bg}"/><path fill="${fg}" d="${d}"/></svg>`;
}
function pdf(text, opts) {
  const m = matrix(text, opts.ecl); const margin = Math.max(0, Math.min(10, opts.margin ?? 2)); const total = m.n + margin * 2;
  const pt = toInches(opts.size, opts.unit) * 72; const s = pt / total;
  const f = parseColor(opts.fg, '000000').map(v => (v / 255).toFixed(3)).join(' '), b = parseColor(opts.bg, 'ffffff').map(v => (v / 255).toFixed(3)).join(' ');
  let ops = `${b} rg 0 0 ${pt.toFixed(3)} ${pt.toFixed(3)} re f\n${f} rg\n`;
  runs(m, (x, y, w) => { ops += `${((x + margin) * s).toFixed(3)} ${(pt - (y + margin + 1) * s).toFixed(3)} ${(w * s).toFixed(3)} ${s.toFixed(3)} re\n`; });
  ops += 'f\n';
  const content = zlib.deflateSync(Buffer.from(ops));
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pt.toFixed(3)} ${pt.toFixed(3)}] /Contents 4 0 R /Resources << >> >>`,
    null
  ];
  const parts = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'binary')]; const offsets = []; let len = parts[0].length;
  objs.forEach((o, i) => {
    offsets.push(len);
    const buf = o === null ? Buffer.concat([Buffer.from(`${i + 1} 0 obj\n<< /Length ${content.length} /Filter /FlateDecode >>\nstream\n`), content, Buffer.from('\nendstream\nendobj\n')]) : Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`);
    parts.push(buf); len += buf.length;
  });
  const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${len}\n%%EOF`;
  parts.push(Buffer.from(xref)); return Buffer.concat(parts);
}

// minimal ZIP (store, no compression — QR files are already compact)
function zip(files) {
  const local = [], central = []; let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8'); const data = f.data; const crc = crc32(data);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(0, 8);
    h.writeUInt32LE(0, 10); h.writeUInt32LE(crc, 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(name.length, 26); h.writeUInt16LE(0, 28);
    local.push(h, name, data);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(0, 10);
    c.writeUInt32LE(0, 12); c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(offset, 42); central.push(c, name);
    offset += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(central); const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
}

module.exports = { png, svg, pdf, zip, toInches };
