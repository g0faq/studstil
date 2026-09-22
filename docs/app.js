(() => {
  const API = window.API_URL || '';
  const IDLE_MS = 30000; // «завис» → подсказка-триггер
  const $ = (s) => document.querySelector(s);
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
  };

  let sessionId = store.get('bc-session');
  // Свой id устройства: сессия общая на команду, а устройств может быть несколько
  let deviceId = store.get('bc-device');
  if (!deviceId) { deviceId = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)); store.set('bc-device', deviceId); }
  let syncTimer = null;
  let tick = null, tBase = null; // отсчёт времени: сервер — источник истины
  let state = null;
  let busy = false;
  let waitTimer = null;
  let entering = 0; // метка последнего входа: ответ старого запроса не должен перетирать новый
  let shown = 0; // сколько сообщений уже анимировано (остальные не переигрываем)
  let fresh = new Set(); // индексы только что раскрывших факт ответов
  // Свои иконки вместо эмодзи
  const ICON = {
    unlock: '<svg class="ic" viewBox="0 0 20 20" aria-hidden="true"><path d="M6 9V6.6A4 4 0 0 1 13.6 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><rect x="3.2" y="9" width="13.6" height="8.4" rx="2.6" fill="currentColor"/><circle cx="10" cy="13.2" r="1.5" fill="var(--bg2)"/></svg>',
    spark: '<svg class="ic" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 1.6l1.9 5.1 5.1 1.9-5.1 1.9L10 15.6l-1.9-5.1L3 8.6l5.1-1.9z" fill="currentColor"/><circle cx="16.4" cy="15.2" r="1.8" fill="currentColor" opacity=".7"/><circle cx="4.2" cy="14.6" r="1.2" fill="currentColor" opacity=".5"/></svg>',
    done: '<svg class="ic" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="currentColor" opacity=".18"/><path d="M5.6 10.4l2.9 2.9 5.9-6.6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hits = new Set(); // индексы сообщений, раскрывших факт (для обводки)
  const extra = []; // системные строки в ленте: { after: индекс сообщения, text, err }

  async function api(path, body) {
    const res = await fetch(API + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'Нет связи с сервером'), { status: res.status, code: data.code });
    return data;
  }

  // --- Заголовок по буквам ---
  (() => {
    const t = $('#title'); let i = 0;
    t.innerHTML = t.innerHTML.split('<br>').map((w) => [...w].map((c) => `<span class="ch" aria-hidden="true" style="--i:${i++}">${c}</span>`).join('')).join('<br>');
  })();

  // --- Тема ---
  const themeBtn = $('#theme-btn');
  const paintTheme = () => { themeBtn.textContent = document.documentElement.dataset.theme === 'light' ? 'Тёмная тема' : 'Светлая тема'; };
  themeBtn.onclick = () => {
    const t = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = t; store.set('bc-theme', t); paintTheme();
  };
  paintTheme();

  // --- Навигация ---
  function go(screen) {
    for (const el of document.querySelectorAll('.screen')) el.classList.toggle('hidden', el.id !== screen);
    clearInterval(waitTimer);
    clearInterval(syncTimer);
    if (screen === 'chat') {
      scrollDown();
      setTimeout(() => $('#q').focus({ preventScroll: true }), 50);
      syncTimer = setInterval(syncTeam, 2000); // сообщения с других устройств команды
    }
    if (screen === 'wait') waitTimer = setInterval(checkStart, 2500);
    if (screen === 'solve' || screen === 'done' || screen === 'score') syncTimer = setInterval(syncTeam, 5000);
    if (screen === 'done') renderDone();
    if (screen === 'solve') {
      $('#solve-problem').textContent = state?.final?.problem || '';
      countChars();
      setTimeout(() => $('#solution').focus({ preventScroll: true }), 80);
    }
    if (screen === 'score') renderScore();
  }

  document.addEventListener('click', (e) => { const b = e.target.closest('[data-go]'); if (b) go(b.dataset.go); });

  // --- Вход по коду ---
  $('#code-form').onsubmit = async (e) => {
    e.preventDefault();
    const code = $('#code').value.trim();
    if (!code) return ($('#code-err').textContent = 'Введите код команды');
    $('#enter-btn').disabled = true; $('#code-err').textContent = '';
    const mark = ++entering;
    try {
      const r = await api('/api/session', { code, deviceId });
      if (mark !== entering) return; // пока ждали ответ, ввели другой код
      sessionId = r.sessionId; store.set('bc-session', sessionId);
      hits.clear(); extra.length = 0; shown = 0;
      apply(r.state); go(r.state.phase === 'lobby' ? 'wait' : 'card');
    } catch (err) {
      $('#code-err').textContent = err.message;
      const f = $('.code-field'); f.classList.remove('shake'); void f.offsetWidth; f.classList.add('shake');
    }
    finally { $('#enter-btn').disabled = false; }
  };
  $('#code').oninput = () => { $('#code-err').textContent = ''; };

  // --- Отрисовка ---
  function apply(s) {
    state = s;
    const c = s.client;
    const app = $('#app');
    const green = document.documentElement.dataset.palette === 'green';
    app.style.setProperty('--accent', (green && c.accent_green) || c.accent);
    app.style.setProperty('--accent-soft', (green && c.soft_green) || c.soft);
    for (const el of document.querySelectorAll('[data-f]')) el.textContent = c[el.dataset.f] ?? '';
    const q = $('#quote'); q.replaceChildren();
    `«${c.card_hint}»`.split(' ').forEach((w, i) => { const sp = document.createElement('span'); sp.className = 'w'; sp.style.setProperty('--i', i); sp.textContent = w; q.append(sp, ' '); });
    const photo = (green && c.photo_green) || c.photo;
    for (const el of document.querySelectorAll('.avatar[data-f="letter"]')) { el.querySelector('img')?.remove(); if (photo) addPhoto(el, photo); }
    $('#wait-team').textContent = s.team || 'Ваша команда';
    applyTimer(s.timer);
    updateHintBtn();
    renderProgress(); renderMsgs(); renderChips();
  }

  // Фото героини поверх буквы; если файла нет — остаётся буква
  function addPhoto(el, src) {
    if (el.querySelector('img')) return;
    const img = new Image(); img.alt = ''; img.onerror = () => img.remove(); img.src = src;
    el.append(img);
  }

  // Ждём, пока преподаватель начнёт игру
  async function checkStart() {
    try {
      const r = await api('/api/session?id=' + encodeURIComponent(sessionId));
      if (r.state.phase !== 'lobby') { apply(r.state); go('card'); }
    } catch (e) { if (e.status === 404) resetToStart(); }
  }

  // Подтягиваем сообщения, которые отправили одноклассники с других телефонов
  async function syncTeam(force = false) {
    if (!force && (busy || !sessionId || document.hidden)) return;
    try {
      const r = await api('/api/session?id=' + encodeURIComponent(sessionId));
      if (!state || (r.state.rev === state.rev && r.state.timer?.stage === state.timer?.stage)) { if (r.state.timer) applyTimer(r.state.timer); return; }
      const wasFinished = state.finished;
      apply(r.state);
      renderMsgs();
      if (state.solution && !wasFinished) go('score');
      else if (state.finished && !wasFinished) go('done');
    } catch (e) { if (e.status === 404) resetToStart(); }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !$('#chat').classList.contains('hidden')) syncTeam(); });

  function renderProgress() {
    const { progress: p, revealed, finished } = state;
    $('#prog-text').textContent = `Раскрыто ${p.required_open} из ${p.required_total} фактов`;
    $('#prog-label').textContent = finished ? 'готово' : 'продолжайте';
    $('#prog-fill').style.width = Math.round((p.required_open / p.required_total) * 100) + '%';
    $('#finish-wrap').classList.toggle('hidden', !finished);
    $('#composer').classList.toggle('hidden', finished);
    $('#chips').classList.toggle('hidden', finished);
    const req = revealed.filter((f) => f.required);
    const bonus = revealed.filter((f) => !f.required);
    const hidden = p.required_total - req.length;
    const box = $('#dossier'); box.replaceChildren();
    for (const f of [...req, ...bonus]) box.append(factEl(f.required ? f.label : `${f.label} · бонус`, f.text, true));
    for (let i = 0; i < hidden; i++) box.append(factEl('Не раскрыто', '• • • • • • • • • •', false));
  }

  function factEl(label, text, on) {
    const d = document.createElement('div'); d.className = 'fact ' + (on ? 'on' : 'off');
    const l = document.createElement('div'); l.className = 'caps'; l.textContent = label;
    const t = document.createElement('div'); t.textContent = text;
    d.append(l, t); return d;
  }

  function bubble(cls, text) { const d = document.createElement('div'); d.className = 'msg ' + cls; d.textContent = text; return d; }

  function renderMsgs(typing = false) {
    const box = $('#msgs'); box.replaceChildren();
    state.messages.forEach((m, i) => {
      const old = i < shown ? ' old' : '';
      box.append(bubble(m.who + (hits.has(i) ? ' hit' : '') + (fresh.has(i) ? ' reveal' : '') + old, m.text));
      for (const x of extra.filter((x) => x.after === i)) {
        if (x.stamp) {
          const st = document.createElement('div');
          st.className = 'stamp' + (fresh.has(i) ? ' fresh' : '');
          st.innerHTML = ICON.unlock + '<span></span>';
          st.querySelector('span').textContent = x.text;
          box.append(st);
        }
        else box.append(bubble('sys' + (x.err ? ' err' : '') + old, x.text));
      }
    });
    shown = state.messages.length;
    if (state.finished && state.final) { box.append(bubble('them hit', state.final.message)); const s = bubble('sys', ''); s.innerHTML = ICON.spark + '<span></span>'; s.querySelector('span').textContent = 'Вы выяснили запрос клиентки! Нажмите «Сформулировать проблему»'; box.append(s); }
    if (typing) { const t = document.createElement('div'); t.className = 'typing'; t.innerHTML = '<span></span><span></span><span></span>'; box.append(t); }
    $('#status').textContent = typing ? 'печатает…' : 'в сети';
    scrollDown();
  }
  const scrollDown = () => { const b = $('#msgs'); requestAnimationFrame(() => { b.scrollTop = b.scrollHeight; }); };

  function renderChips() {
    const box = $('#chips'); box.replaceChildren();
    for (const label of state.client.chips) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.textContent = label;
      b.onclick = () => { $('#q').value = label; $('#q').focus(); };
      box.append(b);
    }
  }

  function renderDone() {
    if (!state?.final) return;
    $('#problem').textContent = state.final.problem;
    const facts = $('#done-facts'); facts.replaceChildren();
    state.revealed.forEach((f, i) => {
      const row = document.createElement('div'); row.className = 'row';
      row.innerHTML = '<div class="num"></div><div style="display:flex;flex-direction:column;gap:2px"><div class="caps dim" style="font-size:10px;letter-spacing:.14em"></div><div style="font-size:14px;line-height:1.4;font-weight:600"></div></div>';
      row.querySelector('.num').textContent = i + 1;
      row.querySelector('.caps').textContent = f.label;
      row.querySelector('.caps + div').textContent = f.text;
      facts.append(row);
    });
    const tasks = $('#tasks'); tasks.replaceChildren();
    for (const t of state.final.tasks) {
      const r = document.createElement('div'); r.style.cssText = 'display:flex;gap:10px;font-size:15px;line-height:1.4;font-weight:600';
      r.innerHTML = '<span style="opacity:.7">—</span><span></span>'; r.lastChild.textContent = t; tasks.append(r);
    }
    $('#task-time').textContent = state.final.task_time;
    confetti();
  }

  // --- Отправка вопроса ---
  $('#composer').onsubmit = async (e) => {
    e.preventDefault();
    const input = $('#q');
    const text = input.value.trim();
    if (!text || busy) return;
    busy = true; input.value = '';
    state.messages.push({ who: 'me', text });
    fresh = new Set();
    renderMsgs(true);
    try {
      const r = await api('/api/message', { sessionId, text, deviceId });
      const before = state.messages.length;
      const prevShown = shown;
      apply(r.state);
      shown = prevShown; // apply() перерисовал ленту — ответ ещё не «показан»
      const last = state.messages.length - 1;
      fresh = new Set();
      if (r.newly.length) {
        hits.add(last); fresh.add(last);
        for (const f of r.newly) extra.push({ after: last, text: f.label, stamp: true });
        $('#prog-fill').classList.remove('glint'); void $('#prog-fill').offsetWidth; $('#prog-fill').classList.add('glint');
        setTimeout(() => burst($('#prog-fill')), 350);
      }
      renderMsgs();
    } catch (err) {
      state.messages.pop(); input.value = text;
      extra.push({ after: state.messages.length - 1, text: err.message, err: true });
      renderMsgs();
      if (err.status === 404) return resetToStart();
    } finally { busy = false; }
  };

  // --- Решение команды и оценка ---
  const countChars = () => {
    const n = $('#solution').value.trim().length;
    $('#solve-count').textContent = n < 40 ? `${n} символов · нужно хотя бы 40` : `${n} символов`;
  };
  $('#solution').addEventListener('input', () => { countChars(); $('#solve-err').textContent = ''; });
  $('#to-solve').onclick = () => go(state?.solution ? 'score' : 'solve');
  $('#score-back').onclick = () => go(state?.finished ? 'done' : 'chat');

  $('#send-solution').onclick = async () => {
    const text = $('#solution').value.trim();
    if (text.length < 40) return ($('#solve-err').textContent = 'Опишите решение подробнее.');
    const btn = $('#send-solution');
    btn.disabled = true; btn.textContent = 'Проверяем…'; $('#solve-err').textContent = '';
    try {
      const r = await api('/api/solution', { sessionId, text });
      apply(r.state); go('score');
    } catch (e) { $('#solve-err').textContent = e.message; }
    finally { btn.disabled = false; btn.textContent = 'Отправить на оценку'; }
  };

  function renderScore() {
    const s = state?.solution;
    if (!s) return go('solve');
    $('#score-verdict').textContent = s.verdict;
    $('#score-title').textContent = s.score >= 9 ? 'Отличная работа' : s.score >= 7 ? 'Хорошее решение' : s.score >= 5 ? 'Решение засчитано' : 'Есть над чем поработать';
    const num = $('#score-num'), ring = document.querySelector('.score-ring .val');
    if (reduced) { num.textContent = s.score; ring.style.strokeDashoffset = 1 - s.score / 10; }
    else {
      ring.style.strokeDashoffset = 1;
      requestAnimationFrame(() => { ring.style.strokeDashoffset = 1 - s.score / 10; });
      const t0 = performance.now();
      (function f(t) {
        const k = Math.min(1, (t - t0) / 1200), e = 1 - Math.pow(1 - k, 3);
        num.textContent = Math.round(s.score * e);
        if (k < 1) requestAnimationFrame(f);
      })(t0);
    }
    fillPanel($('#score-strengths'), 'Сильные стороны', s.strengths, ICON.done);
    fillPanel($('#score-missed'), 'Что доработать', s.missed, ICON.spark);
  }

  function fillPanel(box, title, items, icon) {
    box.replaceChildren();
    box.classList.toggle('hidden', !items?.length);
    if (!items?.length) return;
    const h = document.createElement('div'); h.className = 'caps'; h.style.color = 'var(--accent)'; h.textContent = title;
    box.append(h);
    for (const it of items) {
      const row = document.createElement('div'); row.className = 'row';
      row.innerHTML = icon + '<span style="font-size:14px;line-height:1.45"></span>';
      row.querySelector('span').textContent = it;
      box.append(row);
    }
  }

  // --- Подсказка по запросу команды ---
  $('#hint-btn').onclick = async () => {
    const btn = $('#hint-btn');
    btn.disabled = true;
    try {
      const r = await api('/api/hint', { sessionId });
      apply(r.state); // подсказка уже в диалоге, полученном с сервера
      renderMsgs();
    } catch (e) {
      extra.push({ after: state.messages.length - 1, text: e.message, err: true });
      renderMsgs();
    } finally { btn.disabled = false; updateHintBtn(); }
  };
  const updateHintBtn = () => {
    const left = state?.hints_left ?? 0;
    $('#hint-btn').textContent = left ? `Подсказка · ${left}` : 'Подсказок нет';
    $('#hint-btn').disabled = !left;
  };
  $('#to-solve-chat').onclick = () => go(state?.solution ? 'score' : 'solve');
  $('#solve-back').onclick = () => go(state?.finished ? 'done' : 'chat');

  // --- Таймер: считаем локально от последнего ответа сервера ---
  function applyTimer(t) {
    if (!t || t.stage === 'lobby' || t.stage === 'finished') { tBase = null; $('#timer').classList.add('hidden'); clearInterval(tick); return; }
    tBase = { stage: t.stage, left: t.stage === 'play' ? t.left : t.left_answer, at: Date.now() };
    $('#timer').classList.remove('hidden');
    clearInterval(tick); paintTimer(); tick = setInterval(paintTimer, 1000);
  }

  function paintTimer() {
    if (!tBase) return;
    const left = Math.max(0, tBase.left - Math.floor((Date.now() - tBase.at) / 1000));
    const chip = $('#timer');
    $('#timer-val').textContent = (tBase.stage === 'answer' ? 'Ответ · ' : '') +
      `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
    chip.classList.toggle('warn', tBase.stage === 'play' && left <= 60);
    chip.classList.toggle('answer', tBase.stage !== 'play');
    if (left === 0) { clearInterval(tick); syncTeam(true); }
    lockByStage(tBase.stage);
  }

  // Время вышло: чат и карточка закрываются, остаётся только финальный ответ
  function lockByStage(stage) {
    const over = stage === 'over' || stage === 'finished';
    const answerOnly = stage === 'answer' || over;
    $('#composer').classList.toggle('hidden', answerOnly || !!state?.finished);
    $('#chips').classList.toggle('hidden', answerOnly || !!state?.finished);
    $('#hint-btn').classList.toggle('hidden', answerOnly);
    document.querySelector('.solve-client')?.classList.toggle('hidden', answerOnly);
    $('#solve-back').classList.toggle('hidden', answerOnly);
    if (answerOnly && !state?.solution && !$('#solve').classList.contains('hidden') === false) {
      const visible = [...document.querySelectorAll('.screen:not(.hidden)')].map((s) => s.id)[0];
      if (['chat', 'card', 'done'].includes(visible)) go('solve');
    }
    if (over) {
      $('#solution').disabled = true;
      $('#send-solution').disabled = true;
      if (!state?.solution) $('#solve-err').textContent = 'Время на ответ закончилось.';
    }
  }

  function resetToStart() {
    store.set('bc-session', null); sessionId = null; state = null; hits.clear(); extra.length = 0; shown = 0; fresh = new Set();
    $('#app').style.removeProperty('--accent'); $('#app').style.removeProperty('--accent-soft');
    clearInterval(waitTimer); clearInterval(syncTimer); $('#code').value = ''; go('start');
  }
  $('#restart-btn').onclick = resetToStart;
  $('#wait-exit').onclick = resetToStart;

  $('#dossier-btn').onclick = () => {
    const d = $('#dossier'); d.classList.toggle('hidden');
    $('#dossier-btn').setAttribute('aria-expanded', String(!d.classList.contains('hidden')));
  };

  // --- Восстановление после перезагрузки страницы ---
  if (sessionId) {
    const restoring = sessionId;
    api('/api/session?id=' + encodeURIComponent(restoring))
      .then((r) => {
        if (entering || sessionId !== restoring) return; // уже вошли по новому коду — старую сессию игнорируем
        apply(r.state); go(r.state.phase === 'lobby' ? 'wait' : r.state.solution ? 'score' : r.state.finished ? 'done' : 'chat');
      })
      .catch(() => store.set('bc-session', null));
  }
})();
