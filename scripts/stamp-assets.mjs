/**
 * Проставляет версию во все ссылки на свои css/js в html-файлах.
 * Без этого браузер может взять из кэша старый app.js вместе с новым styles.css —
 * и страница ломается на полпути. Запускается при публикации сайта, исходники не трогает.
 */
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
const stamp = process.argv[3] || String(Date.now());
if (!dir) { console.error('укажите папку'); process.exit(1); }

const htmls = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.html')) htmls.push(p);
  }
};
walk(dir);

const re = /(\s(?:href|src)=")((?:\.{1,2}\/)?[\w./-]+\.(?:css|js))(")/g;
let n = 0;
for (const file of htmls) {
  const src = fs.readFileSync(file, 'utf8');
  const out = src.replace(re, (m, a, url, b) => (url.includes('?') ? m : (n++, `${a}${url}?v=${stamp}${b}`)));
  if (out !== src) fs.writeFileSync(file, out);
}
console.log(`версия ${stamp}: обновлено ссылок — ${n}`);
