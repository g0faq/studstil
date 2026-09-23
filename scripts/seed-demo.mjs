// Наполняет игру правдоподобными данными без обращения к платным моделям.
// Нужен для проверки экранов итогов и дашборда: npm run seed
import { useSqlite, store } from '../src/core/db.js';
import { config } from '../src/config.js';
import * as E from '../src/core/engine.js';
import { RUBRIC } from '../src/core/prompt.js';

await useSqlite(config.dbPath);
config.rateLimitMs = 0;

const SCORES = [86, 74, 74, 0];
const TEXTS = [
  'Одежда: жакет прямого кроя с чёткой линией плеч, прямые брюки, плотный трикотаж — капсула из шести вещей. Волосы: длину сохраняем, форма средней длины, сушка феном десять минут. Макияж: брови, лёгкое покрытие для чувствительной кожи, матовая помада за пять минут.',
  'Одежда: монохром графит, лаконичная геометрия, структурный жакет. Волосы: заметная перемена формы, работа с сединой через тонирование. Макияж: акцент на глаза холодной гаммой, без розового и блёсток.',
  'Одежда: casual chic, прямые джинсы и трикотаж, вещи переживают стирку. Волосы: длина сохранена, мягкое отрастание цвета. Макияж: пять шагов на каждый день, один дополнительный для съёмки.',
  '',
];

const judge = (i) => async () => {
  const target = SCORES[i];
  const share = target / 100;
  const criteria = Object.fromEntries(RUBRIC.map((r) => [r.key, {
    score: Math.round(r.max * share),
    evidence: 'Команда обосновала решение репликами клиентки и учла её ограничения.',
  }]));
  return {
    data: {
      criteria,
      found_needs: ['контекст выхода на работу', 'лимит времени'],
      missed_needs: ['страх обесценивания'],
      respected_limits: ['длина волос сохранена'],
      violated_limits: [],
      strengths: ['Точные вопросы о распорядке дня', 'Решение реально по времени'],
      recommendations: ['Добавить уход за волосами', 'Пояснить выбор оттенка'],
      verdict: 'Вы собрали цельный образ и удержали границы клиентки.',
      needs_teacher_review: false,
    },
    usage: { model: 'gpt-5.6-terra', ms: 4200, prompt_tokens: 4800, completion_tokens: 900 },
  };
};

await E.endGame();
const game = await E.createGame(['Акварель', 'Глянец', 'Контур', 'Ракурс']);
await E.startGame();

const persona = (ids) => async () => ({ reply: 'Отвечаю на ваш вопрос.', revealed_fact_ids: ids, usage: { model: 'gpt-5.6-luna', ms: 900, prompt_tokens: 700, completion_tokens: 60 } });
const factsOf = { olga: ['o1', 'o2', 'o3', 'o4'], marina: ['m1', 'm2', 'm3'], alina: ['a1', 'a2'], valeria: [] };

for (const [i, t] of game.teams.entries()) {
  const { sessionId } = await E.enterCode(t.code, `seed-${i}-a`);
  await E.enterCode(t.code, `seed-${i}-b`);
  for (const f of factsOf[t.scenario_id] || []) await E.handleMessage(sessionId, 'Вопрос команды', { llm: persona([f]) });
  if (!TEXTS[i]) continue;
  await E.submitSolution(sessionId, TEXTS[i]);
  await E.evaluateWork(sessionId, { judge: judge(i) });
}

// Картинку берём готовую, если она уже есть от прошлых прогонов
const keys = (await store.activeSessions()).map((s) => s.submission?.image?.key).filter(Boolean);
console.log('Игра наполнена. Коды:', game.teams.map((t) => `${t.name}=${t.code}`).join(' '));
console.log('Работ с оценкой:', (await E.resultsState()).teams.filter((t) => t.score !== null).length, '| картинок:', keys.length);
