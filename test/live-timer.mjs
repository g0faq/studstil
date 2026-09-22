import 'dotenv/config';
const API='https://api.studstil.ru', KEY=process.env.ADMIN_KEY;
let pass=0,fail=0; const ok=(c,m,x='')=>{c?pass++:fail++;console.log(`${c?'✅':'❌'} ${m}${x?' — '+x:''}`)};
const call=async(p,{method='GET',body,admin}={})=>{const r=await fetch(API+p,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(admin?{'X-Admin-Key':KEY}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json().catch(()=>({}))}};
const sleep=(s)=>new Promise(r=>setTimeout(r,s*1000));

await call('/api/admin/end',{method:'POST',admin:true});
const g=(await call('/api/admin/game',{method:'POST',admin:true,body:{names:['Тест времени','Б','В']}})).data.game;
ok(g.duration_sec===60 && g.answer_sec===30,'игра на 1 минуту + 30 секунд на ответ');
await call('/api/admin/start',{method:'POST',admin:true});
const s=(await call('/api/session',{method:'POST',body:{code:g.teams[0].code,deviceId:'t'}})).data;
ok(s.state.timer.stage==='play','идёт игра', `осталось ${s.state.timer.left} с`);
ok(!(await call('/api/message',{method:'POST',body:{sessionId:s.sessionId,text:'Ты работаешь?',deviceId:'t'}})).data.error,'во время игры вопросы проходят');

console.log('   ждём окончания минуты…');
await sleep(62);
const t2=(await call(`/api/session?id=${s.sessionId}`)).data.state.timer;
ok(t2.stage==='answer','после минуты — этап финального ответа', `на ответ ${t2.left_answer} с`);
ok((await call('/api/message',{method:'POST',body:{sessionId:s.sessionId,text:'ещё вопрос',deviceId:'t'}})).data.code==='time_up','чат закрыт');
ok((await call('/api/hint',{method:'POST',body:{sessionId:s.sessionId}})).data.code==='time_up','подсказки закрыты');
const sol=(await call('/api/solution',{method:'POST',body:{sessionId:s.sessionId,text:'Каре до плеч с чётким срезом, укладка за 10 минут, натуральный макияж, жакет с линией плеч и полуприлегающий силуэт.'}})).data;
ok(sol.solution?.score>0,'в минуту ответа решение принимается и оценивается',`балл ${sol.solution?.score}`);

console.log('   ждём конца окна ответа…');
await sleep(32);
const s2=(await call('/api/session',{method:'POST',body:{code:g.teams[1].code,deviceId:'t2'}})).data;
ok((await call(`/api/session?id=${s2.sessionId}`)).data.state.timer.stage==='over','время вышло совсем');
ok((await call('/api/solution',{method:'POST',body:{sessionId:s2.sessionId,text:'Поздний ответ команды, который сервер уже не должен принимать ни при каких условиях.'}})).data.code==='time_over','поздний ответ отклонён');
await call('/api/admin/end',{method:'POST',admin:true});
console.log(`\nИтого: ${pass} ✅ / ${fail} ❌`); process.exit(fail?1:0);
