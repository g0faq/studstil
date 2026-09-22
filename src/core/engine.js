import { config } from '../config.js';
import { store } from './db.js';
import { getScenario, findByCode, loadScenarios } from './scenarios.js';
import { buildSystemPrompt, buildJudgePrompt } from './prompt.js';
import { callPersona, callJudge } from './llm.js';

export function progressOf(scenario, revealed) {
  const req = scenario.facts.filter((f) => f.required);
  return {
    required_total: req.length,
    required_open: req.filter((f) => revealed.includes(f.id)).length,
    total: scenario.facts.length,
    open: revealed.length,
  };
}

export const finalOf = (sc) => ({
  message: sc.final_message, problem: sc.problem || '', tasks: sc.tasks || [sc.task], task_time: sc.task_time || '',
});

/**
 * Вход по коду. Сессия общая на всю команду: все устройства видят один чат.
 * deviceId нужен только чтобы показать преподавателю, сколько устройств в команде.
 */
export async function enterCode(code, deviceId = null) {
  const found = await teamByCode(code);
  if (!found) return { ok: false };
  const { team } = found;
  const sessionId = `team:${team.scenario_id}`;
  const existing = await store.getSession(sessionId);
  if (!existing) await startScenario(sessionId, team.scenario_id, team.name);
  await addDevice(sessionId, deviceId);
  return { ok: true, sessionId };
}

/** Учёт устройств команды (для строки «в игре · 3»). */
async function addDevice(sessionId, deviceId) {
  if (!deviceId) return;
  const s = await store.getSession(sessionId);
  if (!s) return;
  const devices = Array.isArray(s.devices) ? s.devices : [];
  if (devices.includes(deviceId) || devices.length >= 30) return;
  await store.updateSession(sessionId, { devices: [...devices, deviceId] });
}

/** Прямой старт по id сценария (CLI/eval). */
export async function startScenario(sessionId, scenarioId, label = null) {
  const scenario = getScenario(scenarioId);
  if (!scenario) throw new Error(`Сценарий "${scenarioId}" не найден`);
  await store.resetSession(sessionId);
  await store.startSession(sessionId, scenario.id, label);
  await store.addMessage(sessionId, scenario.id, 'assistant', scenario.greeting);
  return { scenario, greeting: scenario.greeting, progress: progressOf(scenario, []) };
}

export const resetSession = (sessionId) => store.resetSession(sessionId);

export async function getSessionState(sessionId) {
  const s = await store.getSession(sessionId);
  if (!s?.scenario_id) return null;
  const scenario = getScenario(s.scenario_id);
  return scenario ? { session: s, scenario, progress: progressOf(scenario, s.revealed) } : null;
}

/**
 * Главная функция ядра.
 * → { reply, newly_revealed, progress, finished, final?, error? }
 * error: 'no_session' | 'empty' | 'too_long' | 'rate_limited' | 'already_finished' | 'llm_error'
 */
