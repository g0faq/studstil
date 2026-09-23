// Базовые правила диалога
process.chdir('/Users/fedaersov/dev/Визажист');
const R='/Users/fedaersov/dev/Визажист/src';
const { config } = await import(R+'/config.js');
const { useSqlite, store } = await import(R+'/core/db.js');
const E = await import(R+'/core/engine.js');
const { getScenario } = await import(R+'/core/scenarios.js');
const { buildSystemPrompt } = await import(R+'/core/prompt.js');
await import(R+'/adapters/telegram.js');
const { handler } = await import(R+'/adapters/http.js');
await useSqlite(':memory:'); config.rateLimitMs = 0;
const a=(c,m)=>{if(!c){console.error('FAIL',m);process.exit(1)}console.log('ok',m)};
const mock=(ids)=>async()=>({reply:'реплика',revealed_fact_ids:ids});

a(!(await E.enterCode('нет-такого')).ok, 'неверный код');
const { sessionId: s1 } = await E.enterCode(' 101 ', 'd1');
a(!!s1, 'код с пробелами');
a((await E.handleMessage('team:нет', 'hi')).error === 'no_session', 'без сессии');
let r = await E.handleMessage(s1, 'q', { llm: mock(['выдуманный_id']) });
a(r.progress.open === 0, 'несуществующий id отброшен');
a((await E.handleMessage(s1, 'x'.repeat(600), { llm: mock([]) })).error === 'too_long', 'лимит длины');
for (const id of ['o1','o2','o3']) r = await E.handleMessage(s1, 'q', { llm: mock([id, id]) });
a(!r.finished && r.progress.required_open === 3, 'прогресс 3/4, дубли не считаются');
r = await E.handleMessage(s1, 'q', { llm: mock(['o4']) });
a(r.finished && r.final.brief.length === 3 && !r.final.tasks, 'финиш: нейтральное задание без готового ответа');
a((await E.handleMessage(s1, 'q', { llm: mock([]) })).error === 'already_finished', 'после финиша');
a(buildSystemPrompt(getScenario('olga'), ['o1']).includes('[o1] (УЖЕ РАССКАЗАНО'), 'статусы фактов в промпте');
config.rateLimitMs = 10000;
const { sessionId: s2 } = await E.enterCode('202', 'd2');
await E.handleMessage(s2, 'a', { llm: mock([]) });
a((await E.handleMessage(s2, 'b', { llm: mock([]) })).error === 'rate_limited', 'rate limit');
config.rateLimitMs = 0;
a((await store.history(s1, 4)).length === 4, 'история ограничена N');
a((await store.resetAll()) === 2 && (await store.log(s1)).length > 0, 'reset_all сохраняет лог');

const call = (method, url, body, headers = {}) => new Promise((resolve) => {
  const res = { headersSent: false, h: {}, setHeader(k, v) { this.h[k] = v; }, writeHead(c) { this.code = c; this.headersSent = true; }, end(d) { resolve({ code: this.code, data: d ? JSON.parse(d) : null }); } };
  handler({ method, url, headers, body, socket: {} }, res);
});
let x = await call('POST', '/api/session', { code: '202', deviceId: 'phone' });
a(x.code === 200 && x.data.state.client.name === 'Марина', 'POST /api/session');
a((await call('GET', '/api/session?id=' + x.data.sessionId)).code === 200, 'GET /api/session');
a((await call('GET', '/api/board')).code === 401, 'табло без ключа 401');
a((await call('POST', '/api/session', { code: '000' })).code === 404, 'неверный код 404');
