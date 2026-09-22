// Хранилище сессий и логов. Два бэкенда с одинаковым асинхронным API:
// - Redis — REST (Upstash: KV_REST_API_URL/TOKEN) или TCP (Redis for Vercel: REDIS_URL);
// - SQLite (better-sqlite3) — локально и на VPS.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import tls from 'node:tls';
import { config } from '../config.js';

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const REDIS_TCP = process.env.REDIS_URL; // Redis for Vercel: redis://user:pass@host:port или rediss://
const now = () => new Date().toISOString();

// ---------- Redis ----------
// Команды отправляются пачкой (pipeline): по REST (Upstash) или по TCP (протокол RESP, без внешних библиотек)
async function redis(...commands) {
  return REDIS_URL && REDIS_TOKEN ? redisRest(commands) : redisTcp(commands);
}

async function redisRest(commands) {
  const res = await fetch(`${REDIS_URL}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new Error(`Redis ${res.status}: ${await res.text()}`);
  const out = await res.json();
  const err = out.find((r) => r.error);
  if (err) throw new Error(`Redis: ${err.error}`);
  return out.map((r) => r.result);
}

function encode(cmd) {
  return `*${cmd.length}\r\n` + cmd.map((a) => { const b = Buffer.from(String(a)); return `$${b.length}\r\n${b}\r\n`; }).join('');
}

// Разбор одного ответа RESP из буфера; null — данных пока не хватает
function parseReply(buf, pos) {
  const eol = buf.indexOf('\r\n', pos);
  if (eol === -1) return null;
  const type = String.fromCharCode(buf[pos]);
  const line = buf.toString('utf8', pos + 1, eol);
  let next = eol + 2;
  if (type === '+') return { value: line, next };
  if (type === '-') return { value: new Error(line), next };
  if (type === ':') return { value: Number(line), next };
  if (type === '$') {
    const len = Number(line);
    if (len === -1) return { value: null, next };
    if (buf.length < next + len + 2) return null;
    return { value: buf.toString('utf8', next, next + len), next: next + len + 2 };
  }
  if (type === '*') {
    const n = Number(line);
    if (n === -1) return { value: null, next };
    const arr = [];
    for (let i = 0; i < n; i++) {
      const r = parseReply(buf, next);
      if (!r) return null;
      arr.push(r.value); next = r.next;
    }
    return { value: arr, next };
  }
  throw new Error('Redis: неизвестный ответ ' + type);
}

function redisTcp(commands) {
  const u = new URL(REDIS_TCP);
  const pre = [];
  if (u.password) pre.push(u.username && u.username !== 'default' ? ['AUTH', decodeURIComponent(u.username), decodeURIComponent(u.password)] : ['AUTH', decodeURIComponent(u.password)]);
  const all = [...pre, ...commands];
  return new Promise((resolve, reject) => {
    const opts = { host: u.hostname, port: Number(u.port) || 6379 };
    const sock = u.protocol === 'rediss:' ? tls.connect({ ...opts, servername: u.hostname }) : net.connect(opts);
    let buf = Buffer.alloc(0);
    const replies = [];
    let pos = 0;
    sock.setTimeout(10000, () => sock.destroy(new Error('Redis: таймаут')));
    sock.on(u.protocol === 'rediss:' ? 'secureConnect' : 'connect', () => sock.write(all.map(encode).join('')));
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      let r;
      while (replies.length < all.length && (r = parseReply(buf, pos))) { replies.push(r.value); pos = r.next; }
      if (replies.length === all.length) {
        sock.end();
        const out = replies.slice(pre.length);
        const err = replies.find((x) => x instanceof Error);
        err ? reject(new Error('Redis: ' + err.message)) : resolve(out);
      }
    });
    sock.on('error', reject);
  });
}

// Ключи: s:<id> — сессия (JSON), active — множество id, h:<id> — история активной сессии,
// log:<id> — полный лог чата (не удаляется при сбросе)
const redisStore = {
  async getSession(id) {
    const [raw] = await redis(['GET', `s:${id}`]);
    return raw ? JSON.parse(raw) : null;
  },
  async startSession(id, scenarioId, label = null) {
    const s = { chat_id: String(id), scenario_id: scenarioId, revealed: [], finished: false, label, nudges: 0, last_call: 0, devices: [], last_by: {}, created_at: now() };
    await redis(['SET', `s:${id}`, JSON.stringify(s)], ['SADD', 'active', String(id)], ['DEL', `h:${id}`]);
  },
  async updateSession(id, patch) {
    const s = await this.getSession(id);
    if (!s) return;
    await redis(['SET', `s:${id}`, JSON.stringify({ ...s, ...patch, updated_at: now() })]);
  },
  async resetSession(id) {
    await redis(['DEL', `s:${id}`, `h:${id}`], ['SREM', 'active', String(id)]);
  },
  async resetAll() {
    const [ids] = await redis(['SMEMBERS', 'active']);
    if (ids.length) await redis(['DEL', ...ids.flatMap((i) => [`s:${i}`, `h:${i}`])], ['DEL', 'active']);
    return ids.length;
  },
  async addMessage(id, scenarioId, role, content, revealed = null) {
    const m = JSON.stringify({ role, content, scenario_id: scenarioId, revealed, created_at: now() });
    const cmds = [['RPUSH', `log:${id}`, m], ['SADD', 'chats', String(id)]];
    if (role === 'user' || role === 'assistant') cmds.push(['RPUSH', `h:${id}`, m]);
    await redis(...cmds);
  },
  async history(id, limit) {
    const [rows] = await redis(['LRANGE', `h:${id}`, -limit, -1]);
    return rows.map((r) => { const m = JSON.parse(r); return { role: m.role, content: m.content }; });
  },
  async log(id, limit = 30) {
    const [rows] = await redis(['LRANGE', `log:${id}`, -limit, -1]);
    return rows.map((r) => JSON.parse(r));
  },
  async getMeta(key) {
    const [raw] = await redis(['GET', `m:${key}`]);
    return raw ? JSON.parse(raw) : null;
  },
  async setMeta(key, value) {
    await redis(value === null ? ['DEL', `m:${key}`] : ['SET', `m:${key}`, JSON.stringify(value)]);
  },
  async activeSessions() {
    const [ids] = await redis(['SMEMBERS', 'active']);
    if (!ids.length) return [];
    const [raws] = await redis(['MGET', ...ids.map((i) => `s:${i}`)]);
    return raws.filter(Boolean).map((r) => JSON.parse(r));
  },
};

// ---------- SQLite ----------
let db;
async function getSqlite(file = config.dbPath) {
  if (db) return db;
  const { default: Database } = await import('better-sqlite3'); // только локально: на Vercel не грузится
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      chat_id TEXT PRIMARY KEY, scenario_id TEXT, revealed TEXT NOT NULL DEFAULT '[]',
      finished INTEGER NOT NULL DEFAULT 0, label TEXT, nudges INTEGER NOT NULL DEFAULT 0, last_call INTEGER NOT NULL DEFAULT 0, devices TEXT NOT NULL DEFAULT '[]', solution TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id TEXT NOT NULL, scenario_id TEXT,
      role TEXT NOT NULL, content TEXT NOT NULL, revealed TEXT,
      archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, archived, id);
  `);
  for (const col of ['nudges', 'last_call']) { // миграция старой базы
    try { db.exec(`ALTER TABLE sessions ADD COLUMN ${col} INTEGER NOT NULL DEFAULT 0`); } catch {}
  }
  try { db.exec(`ALTER TABLE sessions ADD COLUMN devices TEXT NOT NULL DEFAULT '[]'`); } catch {}
  try { db.exec('ALTER TABLE sessions ADD COLUMN solution TEXT'); } catch {}
  return db;
}

