(() => {
  const API = window.API_URL || '';
  const $ = (s) => document.querySelector(s);
  const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
  const params = new URLSearchParams(location.search);
  let key = params.get('key') || ls.get('bc-admin-key') || '';
  if (params.get('key')) { ls.set('bc-admin-key', key); history.replaceState(null, '', location.pathname + (params.get('min') ? '?min=' + params.get('min') : '')); } // не держим ключ в адресной строке
  let pollTimer;
  const prev = new Map(); // id → { done, tags } с прошлого опроса
  // Свои иконки вместо эмодзи
  const ICON = {
    unlock: '<svg class="ic" viewBox="0 0 20 20" aria-hidden="true"><path d="M6 9V6.6A4 4 0 0 1 13.6 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><rect x="3.2" y="9" width="13.6" height="8.4" rx="2.6" fill="currentColor"/><circle cx="10" cy="13.2" r="1.5" fill="var(--bg2)"/></svg>',
    spark: '<svg class="ic" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 1.6l1.9 5.1 5.1 1.9-5.1 1.9L10 15.6l-1.9-5.1L3 8.6l5.1-1.9z" fill="currentColor"/><circle cx="16.4" cy="15.2" r="1.8" fill="currentColor" opacity=".7"/><circle cx="4.2" cy="14.6" r="1.2" fill="currentColor" opacity=".5"/></svg>',
    done: '<svg class="ic" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="currentColor" opacity=".18"/><path d="M5.6 10.4l2.9 2.9 5.9-6.6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let firstPaint = true;

  async function call(path, method = 'GET') {
    const res = await fetch(API + path, { method, headers: { 'X-Admin-Key': key } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'Нет связи с сервером'), { status: res.status });
    return data;
  }


  // --- Флакон: сосуд наполняется цветом команды, одно деление = один факт ---
  function flacon(t) {
    const TOP = 52, BOT = 188;                       // границы жидкости внутри флакона
    const k = Math.max(0, Math.min(1, t.done / t.total));
    const y = BOT - (BOT - TOP) * k;
    const uid = 'f-' + t.id;
    const marks = Array.from({ length: t.total - 1 }, (_, i) => {
      const my = BOT - (BOT - TOP) * ((i + 1) / t.total);
      return `<line x1="26" y1="${my}" x2="40" y2="${my}" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity=".35"/>`;
    }).join('');
    const bubbles = [0, 1, 2].map((i) => `<circle class="bub b${i}" cx="${46 + i * 14}" cy="0" r="${3 - i * .6}" fill="#fff" opacity=".45"/>`).join('');
    return `
<svg class="flacon${t.done === t.total ? ' full' : ''}" viewBox="0 0 120 210" aria-label="Раскрыто ${t.done} из ${t.total}">
  <defs>
    <clipPath id="${uid}-body"><path d="M22 66c0-9 6-13 13-16l6-3v-9h38v9l6 3c7 3 13 7 13 16v112c0 9-7 16-16 16H38c-9 0-16-7-16-16z"/></clipPath>
    <linearGradient id="${uid}-liq" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="currentColor" stop-opacity=".95"/>
      <stop offset="1" stop-color="currentColor" stop-opacity=".62"/>
    </linearGradient>
    <linearGradient id="${uid}-glass" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity=".16"/>
      <stop offset=".5" stop-color="#fff" stop-opacity=".03"/>
      <stop offset="1" stop-color="#fff" stop-opacity=".12"/>
    </linearGradient>
  </defs>

  <rect x="44" y="6" width="32" height="18" rx="6" fill="currentColor" opacity=".85"/>
  <rect x="50" y="22" width="20" height="12" rx="3" fill="currentColor" opacity=".45"/>

  <g clip-path="url(#${uid}-body)">
    <rect x="0" y="0" width="120" height="210" fill="url(#${uid}-glass)"/>
    <g class="liquid" style="--y:${y}px">
      <rect x="0" y="0" width="240" height="210" fill="url(#${uid}-liq)" transform="translate(0 6)"/>
      <path class="wave w1" d="M0 6c15 0 15-8 30-8s15 8 30 8 15-8 30-8 15 8 30 8 15-8 30-8 15 8 30 8 15-8 30-8 15 8 30 8v210H0z" fill="url(#${uid}-liq)"/>
      <path class="wave w2" d="M0 6c15 0 15-7 30-7s15 7 30 7 15-7 30-7 15 7 30 7 15-7 30-7 15 7 30 7 15-7 30-7 15 7 30 7v210H0z" fill="currentColor" opacity=".35"/>
      <g class="bubbles">${bubbles}</g>
    </g>
  </g>

  <path d="M22 66c0-9 6-13 13-16l6-3v-9h38v9l6 3c7 3 13 7 13 16v112c0 9-7 16-16 16H38c-9 0-16-7-16-16z"
        fill="none" stroke="currentColor" stroke-width="2.5" opacity=".75"/>
  <path d="M34 78c0-6 4-10 9-12" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" opacity=".28"/>
  ${marks}
</svg>`;
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
      const body = el('div', 'team-body');
      const vessel = el('div', 'vessel');
      vessel.innerHTML = flacon(t);
      const right = el('div', 'team-right');
      const score = el('div', 'score');
      const big = el('span', 'big', was ? was.done : 0);
      score.append(big, el('span', 'score-note', `/ ${t.total}`));
      const cap = el('div', 'score-cap', 'фактов раскрыто');
      countUp(big, was ? was.done : 0, t.done);
      const tags = el('div', 'tags');
      t.tags.forEach((g, j) => {
        const isNew = g.on && was && !was.tags[j];
        tags.append(el('span', 'tag' + (g.on ? ' on' : '') + (isNew ? ' pop' : ''), g.on ? g.label : '• • •')); // закрытые не подсказываем
      });
      for (const x of t.extra) tags.append(el('span', 'tag', '+ ' + x));
      right.append(score, cap);
      body.append(vessel, right);
      const st = el('div', 'status' + (t.finished ? ' ok' : ''));
      if (t.finished) { st.innerHTML = ICON.done + '<span></span>'; st.querySelector('span').textContent = 'Проблема сформулирована'; }
      else st.textContent = t.sessions ? `Идёт консультация · устройств: ${t.sessions}` : 'Ждём команду…';
      card.append(head, body, tags, st);
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
  $('#end-btn').onclick = async () => {
    if (params.get('demo')) return location.href = 'admin/';
    if (!confirm('Завершить игру? Команды выйдут из своих комнат, прогресс и коды сбросятся. Логи диалогов сохранятся.')) return;
    try { await call('/api/admin/end', 'POST'); clearTimeout(pollTimer); location.href = 'admin/'; }
    catch (e) { alert(e.message); }
  };

  $('#reset-btn').onclick = async () => {
    if (!confirm('Сбросить прогресс команд? Коды останутся прежними, диалоги начнутся заново.')) return;
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
