// Реальный круг игры с настоящими вызовами моделей: диалог (Luna), оценка (Terra), картинка (sunburst).
// Тратит деньги. Запуск: node test/live-full.mjs [https://api.studstil.ru] [teams=1]
import 'dotenv/config';

const API = process.argv[2] || 'http://localhost:8080';
const TEAMS = Number(process.argv[3] || 1);
const KEY = process.env.ADMIN_KEY;
let pass = 0, fail = 0;
const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log(`${c ? '✅' : '❌'} ${m}${x ? ' — ' + x : ''}`); };
const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));

const call = async (p, { method = 'GET', body, admin, raw } = {}) => {
  const res = await fetch(API + p, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(admin ? { 'X-Admin-Key': KEY } : {}), Origin: 'https://studstil.ru' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (raw) return { status: res.status, bytes: (await res.arrayBuffer()).byteLength, type: res.headers.get('content-type') };
  return { status: res.status, data: await res.json().catch(() => ({})) };
};

const WORK = `Одежда: жакет прямого кроя с чёткой линией плеч, прямые брюки и плотный трикотаж — капсула из шести вещей, которые сочетаются между собой и переживают стирку.
Волосы: длину сохраняем, делаем форму средней длины с чётким срезом; сушка феном за десять минут, без плойки. Цвет освежаем мягкими бликами у лица.
Макияж: за пять-семь минут — оформленные брови, лёгкое покрытие для чувствительной кожи, матовая помада нюд.
Почему так: ей важно, чтобы в ней видели руководителя, а на сборы есть только пятнадцать минут; короткую стрижку не предлагаем, у неё был неудачный опыт.`;

console.log(`\n=== Реальный прогон: ${API} ===\n`);

await call('/api/admin/end', { method: 'POST', admin: true });
const g = (await call('/api/admin/game', { method: 'POST', admin: true, body: { names: ['Акварель', 'Глянец', 'Контур', 'Ракурс'] } })).data.game;
ok(g?.teams?.length === 4, 'игра на четыре команды создана', g?.teams?.map((t) => t.code).join(' '));
await call('/api/admin/start', { method: 'POST', admin: true });

const sids = [];
for (let i = 0; i < TEAMS; i++) {
  const s = (await call('/api/session', { method: 'POST', body: { code: g.teams[i].code, deviceId: `real-${i}` } })).data;
  sids.push(s.sessionId);
}

// Диалог живой моделью
for (const [i, sid] of sids.entries()) {
  const q = ['Почему решили обновить образ именно сейчас?', 'Сколько времени есть утром на сборы?', 'Чего точно не хотите?'];
  for (const text of q) {
    const r = (await call('/api/message', { method: 'POST', body: { sessionId: sid, text, deviceId: `real-${i}` } })).data;
    ok(!r.error && r.reply, `ответ клиентки: «${text.slice(0, 32)}…»`, (r.reply || r.error || '').slice(0, 60));
    await sleep(0.6);
  }
}

// Сдача работы
for (const sid of sids) {
  const r = (await call('/api/solution', { method: 'POST', body: { sessionId: sid, text: WORK } })).data;
  ok(r.submission?.version === 1, 'работа сдана', `версия ${r.submission?.version}`);
}

// Фоновые задачи: как их дёргает страница
console.log('   считаем оценку и рисуем образ…');
const deadline = Date.now() + 300000;
let done = false;
while (!done && Date.now() < deadline) {
  for (const sid of sids) await call('/api/jobs', { method: 'POST', body: { sessionId: sid } });
  const states = await Promise.all(sids.map(async (sid) => (await call(`/api/session?id=${sid}`)).data.state.work));
  done = states.every((w) => w && ['done', 'error', 'skipped'].includes(w.eval_status) && ['done', 'error', 'skipped'].includes(w.image_status));
  if (!done) { process.stdout.write('.'); await sleep(5); }
}
console.log('');

const res = (await call('/api/admin/results', { admin: true })).data;
for (const t of res.teams.filter((x) => x.status !== 'not_submitted')) {
  ok(t.eval_status === 'done', `${t.team}: оценка получена`, t.eval_error || `${t.score}/100`);
  if (t.eval) {
    const sum = Object.values(t.eval.criteria).reduce((n, c) => n + c.score, 0);
    ok(sum === t.eval.total, `${t.team}: сумму сошлась с критериями`, `${sum}`);
    ok(t.eval.strengths.length === 2 && t.eval.recommendations.length === 2, `${t.team}: две сильные стороны и две рекомендации`);
    ok(Object.values(t.eval.criteria).every((c) => c.evidence?.length > 5), `${t.team}: у каждого критерия есть доказательство`);
  }
  ok(['done', 'error'].includes(t.image_status), `${t.team}: генерация завершилась`, t.image_error || t.image_status);
  if (t.image_status === 'done') {
    const img = await call(`/api/image?key=${t.image.key}`, { raw: true });
    ok(img.status === 200 && img.bytes > 10000, `${t.team}: картинка отдаётся`, `${Math.round(img.bytes / 1024)} КБ, ${img.type}`);
  }
}

ok(res.tech.calls >= 2, 'вызовы моделей учтены', JSON.stringify(res.tech.by_model));
ok(res.tech.prompt_tokens > 0, 'токены посчитаны', `${res.tech.prompt_tokens} вход / ${res.tech.completion_tokens} выход`);

// Повторное открытие результатов не тратит деньги
const callsBefore = res.tech.calls;
await Promise.all(sids.map((sid) => call('/api/jobs', { method: 'POST', body: { sessionId: sid } })));
const res2 = (await call('/api/admin/results', { admin: true })).data;
ok(res2.tech.calls === callsBefore, 'повторное открытие не создаёт новых запросов', `${callsBefore} → ${res2.tech.calls}`);

// Публикация
ok(!res2.published, 'до публикации итоги закрыты');
const before = (await call(`/api/session?id=${sids[0]}`)).data.state.work;
ok(before.eval === undefined, 'до публикации команда не видит балл');
await call('/api/admin/publish', { method: 'POST', admin: true });
const after = (await call(`/api/session?id=${sids[0]}`)).data.state.work;
ok(after.published && after.eval?.total > 0, 'после публикации команда видит балл', `${after.eval?.total}/100`);
ok(after.image ? !!after.image.key : true, 'картинка доступна команде');

console.log(`\nИтого: ${pass} ✅ / ${fail} ❌`);
if (res.teams[0]?.eval) {
  const e = res.teams[0].eval;
  console.log(`\nПример оценки (${res.teams[0].team}): ${e.total}/100`);
  for (const c of Object.values(e.criteria)) console.log(`  ${c.title}: ${c.score}/${c.max} — ${c.evidence.slice(0, 90)}`);
  console.log(`  Вывод: ${e.verdict}`);
}
process.exit(fail ? 1 : 0);
