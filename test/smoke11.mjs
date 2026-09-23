// Команда с нескольких телефонов: вопросы не должны перебивать друг друга
process.chdir('/Users/fedaersov/dev/Визажист');
const R = '/Users/fedaersov/dev/Визажист/src';
const { config } = await import(R + '/config.js');
const { useSqlite, store } = await import(R + '/core/db.js');
const E = await import(R + '/core/engine.js');
await useSqlite(':memory:'); config.rateLimitMs = 0;
const a = (c, m, x = '') => { if (!c) { console.error('FAIL', m, x); process.exit(1); } console.log('ok', m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Модель отвечает не мгновенно: на этом и ломалась параллельная работа двух телефонов
const slowPersona = (reply, ids, ms) => async () => { await sleep(ms); return { reply, revealed_fact_ids: ids }; };

const { sessionId } = await E.enterCode('14235867', 'phone-1');
a(sessionId.startsWith('test:olga') || sessionId.startsWith('test:'), 'команда вошла', sessionId);
const scenarioId = sessionId.split(':')[1];
const facts = (await E.publicState(sessionId)) && (await import(R + '/core/scenarios.js')).getScenario(scenarioId).facts;
const [f1, f2] = facts.filter((f) => f.required).map((f) => f.id);

// Два телефона спрашивают одновременно, первый отвечает дольше второго
const [r1, r2] = await Promise.all([
  E.handleMessage(sessionId, 'вопрос с первого телефона', { llm: slowPersona('ответ первому', [f1], 300), deviceId: 'phone-1' }),
  E.handleMessage(sessionId, 'вопрос со второго телефона', { llm: slowPersona('ответ второму', [f2], 50), deviceId: 'phone-2' }),
]);

a(!r1.error && !r2.error, 'оба телефона получили ответ', JSON.stringify([r1.error, r2.error]));
a(r1.reply === 'ответ первому' && r2.reply === 'ответ второму', 'ответы не перепутаны');

const st = await E.publicState(sessionId);
const open = st.revealed.map((f) => f.id);
a(open.includes(f1) && open.includes(f2), 'факты обоих телефонов сохранены', open.join(','));
a(st.progress.required_open === 2, 'прогресс считает оба факта', String(st.progress.required_open));

// Лента одинаковая для всех телефонов команды и без потерянных сообщений
const mine = st.messages.filter((m) => m.who === 'me').map((m) => m.text);
a(mine.includes('вопрос с первого телефона') && mine.includes('вопрос со второго телефона'), 'оба вопроса в ленте');
const theirs = st.messages.filter((m) => m.who === 'them').map((m) => m.text);
a(theirs.includes('ответ первому') && theirs.includes('ответ второму'), 'оба ответа в ленте');

// Порядок: каждый ответ идёт сразу за своим вопросом
const texts = st.messages.map((m) => m.text);
a(texts.indexOf('ответ первому') === texts.indexOf('вопрос с первого телефона') + 1, 'ответ идёт за своим вопросом (телефон 1)');
a(texts.indexOf('ответ второму') === texts.indexOf('вопрос со второго телефона') + 1, 'ответ идёт за своим вопросом (телефон 2)');

// Подсказка с третьего телефона в тот же момент тоже не теряется
const [hint, r3] = await Promise.all([
  E.nextTrigger(sessionId),
  E.handleMessage(sessionId, 'третий вопрос', { llm: slowPersona('ответ третьему', [], 200), deviceId: 'phone-3' }),
]);
a(!hint.error && hint.text, 'подсказка выдана', JSON.stringify(hint.error || ''));
a(!r3.error && r3.reply === 'ответ третьему', 'третий телефон получил свой ответ');
const after = await E.publicState(sessionId);
a(after.hints === 1, 'подсказка посчитана один раз', String(after.hints));
a(after.messages.filter((m) => m.text === hint.text).length === 1, 'подсказка не задвоилась');

// Замок снимается: следующий вопрос не ждёт впустую
const t0 = Date.now();
const r4 = await E.handleMessage(sessionId, 'четвёртый вопрос', { llm: slowPersona('ответ четвёртому', [], 10), deviceId: 'phone-1' });
a(!r4.error && Date.now() - t0 < 2000, 'очередь освобождается после ответа', String(Date.now() - t0));

console.log('--- всего проверок:');
console.log(14);
