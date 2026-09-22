// CLI-чат с персонажем: npm run chat -- --scenario elena [--save]
import readline from 'node:readline/promises';
import { stdin, stdout, argv } from 'node:process';
import { config } from '../src/config.js';
import { useSqlite } from '../src/core/db.js';
import { startScenario, handleMessage, getSessionState } from '../src/core/engine.js';
import { loadScenarios } from '../src/core/scenarios.js';

const arg = (name) => { const i = argv.indexOf(`--${name}`); return i > -1 ? argv[i + 1] : undefined; };
const scenarioId = arg('scenario') || [...loadScenarios().keys()][0];
await useSqlite(argv.includes('--save') ? config.dbPath : ':memory:');
config.rateLimitMs = 0;

const sid = `cli:${Date.now()}`;
const { scenario, greeting } = await startScenario(sid, scenarioId, 'cli');
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
console.log(dim(`Сценарий: ${scenario.id} | модель: ${config.openaiModel} | команды: /facts /restart /exit`));
console.log(`\n${scenario.persona.name}: ${greeting}\n`);

const rl = readline.createInterface({ input: stdin, output: stdout });
rl.on('close', () => process.exit(0));
while (true) {
  const q = (await rl.question('Вы: ')).trim();
  if (!q) continue;
  if (q === '/exit') break;
  if (q === '/restart') { const r = await startScenario(sid, scenarioId, 'cli'); console.log(`\n${scenario.persona.name}: ${r.greeting}\n`); continue; }
  if (q === '/facts') {
    const st = await getSessionState(sid);
    for (const f of scenario.facts) console.log(dim(`${st.session.revealed.includes(f.id) ? '●' : '○'} ${f.id}${f.required ? ' *' : ''}`));
    continue;
  }
  const res = await handleMessage(sid, q);
  if (res.error) { console.log(dim(`[${res.error}]`)); if (res.error === 'already_finished') break; continue; }
  console.log(`\n${scenario.persona.name}: ${res.reply}`);
  console.log(dim(`   ${res.newly_revealed.length ? '🔓 ' + res.newly_revealed.join(', ') + ' | ' : ''}обязательные ${res.progress.required_open}/${res.progress.required_total}, всего ${res.progress.open}/${res.progress.total}`) + '\n');
  if (res.finished) { console.log(`🎉 ${res.final.message}\n\n${res.final.problem}\n${res.final.tasks.map((t) => '— ' + t).join('\n')}\n`); break; }
}
rl.close();
