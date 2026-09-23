process.chdir('/Users/fedaersov/dev/Визажист');
const R='/Users/fedaersov/dev/Визажист/src';
const { config } = await import(R+'/config.js');
const { useSqlite, store } = await import(R+'/core/db.js');
const E = await import(R+'/core/engine.js');
await useSqlite(':memory:'); config.rateLimitMs = 0;
const a=(c,m)=>{if(!c){console.error('FAIL',m);process.exit(1)}console.log('ok',m)};
const mock=(ids)=>async()=>({reply:'р',revealed_fact_ids:ids});


const g = await E.createGame(['Акварель','Б','В','Г']);
a(g.duration_sec === 420, 'по умолчанию игра на 7 минут');
await E.startGame();
const { sessionId } = await E.enterCode(g.teams[0].code, 'd1');
let st = await E.publicState(sessionId);
a(st.timer.stage === 'play' && st.timer.left > 400, 'таймер идёт');
a(st.hints_left === 2, 'у команды 2 подсказки');

const h1 = await E.nextTrigger(sessionId);
a(h1.text && h1.hints === 1, 'подсказка выдана и посчитана');
a((await E.publicState(sessionId)).hints === 1, 'подсказка видна команде');
a((await E.boardState())[0].hints === 1, 'подсказка видна на табло');
await E.nextTrigger(sessionId);
a((await E.nextTrigger(sessionId)).error === 'no_hints', 'подсказки заканчиваются');

// разбор доступен, даже если факты не раскрыты
const r = await E.submitSolution(sessionId, 'Одежда: деловой костюм с чёткой линией плеч. Волосы: каре. Макияж: за 7 минут.');
a(r.submission.version === 1, 'работу можно сдать, не раскрыв все факты');
const r2 = await E.submitSolution(sessionId, 'Второй вариант решения, достаточно длинный для проверки.');
a(r2.already, 'финальная работа только одна');

// перематываем время: часы идут дальше, но ничего не закрывают
const game = await store.getMeta('game');
game.started_at = new Date(Date.now() - 421 * 1000).toISOString();
await store.setMeta('game', game);
const over = E.stageOf(game);
a(over.stage === 'play' && over.left === 0 && over.over_by >= 1, 'после 7 минут игра продолжается, идёт счёт сверх времени', JSON.stringify(over));
a(!(await E.handleMessage(sessionId, 'вопрос', { llm: mock([]) })).error, 'чат работает и после сигнала');
a((await E.nextTrigger(sessionId)).error !== 'time_up', 'подсказки время не закрывает');
const { sessionId: s2 } = await E.enterCode(g.teams[1].code, 'd2');
a((await E.submitSolution(s2, 'Одежда: жакет. Волосы: длина сохранена. Макияж: лёгкий. Успеваем в последнюю минуту.')).submission.version === 1, 'работа принимается после сигнала');

game.started_at = new Date(Date.now() - 5200 * 1000).toISOString();
await store.setMeta('game', game);
a(E.stageOf(game).over_by > 4000, 'счёт сверх времени растёт');
const { sessionId: s3 } = await E.enterCode(g.teams[2].code, 'd3');
a((await E.submitSolution(s3, 'Поздний ответ: часы игру не закрывают, работу принимаем.')).submission.version === 1, 'поздняя работа тоже принимается');

// закрывает игру только преподаватель
await E.finishGame();
a(E.stageOf(await store.getMeta('game')).stage === 'finished', 'преподаватель завершил игру');
const { sessionId: s4 } = await E.enterCode(g.teams[3].code, 'd4');
a((await E.submitSolution(s4, 'После завершения игры работу уже не принимаем ни от кого.')).error === 'time_over', 'после завершения работа не принимается');