export async function handleMessage(sessionId, text, { llm = callPersona, deviceId = null } = {}) {
  const state = await getSessionState(sessionId);
  if (!state) return { error: 'no_session', reply: null, finished: false };
  const { session, scenario } = state;

  if (session.finished) return { error: 'already_finished', reply: null, progress: state.progress, finished: true };
  const g = await getGame();
  if (g && g.phase === 'lobby') return { error: 'not_started', reply: null, progress: state.progress, finished: false };
  if (g && g.phase === 'finished') return { error: 'game_over', reply: null, progress: state.progress, finished: false };
  if (g && stageOf(g).stage !== 'play') return { error: 'time_up', reply: null, progress: state.progress, finished: false };
  text = String(text || '').trim();
  if (!text) return { error: 'empty', reply: null, progress: state.progress, finished: false };
  if (text.length > config.maxInputChars) return { error: 'too_long', reply: null, progress: state.progress, finished: false };

  // Защита от «залипшей» кнопки: считаем по устройству, чтобы команда могла спрашивать параллельно
  const now = Date.now();
  const byDev = { ...(session.last_by || {}) };
  const lastOwn = deviceId ? byDev[deviceId] || 0 : session.last_call || 0;
  if (now - lastOwn < config.rateLimitMs) {
    return { error: 'rate_limited', reply: null, progress: state.progress, finished: false };
  }
  if (deviceId) {
    byDev[deviceId] = now;
    for (const k of Object.keys(byDev)) if (now - byDev[k] > 300000) delete byDev[k]; // чистим старые
    await store.updateSession(sessionId, { last_by: byDev, last_call: now });
  } else {
    await store.updateSession(sessionId, { last_call: now });
  }

  const history = await store.history(sessionId, config.historyLimit);
  const messages = [
    { role: 'system', content: buildSystemPrompt(scenario, session.revealed) },
    ...history,
    { role: 'user', content: text },
  ];

  let out;
  try {
    out = await llm(messages);
  } catch (e) {
    await store.updateSession(sessionId, deviceId ? { last_by: { ...(session.last_by || {}), [deviceId]: 0 } } : { last_call: 0 });
    console.error('[llm]', e.status || '', e.message);
    return { error: 'llm_error', reply: null, progress: state.progress, finished: false };
  }
  const reply = out.reply || 'Ой, простите, я задумалась… Что вы спросили?';

  // Сервер — источник истины: принимаем только существующие и ещё не открытые id
  const known = new Set(scenario.facts.map((f) => f.id));
  const newly = [...new Set(out.revealed_fact_ids)].filter((id) => known.has(id) && !session.revealed.includes(id));
  const revealed = [...session.revealed, ...newly];
  const progress = progressOf(scenario, revealed);
  const finished = progress.required_open === progress.required_total;

  await store.addMessage(sessionId, scenario.id, 'user', text);
  await store.addMessage(sessionId, scenario.id, 'assistant', reply, newly);
  if (finished) await store.addMessage(sessionId, scenario.id, 'system', `FINISHED\n${scenario.final_message}`);
  await store.updateSession(sessionId, { revealed, finished });

  return { reply, newly_revealed: newly, progress, finished, ...(finished ? { final: finalOf(scenario) } : {}) };
}

/** Состояние сессии для веб-клиента: только то, что студентам можно видеть. */
export async function publicState(sessionId) {
  const st = await getSessionState(sessionId);
  if (!st) return null;
  const { scenario: sc, session, progress } = st;
  const ui = sc.ui || {};
  const revealed = sc.facts.filter((f) => session.revealed.includes(f.id))
    .map((f) => ({ id: f.id, label: f.label || f.id, text: f.text, required: !!f.required }));
  const game = await getGame();
  const phase = game ? game.phase : 'running'; // без игры (запасной вход по кодам сценариев) сразу играем
  const messages = phase === 'lobby' ? [] : (await store.history(sessionId, 200)).map((m) => ({ who: m.role === 'user' ? 'me' : 'them', text: m.content }));
  return {
    phase, team: session.label || null,
    client: {
      name: sc.persona.name, letter: sc.persona.name[0], meta: ui.meta || `${sc.persona.age}`,
      accent: ui.accent || '#FF7A1A', soft: ui.soft || 'rgba(255,122,26,0.4)',
      accent_green: ui.accent_green || null, soft_green: ui.soft_green || null,
      photo: ui.photo || null, photo_green: ui.photo_green || null,
      card_hint: ui.card_hint || sc.greeting, chips: ui.chips || [],
    },
    revealed, progress, finished: session.finished, messages,
    solution: session.solution || null,
    hints: session.nudges || 0,
    hints_left: Math.max(0, (sc.triggers?.length || 0) - (session.nudges || 0)),
    timer: { ...stageOf(game), duration_sec: game?.duration_sec || null, answer_sec: game?.answer_sec || null },
    devices: (session.devices || []).length,
    rev: messages.length + session.revealed.length + (session.finished ? 1 : 0) + (session.solution ? 100 : 0) + (session.nudges || 0) * 7, // дёшево понять, изменилось ли что-то
    final: session.finished ? finalOf(sc) : null,
  };
}

