// HTTP API для сайта (этап 2) + раздача статики из docs/ для локальной разработки.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { store } from '../core/db.js';
import {
  enterCode, handleMessage, publicState, nextTrigger, boardState, getGame, createGame, startGame, endGame,
  finishGame, resultsState, submitSolution, stageOf, methodState, runJobs, evaluateWork, renderImage,
  allowResubmit, adjustScore, publishResults, getImageBlob,
} from '../core/engine.js';

const STATIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../docs');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const ERR_TEXT = {
  too_long: `Слишком длинный вопрос (до ${config.maxInputChars} символов).`,
  rate_limited: 'Клиентка ещё думает над прошлым вопросом.',
  already_finished: 'Запрос клиента уже выяснен.',
  llm_error: 'Клиентка отвлеклась (ошибка связи). Отправьте вопрос ещё раз.',
  empty: 'Напишите вопрос.',
  no_session: 'Сессия не найдена, введите код заново.',
  not_started: 'Игра ещё не началась — дождитесь преподавателя.',
  game_over: 'Игра завершена. Спасибо за работу!',
  not_finished: 'Сначала выясните запрос клиентки.',
  too_short: 'Опишите решение подробнее — хотя бы несколько предложений.',
  time_up: 'Время вышло — переходите к финальному ответу.',
  time_over: 'Время на ответ закончилось.',
  no_hints: 'Подсказки закончились.',
};

const ipHits = new Map();
// В классе все устройства выходят через один IP — лимит должен быть щедрым
function ipLimited(ip, max = 200, windowMs = 60_000) {
  const now = Date.now();
  const arr = (ipHits.get(ip) || []).filter((t) => now - t < windowMs);
  arr.push(now); ipHits.set(ip, arr);
  return arr.length > max;
}

function cors(req, res) {
  const origin = req.headers.origin;
  const allowed = config.webOrigins;
  if (origin && (allowed.includes('*') || allowed.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Key');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }
}

const send = (res, code, data) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };

function readBody(req) {
  if (req.body !== undefined) return Promise.resolve(typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {});
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 8192) { reject(new Error('too_big')); req.destroy(); } });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('bad_json')); } });
  });
}

const sid = (id) => (typeof id === 'string' && /^(team|test):[a-z0-9_:-]{1,60}$/i.test(id) ? id : null);
const isAdmin = (req, url) => {
  const key = req.headers['x-admin-key'] || url.searchParams.get('key');
  return !!config.adminKey && typeof key === 'string' && key.length === config.adminKey.length &&
    crypto.timingSafeEqual(Buffer.from(key), Buffer.from(config.adminKey));
};

function serveStatic(url, res) {
  let p = decodeURIComponent(url.pathname);
  if (p.endsWith('/')) p += 'index.html';
  let file = path.join(STATIC, path.normalize(p));
  if (!file.startsWith(STATIC)) return send(res, 404, { error: 'not_found' });
  // /admin → /admin/ (как делает GitHub Pages), иначе ломаются относительные пути
  if (!path.extname(file) && fs.existsSync(path.join(file, 'index.html'))) {
    res.writeHead(301, { Location: url.pathname + '/' + url.search });
    return res.end();
  }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, { error: 'not_found' });
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

