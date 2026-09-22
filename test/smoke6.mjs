process.chdir('/Users/fedaersov/dev/Визажист');
const R='/Users/fedaersov/dev/Визажист/src';
const { config } = await import(R+'/config.js');
const { useSqlite, store } = await import(R+'/core/db.js');
const E = await import(R+'/core/engine.js');
await useSqlite(':memory:'); config.rateLimitMs = 0;
const a=(c,m)=>{if(!c){console.error('FAIL',m);process.exit(1)}console.log('ok',m)};
const mock=(ids)=>async()=>({reply:'р',revealed_fact_ids:ids});
const judge=async()=>({score:7,verdict:'ок',strengths:['a'],missed:[]});

const g = await E.createGame(['Акварель','Б','В']);
a(g.duration_sec === 600 && g.answer_sec === 60, 'по умолчанию 10 минут + 1 минута на ответ');
await E.startGame();
const { sessionId } = await E.enterCode(g.teams[0].code, 'd1');
let st = await E.publicState(sessionId);
a(st.timer.stage === 'play' && st.timer.left > 595, 'таймер идёт');
a(st.hints_left === 2, 'у команды 2 подсказки');

const h1 = await E.nextTrigger(sessionId);
a(h1.text && h1.hints === 1, 'подсказка выдана и посчитана');
a((await E.publicState(sessionId)).hints === 1, 'подсказка видна команде');
a((await E.boardState())[0].hints === 1, 'подсказка видна на табло');
await E.nextTrigger(sessionId);
a((await E.nextTrigger(sessionId)).error === 'no_hints', 'подсказки заканчиваются');

// разбор доступен, даже если факты не раскрыты
const r = await E.submitSolution(sessionId, 'Предлагаем структурное каре и деловой костюм с чёткой линией плеч, макияж за 7 минут.', { llm: judge });
a(r.solution.score === 7, 'решение принимается без всех фактов');
const r2 = await E.submitSolution(sessionId, 'Второй вариант решения, достаточно длинный для проверки.', { llm: judge });
a(r2.already, 'финальный ответ только один');

// перематываем время: этап ответа
const game = await store.getMeta('game');
game.started_at = new Date(Date.now() - 601 * 1000).toISOString();
await store.setMeta('game', game);
a(E.stageOf(game).stage === 'answer', 'после 10 минут — этап ответа');
a((await E.handleMessage(sessionId, 'вопрос', { llm: mock([]) })).error === 'time_up', 'чат закрыт после сигнала');
a((await E.nextTrigger(sessionId)).error === 'time_up', 'подсказки тоже закрыты');
const { sessionId: s2 } = await E.enterCode(g.teams[1].code, 'd2');
a((await E.submitSolution(s2, 'Успеваем вписать ответ в последнюю минуту, текст достаточной длины.', { llm: judge })).solution.score === 7, 'в минуту ответа решение принимается');

game.started_at = new Date(Date.now() - 700 * 1000).toISOString();
await store.setMeta('game', game);
a(E.stageOf(game).stage === 'over', 'время вышло совсем');
const { sessionId: s3 } = await E.enterCode(g.teams[2].code, 'd3');
a((await E.submitSolution(s3, 'Поздний ответ, который уже не должен приниматься сервером вообще.', { llm: judge })).error === 'time_over', 'после минуты ответ не принять');