/** Команда попросила подсказку. Считается и видна преподавателю. */
export async function nextTrigger(sessionId) {
  const st = await getSessionState(sessionId);
  if (!st) return { error: 'no_session' };
  const game = await getGame();
  if (game && stageOf(game).stage !== 'play') return { error: 'time_up' };
  const list = st.scenario.triggers || [];
  const i = st.session.nudges || 0;
  if (i >= list.length) return { error: 'no_hints' };
  await store.updateSession(sessionId, { nudges: i + 1 });
  await store.addMessage(sessionId, st.scenario.id, 'assistant', list[i]);
  return { text: list[i], hints: i + 1, left: list.length - i - 1 };
}

/** Табло: прогресс команд (объединение открытых фактов всех сессий сценария). */
export async function boardState() {
  const sessions = await store.activeSessions();
  const game = await getGame();
  return [...loadScenarios().values()]
    .sort((a, b) => String(a.access_code).localeCompare(String(b.access_code), 'ru', { numeric: true }))
    .map((sc) => {
      const group = sessions.filter((s) => s.scenario_id === sc.id);
      const union = new Set(group.flatMap((s) => s.revealed));
      const req = sc.facts.filter((f) => f.required);
      return {
        id: sc.id, name: sc.persona.name, age: sc.persona.age, letter: sc.persona.name[0],
        team: game?.teams.find((t) => t.scenario_id === sc.id)?.name
          || ((sc.ui?.meta || '').split('·').pop().trim() || sc.id).replace(/^./, (c) => c.toUpperCase()),
        accent: sc.ui?.accent || '#FF7A1A', accent_green: sc.ui?.accent_green || null,
        photo: sc.ui?.photo || null, photo_green: sc.ui?.photo_green || null,
        code: game?.teams.find((t) => t.scenario_id === sc.id)?.code || sc.access_code,
        sessions: group.reduce((n, s) => n + Math.max(1, (s.devices || []).length), 0), finished: group.some((s) => s.finished),
        score: group.map((s) => s.solution?.score).find((v) => v !== undefined) ?? null,
        hints: group.reduce((n, s) => n + (s.nudges || 0), 0),
        done: req.filter((f) => union.has(f.id)).length, total: req.length,
        tags: req.map((f) => ({ label: f.label || f.id, on: union.has(f.id) })),
        extra: sc.facts.filter((f) => !f.required && union.has(f.id)).map((f) => f.label || f.id),
      };
    });
}

// ================= Игра: лобби → старт → дашборд =================
// Состояние хранится под ключом 'game': { phase, teams: [{ scenario_id, name, code }], created_at, started_at }

const GAME = 'game';

function randomCodes(n) {
  const out = new Set();
  while (out.size < n) out.add(String(100 + Math.floor(Math.random() * 900)) + String(Math.floor(Math.random() * 10)));
  return [...out];
}

export const getGame = () => store.getMeta(GAME);

/**
 * Этап по часам сервера:
 * 'lobby' — ждём старта, 'play' — идёт игра, 'answer' — только финальный ответ,
 * 'over' — время вышло, 'finished' — преподаватель завершил игру.
 */
export function stageOf(game) {
  if (!game) return { stage: 'play', left: null, left_answer: null };
  if (game.phase === 'lobby') return { stage: 'lobby', left: null, left_answer: null };
  if (game.phase === 'finished') return { stage: 'finished', left: 0, left_answer: 0 };
  const dur = game.duration_sec || 600;
  const ans = game.answer_sec || 60;
  const passed = (Date.now() - new Date(game.started_at).getTime()) / 1000;
  if (passed < dur) return { stage: 'play', left: Math.ceil(dur - passed), left_answer: ans };
  if (passed < dur + ans) return { stage: 'answer', left: 0, left_answer: Math.ceil(dur + ans - passed) };
  return { stage: 'over', left: 0, left_answer: 0 };
}

