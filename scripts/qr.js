// npm run qr -- https://domain.ru   → qr.png со ссылкой на сайт
// npm run qr                        → ссылка из docs/CNAME, иначе t.me/<бот> по TELEGRAM_BOT_TOKEN
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
console.log(`qr.png → ${url}`);
