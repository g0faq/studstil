// npm run qr [-- https://domain.ru] → qr.png (для печати) и docs/img/qr.svg (для админ-панели)
import fs from 'node:fs';
import QRCode from 'qrcode';
import { config } from '../src/config.js';

let url = process.argv[2];
if (!url && fs.existsSync('docs/CNAME')) url = 'https://' + fs.readFileSync('docs/CNAME', 'utf8').trim();
if (!url && config.telegramToken) {
  const r = await fetch(`https://api.telegram.org/bot${config.telegramToken}/getMe`).then((x) => x.json());
  if (r.ok) url = `https://t.me/${r.result.username}`;
}
if (!url) { console.error('Укажите ссылку: npm run qr -- https://domain.ru'); process.exit(1); }
if (!/^https?:\/\//.test(url)) url = 'https://' + url;

await QRCode.toFile('qr.png', url, { width: 1000, margin: 2 });

// SVG в стиле сайта: тёмный фон, оранжевые модули со скруглением
const svg = (await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }))
  .replace(/<svg([^>]*)>/, '<svg$1 role="img" aria-label="QR-код на сайт">')
  .replace(/fill="#ffffff"/g, 'fill="none"')
  .replace(/fill="#000000"/g, 'fill="currentColor"')
  .replace(/stroke="#000000"/g, 'stroke="currentColor"')
  .replace(/shape-rendering="crispEdges"/g, '');
fs.mkdirSync('docs/img', { recursive: true });
fs.writeFileSync('docs/img/qr.svg', svg);
console.log(`qr.png и docs/img/qr.svg → ${url}`);
