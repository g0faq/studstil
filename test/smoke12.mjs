// Соединение с Redis: общий сокет, порядок ответов, склейка кусков, переподключение.
// Поднимаем игрушечный сервер RESP прямо здесь — без внешнего Redis и без сети.
process.chdir('/Users/fedaersov/dev/Визажист');
const R = '/Users/fedaersov/dev/Визажист/src';
import net from 'node:net';

const a = (c, m, x = '') => { if (!c) { console.error('FAIL', m, x); process.exit(1); } console.log('ok', m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- игрушечный Redis ----------
const data = new Map();   // ключ → строка
const lists = new Map();  // ключ → массив строк
const sets = new Map();   // ключ → Set
let served = 0;           // сколько команд обработано
let conns = 0;            // сколько раз к нам подключались
let chunkBytes = 0;       // 0 — ответ целиком; иначе режем на куски и проверяем склейку
let stall = null;         // имя команды, на которую сервер «зависает»

const enc = {
  simple: (s) => `+${s}\r\n`,
  bulk: (s) => (s === null ? '$-1\r\n' : `$${Buffer.byteLength(s)}\r\n` + Buffer.from(s, 'utf8').toString('latin1') + '\r\n'),
  int: (n) => `:${n}\r\n`,
  arr: (items) => `*${items.length}\r\n` + items.map((x) => (x === null ? '$-1\r\n' : enc.bulk(x))).join(''),
};

function run(cmd) {
  const [name, ...args] = cmd;
  served++;
  switch (name.toUpperCase()) {
    case 'AUTH': return enc.simple('OK');
    case 'SET': {
      if (args.includes('NX') && (data.has(args[0]) || lists.has(args[0]))) return '$-1\r\n';
      data.set(args[0], args[1]); return enc.simple('OK');
    }
    case 'GET': return enc.bulk(data.has(args[0]) ? data.get(args[0]) : null);
    case 'MGET': return enc.arr(args.map((k) => (data.has(k) ? data.get(k) : null)));
    case 'DEL': { let n = 0; for (const k of args) { if (data.delete(k)) n++; if (lists.delete(k)) n++; if (sets.delete(k)) n++; } return enc.int(n); }
    case 'RPUSH': { const l = lists.get(args[0]) || []; l.push(...args.slice(1)); lists.set(args[0], l); return enc.int(l.length); }
    case 'LRANGE': {
      const l = lists.get(args[0]) || [];
      const [s, e] = [Number(args[1]), Number(args[2])];
      return enc.arr(l.slice(s, e === -1 ? undefined : e + 1));
    }
    case 'SADD': { const st = sets.get(args[0]) || new Set(); const b = st.size; args.slice(1).forEach((v) => st.add(v)); sets.set(args[0], st); return enc.int(st.size - b); }
    case 'SREM': { const st = sets.get(args[0]); if (!st) return enc.int(0); let n = 0; args.slice(1).forEach((v) => { if (st.delete(v)) n++; }); return enc.int(n); }
    case 'SMEMBERS': return enc.arr([...(sets.get(args[0]) || [])]);
    default: return `-ERR неизвестная команда ${name}\r\n`;
  }
}

function parseCommands(buf) {
  const out = []; let i = 0;
  for (;;) {
    if (buf[i] !== 0x2a) break; // '*'
    const e = buf.indexOf('\r\n', i);
    if (e < 0) break;
    const n = Number(buf.toString('latin1', i + 1, e));
    let p = e + 2; const parts = []; let ok = true;
    for (let k = 0; k < n; k++) {
      if (buf[p] !== 0x24) { ok = false; break; } // '$'
      const le = buf.indexOf('\r\n', p);
      if (le < 0) { ok = false; break; }
      const len = Number(buf.toString('latin1', p + 1, le));
      if (buf.length < le + 2 + len + 2) { ok = false; break; }
      parts.push(buf.toString('utf8', le + 2, le + 2 + len));
      p = le + 2 + len + 2;
    }
    if (!ok) break;
    out.push(parts); i = p;
  }
  return { cmds: out, rest: buf.subarray(i) };
}

const live = new Set();
const server = net.createServer((sock) => {
  conns++;
  live.add(sock);
  sock.on('close', () => live.delete(sock));
  let buf = Buffer.alloc(0);
  let chain = Promise.resolve(); // ответы отдаём строго по очереди
  sock.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    const { cmds, rest } = parseCommands(buf);
    buf = rest;
    for (const cmd of cmds) {
      if (stall && cmd[0].toUpperCase() === stall) continue; // молчим: проверяем таймаут
      const reply = run(cmd);
      chain = chain.catch(() => {}).then(async () => {
        if (sock.destroyed) return;
        const step = chunkBytes > 0 ? chunkBytes : reply.length; // размер куска фиксируем до цикла
        // Режем ответ на куски: клиент обязан собрать его сам
        for (let i = 0; i < reply.length; i += step) {
          if (sock.destroyed) return;
          sock.write(Buffer.from(reply.slice(i, i + step), 'latin1'));
          await sleep(0);
        }
      }).catch((e) => console.log('СЕРВЕР: сбой записи —', e.message));
    }
  });
  sock.on('error', () => {});
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

process.env.REDIS_TIMEOUT_MS = '2500';
process.env.REDIS_URL = `redis://default:secret@127.0.0.1:${port}`;
delete process.env.KV_REST_API_URL;
delete process.env.UPSTASH_REDIS_REST_URL;
const { store, storeKind } = await import(R + '/core/db.js');
a(storeKind === 'redis', 'хранилище — redis по TCP', storeKind);

// ---------- проверки ----------
await store.startSession('team:olga', 'olga');
const s0 = await store.getSession('team:olga');
a(s0 && s0.scenario_id === 'olga', 'сессия создана и прочитана');
a(conns === 1, 'соединение одно на все команды', String(conns));

// Пачка параллельных запросов: ответы не должны перепутаться
await Promise.all([...Array(25)].map((_, i) => store.setMeta('k' + i, i)));
const reads = await Promise.all([...Array(25)].map((_, i) => store.getMeta('k' + i)));
a(reads.every((v, i) => Number(v) === i), 'параллельные ответы не перепутаны', JSON.stringify(reads.slice(0, 5)));
a(conns === 1, 'параллельные запросы не открывают новых соединений', String(conns));

// Одновременная запись сообщений: ничего не теряется и порядок сохранён
await Promise.all([...Array(12)].map((_, i) => store.addMessage('team:olga', 'olga', i % 2 ? 'assistant' : 'user', 'строка ' + i)));
const hist = await store.history('team:olga', 50);
a(hist.length === 12, 'все сообщения на месте', String(hist.length));

// Крупные значения приходят по частям — клиент обязан их склеить
chunkBytes = 900; // теперь сервер отвечает кусками
const big = 'я'.repeat(5000);
await store.addMessage('team:olga', 'olga', 'user', big);
const h2 = await store.history('team:olga', 50);
a(h2.at(-1).content.length === 5000, 'длинный ответ собран из кусков', String(h2.at(-1).content.length));

chunkBytes = 0;

// Замок работает и снимается
a((await store.acquireLock('msg:team:olga', 30)) === true, 'замок взят');
a((await store.acquireLock('msg:team:olga', 30)) === false, 'второй раз замок не даётся');
await store.releaseLock('msg:team:olga');
a((await store.acquireLock('msg:team:olga', 30)) === true, 'после снятия замок снова свободен');
await store.releaseLock('msg:team:olga');

// Сервер закрыл простаивающее соединение — клиент переподключается сам
const before = conns;
for (const sock of live) sock.destroy();
await sleep(60);
const again = await store.getSession('team:olga');
a(again && again.scenario_id === 'olga', 'после обрыва запрос прошёл');
a(conns === before + 1, 'клиент переподключился ровно один раз', `${before} → ${conns}`);

// Redis замолчал: запрос падает с ошибкой, но следующий проходит по новому соединению
stall = 'GET';
let failed = null;
try { await store.getSession('team:olga'); } catch (e) { failed = e.message; }
a(/таймаут|закрыто/.test(failed || ''), 'зависший запрос не висит вечно', String(failed));
stall = null;
const alive = await store.getSession('team:olga');
a(alive && alive.scenario_id === 'olga', 'после зависания хранилище снова отвечает');

console.log('--- всего проверок:');
console.log(14);
server.close();
process.exit(0);
