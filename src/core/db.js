import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

let db;

export function getDb(file = config.dbPath) {
  if (db) return db;
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      chat_id TEXT PRIMARY KEY,
      scenario_id TEXT,
      revealed TEXT NOT NULL DEFAULT '[]',
      finished INTEGER NOT NULL DEFAULT 0,
      label TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      scenario_id TEXT,
      role TEXT NOT NULL,          -- user | assistant | system
      content TEXT NOT NULL,
      revealed TEXT,               -- факты, открытые этим ответом (JSON)
      archived INTEGER NOT NULL DEFAULT 0, -- 1 = после /restart или /reset_all (лог сохраняется)
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, archived, id);
  `);
  return db;
}

const parse = (row) => row && { ...row, revealed: JSON.parse(row.revealed), finished: !!row.finished };

export const store = {
  getSession: (chatId) => parse(getDb().prepare('SELECT * FROM sessions WHERE chat_id = ?').get(String(chatId))),

  startSession(chatId, scenarioId, label = null) {
    getDb().prepare(`INSERT INTO sessions (chat_id, scenario_id, revealed, finished, label) VALUES (?, ?, '[]', 0, ?)
      ON CONFLICT(chat_id) DO UPDATE SET scenario_id = excluded.scenario_id, revealed = '[]', finished = 0,
      label = excluded.label, created_at = datetime('now'), updated_at = datetime('now')`).run(String(chatId), scenarioId, label);
  },

  updateSession(chatId, { revealed, finished }) {
    getDb().prepare(`UPDATE sessions SET revealed = ?, finished = ?, updated_at = datetime('now') WHERE chat_id = ?`)
      .run(JSON.stringify(revealed), finished ? 1 : 0, String(chatId));
  },

  resetSession(chatId) {
    const d = getDb();
    d.prepare('UPDATE messages SET archived = 1 WHERE chat_id = ?').run(String(chatId));
    d.prepare('DELETE FROM sessions WHERE chat_id = ?').run(String(chatId));
  },

  resetAll() {
    const d = getDb();
    d.prepare('UPDATE messages SET archived = 1').run();
    return d.prepare('DELETE FROM sessions').run().changes;
  },

  addMessage(chatId, scenarioId, role, content, revealed = null) {
    getDb().prepare('INSERT INTO messages (chat_id, scenario_id, role, content, revealed) VALUES (?, ?, ?, ?, ?)')
      .run(String(chatId), scenarioId, role, content, revealed ? JSON.stringify(revealed) : null);
  },

  /** Последние N сообщений активной сессии (для контекста модели). */
  history(chatId, limit) {
    return getDb().prepare(`SELECT role, content FROM messages WHERE chat_id = ? AND archived = 0 AND role IN ('user','assistant')
      ORDER BY id DESC LIMIT ?`).all(String(chatId), limit).reverse();
  },

  /** Последние N сообщений включая архив (для /log). */
  log(chatId, limit = 30) {
    return getDb().prepare('SELECT role, content, revealed, archived, created_at FROM messages WHERE chat_id = ? ORDER BY id DESC LIMIT ?')
      .all(String(chatId), limit).reverse();
  },

  activeSessions: () => getDb().prepare('SELECT * FROM sessions WHERE scenario_id IS NOT NULL ORDER BY scenario_id, created_at').all().map(parse),
};
