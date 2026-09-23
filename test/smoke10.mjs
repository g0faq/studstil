// Сквозной тестовый код: игра проходится в любой момент и не влияет на команды
process.chdir('/Users/fedaersov/dev/Визажист');
const R = '/Users/fedaersov/dev/Визажист/src';
const { config } = await import(R + '/config.js');
const { useSqlite, store } = await import(R + '/core/db.js');
const E = await import(R + '/core/engine.js');
const { RUBRIC } = await import(R + '/core/prompt.js');
await useSqlite(':memory:'); config.rateLimitMs = 0;
const a = (c, m, x = '') => { if (!c) { console.error('FAIL', m, x); process.exit(1); } console.log('ok', m); };
const persona = (ids) => async () => ({ reply: 'ответ', revealed_fact_ids: ids });
const judge = async () => ({
  data: { criteria: Object.fromEntries(RUBRIC.map((r) => [r.key, { score: r.max - 2, evidence: '—' }])),
    found_needs: [], missed_needs: [], respected_limits: [], violated_limits: [],
    strengths: ['а','б'], recommendations: ['в','г'], verdict: 'ок', needs_teacher_review: false },
  usage: { model: 'terra', ms: 5, prompt_tokens: 1, completion_tokens: 1 },
});
const TEXT = 'Одежда: жакет и брюки. Волосы: длина сохранена. Макияж: лёгкий тон и брови, пять минут.';

// Игры нет вообще
const t1 = await E.enterCode('14235867', 'tester-1');
a(t1.ok && t1.sessionId.startsWith('test:'), 'тестовый код работает без игры', t1.sessionId);
const st1 = await E.publicState(t1.sessionId);
a(st1.phase === 'running' && st1.timer.stage === 'play', 'тестовая сессия сразу в игре');
a(!(await E.handleMessage(t1.sessionId, 'Почему сейчас?', { llm: persona(['o1']) })).error, 'в тесте можно спрашивать');

// Идёт настоящая игра — тестовый код по-прежнему работает и не мешает ей
const g = await E.createGame(['Акварель', 'Глянец', 'Контур', 'Ракурс']);
await E.startGame();
const real = await E.enterCode(g.teams[0].code, 'phone');
const t2 = await E.enterCode('14235867', 'tester-2');
a(t2.ok && t2.sessionId !== real.sessionId, 'тест и команда — разные сессии');
a((await E.enterCode('14235867', 'tester-3')).sessionId !== t2.sessionId, 'у каждого устройства свой тест');

await E.handleMessage(t2.sessionId, 'вопрос', { llm: persona(['o1']) });
await E.submitSolution(t2.sessionId, TEXT);
await E.evaluateWork(t2.sessionId, { judge });
const done = await E.publicState(t2.sessionId);
a(done.work.published && done.work.eval.total > 0, 'в тесте результат виден сразу, без публикации', `${done.work.eval.total}/100`);
a(done.reference && done.reference.problem, 'в тесте сразу доступен разбор преподавателя');

const board = await E.boardState();
a(board.length === 4 && board.every((t) => t.sessions <= 1), 'тестовые сессии не попадают на табло');
const res = await E.resultsState();
a(res.teams.length === 4 && !res.teams.some((t) => t.team === 'Тестовый прогон'), 'тестовые прогоны не попадают в итоги');
a(res.teams.find((t) => t.id === real.sessionId.split(':')[1])?.status === 'not_submitted', 'работа настоящей команды не задета');

// Игра завершена — тест всё равно доступен
await E.finishGame();
const t4 = await E.enterCode('14235867', 'tester-4');
a(t4.ok && !(await E.handleMessage(t4.sessionId, 'вопрос', { llm: persona([]) })).error, 'после завершения игры тест продолжает работать');
