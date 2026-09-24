// Табло: отметки загораются по порядку находки, а не по порядку фактов в сценарии
process.chdir('/Users/fedaersov/dev/Визажист');
const R = '/Users/fedaersov/dev/Визажист/src';
const { config } = await import(R + '/config.js');
const { useSqlite } = await import(R + '/core/db.js');
const E = await import(R + '/core/engine.js');
const { getScenario } = await import(R + '/core/scenarios.js');
await useSqlite(':memory:'); config.rateLimitMs = 0;
const a = (c, m, x = '') => { if (!c) { console.error('FAIL', m, x); process.exit(1); } console.log('ok', m); };
const mock = (ids) => async () => ({ reply: 'ответ', revealed_fact_ids: ids });

const g = await E.createGame(['А', 'Б', 'В', 'Г']);
await E.startGame();
const team = g.teams[0];
const sc = getScenario(team.scenario_id);
const req = sc.facts.filter((f) => f.required);
const bonus = sc.facts.find((f) => !f.required);
const { sessionId } = await E.enterCode(team.code, 'd1');

// Находим третий по списку факт первым
await E.handleMessage(sessionId, 'q', { llm: mock([req[2].id]) });
let lane = (await E.boardState()).find((t) => t.id === sc.id);
a(lane.done === 1, 'найден один факт', String(lane.done));
a(lane.tags[0].on && lane.tags[0].label === req[2].label, 'первым делением стал факт, найденный первым', lane.tags[0].label);
a(!lane.tags[1].on && !lane.tags[2].on, 'остальные деления пустые');
a(lane.tags[1].label === '' && lane.tags[3].label === '', 'у пустых делений нет подписи');

// Затем первый по списку — он должен встать вторым делением
await E.handleMessage(sessionId, 'q', { llm: mock([req[0].id]) });
lane = (await E.boardState()).find((t) => t.id === sc.id);
a(lane.done === 2, 'фактов стало два', String(lane.done));
a(lane.tags[0].label === req[2].label, 'первое деление не переехало');
a(lane.tags[1].on && lane.tags[1].label === req[0].label, 'вторым делением стал факт, найденный вторым', lane.tags[1].label);

// Доп-сведения не занимают деления и по-прежнему видны отдельно
if (bonus) {
  await E.handleMessage(sessionId, 'q', { llm: mock([bonus.id]) });
  lane = (await E.boardState()).find((t) => t.id === sc.id);
  a(lane.done === 2, 'доп-сведение не занимает деление', String(lane.done));
  a(lane.extra.includes(bonus.label || bonus.id), 'доп-сведение показано отдельно', lane.extra.join(','));
}

// Порядок держится до конца
for (const f of [req[3], req[1]]) await E.handleMessage(sessionId, 'q', { llm: mock([f.id]) });
lane = (await E.boardState()).find((t) => t.id === sc.id);
a(lane.done === 4, 'найдены все четыре', String(lane.done));
a(lane.tags.map((t) => t.label).join('|') === [req[2], req[0], req[3], req[1]].map((f) => f.label).join('|'),
  'порядок делений совпадает с порядком находок', lane.tags.map((t) => t.label).join('|'));

console.log('--- всего проверок:');
console.log(bonus ? 11 : 9);
