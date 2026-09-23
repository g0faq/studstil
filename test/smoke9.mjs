// Полный круг из четырёх команд с подменёнными ответами моделей: сдача, оценка, картинка, места.
process.chdir('/Users/fedaersov/dev/Визажист');
const R = '/Users/fedaersov/dev/Визажист/src';
const { config } = await import(R + '/config.js');
const { useSqlite, store } = await import(R + '/core/db.js');
const E = await import(R + '/core/engine.js');
await useSqlite(':memory:');
config.rateLimitMs = 0;

const a = (c, m, x = '') => { if (!c) { console.error('FAIL', m, x); process.exit(1); } console.log('ok', m); };
const persona = (ids) => async () => ({ reply: 'реплика', revealed_fact_ids: ids, usage: { model: 'luna', ms: 10, prompt_tokens: 100, completion_tokens: 20 } });

// Подменённые вызовы: считаем, сколько раз реально дёрнули «платные» модели
let judgeCalls = 0, imageCalls = 0, instructionCalls = 0;
const judge = async () => {
  judgeCalls += 1;
  return {
    data: {
      criteria: {
        diagnostics: { score: 18, evidence: 'спросили о контексте и границах' },
        understanding: { score: 13, evidence: 'запрос сформулирован верно' },
        outfit: { score: 12, evidence: 'силуэт объяснён' },
        hair: { score: 11, evidence: 'длина сохранена' },
        makeup: { score: 10, evidence: 'быстрый макияж' },
        coherence: { score: 8, evidence: 'части согласованы' },
        realism: { score: 8, evidence: 'уложились во время' },
      },
      found_needs: ['контекст', 'быт'], missed_needs: ['эмоция'],
      respected_limits: ['длина сохранена'], violated_limits: [],
      strengths: ['точные вопросы', 'реалистичный тайминг'],
      recommendations: ['добавить уход', 'пояснить цвет'],
      verdict: 'Хорошая работа', needs_teacher_review: false,
    },
    usage: { model: 'terra', ms: 900, prompt_tokens: 2000, completion_tokens: 300 },
  };
};
const instructor = async () => {
  instructionCalls += 1;
  return { data: { instruction: 'Замените свитшот на жакет, волосы уложите мягко', changed: ['одежда', 'волосы'] }, usage: { model: 'luna', ms: 300, prompt_tokens: 400, completion_tokens: 60 } };
};
const imager = async () => { imageCalls += 1; return { b64: Buffer.from('картинка').toString('base64'), mime: 'image/webp', usage: { model: 'sunburst', ms: 5000, prompt_tokens: null, completion_tokens: null } }; };
const jobs = { judge, imager, instructor };

const TEXT = 'Одежда: жакет с чёткой линией плеч и прямые брюки, капсула из шести вещей. Волосы: длина сохранена, мягкая форма с укладкой за десять минут. Макияж: брови, лёгкий тон для чувствительной кожи, матовая помада за пять минут.';

// --- Игра на четыре команды ---
const g = await E.createGame(['Акварель', 'Глянец', 'Контур', 'Ракурс']);
a(g.teams.length === 4, 'игра на четыре команды');
await E.startGame();

const sids = [];
for (const t of g.teams) {
  const s1 = await E.enterCode(t.code, 'phone-a');
  const s2 = await E.enterCode(t.code, 'phone-b');
  a(s1.sessionId === s2.sessionId, `${t.name}: два телефона — одна работа`);
  sids.push(s1.sessionId);
}

// Диалоги
for (const sid of sids) {
  await E.handleMessage(sid, 'Почему сейчас?', { llm: persona([]) });
  await E.handleMessage(sid, 'Сколько времени утром?', { llm: persona([]) });
}

// --- Сдача с двух телефонов одновременно ---
const [r1, r2] = await Promise.all([E.submitSolution(sids[0], TEXT), E.submitSolution(sids[0], TEXT + ' второй вариант')]);
const first = r1.submission || r2.submission;
a(first && first.version === 1, 'сдача зафиксирована как версия 1');
a(r1.already || r2.already, 'вторая одновременная сдача не создала новую работу');
const st0 = await E.publicState(sids[0]);
a(st0.work.eval_status === 'queued' && st0.work.image_status === 'queued', 'задачи поставлены в очередь');
a(st0.work.eval === undefined && st0.reference === null, 'до публикации команда не видит баллы и эталон');

// --- Фоновая обработка: параллельные вызовы не задваивают платные запросы ---
await Promise.all([E.runJobs(sids[0], jobs), E.runJobs(sids[0], jobs), E.runJobs(sids[0], jobs)]);
await E.runJobs(sids[0], jobs); // вторая задача — картинка
await E.runJobs(sids[0], jobs);
a(judgeCalls === 1, 'оценка вызвана ровно один раз', `вызовов: ${judgeCalls}`);
a(imageCalls === 1 && instructionCalls === 1, 'генерация вызвана один раз', `картинок: ${imageCalls}`);

