process.chdir('/Users/fedaersov/dev/Визажист');
const R = '/Users/fedaersov/dev/Визажист/src';
const { config } = await import(R + '/config.js');
const { useSqlite } = await import(R + '/core/db.js');
const E = await import(R + '/core/engine.js');
await useSqlite(':memory:'); config.rateLimitMs = 0;
const a = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } console.log('ok', m); };
const mock = (ids) => async () => ({ reply: 'ответ', revealed_fact_ids: ids });

const g = await E.createGame(['Акварель', 'Глянец', 'Стиль', 'Ракурс']);
await E.startGame();
const code = g.teams[0].code;
const d1 = await E.enterCode(code, 'dev-1');
const d2 = await E.enterCode(code, 'dev-2');
a(d1.sessionId === d2.sessionId, 'два устройства — одна сессия команды');
a((await E.publicState(d1.sessionId)).devices === 2, 'устройства посчитаны');
a((await E.publicState(d1.sessionId)).messages.length === 1, 'приветствие не задвоилось');

await E.handleMessage(d1.sessionId, 'Ты работаешь?', { llm: mock(['o1']) });
const seenBy2 = await E.publicState(d2.sessionId);
a(seenBy2.messages.length === 3, 'второе устройство видит вопрос и ответ');
a(seenBy2.progress.required_open === 1, 'прогресс общий');

const before = seenBy2.rev;
await E.handleMessage(d2.sessionId, 'Какой стиль?', { llm: mock(['o2']) });
const after = await E.publicState(d1.sessionId);
a(after.rev !== before, 'rev меняется — клиент поймёт, что есть новое');
a(after.messages.length === 5 && after.progress.required_open === 2, 'диалог общий в обе стороны');

const other = await E.enterCode(g.teams[1].code, 'dev-3');
a(other.sessionId !== d1.sessionId && (await E.publicState(other.sessionId)).messages.length === 1, 'у другой команды свой чат');
a((await E.boardState())[0].sessions === 2, 'на табло 2 устройства у первой команды');

await E.finishGame();
a((await E.handleMessage(d1.sessionId, 'ещё', { llm: mock([]) })).error === 'game_over', 'после завершения писать нельзя');
const res = await E.resultsState();
a(res.teams.length === 4 && res.teams.some((t) => t.questions >= 1), 'статистика собрана');
a(res.teams.every((t) => t.rank === undefined || typeof t.rank === 'number'), 'места только у оценённых работ');
a(res.teams.every((t) => t.status), 'у каждой команды есть статус работы');