/** Преподаватель ввёл названия команд → выдаём случайные коды. Сценарии раздаются по порядку. */
export async function createGame(names) {
  const scenarios = [...loadScenarios().values()]
    .sort((a, b) => String(a.access_code).localeCompare(String(b.access_code), 'ru', { numeric: true }));
  const clean = (names || []).map((n) => String(n || '').trim().slice(0, 40));
  const codes = randomCodes(scenarios.length);
  const game = {
    phase: 'lobby',
    duration_sec: config.gameMinutes * 60,
    answer_sec: config.answerSeconds,
    created_at: new Date().toISOString(),
    started_at: null,
    teams: scenarios.map((sc, i) => ({
      scenario_id: sc.id, code: codes[i],
      name: clean[i] || `Команда ${i + 1}`,
      client: `${sc.persona.name}, ${sc.persona.age}`,
    })),
  };
  await store.resetAll();
  await store.setMeta(GAME, game);
  return game;
}

export async function startGame() {
  const game = await getGame();
  if (!game) return null;
  game.phase = 'running';
  game.started_at = new Date().toISOString();
  await store.setMeta(GAME, game);
  return game;
}

export async function endGame() {
  await store.setMeta(GAME, null);
  return store.resetAll();
}

/** Команда по коду: сначала коды текущей игры, затем коды из файлов сценариев (запасной вариант). */
export async function teamByCode(code) {
  const c = String(code || '').trim();
  const game = await getGame();
  const team = game?.teams.find((t) => t.code === c);
  if (team) return { team, game };
  if (game) return null; // идёт игра — работают только её коды
  const sc = findByCode(c);
  return sc ? { team: { scenario_id: sc.id, code: c, name: null }, game: null } : null;
}

/** Игра сыграна: коды и сессии остаются, чтобы показать статистику. */
export async function finishGame() {
  const game = await getGame();
  if (!game) return null;
  game.phase = 'finished';
  game.finished_at = new Date().toISOString();
  await store.setMeta(GAME, game);
  return game;
}

/**
 * Итоги урока: по каждой команде — сколько фактов, сколько вопросов,
 * за сколько минут и в каком порядке раскрывались факты.
 */