const after = await store.getSession(sids[0]);
a(after.submission.eval.total === 80, 'сумму посчитал сервер', String(after.submission.eval.total));
a(after.submission.eval_status === 'done' && after.submission.image_status === 'done', 'статусы завершены');
a(await store.getBlob(after.submission.image.key), 'картинка сохранена в хранилище');

// Повторное открытие результатов не запускает новых запросов
await E.runJobs(sids[0], jobs);
await E.evaluateWork(sids[0], { judge });
a(judgeCalls === 1 && imageCalls === 1, 'повторное открытие не тратит деньги');

// --- Остальные команды: разные исходы ---
const scores = [80, 92, 92, null]; // четвёртая не сдала
for (let i = 1; i < 4; i++) {
  if (scores[i] === null) continue;
  await E.submitSolution(sids[i], TEXT);
  const custom = async () => {
    const base = await judge();
    const diff = scores[i] - 80;
    base.data.criteria.diagnostics.score = Math.min(20, 18 + diff);
    return base;
  };
  await E.evaluateWork(sids[i], { judge: custom });
}

// Ошибка генерации не ломает оценку
const failImage = async () => { throw new Error('генератор недоступен'); };
await E.renderImage(sids[1], { imager: failImage, instructor });
const failed = await store.getSession(sids[1]);
a(failed.submission.image_status === 'error' && failed.submission.eval.total > 0, 'ошибка картинки не мешает оценке');

// Ошибка оценки и разрешённый повтор
const failJudge = async () => { throw new Error('терра недоступна'); };
await E.submitSolution(sids[3], TEXT);
await E.evaluateWork(sids[3], { judge: failJudge });
let s3 = await store.getSession(sids[3]);
a(s3.submission.eval_status === 'error' && s3.submission.eval === null, 'ошибка оценки сохранена как статус');
await E.evaluateWork(sids[3], { judge, force: true });
s3 = await store.getSession(sids[3]);
a(s3.submission.eval_status === 'done', 'повтор оценки прошёл');

// --- Места: равные баллы получают одинаковое место ---
let res = await E.resultsState();
const ranks = res.teams.map((t) => `${t.team}:${t.score}:${t.rank}`);
a(res.teams.filter((t) => t.rank === 1).length === 2, 'два первых места при равных баллах', ranks.join(' '));
a(res.teams.filter((t) => t.rank === 2).length === 0 && res.teams.some((t) => t.rank === 3), 'второе место пропущено: схема 1,1,3', ranks.join(' '));
a(!res.published, 'итоги ещё не опубликованы');

// --- Правка баллов преподавателем ---
a((await E.adjustScore(sids[0], { criteria: { outfit: 15 }, comment: '' })).error === 'comment_required', 'правка без пояснения запрещена');
const adj = await E.adjustScore(sids[0], { criteria: { outfit: 15 }, comment: 'силуэт объяснён лучше, чем увидела модель' });
a(adj.eval.total === 83 && adj.eval.ai_total === 80, 'исходная оценка ИИ сохранена', `${adj.eval.ai_total} → ${adj.eval.total}`);
res = await E.resultsState();
a(res.teams.find((t) => t.id === 'olga').score === 83, 'места пересчитаны после правки');

// --- Публикация итогов ---
await E.publishResults();
const pub = await E.publicState(sids[0]);
a(pub.work.published && pub.work.eval.total === 83, 'после публикации команда видит свой балл');
a(pub.work.image && pub.reference, 'после публикации доступны картинка и разбор');

// --- Техническая статистика ---
res = await E.resultsState();
a(res.tech.calls > 0 && res.tech.by_model.terra >= 1, 'учтены вызовы моделей', JSON.stringify(res.tech.by_model));
a(res.tech.prompt_tokens > 0 && res.tech.total_ms > 0, 'учтены токены и время');
a(res.tech.errors.length >= 1, 'ошибки записаны для преподавателя');

// --- Повторная сдача по разрешению преподавателя ---
await E.allowResubmit(sids[0]);
const re = await E.submitSolution(sids[0], TEXT + ' Уточнили цвет и уход.');
a(re.submission.version === 2, 'повторная сдача создаёт версию 2');
const arch = await store.getSession(sids[0]);
a((arch.archive || []).length === 1 && arch.archive[0].eval.total === 83, 'прошлая версия с оценкой сохранена');

// Картинка прошлой игры не должна показываться в новой
const oldKey = (await store.getSession(sids[0])).submission?.image?.key;
await E.endGame();
const g2 = await E.createGame(['Акварель', 'Глянец', 'Контур', 'Ракурс']);
await E.startGame();
const fresh = (await E.enterCode(g2.teams[0].code, 'phone-a')).sessionId;
await E.submitSolution(fresh, TEXT);
await E.renderImage(fresh, { imager, instructor });
const newKey = (await store.getSession(fresh)).submission.image.key;
a(newKey !== oldKey, 'ключ картинки уникален для каждой игры', `${oldKey} → ${newKey}`);
