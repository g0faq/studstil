// Калибровка оценки: полный образ против неполного
import 'dotenv/config';
const API = process.argv[2] || 'https://api.studstil.ru', KEY = process.env.ADMIN_KEY;
let pass=0, fail=0; const ok=(c,m,x='')=>{c?pass++:fail++;console.log(`${c?'✅':'❌'} ${m}${x?' — '+x:''}`)};
const call=(p,{method='GET',body,admin}={})=>fetch(API+p,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(admin?{'X-Admin-Key':KEY}:{})},...(body?{body:JSON.stringify(body)}:{})}).then(async r=>({status:r.status,data:await r.json().catch(()=>({}))}));

const CASES = [
  { name: 'полный образ (одежда + стрижка + макияж)', min: 7, max: 10, text:
    'Одежда: капсула на неделю — жакет с чёткой линией плеч, прямые брюки, юбка-карандаш, плотный трикотаж; силуэт полуприлегающий, пояс выше линии живота, ткани не мнутся. Стрижка и цвет: удлинённый боб с чётким срезом, укладка феном 10 минут, тёплый тон с мягкими бликами у лица, без коротких длин. Макияж: дневной за 7 минут, архитектура бровей, матовая нюдовая помада, тон для чувствительной кожи, кремовые текстуры.' },
  { name: 'только стрижка, без одежды и макияжа', min: 0, max: 6, text:
    'Мы предлагаем удлинённый боб с чётким срезом и тёплым оттенком, укладка феном занимает десять минут, форма держится сама и хорошо выглядит без плойки. Это освежит лицо и добавит собранности.' },
  { name: 'две части из трёх (без макияжа)', min: 0, max: 6, text:
    'Стрижка: удлинённый боб с чётким срезом, укладка за 10 минут, тёплый тон. Одежда: жакет с линией плеч, прямые брюки, полуприлегающий силуэт, капсула из 6 вещей, ткани не мнутся и легко стираются.' },
];

for (const c of CASES) {
  await call('/api/admin/end', { method: 'POST', admin: true });
  const g = (await call('/api/admin/game', { method: 'POST', admin: true, body: { names: ['Тест'] } })).data.game;
  await call('/api/admin/start', { method: 'POST', admin: true });
  const s = (await call('/api/session', { method: 'POST', body: { code: g.teams[0].code, deviceId: 'j' } })).data.sessionId;
  const r = (await call('/api/solution', { method: 'POST', body: { sessionId: s, text: c.text } })).data.solution;
  ok(r.score >= c.min && r.score <= c.max, `${c.name}: ожидали ${c.min}–${c.max}`, `балл ${r.score}; ${(r.missed||[]).slice(0,1).join('')}`.slice(0, 120));
}
await call('/api/admin/end', { method: 'POST', admin: true });
console.log(`\nИтого: ${pass} ✅ / ${fail} ❌`); process.exit(fail?1:0);
