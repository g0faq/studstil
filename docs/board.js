(() => {
  const API = window.API_URL || '';
  const $ = (s) => document.querySelector(s);
  const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
  const params = new URLSearchParams(location.search);
  let key = params.get('key') || ls.get('bc-admin-key') || '';
  if (params.get('key')) { ls.set('bc-admin-key', key); history.replaceState(null, '', location.pathname + (params.get('min') ? '?min=' + params.get('min') : '')); } // не держим ключ в адресной строке
  let pollTimer;
  const prev = new Map(); // id → { done, tags } с прошлого опроса
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let firstPaint = true;

  async function call(path, method = 'GET') {
    const res = await fetch(API + path, { method, headers: { 'X-Admin-Key': key } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'Нет связи с сервером'), { status: res.status });
    return data;
  }

  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  function render(teams) {
    const grid = $('#grid'); grid.replaceChildren();
    for (const t of teams) {
      const was = prev.get(t.id);
      const gained = was && t.done > was.done;
      const card = el('div', 'team glass' + (t.finished ? ' win' : '') + (gained ? ' bump' : '') + (firstPaint ? ' enter' : ''));
      card.style.setProperty('--i', grid.children.length);
      card.style.setProperty('--accent', (document.documentElement.dataset.palette === 'green' && t.accent_green) || t.accent);
      const head = el('div'); head.style.cssText = 'display:flex;align-items:center;gap:clamp(10px,1vw,20px);position:relative';
      const av = el('div', 'avatar', t.letter); 
      const photo = (document.documentElement.dataset.palette === 'green' && t.photo_green) || t.photo;
      if (photo) { const img = new Image(); img.alt = ''; img.onerror = () => img.remove(); img.src = photo; av.append(img); }
      const who = el('div'); who.style.cssText = 'display:flex;flex-direction:column;gap:2px';
      const tn = el('div', 'display', t.team); tn.style.cssText = 'font-weight:600;font-size:20px';
      who.append(tn, el('div', 'dim', `${t.name}, ${t.age} · код ${t.code}`));
      head.append(av, who);
      const score = el('div'); score.style.cssText = 'display:flex;align-items:baseline;gap:8px';
      const big = el('span', 'big', was ? was.done : 0);
      score.append(big, el('span', 'score-note', `/ ${t.total} факта`));
      countUp(big, was ? was.done : 0, t.done);
      const track = el('div', 'track'); track.style.height = '12px';
      const fill = el('div', 'fill'); fill.style.transform = `scaleX(${t.done / t.total})`; fill.style.width = '100%'; fill.style.transformOrigin = 'left'; track.append(fill);
      const tags = el('div'); tags.style.cssText = 'display:flex;gap:clamp(6px,.6vw,12px);flex-wrap:wrap';
      t.tags.forEach((g, j) => {
        const isNew = g.on && was && !was.tags[j];
        tags.append(el('span', 'tag' + (g.on ? ' on' : '') + (isNew ? ' pop' : ''), g.on ? g.label : '• • •')); // закрытые не подсказываем
      });
      for (const x of t.extra) tags.append(el('span', 'tag', '+ ' + x));
      const status = t.finished ? '✅ Проблема сформулирована' : t.sessions ? `Идёт консультация · устройств: ${t.sessions}` : 'Ждём команду…';
      const st = el('div', 'status', status);
      card.append(head, score, track, tags, st);
      grid.append(card);
      prev.set(t.id, { done: t.done, tags: t.tags.map((g) => g.on) });
    }
    firstPaint = false;
    $('#updated').textContent = (params.get('demo') ? 'Демонстрация · ' : 'Обновлено ') + new Date().toLocaleTimeString('ru-RU');
  }

  function countUp(node, from, to) {
    if (reduced || from === to) { node.textContent = to; return; }
    const t0 = performance.now(), dur = 700;
    (function f(t) {
      const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      node.textContent = Math.round(from + (to - from) * e);
      if (k < 1) requestAnimationFrame(f);
    })(t0);
  }

  async function poll() {
    clearTimeout(pollTimer);
    try { render((await call('/api/board')).teams); }
    catch (e) { if (e.status === 401) return showLogin('Неверный ключ'); $('#updated').textContent = '⚠️ ' + e.message; }
    pollTimer = setTimeout(poll, 3000);
  }

  function showLogin(err = '') { clearTimeout(pollTimer); $('#board').classList.add('hidden'); $('#login').classList.remove('hidden'); $('#login-err').textContent = err; }
  function showBoard() { $('#login').classList.add('hidden'); $('#board').classList.remove('hidden'); poll(); }

  $('#login-btn').onclick = () => { key = $('#key').value.trim(); ls.set('bc-admin-key', key); showBoard(); };
  $('#key').onkeydown = (e) => { if (e.key === 'Enter') $('#login-btn').click(); };
  $('#reset-btn').onclick = async () => {
    if (!confirm('Сбросить все сессии? Команды начнут заново с ввода кода. Логи сохранятся.')) return;
    try { const r = await call('/api/admin/reset', 'POST'); alert('Сброшено сессий: ' + r.reset); poll(); } catch (e) { alert(e.message); }
  };

  // Таймер урока: клик — старт/пауза, двойной клик — сброс. Длительность: ?min=10
  const total = (Number(params.get('min')) || 10) * 60;
  let left = total, tick = null;
  const paint = () => { $('#time').textContent = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`; };
  $('#timer').onclick = () => {
    if (tick) { clearInterval(tick); tick = null; return; }
    tick = setInterval(() => { left = Math.max(0, left - 1); paint(); if (!left) { clearInterval(tick); tick = null; } }, 1000);
  };
  $('#timer').ondblclick = () => { clearInterval(tick); tick = null; left = total; paint(); };
  paint();

  // --- Демо-режим: ?demo=1 — прогресс идёт сам, без учеников и без ключа ---
  const DEMO = [
    { id: 'olga', name: 'Ольга', age: 38, letter: 'О', team: 'Команда 1', code: '101', accent: '#FF7A1A', accent_green: '#3DDC84', photo: 'img/olga.svg', photo_green: 'img/olga-green.svg', total: 4,
      labels: ['Повод', 'Стиль сейчас', 'Время на сборы', 'Страх'], extraLabels: ['Успешный образ'] },
    { id: 'marina', name: 'Марина', age: 52, letter: 'М', team: 'Команда 2', code: '202', accent: '#F4C95D', accent_green: '#9FE870', photo: 'img/marina.svg', photo_green: 'img/marina-green.svg', total: 4,
      labels: ['Прошлый образ', 'Страх', 'Не молодиться', 'Образ с характером'], extraLabels: [] },
    { id: 'alina', name: 'Алина', age: 24, letter: 'А', team: 'Команда 3', code: '303', accent: '#FF5A5F', accent_green: '#FF5A5F', photo: 'img/alina.svg', photo_green: 'img/alina-green.svg', total: 4,
      labels: ['Цель', 'Время на сборы', 'Цвет волос', 'Чувство'], extraLabels: ['Референсы'] },
  ];
  let demoDone = [1, 0, 2];

  function demoTeams() {
    return DEMO.map((d, i) => ({
      ...d, done: demoDone[i], sessions: [2, 3, 2][i], finished: demoDone[i] === d.total,
      tags: d.labels.map((label, j) => ({ label, on: j < demoDone[i] })),
      extra: demoDone[i] === d.total ? d.extraLabels : [],
    }));
  }

  function runDemo() {
    $('#login').classList.add('hidden'); $('#board').classList.remove('hidden');
    $('#reset-btn').textContent = 'Демо-режим: сбросить прогресс';
    $('#reset-btn').onclick = () => { demoDone = [0, 0, 0]; render(demoTeams()); };
    render(demoTeams());
    setInterval(() => {
      const i = Math.floor(Math.random() * 3);
      if (demoDone[i] < DEMO[i].total && Math.random() > 0.35) demoDone[i]++;
      if (demoDone.every((d, k) => d === DEMO[k].total)) demoDone = [0, 1, 0];
      render(demoTeams());
    }, 4000);
  }

  if (params.get('demo')) runDemo();
  else key ? showBoard() : showLogin();
})();
