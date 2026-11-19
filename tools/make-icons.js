/* Draws the app icon (three linked timeline dots on a dark red square) and writes PNG files. Run: node tools/make-icons.js */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) { c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; }
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) { c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, crc]);
}

// Distance from point to segment
function segDist(x, y, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}

// Shape in 0..1 coordinates, inside the maskable safe zone
const dots = [[0.3, 0.66], [0.5, 0.42], [0.7, 0.58]];
function shade(x, y) {
  for (let i = 0; i < dots.length; i++) {
    const d = Math.hypot(x - dots[i][0], y - dots[i][1]);
    if (d <= 0.075) { return i === dots.length - 1 ? 'gold' : 'white'; }
  }
  for (let i = 0; i < dots.length - 1; i++) {
    if (segDist(x, y, dots[i][0], dots[i][1], dots[i + 1][0], dots[i + 1][1]) <= 0.022) { return 'white'; }
  }
  return null;
}

function png(size) {
  const bg = [122, 46, 42], colors = { white: [255, 248, 238], gold: [232, 182, 92] }, ss = 3;
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let py = 0; py < size; py++) {
    const row = py * (size * 3 + 1);
    for (let px = 0; px < size; px++) {
      const acc = [0, 0, 0];
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const s = shade((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size);
          const c = s ? colors[s] : bg;
          acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2];
        }
      }
      for (let c = 0; c < 3; c++) { raw[row + 1 + px * 3 + c] = Math.round(acc[c] / (ss * ss)); }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))
  ]);
}

const out = path.join(__dirname, '..', 'icons');
fs.mkdirSync(out, { recursive: true });
for (const size of [192, 512]) {
  fs.writeFileSync(path.join(out, `icon-${size}.png`), png(size));
  console.log(`icon-${size}.png`);
}
