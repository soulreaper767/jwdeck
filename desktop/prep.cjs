// Copies the server, its runtime dependencies and the built web UI into desktop/app for packaging.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { execSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const app = path.join(__dirname, 'app');

fs.rmSync(app, { recursive: true, force: true });
fs.mkdirSync(app, { recursive: true });

// fresh UI build
execSync('npx vite build', { cwd: path.join(root, 'client'), stdio: 'inherit' });

const copy = (from, to) => fs.cpSync(from, to, { recursive: true });
copy(path.join(root, 'server', 'src'), path.join(app, 'server', 'src'));
fs.copyFileSync(path.join(root, 'server', 'package.json'), path.join(app, 'server', 'package.json'));
copy(path.join(root, 'server', 'node_modules'), path.join(app, 'server', 'node_modules'));
copy(path.join(root, 'client', 'dist'), path.join(app, 'client', 'dist'));

// app icon: black square with "JW" in white blocks (no image tooling needed)
function icon(size) {
  const font = {
    J: ['00111', '00010', '00010', '00010', '10010', '10010', '01100'],
    W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  };
  const px = Buffer.alloc(size * size * 4, 0);
  const set = (x, y, v) => { const i = (y * size + x) * 4; px[i] = px[i + 1] = px[i + 2] = v; px[i + 3] = 255; };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) set(x, y, 0);
  const cell = Math.floor(size / 16);
  const text = 'JW';
  const w = text.length * 5 * cell + (text.length - 1) * cell;
  let ox = Math.floor((size - w) / 2);
  const oy = Math.floor((size - 7 * cell) / 2);
  for (const ch of text) {
    font[ch].forEach((row, ry) => [...row].forEach((b, rx) => {
      if (b === '1') for (let dy = 0; dy < cell; dy++) for (let dx = 0; dx < cell; dx++) set(ox + rx * cell + dx, oy + ry * cell + dy, 255);
    }));
    ox += 6 * cell;
  }
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const png = icon(256);
fs.writeFileSync(path.join(app, 'icon.png'), png);
fs.writeFileSync(path.join(__dirname, 'icon.png'), png);
console.log('desktop/app ready');
