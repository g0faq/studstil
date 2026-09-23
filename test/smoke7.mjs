// Статистика считается только за текущую игру, а не за все прошлые
process.chdir('/Users/fedaersov/dev/Визажист');
const R='/Users/fedaersov/dev/Визажист/src';
const { config } = await import(R+'/config.js');
const { useSqlite } = await import(R+'/core/db.js');
const E = await import(R+'/core/engine.js');
await useSqlite(':memory:'); config.rateLimitMs = 0;
const a=(c,m,x='')=>{if(!c){console.error('FAIL',m,x);process.exit(1)}console.log('ok',m)};
const mock=(ids)=>async()=>({reply:'р',revealed_fact_ids:ids});


// первая игра: 3 вопроса
let g = await E.createGame(['Первая','Б','В']); await E.startGame();
let sid = (await E.enterCode(g.teams[0].code,'d1')).sessionId;
for (const q of ['q1','q2','q3']) await E.handleMessage(sid,q,{ llm: mock([]) });
a((await E.resultsState()).teams.find(t=>t.team==='Первая').questions === 3, 'в первой игре 3 вопроса');

// вторая игра: логи прошлой не должны попасть в статистику
g = await E.createGame(['Вторая','Б','В']); await E.startGame();
sid = (await E.enterCode(g.teams[0].code,'d1')).sessionId;
await E.handleMessage(sid,'только один вопрос',{ llm: mock(['o1']) });
await E.submitSolution(sid,'Одежда: жакет. Волосы: длина сохранена. Макияж: лёгкий тон и брови. Решение новой игры.');
const t = (await E.resultsState()).teams.find(x=>x.team==='Вторая');
a(t.questions === 1, 'во второй игре только её вопросы', 'стало '+t.questions);
a(t.work_minutes !== null && t.work_minutes < 5, 'время считается от старта текущей игры', 'минут: '+t.work_minutes);
a(t.facts.find(f=>f.label==='Контекст').at !== null, 'у факта есть минута раскрытия');