export async function resultsState() {
  const game = await getGame();
  const sessions = await store.activeSessions();
  const scenarios = [...loadScenarios().values()];

  const teams = [];
  for (const sc of scenarios) {
    const group = sessions.filter((s) => s.scenario_id === sc.id);
    if (!group.length && !game) continue;
    const req = sc.facts.filter((f) => f.required);

    // Собираем лог всех устройств команды — только за текущую игру
    const since = game?.started_at || group[0]?.created_at || null;
    const ts = (v) => (v ? new Date(String(v).includes('T') ? v : String(v).replace(' ', 'T') + 'Z').getTime() : 0);
    let log = [];
    for (const s of group) log = log.concat(await store.log(s.chat_id, 400));
    log = log
      .filter((m) => !since || ts(m.created_at) >= ts(since))
      .sort((a, b) => ts(a.created_at) - ts(b.created_at));

    const started = since ? ts(since) : (log[0] ? ts(log[0].created_at) : null);
    const questions = log.filter((m) => m.role === 'user').length;
    const revealAt = new Map();
    for (const m of log) {
      for (const id of m.revealed || []) if (!revealAt.has(id)) revealAt.set(id, m.created_at);
    }
    const minutes = (iso) => (started && iso ? Math.max(0, Math.round((ts(iso) - started) / 60000)) : null);
    const union = new Set(group.flatMap((s) => s.revealed));
    const done = req.filter((f) => union.has(f.id)).length;
    const lastRequired = req.filter((f) => revealAt.has(f.id)).map((f) => revealAt.get(f.id)).sort().pop();

    teams.push({
      id: sc.id,
      team: game?.teams.find((t) => t.scenario_id === sc.id)?.name || sc.persona.name,
      client: `${sc.persona.name}, ${sc.persona.age}`,
      accent: sc.ui?.accent || '#FF7A1A', accent_green: sc.ui?.accent_green || null,
      photo: sc.ui?.photo || null, photo_green: sc.ui?.photo_green || null,
      letter: sc.persona.name[0],
      done, total: req.length, finished: done === req.length,
      questions, devices: group.length,
      hints: group.reduce((n, s) => n + (s.nudges || 0), 0),
      solution: group.map((s) => s.solution).find(Boolean) || null,
      minutes: done === req.length ? minutes(lastRequired) : minutes(log[log.length - 1]?.created_at),
      problem: sc.problem || '',
      facts: [
        ...req.map((f, i) => ({ label: f.label || f.id, text: f.text, on: union.has(f.id), at: minutes(revealAt.get(f.id)), order: i + 1, bonus: false })),
        ...sc.facts.filter((f) => !f.required && union.has(f.id)).map((f) => ({ label: f.label || f.id, text: f.text, on: true, at: minutes(revealAt.get(f.id)), bonus: true })),
      ],
      // сколько вопросов пришлось на один факт — чем меньше, тем точнее спрашивали
      precision: done ? Math.round((questions / done) * 10) / 10 : null,
    });
  }

  // Победитель: больше фактов, при равенстве — быстрее
  // Место: сначала балл за решение, потом раскрытые факты, потом время
  teams.sort((a, b) => (b.solution?.score ?? -1) - (a.solution?.score ?? -1) || b.done - a.done || (a.minutes ?? 999) - (b.minutes ?? 999));
  teams.forEach((t, i) => { t.rank = i + 1; });
  return { phase: game?.phase || null, started_at: game?.started_at || null, finished_at: game?.finished_at || null, teams };
}

/**
 * Команда прислала решение — модель ставит балл 0–10.
 * Доступно только после того, как раскрыты все обязательные факты. Принимается одно решение.
 */
export async function submitSolution(sessionId, text, { llm = callJudge } = {}) {
  const st = await getSessionState(sessionId);
  if (!st) return { error: 'no_session' };
  const { session, scenario } = st;
  if (session.solution) return { solution: session.solution, already: true };
  const game = await getGame();
  const stage = stageOf(game).stage;
  if (stage === 'lobby') return { error: 'not_started' };
  if (stage === 'over' || stage === 'finished') return { error: 'time_over' };

  text = String(text || '').trim();
  if (text.length < 40) return { error: 'too_short' };
  if (text.length > 4000) return { error: 'too_long' };

  let out;
  try {
    const missedFacts = scenario.facts.filter((f) => f.required && !session.revealed.includes(f.id));
    const note = missedFacts.length
      ? `\n\nКоманда не успела выяснить: ${missedFacts.map((f) => f.label || f.id).join(', ')}. Это не повод занижать балл само по себе — оценивай по тому, насколько решение подходит клиентке.`
      : '';
    out = await llm([
      { role: 'system', content: buildJudgePrompt(scenario) },
      { role: 'user', content: `Решение команды «${session.label || 'без названия'}»:\n\n${text}${note}` },
    ]);
  } catch (e) {
    console.error('[judge]', e.status || '', e.message);
    return { error: 'llm_error' };
  }

  const solution = {
    text,
    score: Math.max(0, Math.min(10, Math.round(Number(out.score) || 0))),
    verdict: String(out.verdict || '').trim(),
    strengths: (out.strengths || []).slice(0, 3).map(String),
    missed: (out.missed || []).slice(0, 3).map(String),
    at: new Date().toISOString(),
  };
  await store.updateSession(sessionId, { solution });
  await store.addMessage(sessionId, scenario.id, 'system', `SOLUTION ${solution.score}/10\n${text}`);
  return { solution };
}
