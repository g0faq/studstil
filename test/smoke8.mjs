// Система должна работать с любым числом команд: проверяем на четырёх
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

process.chdir('/Users/fedaersov/dev/Визажист');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-scen-'));
for (const f of ['olga.json', 'marina.json', 'alina.json']) fs.copyFileSync(`scenarios/${f}`, path.join(dir, f));
// Четвёртая команда: минимальный сценарий без ui — цвет и подпись должны подставиться сами
fs.writeFileSync(path.join(dir, 'kristina.json'), JSON.stringify({
  id: 'kristina', access_code: '404',
  persona: { name: 'Кристина', age: 19, description: 'Студентка, готовится к конкурсу.', speech: 'На «ты».', character: 'Смелая.' },
  greeting: 'Привет! Мне нужно что-то придумать к конкурсу.',
  facts: [
    { id: 'contest', label: 'Контекст', text: 'Через месяц конкурс.', reveal_when: 'спрашивают о поводе', level: 1, required: true },
    { id: 'fear', label: 'Страх', text: 'Боится выглядеть вульгарно.', reveal_when: 'спрашивают о страхах', level: 3, required: true },
    { id: 'budget', label: 'Бюджет', text: 'Денег мало.', reveal_when: 'спрашивают о бюджете', level: 2, required: false },
  ],
  triggers: ['Можешь спросить, чего я боюсь.'],
  final_message: 'Мне нужно выделиться, но не быть вульгарной.',
  problem: 'Кристине нужен яркий, но не вульгарный конкурсный образ.',
  tasks: ['Образ для сцены'],
  solution: { goal: 'Яркий сценический образ', outfit: ['Костюм для сцены'], hair: ['Укладка с объёмом'], makeup: ['Сценический макияж'], why: ['Боится вульгарности'], cross: ['Визаж, парикмахерское'] },
}, null, 2), 'utf8');
process.env.SCENARIOS_DIR = dir;

const R = '/Users/fedaersov/dev/Визажист/src';
const { config } = await import(R + '/config.js');
const { useSqlite } = await import(R + '/core/db.js');
const E = await import(R + '/core/engine.js');
await useSqlite(':memory:'); config.rateLimitMs = 0;
const a = (c, m, x = '') => { if (!c) { console.error('FAIL', m, x); process.exit(1); } console.log('ok', m); };
const mock = (ids) => async () => ({ reply: 'р', revealed_fact_ids: ids });
const { RUBRIC } = await import(R + '/core/prompt.js');
const judge = async () => ({
  data: {
    criteria: Object.fromEntries(RUBRIC.map((r) => [r.key, { score: Math.round(r.max * 0.7), evidence: '—' }])),
    found_needs: [], missed_needs: [], respected_limits: [], violated_limits: [],
    strengths: ['а','б'], recommendations: ['в','г'], verdict: 'ок', needs_teacher_review: false,
  },
  usage: { model: 'terra', ms: 10, prompt_tokens: 10, completion_tokens: 5 },
});

const g = await E.createGame(['Первая', 'Вторая', 'Третья', 'Четвёртая']);
a(g.teams.length === 4, 'игра на четыре команды');
a(new Set(g.teams.map((t) => t.code)).size === 4, 'четыре разных кода', g.teams.map((t) => t.code).join(','));
a(g.teams[3].name === 'Четвёртая' && g.teams[3].scenario_id === 'kristina', 'четвёртой достался новый сценарий');
await E.startGame();

const s4 = (await E.enterCode(g.teams[3].code, 'd4')).sessionId;
const st = await E.publicState(s4);
a(st.client.name === 'Кристина' && /^#/.test(st.client.accent), 'цвет подставился автоматически', st.client.accent);
a(st.client.meta.includes('команда 4'), 'подпись команды проставлена', st.client.meta);
a(st.progress.required_total === 2, 'у новой клиентки свои обязательные факты');
a(st.hints_left === 1, 'подсказки берутся из её сценария');

for (const id of ['contest', 'fear']) await E.handleMessage(s4, 'q', { llm: mock([id]) });
const fin = await E.publicState(s4);
a(fin.finished && fin.final.message && !fin.reference, 'финиш без утечки готового решения');
await E.submitSolution(s4, 'Одежда: костюм для сцены. Волосы: укладка с объёмом. Макияж: яркий, но не вульгарный.');
await E.evaluateWork(s4, { judge });

const board = await E.boardState();
a(board.length === 4 && board[3].team === 'Четвёртая', 'на табло четыре дорожки');
a(board.every((t) => t.accent && t.tags.length === t.total), 'у каждой команды свой цвет и свои отметки');
const res = await E.resultsState();
a(res.teams.length === 4 && res.teams.filter((t) => t.rank === 1).length === 1, 'итоги на четыре команды, место у оценённой работы');
a(res.teams.find((t) => t.team === 'Четвёртая').score > 0, 'балл четвёртой команды учтён');
const method = E.methodState();
a(method.length === 4 && method[3].solution.goal, 'на странице разбора четыре клиентки');

fs.rmSync(dir, { recursive: true, force: true });
