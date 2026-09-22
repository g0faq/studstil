import { config } from '../config.js';
import { store } from './db.js';
import { getScenario, findByCode, loadScenarios } from './scenarios.js';
import { buildSystemPrompt } from './prompt.js';
import { callPersona } from './llm.js';

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

/** Привязка сессии к сценарию по коду команды. */
export async function enterCode(sessionId, code, label = null) {
  const scenario = findByCode(code);
  if (!scenario) return { ok: false };
  return { ok: true, ...(await startScenario(sessionId, scenario.id, label)) };
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
export async function handleMessage(sessionId, text, { llm = callPersona } = {}) {
  const state = await getSessionState(sessionId);
  if (!state) return { error: 'no_session', reply: null, finished: false };
  const { session, scenario } = state;

  if (session.finished) return { error: 'already_finished', reply: null, progress: state.progress, finished: true };
  text = String(text || '').trim();
  if (!text) return { error: 'empty', reply: null, progress: state.progress, finished: false };
  if (text.length > config.maxInputChars) return { error: 'too_long', reply: null, progress: state.progress, finished: false };

  // Rate limit хранится в сессии: на serverless память процесса между запросами не сохраняется
  const now = Date.now();
  if (now - (session.last_call || 0) < config.rateLimitMs) {
    return { error: 'rate_limited', reply: null, progress: state.progress, finished: false };
  }
  await store.updateSession(sessionId, { last_call: now });

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
    await store.updateSession(sessionId, { last_call: 0 });
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
  const messages = (await store.history(sessionId, 200)).map((m) => ({ who: m.role === 'user' ? 'me' : 'them', text: m.content }));
  return {
    client: {
      name: sc.persona.name, letter: sc.persona.name[0], meta: ui.meta || `${sc.persona.age}`,
      accent: ui.accent || '#FF7A1A', soft: ui.soft || 'rgba(255,122,26,0.4)',
      accent_green: ui.accent_green || null, soft_green: ui.soft_green || null,
      photo: ui.photo || null, photo_green: ui.photo_green || null,
      card_hint: ui.card_hint || sc.greeting, chips: ui.chips || [],
    },
    revealed, progress, finished: session.finished, messages,
    final: session.finished ? finalOf(sc) : null,
  };
}

/** Следующая подсказка-«триггер», если команда зависла. Счётчик хранится в сессии. */
export async function nextTrigger(sessionId) {
  const st = await getSessionState(sessionId);
  if (!st || st.session.finished) return null;
  const list = st.scenario.triggers || [];
  const i = st.session.nudges || 0;
  if (i >= list.length) return null;
  await store.updateSession(sessionId, { nudges: i + 1 });
  await store.addMessage(sessionId, st.scenario.id, 'assistant', list[i]);
  return list[i];
}

/** Табло: прогресс команд (объединение открытых фактов всех сессий сценария). */
export async function boardState() {
  const sessions = await store.activeSessions();
  return [...loadScenarios().values()]
    .sort((a, b) => String(a.access_code).localeCompare(String(b.access_code), 'ru', { numeric: true }))
    .map((sc) => {
      const group = sessions.filter((s) => s.scenario_id === sc.id);
      const union = new Set(group.flatMap((s) => s.revealed));
      const req = sc.facts.filter((f) => f.required);
      return {
        id: sc.id, name: sc.persona.name, age: sc.persona.age, letter: sc.persona.name[0],
        team: ((sc.ui?.meta || '').split('·').pop().trim() || sc.id).replace(/^./, (c) => c.toUpperCase()),
        accent: sc.ui?.accent || '#FF7A1A', accent_green: sc.ui?.accent_green || null,
        photo: sc.ui?.photo || null, photo_green: sc.ui?.photo_green || null, code: sc.access_code,
        sessions: group.length, finished: group.some((s) => s.finished),
        done: req.filter((f) => union.has(f.id)).length, total: req.length,
        tags: req.map((f) => ({ label: f.label || f.id, on: union.has(f.id) })),
        extra: sc.facts.filter((f) => !f.required && union.has(f.id)).map((f) => f.label || f.id),
      };
    });
}
