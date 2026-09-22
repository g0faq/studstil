process.chdir('/Users/fedaersov/dev/Визажист');
const R='/Users/fedaersov/dev/Визажист/src';
const { config } = await import(R+'/config.js');
const { useSqlite } = await import(R+'/core/db.js');
const E = await import(R+'/core/engine.js');
const { buildJudgePrompt } = await import(R+'/core/prompt.js');
const { getScenario } = await import(R+'/core/scenarios.js');
await useSqlite(':memory:'); config.rateLimitMs = 0;
const a=(c,m)=>{if(!c){console.error('FAIL',m);process.exit(1)}console.log('ok',m)};
const g = await E.createGame(['Акварель','Б','В']); await E.startGame();
const { sessionId } = await E.enterCode(g.teams[0].code, 'd1');
a((await E.submitSolution(sessionId,'мало')).error === 'too_short', 'слишком короткое решение отклонено');
const early = (await E.enterCode(g.teams[1].code, 'dx')).sessionId; // другая команда, фактов ещё нет
a(!!(await E.submitSolution(early,'Решение до разгадки: команда может перейти к разбору в любой момент игры.',{ llm: async()=>({score:5,verdict:'ок',strengths:[],missed:[]}) })).solution, 'разбор доступен до разгадки');
for (const id of ['new_job','current_style','time_limit','fear_status'])
  await E.handleMessage(sessionId,'q',{ llm: async()=>({reply:'р',revealed_fact_ids:[id]}) });
const judge = async (msgs) => { globalThis.__p = msgs[0].content; return { score: 8.4, verdict: 'Хорошо', strengths: ['каре','тайминг','брови','лишнее'], missed: [] }; };
const r1 = await E.submitSolution(sessionId,'Предлагаем структурное каре, укладка 10 минут, натуральный макияж с акцентом на брови и губы, костюм с чёткой линией плеч.',{ llm: judge });
a(r1.solution.score === 8 && r1.solution.strengths.length === 3, 'балл округлён, список обрезан до 3');
a((await E.publicState(sessionId)).solution.score === 8, 'балл виден команде');
const r2 = await E.submitSolution(sessionId,'Другое решение, достаточно длинное чтобы пройти проверку длины текста.',{ llm: judge });
a(r2.already && r2.solution.score === 8, 'второе решение не перезаписывает первое');
a((await E.boardState())[0].score === 8, 'балл на табло');
const res = await E.resultsState();
a(res.teams[0].team === 'Акварель' && res.teams[0].solution.score === 8, 'в итогах первая команда с баллом');
const p = buildJudgePrompt(getScenario('olga'));
a(p.includes('Страх') && p.includes('структурная стрижка') === false && p.includes('0–10'), 'в промпте судьи есть факты и шкала');