async function route(req, res) {
  const url = new URL(req.url, 'http://x');
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
  cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (!url.pathname.startsWith('/api/')) return config.serveStatic ? serveStatic(url, res) : send(res, 404, { error: 'not_found' });

  const r = `${req.method} ${url.pathname}`;
  if (r === 'GET /api/health') return send(res, 200, { ok: true });

  if (r === 'POST /api/session') {
    if (ipLimited(ip)) return send(res, 429, { error: 'Слишком много попыток входа, подождите минуту.' });
    const { code, deviceId } = await readBody(req);
    const dev = typeof deviceId === 'string' ? deviceId.slice(0, 40) : null;
    const out = await enterCode(String(code || '').slice(0, 40), dev);
    if (!out.ok) return send(res, 404, { error: 'Код не найден. Проверьте карточку команды.' });
    return send(res, 200, { sessionId: out.sessionId, state: await publicState(out.sessionId) });
  }

  if (r === 'GET /api/session') {
    const s = sid(url.searchParams.get('id'));
    const state = s && (await publicState(s));
    return state ? send(res, 200, { state }) : send(res, 404, { error: ERR_TEXT.no_session });
  }

  if (r === 'POST /api/message') {
    const { sessionId, text, deviceId } = await readBody(req);
    const s = sid(sessionId);
    if (!s) return send(res, 404, { error: ERR_TEXT.no_session });
    const out = await handleMessage(s, text, { deviceId: typeof deviceId === 'string' ? deviceId.slice(0, 40) : null });
    if (out.error) return send(res, out.error === 'no_session' ? 404 : 400, { error: ERR_TEXT[out.error] || out.error, code: out.error });
    const state = await publicState(s);
    return send(res, 200, { reply: out.reply, newly: state.revealed.filter((f) => out.newly_revealed.includes(f.id)), state });
  }

  if (r === 'POST /api/solution') {
    const { sessionId, text } = await readBody(req);
    const s = sid(sessionId);
    if (!s) return send(res, 404, { error: ERR_TEXT.no_session });
    const out = await submitSolution(s, text);
    if (out.error) return send(res, out.error === 'no_session' ? 404 : 400, { error: ERR_TEXT[out.error] || out.error, code: out.error });
    return send(res, 200, { submission: { version: out.submission.version, at: out.submission.at }, already: !!out.already, state: await publicState(s) });
  }

  // Двигатель фоновых задач: его дёргают опросы страниц, повторы защищены замками
  if (r === 'POST /api/jobs') {
    const { sessionId } = await readBody(req);
    const s = sid(sessionId);
    if (!s) return send(res, 404, { error: ERR_TEXT.no_session });
    const out = await runJobs(s);
    return send(res, 200, { ...out, state: await publicState(s) });
  }

  // Картинка «после»
  if (r === 'GET /api/image') {
    const key = url.searchParams.get('key');
    if (!key || !/^(team|test):[a-z0-9_:-]{1,80}$/i.test(key)) return send(res, 404, { error: 'not_found' });
    const b64 = await getImageBlob(key);
    if (!b64) return send(res, 404, { error: 'not_found' });
    const buf = Buffer.from(b64, 'base64');
    res.writeHead(200, { 'Content-Type': 'image/webp', 'Content-Length': buf.length, 'Cache-Control': 'public, max-age=86400' });
    return res.end(buf);
  }

  if (r === 'POST /api/hint') {
    const { sessionId } = await readBody(req);
    const s = sid(sessionId);
    if (!s) return send(res, 404, { error: ERR_TEXT.no_session });
    const out = await nextTrigger(s);
    if (out.error) return send(res, 400, { error: ERR_TEXT[out.error] || out.error, code: out.error });
    return send(res, 200, { ...out, state: await publicState(s) });
  }

  if (r === 'GET /api/board') {
    if (!isAdmin(req, url)) return send(res, 401, { error: 'Неверный ключ преподавателя' });
    const game = await getGame();
    return send(res, 200, { teams: await boardState(), phase: game?.phase || null, started_at: game?.started_at || null, timer: stageOf(game) });
  }

  // --- Игра (админ-панель преподавателя) ---
  if (r === 'GET /api/admin/game') {
    if (!isAdmin(req, url)) return send(res, 401, { error: 'Неверный ключ преподавателя' });
    return send(res, 200, { game: await getGame() });
  }

  if (r === 'POST /api/admin/game') {
    if (!isAdmin(req, url)) return send(res, 401, { error: 'Неверный ключ преподавателя' });
    const { names } = await readBody(req);
    return send(res, 200, { game: await createGame(Array.isArray(names) ? names : []) });
  }

  if (r === 'POST /api/admin/start') {
    if (!isAdmin(req, url)) return send(res, 401, { error: 'Неверный ключ преподавателя' });
    const game = await startGame();
    return game ? send(res, 200, { game }) : send(res, 400, { error: 'Игра ещё не создана' });
  }

  if (r === 'POST /api/admin/finish') {
    if (!isAdmin(req, url)) return send(res, 401, { error: 'Неверный ключ преподавателя' });
    const game = await finishGame();
    return game ? send(res, 200, { game }) : send(res, 400, { error: 'Игра не создана' });
  }

  if (r === 'GET /api/admin/method') {
    if (!isAdmin(req, url)) return send(res, 401, { error: 'Неверный ключ преподавателя' });
    return send(res, 200, { clients: methodState() });
  }

  if (r === 'GET /api/admin/results') {
    if (!isAdmin(req, url)) return send(res, 401, { error: 'Неверный ключ преподавателя' });
    return send(res, 200, await resultsState());
  }

  // --- Управление работами (только преподаватель) ---
  if (r === 'POST /api/admin/jobs') {
    if (!isAdmin(req, url)) return send(res, 401, { error: 'Неверный ключ преподавателя' });
    const { sessionId, kind, force } = await readBody(req);
    const s = sid(sessionId);
    if (!s) return send(res, 404, { error: ERR_TEXT.no_session });
    const out = kind === 'image' ? await renderImage(s, { force: !!force }) : await evaluateWork(s, { force: !!force });
    return send(res, 200, out);
  }

  if (r === 'POST /api/admin/resubmit') {
    if (!isAdmin(req, url)) return send(res, 401, { error: 'Неверный ключ преподавателя' });
    const { sessionId } = await readBody(req);
    const s = sid(sessionId);
    if (!s) return send(res, 404, { error: ERR_TEXT.no_session });
    return send(res, 200, await allowResubmit(s));
  }

  if (r === 'POST /api/admin/score') {
    if (!isAdmin(req, url)) return send(res, 401, { error: 'Неверный ключ преподавателя' });
    const { sessionId, criteria, comment } = await readBody(req);
    const s = sid(sessionId);
    if (!s) return send(res, 404, { error: ERR_TEXT.no_session });
    const out = await adjustScore(s, { criteria: criteria || {}, comment: comment || '' });
    return out.error ? send(res, 400, { error: out.error }) : send(res, 200, out);
  }

  if (r === 'POST /api/admin/publish') {
    if (!isAdmin(req, url)) return send(res, 401, { error: 'Неверный ключ преподавателя' });
    const game = await publishResults();
    return game ? send(res, 200, { published: true }) : send(res, 400, { error: 'Игра не создана' });
  }

  if (r === 'POST /api/admin/end') {
    if (!isAdmin(req, url)) return send(res, 401, { error: 'Неверный ключ преподавателя' });
    return send(res, 200, { reset: await endGame() });
  }

  if (r === 'POST /api/admin/reset') {
    if (!isAdmin(req, url)) return send(res, 401, { error: 'Неверный ключ преподавателя' });
    return send(res, 200, { reset: await store.resetAll() });
  }

  return send(res, 404, { error: 'not_found' });
}

/** Обработчик (req, res) — общий для локального сервера и Vercel-функции. */
export async function handler(req, res) {
  try {
    await route(req, res);
  } catch (e) {
    console.error('[http]', e.message);
    if (!res.headersSent) send(res, e.message === 'bad_json' || e.message === 'too_big' ? 400 : 500, { error: 'Ошибка сервера' });
  }
}

export function createHttpServer() {
  return http.createServer(handler);
}
