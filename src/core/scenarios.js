import fs from 'node:fs';
import path from 'node:path';

const DIR = path.resolve(process.cwd(), 'scenarios');

function validate(s, file) {
  const err = (m) => { throw new Error(`Сценарий ${file}: ${m}`); };
  for (const k of ['id', 'access_code', 'persona', 'greeting', 'facts', 'final_message']) {
    if (s[k] === undefined || s[k] === '') err(`нет поля "${k}"`);
  }
  if (!s.task && !(Array.isArray(s.tasks) && s.tasks.length)) err('нужно поле "task" (строка) или "tasks" (массив)');
  if (!Array.isArray(s.facts) || !s.facts.length) err('facts должен быть непустым массивом');
  const ids = new Set();
  for (const f of s.facts) {
    if (!f.id || !f.text || !f.reveal_when) err(`у факта нужны id, text, reveal_when (${JSON.stringify(f).slice(0, 60)})`);
    if (ids.has(f.id)) err(`дублирующийся id факта "${f.id}"`);
    ids.add(f.id);
  }
  if (!s.facts.some((f) => f.required)) err('нужен хотя бы один факт с "required": true');
}

/** Загружает все scenarios/*.json (кроме файлов, начинающихся с "_"). Читается заново при каждом вызове — правки подхватываются без перезапуска. */
export function loadScenarios() {
  const map = new Map();
  const codes = new Map();
  for (const file of fs.readdirSync(DIR)) {
    if (!file.endsWith('.json') || file.startsWith('_')) continue;
    let s;
    try { s = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8')); }
    catch (e) { throw new Error(`Сценарий ${file}: ошибка JSON — ${e.message}`); }
    validate(s, file);
    const code = String(s.access_code).trim().toLowerCase();
    if (codes.has(code)) throw new Error(`Код "${s.access_code}" повторяется в ${file} и ${codes.get(code)}`);
    codes.set(code, file);
    map.set(s.id, s);
  }
  return map;
}

export function getScenario(id) {
  return loadScenarios().get(id) || null;
}

export function findByCode(code) {
  const c = String(code || '').trim().toLowerCase();
  for (const s of loadScenarios().values()) if (String(s.access_code).trim().toLowerCase() === c) return s;
  return null;
}