const parse = (row) => row && { ...row, revealed: JSON.parse(row.revealed), devices: JSON.parse(row.devices || '[]'),
  solution: row.solution ? JSON.parse(row.solution) : null, finished: !!row.finished };

const sqliteStore = {
  async getSession(id) {
    return parse((await getSqlite()).prepare('SELECT * FROM sessions WHERE chat_id = ?').get(String(id)));
  },
  async startSession(id, scenarioId, label = null) {
    (await getSqlite()).prepare(`INSERT INTO sessions (chat_id, scenario_id, revealed, finished, label, nudges, last_call, devices, created_at, updated_at) VALUES (?, ?, '[]', 0, ?, 0, 0, '[]', ?, ?)
      ON CONFLICT(chat_id) DO UPDATE SET scenario_id = excluded.scenario_id, revealed = '[]', finished = 0, nudges = 0, last_call = 0, devices = '[]',
      label = excluded.label, created_at = excluded.created_at, updated_at = excluded.updated_at`).run(String(id), scenarioId, label, now(), now());
  },
  async updateSession(id, patch) {
    const cur = await this.getSession(id);
    if (!cur) return;
    const s = { ...cur, ...patch };
    (await getSqlite()).prepare(`UPDATE sessions SET revealed = ?, finished = ?, nudges = ?, last_call = ?, devices = ?, solution = ?, updated_at = datetime('now') WHERE chat_id = ?`)
      .run(JSON.stringify(s.revealed), s.finished ? 1 : 0, s.nudges || 0, s.last_call || 0, JSON.stringify(s.devices || []),
           s.solution ? JSON.stringify(s.solution) : null, String(id));
  },
  async resetSession(id) {
    const d = await getSqlite();
    d.prepare('UPDATE messages SET archived = 1 WHERE chat_id = ?').run(String(id));
    d.prepare('DELETE FROM sessions WHERE chat_id = ?').run(String(id));
  },
  async resetAll() {
    const d = await getSqlite();
    d.prepare('UPDATE messages SET archived = 1').run();
    return d.prepare('DELETE FROM sessions').run().changes;
  },
  async addMessage(id, scenarioId, role, content, revealed = null) {
    (await getSqlite()).prepare('INSERT INTO messages (chat_id, scenario_id, role, content, revealed, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(String(id), scenarioId, role, content, revealed ? JSON.stringify(revealed) : null, now());
  },
  async history(id, limit) {
    return (await getSqlite()).prepare(`SELECT role, content FROM messages WHERE chat_id = ? AND archived = 0 AND role IN ('user','assistant')
      ORDER BY id DESC LIMIT ?`).all(String(id), limit).reverse();
  },
  async log(id, limit = 30) {
    return (await getSqlite()).prepare('SELECT role, content, revealed, archived, created_at FROM messages WHERE chat_id = ? ORDER BY id DESC LIMIT ?')
      .all(String(id), limit).reverse().map((r) => ({ ...r, revealed: r.revealed ? JSON.parse(r.revealed) : null }));
  },
  async getMeta(key) {
    const row = (await getSqlite()).prepare('SELECT v FROM meta WHERE k = ?').get(key);
    return row ? JSON.parse(row.v) : null;
  },
  async setMeta(key, value) {
    const d = await getSqlite();
    if (value === null) d.prepare('DELETE FROM meta WHERE k = ?').run(key);
    else d.prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(key, JSON.stringify(value));
  },
  async activeSessions() {
    return (await getSqlite()).prepare('SELECT * FROM sessions WHERE scenario_id IS NOT NULL ORDER BY scenario_id, created_at').all().map(parse);
  },
};

const hasRedis = (REDIS_URL && REDIS_TOKEN) || REDIS_TCP;
export const store = { ...(hasRedis ? redisStore : sqliteStore) };
export let storeKind = hasRedis ? 'redis' : 'sqlite';

/** Для тестов, CLI и eval: всегда SQLite (в памяти или файле), даже если настроен Redis — чтобы не писать в боевую базу. */
export async function useSqlite(file) {
  await getSqlite(file);
  Object.assign(store, sqliteStore);
  storeKind = 'sqlite';
}
