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


  // --- Дорожка: команда движется к финишу, каждый факт — шаг ---
  const ICON_FLAG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 21V3" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/><path d="M7.4 4.2h11.2l-2.6 4 2.6 4H7.4z" fill="currentColor"/></svg>';

  function laneEl(t, was) {
    const p = Math.max(0, Math.min(1, t.done / t.total));
    const lane = el('div', 'lane' + (t.finished ? ' done' : ''));
    lane.style.setProperty('--accent', (document.documentElement.dataset.palette === 'green' && t.accent_green) || t.accent);
    lane.style.setProperty('--p', (p * 100) + '%');

    // Кто бежит
    const who = el('div', 'who');
    const av = el('div', 'avatar');
    av.textContent = t.letter;
    const photo = (document.documentElement.dataset.palette === 'green' && t.photo_green) || t.photo;
    if (photo) { const img = new Image(); img.alt = ''; img.onerror = () => img.remove(); img.src = photo; av.append(img); }
    const wt = el('div', 'who-text');
    const nm = el('div', 'team-name', t.team);
    wt.append(nm, el('div', 'dim', `${t.name}, ${t.age} · код ${t.code}`));
    who.append(av, wt);

    // Дорожка с отметками по фактам
    const track = el('div', 'track');
    const line = el('div', 'line');
    const fill = el('div', 'line-fill');
    line.append(fill);
    const marks = el('div', 'marks');
    t.tags.forEach((g, i) => {
      const m = el('div', 'mark' + (g.on ? ' on' : '') + (g.on && was && !was.tags[i] ? ' pop' : ''));
      m.style.left = ((i + 1) / t.total * 100) + '%';
      m.append(el('i'), el('span', 'mark-label', g.on ? g.label : '• • •'));
      marks.append(m);
    });
    const runner = el('div', 'runner');
    const rav = el('div', 'avatar');
    rav.textContent = t.letter;
    if (photo) { const img = new Image(); img.alt = ''; img.onerror = () => img.remove(); img.src = photo; rav.append(img); }
    runner.append(rav);
    const flag = el('div', 'flag');
    flag.innerHTML = ICON_FLAG;
    track.append(line, marks, runner, flag);

    // Счёт
    const score = el('div', 'score');
    const big = el('span', 'big', was ? was.done : 0);
    score.append(big, el('span', 'score-note', `/${t.total}`));
    countUp(big, was ? was.done : 0, t.done);
    const right = el('div', 'right');
    const note = t.score !== null && t.score !== undefined ? `решение · ${t.score}/10`
      : t.finished ? 'финиш' : t.sessions ? `в игре · ${t.sessions}` : 'ждём команду';
    right.append(score, el('div', 'caps2', note));
    if (t.hints) right.append(el('div', 'caps2 hints', `подсказок: ${t.hints}`));

    lane.append(who, track, right);
    return lane;
  }

  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  function render(teams) {
    const grid = $('#grid'); grid.replaceChildren();
    teams.forEach((t, i) => {
      const was = prev.get(t.id);
      const lane = laneEl(t, was);
      lane.style.setProperty('--i', i);
      if (firstPaint) lane.classList.add('enter');
      if (was && t.done > was.done) lane.classList.add('bump');
      grid.append(lane);
      prev.set(t.id, { done: t.done, tags: t.tags.map((g) => g.on) });
    });
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
    try {
      const r = await call('/api/board');
      render(r.teams);
      applyTimer(r.timer);
    }
    catch (e) { if (e.status === 401) return showLogin('Неверный ключ'); $('#updated').textContent = '⚠️ ' + e.message; }
    pollTimer = setTimeout(poll, 3000);
  }

  function showLogin(err = '') { clearTimeout(pollTimer); $('#board').classList.add('hidden'); $('#login').classList.remove('hidden'); $('#login-err').textContent = err; }
  function showBoard() { $('#login').classList.add('hidden'); $('#board').classList.remove('hidden'); poll(); }

  $('#login-btn').onclick = () => { key = $('#key').value.trim(); ls.set('bc-admin-key', key); showBoard(); };
  $('#key').onkeydown = (e) => { if (e.key === 'Enter') $('#login-btn').click(); };
  $('#end-btn').onclick = async () => {
    if (params.get('demo')) return location.href = 'results.html?demo=1';
    if (!confirm('Завершить игру и показать итоги? Команды больше не смогут отвечать.')) return;
    try { await call('/api/admin/finish', 'POST'); clearTimeout(pollTimer); location.href = 'results.html'; }
    catch (e) { alert(e.message); }
  };

  $('#reset-btn').onclick = async () => {
    if (!confirm('Сбросить прогресс команд? Коды останутся прежними, диалоги начнутся заново.')) return;
    try { const r = await call('/api/admin/reset', 'POST'); alert('Сброшено сессий: ' + r.reset); poll(); } catch (e) { alert(e.message); }
  };

  // Таймер игры: время считает сервер, здесь только показываем
  let tBase = null, tick = null;
  const label = (txt) => { $('#timer').firstChild.textContent = txt; };
  function applyTimer(t) {
    if (!t || t.stage === 'lobby') { $('#time').textContent = '--:--'; label('Ждём старта '); return; }
    if (t.stage === 'finished') { clearInterval(tick); $('#time').textContent = '00:00'; label('Игра завершена '); return; }
    tBase = { stage: t.stage, left: t.stage === 'play' ? t.left : t.left_answer, at: Date.now() };
    clearInterval(tick); paintTimer(); tick = setInterval(paintTimer, 1000);
  }
  function paintTimer() {
    if (!tBase) return;
    const left = Math.max(0, tBase.left - Math.floor((Date.now() - tBase.at) / 1000));
    $('#time').textContent = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
    label(tBase.stage === 'play' ? 'Осталось ' : tBase.stage === 'answer' ? 'Финальный ответ ' : 'Время вышло ');
    if (!left) clearInterval(tick);
  }

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
    applyTimer({ stage: 'play', left: 600 });
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
