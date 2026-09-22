// npm run set-domain -- example.ru  → прописывает домен в docs/CNAME, docs/config.js, deploy/Caddyfile, .env.example
import fs from 'node:fs';
const domain = (process.argv[2] || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) { console.error('Использование: npm run set-domain -- example.ru'); process.exit(1); }
const api = `api.${domain}`;
fs.writeFileSync('docs/CNAME', domain + '\n');
const edit = (f, fn) => fs.writeFileSync(f, fn(fs.readFileSync(f, 'utf8')));
edit('docs/config.js', (s) => s.replace(/'https:\/\/api\.[^']+'/, `'https://${api}'`));
edit('deploy/Caddyfile', (s) => s.replace(/^api\.[^\s{]+ \{/m, `${api} {`));
edit('.env.example', (s) => s.replace(/^WEB_ORIGIN=.*$/m, `WEB_ORIGIN=https://${domain},https://www.${domain}`));
console.log(`Сайт: https://${domain}\nAPI:  https://${api}\nОбновлены: docs/CNAME, docs/config.js, deploy/Caddyfile, .env.example`);
