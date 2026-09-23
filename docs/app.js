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
  let jobsTimer = null; // пока считают оценку и картинку, дёргаем двигатель фоновых задач
  let revealComp = null; // смонтированный компонент «до / после»
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
    clock: '<svg class="ic" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M10 5.4V10l3.2 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    spin: '<svg class="ic" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" stroke-width="1.8" opacity=".25"/><path d="M18 10a8 8 0 0 0-8-8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
    warn: '<svg class="ic" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M10 5.8v5.2" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="10" cy="14.3" r="1.15" fill="currentColor"/></svg>',
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
  // Путь работы команды: пишем разбор → проверяем → ждём → смотрим итог
  // Результат показываем, только когда оценка готова; иначе — экран обработки
  const resultReady = (w) => !!(w && w.published && w.eval && w.eval_status === 'done');
  const workScreen = () => (!state?.work ? 'solve' : resultReady(state.work) ? 'score' : 'pending');

  function go(screen) {
    for (const el of document.querySelectorAll('.screen')) el.classList.toggle('hidden', el.id !== screen);
    // Экранная клавиатура телефона прокручивает всю карточку: на новом экране возвращаем её наверх,
    // иначе шапка следующего экрана окажется срезанной.
    $('#app').scrollTop = 0;
    const sec = document.getElementById(screen);
    if (sec) for (const el of sec.querySelectorAll('div')) { if (el.id !== 'msgs' && el.scrollTop) el.scrollTop = 0; }
    clearInterval(waitTimer);
    clearInterval(syncTimer);
    clearInterval(jobsTimer);
    if (screen === 'chat') {
      scrollDown();
      setTimeout(() => $('#q').focus({ preventScroll: true }), 50);
      syncTimer = setInterval(syncTeam, 2000); // сообщения с других устройств команды
    }
    if (screen === 'wait') waitTimer = setInterval(checkStart, 2500);
    if (screen === 'solve' || screen === 'done' || screen === 'score') syncTimer = setInterval(syncTeam, 5000);
    if (screen === 'done') renderDone();
    if (screen === 'solve') {
      $('#solve-problem').textContent = state?.final?.message || '';
      countChars();
      setTimeout(() => $('#solution').focus({ preventScroll: true }), 80);
    }
    if (screen === 'confirm') renderConfirm();
    if (screen === 'pending') { renderPending(); jobsTimer = setInterval(pumpJobs, 3000); }
    if (screen === 'score' && !jobsSettled(state?.work)) jobsTimer = setInterval(pumpJobs, 3000);
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
      hits.clear(); extra.length = 0; shown = 0; draft = ''; scoreVersion = null; revealSig = null; $('#jobs').dataset.sig = '';
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
      const hadWork = !!state.work;
      const wasPublished = !!state.work?.published;
      apply(r.state);
      renderMsgs();
      // Работу мог сдать одноклассник с другого телефона, а итоги открыть преподаватель
      if (resultReady(state.work) && !wasPublished) go('score');
      else if (state.work && !hadWork) go('pending');
      else if (state.finished && !wasFinished) go('done');
      else {
        // Ничего не переключаем, но открытый экран перерисовываем: баллы мог поправить преподаватель
        const open = document.querySelector('.screen:not(.hidden)')?.id;
        if (open === 'score' && resultReady(state.work)) renderScore();
        else if (open === 'pending' && state.work) renderPending();
      }
    } catch (e) { if (e.status === 404) resetToStart(); }
  }

  // --- Двигатель фоновых задач ---
  const JOB_OVER = new Set(['done', 'error', 'skipped']);
  const jobsSettled = (w) => !w || (JOB_OVER.has(w.eval_status) && JOB_OVER.has(w.image_status));

  async function pumpJobs() {
    if (!sessionId || document.hidden) return;
    const w = state?.work;
    // Останавливаемся, когда результат готов, а не когда итоги «опубликованы»:
    // в тестовом прогоне публикация включена сразу, но задачи ещё не посчитаны
    if (resultReady(w)) { clearInterval(jobsTimer); if (!$('#pending').classList.contains('hidden')) go('score'); return; }
    try {
      // Пока задачи в работе — крутим двигатель; когда всё посчитано, ждём публикацию
      // итогов дешёвым опросом состояния: иначе экран «Работа сдана» завис бы навсегда
      const r = jobsSettled(w)
        ? await api('/api/session?id=' + encodeURIComponent(sessionId))
        : await api('/api/jobs', { sessionId });
      apply(r.state);
      const now = state.work;
      if (resultReady(now)) {
        clearInterval(jobsTimer);
        if (!$('#pending').classList.contains('hidden')) go('score');
        else if (!$('#score').classList.contains('hidden')) renderScore();
        return;
      }
      if (!$('#pending').classList.contains('hidden')) renderPending();
    } catch (e) { if (e.status === 404) resetToStart(); }
  }
  // Телефон уснул или ушёл в фон — опросы молчали; вернулись на экран, догоняем сразу
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (!$('#chat').classList.contains('hidden')) syncTeam();
    if (!$('#pending').classList.contains('hidden')) pumpJobs();
  });

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
    // Диагноз команда ставит сама — показываем только то, что сказала клиентка
    $('#problem').textContent = `«${state.final.message}»`;
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
    (state.final.brief || []).forEach((t, i) => {
      const r = document.createElement('div'); r.style.cssText = 'display:flex;gap:10px;font-size:15px;line-height:1.4;font-weight:600';
      r.innerHTML = '<span style="opacity:.7"></span><span></span>';
      r.firstChild.textContent = i + 1 + '.';
      r.lastChild.textContent = t;
      tasks.append(r);
    });
    $('#task-time').textContent = state.final.task_time || '';
    const w = state.work;
    $('#to-solve').textContent = !w ? 'Предложить решение'
      : w.published ? `Итог: ${w.eval?.total ?? 0} из 100`
      : 'Работа сдана · смотреть статус';
    confetti($('#confetti'));
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
  const plural = (n, one, few, many) => {
    const m = n % 100, k = n % 10;
    return m > 4 && m < 21 ? many : k === 1 ? one : k > 1 && k < 5 ? few : many;
  };
  $('#solution').addEventListener('input', () => { countChars(); $('#solve-err').textContent = ''; });
  $('#to-solve').onclick = () => go(workScreen());
  $('#to-solve-chat').onclick = () => go(workScreen());
  $('#score-back').onclick = () => go(state?.finished ? 'done' : 'chat');

  let draft = ''; // текст, который команда отправила на проверку перед сдачей

  // С экрана разбора — не сразу на сервер, а на страницу подтверждения
  $('#send-solution').onclick = () => {
    const text = $('#solution').value.trim();
    if (text.length < 40) return ($('#solve-err').textContent = 'Опишите решение подробнее.');
    $('#solve-err').textContent = '';
    draft = text;
    go('confirm');
  };
  $('#confirm-edit').onclick = () => go('solve');
  $('#confirm-back').onclick = () => go('solve');

  function renderConfirm() {
    if (!draft) return go('solve');
    $('#confirm-text').textContent = draft;
    const n = draft.length;
    const words = draft.split(/\s+/).filter(Boolean).length;
    $('#confirm-count').textContent =
      `${n} ${plural(n, 'символ', 'символа', 'символов')} · ${words} ${plural(words, 'слово', 'слова', 'слов')}`;
    $('#confirm-err').textContent = '';
    const btn = $('#confirm-send');
    btn.disabled = false; btn.textContent = 'Сдать решение';
  }

  $('#confirm-send').onclick = async () => {
    const btn = $('#confirm-send');
    btn.disabled = true; btn.textContent = 'Сдаём…'; $('#confirm-err').textContent = '';
    try {
      const r = await api('/api/solution', { sessionId, text: draft });
      apply(r.state);
      go('pending');
      pumpJobs(); // не ждём первые три секунды впустую
    } catch (e) {
      $('#confirm-err').textContent = e.message;
      btn.disabled = false; btn.textContent = 'Сдать решение';
    }
  };

  // --- Работа сдана: ждём оценку и картинку ---
  const JOB_UI = {
    queued: { t: 'В очереди', cls: 'wait', ic: ICON.clock },
    running: { t: 'Считаем', cls: 'run', ic: ICON.spin },
    done: { t: 'Готово', cls: 'ok', ic: ICON.done },
    error: { t: 'Не удалось', cls: 'bad', ic: ICON.warn },
    skipped: { t: 'Пропущено', cls: 'wait', ic: ICON.clock },
  };

  function jobRow(name, status, err, i) {
    const u = JOB_UI[status] || JOB_UI.queued;
    const row = document.createElement('div'); row.className = 'job'; row.style.setProperty('--i', i);
    const line = document.createElement('div'); line.className = 'job-line';
    const n = document.createElement('div'); n.className = 'job-name'; n.textContent = name;
    const chip = document.createElement('span'); chip.className = 'job-chip ' + u.cls;
    chip.innerHTML = u.ic + '<span></span>';
    chip.querySelector('span').textContent = u.t;
    line.append(n, chip); row.append(line);
    if (status === 'error') {
      const e = document.createElement('div'); e.className = 'job-err';
      e.textContent = err ? String(err).slice(0, 160) : 'Преподаватель может запустить ещё раз.';
      row.append(e);
    }
    return row;
  }

  function renderPending() {
    const w = state?.work;
    if (!w) return go('solve');
    if (resultReady(w)) return go('score');
    const at = new Date(w.at);
    const time = isNaN(at.getTime()) ? '' : ' · сдано в ' + at.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    $('#pend-meta').textContent = `Версия ${w.version}${time}`;

    const rows = [['Оценка работы', w.eval_status, w.eval_error]];
    if (w.image_status !== 'skipped') rows.push(['Визуализация образа', w.image_status, w.image_error]);
    const box = $('#jobs');
    // Перерисовываем только когда статус реально сменился — иначе чипы моргали бы каждые три секунды
    const sig = w.version + '|' + rows.map((r) => r[0] + ':' + r[1]).join('|');
    if (box.dataset.sig !== sig) {
      box.dataset.sig = sig;
      box.replaceChildren();
      rows.forEach(([name, st, err], i) => box.append(jobRow(name, st, err, i)));
      if (!jobsSettled(w)) {
        const bar = document.createElement('div'); bar.className = 'pend-bar'; bar.innerHTML = '<i></i>';
        box.append(bar);
      }
    }
    // Пишем как есть: что посчиталось, что сорвалось, чего ждём
    const failed = rows.some(([, st]) => st === 'error');
    $('#pend-tip').textContent = !jobsSettled(w)
      ? 'Считаем. Страницу можно не трогать: результат появится здесь сам.'
      : failed
        ? 'Часть работы не посчиталась. Скажите преподавателю — он запустит ещё раз.'
        : 'Всё посчитано. Ждём, пока преподаватель откроет итоги — экран обновится сам.';
    $('#work-text').textContent = w.text || '';
  }

  $('#show-text').onclick = () => {
    const t = $('#work-text');
    const closed = t.classList.toggle('hidden');
    $('#show-text').textContent = closed ? 'Показать мой текст' : 'Скрыть мой текст';
    $('#show-text').setAttribute('aria-expanded', String(!closed));
  };

  // --- Итог: баллы, критерии, преображение ---
  // Листаем вниз — шапка с кольцом сжимается, и преображению достаётся вся высота телефона
  (() => {
    const body = document.querySelector('#score .done-body');
    if (!body) return;
    body.addEventListener('scroll', () => {
      const t = body.scrollTop;
      if (t > 56) $('#score').classList.add('tight');
      else if (t < 20) $('#score').classList.remove('tight');
    }, { passive: true });
  })();

  const CRIT_ORDER =['diagnostics', 'understanding', 'outfit', 'hair', 'makeup', 'coherence', 'realism'];
  let scoreVersion = null; // чтобы не переигрывать анимацию итога на каждом опросе
  let revealSig = null; // картинку перемонтируем только когда она правда сменилась

  function renderScore() {
    const w = state?.work;
    if (!w) return go('solve');
    if (!w.published) return go('pending');
    const ev = w.eval || {};
    const total = Math.max(0, Math.min(100, Math.round(ev.total ?? 0)));
    const first = scoreVersion !== w.version;
    scoreVersion = w.version;

    $('#score-verdict').textContent = ev.verdict || '';
    $('#score-title').textContent = total >= 85 ? 'Блестящая работа'
      : total >= 70 ? 'Сильное решение'
      : total >= 50 ? 'Решение засчитано'
      : 'Есть над чем поработать';

    const num = $('#score-num'), ring = document.querySelector('#score .score-ring .val');
    if (reduced || !first) { num.textContent = total; ring.style.strokeDashoffset = 1 - total / 100; }
    else {
      const wrap = $('#score-ring');
      wrap.classList.remove('pop'); void wrap.offsetWidth; wrap.classList.add('pop');
      ring.style.strokeDashoffset = 1;
      void ring.getBoundingClientRect(); // фиксируем ноль, чтобы кольцо поехало от него
      ring.style.strokeDashoffset = 1 - total / 100;
      const t0 = performance.now();
      (function f(t) {
        const k = Math.min(1, (t - t0) / 1400), e = 1 - Math.pow(1 - k, 3);
        num.textContent = Math.round(total * e);
        if (k < 1) requestAnimationFrame(f);
      })(t0);
      // Во вкладке в фоне кадры не идут — подстраховываемся, чтобы балл не завис на нуле
      setTimeout(() => { num.textContent = total; }, 1600);
      if (total >= 50) setTimeout(() => confetti($('#score-confetti')), 700);
    }

    renderCriteria(ev);
    fillPanel($('#score-strengths'), 'Сильные стороны', ev.strengths, ICON.done);
    fillPanel($('#score-missed'), 'Что доработать', ev.recommendations, ICON.spark);
    // Преподаватель может перезапустить картинку и опубликовать итоги заново —
    // тогда версия та же, а образ новый, и блок нужно собрать заново.
    const sig = w.version + '|' + w.image_status + '|' + (w.image?.key || '');
    if (revealSig !== sig) { revealSig = sig; renderReveal(w); }
    renderReference($('#score-reference'));
  }

  function renderCriteria(ev) {
    const box = $('#score-criteria');
    box.replaceChildren(); box.classList.remove('run');
    const h = document.createElement('div');
    h.style.cssText = 'display:flex;align-items:baseline;justify-content:space-between;gap:10px';
    h.innerHTML = '<span class="caps" style="color:var(--accent)">Семь критериев</span><span class="crit-hint">нажмите строку</span>';
    box.append(h);
    let i = 0;
    for (const key of CRIT_ORDER) {
      const c = ev.criteria?.[key];
      if (!c) continue;
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'crit'; b.setAttribute('aria-expanded', 'false');
      b.style.setProperty('--i', i);
      b.style.setProperty('--w', Math.round(((c.score || 0) / (c.max || 1)) * 100) + '%');
      b.innerHTML = '<span class="crit-top"><span class="crit-title"></span>'
        + '<span class="crit-val"><b></b><span></span></span></span>'
        + '<span class="crit-track"><i></i></span><span class="crit-ev"></span>';
      b.querySelector('.crit-title').textContent = c.title || key;
      b.querySelector('.crit-val b').textContent = c.score ?? 0;
      b.querySelector('.crit-val b + span').textContent = ' / ' + (c.max ?? 0);
      b.querySelector('.crit-ev').textContent = c.evidence || 'Обоснование не записано.';
      b.onclick = () => b.setAttribute('aria-expanded', String(b.classList.toggle('open')));
      box.append(b); i++;
    }
    if (ev.teacher_edit) {
      const n = document.createElement('div'); n.className = 'wk-note';
      n.textContent = 'Баллы уточнил преподаватель' + (ev.teacher_edit.comment ? ': ' + ev.teacher_edit.comment : '.');
      box.append(n);
    }
    void box.getBoundingClientRect(); // полосы стартуют с нуля, а не появляются заполненными
    box.classList.add('run');
  }

  // Если картинки нет — вместо блока одна строка с настоящим статусом, без выдумок
  const IMAGE_NOTE = {
    queued: 'Визуализация образа ещё в очереди.',
    running: 'Визуализация образа ещё создаётся.',
    error: 'Визуализацию образа создать не удалось.',
    skipped: 'Визуализация образа не создавалась.',
    done: 'Визуализация образа недоступна.',
  };

  // Главный момент финала: кадр «до» превращается в образ, который придумала команда
  function renderReveal(w) {
    const slot = $('#reveal-slot');
    try { revealComp?.destroy?.(); } catch {}
    revealComp = null;
    slot.replaceChildren();
    const name = String(w.photo_full || state?.client?.photo_full || state?.client?.photo || '').split('/').pop();
    if (w.image_status !== 'done' || !w.image?.key || !name || !window.BeautyReveal) {
      const n = document.createElement('div'); n.className = 'wk-note';
      n.textContent = IMAGE_NOTE[w.image_status] || IMAGE_NOTE.error;
      slot.append(n);
      return;
    }
    const wrap = document.createElement('div'); wrap.className = 'wk-reveal reveal-block';
    const title = document.createElement('div'); title.className = 'wk-reveal-title'; title.textContent = 'Преображение';
    const host = document.createElement('div');
    const cap = document.createElement('div'); cap.className = 'reveal-caption'; cap.textContent = 'Визуализация решения команды';
    wrap.append(title, host, cap);
    if (w.image.changed?.length) {
      const list = document.createElement('div'); list.className = 'wk-changed';
      for (const it of w.image.changed) {
        const row = document.createElement('div'); row.className = 'row';
        row.innerHTML = '<span class="dot"></span><span></span>';
        row.lastChild.textContent = it;
        list.append(row);
      }
      wrap.append(list);
    }
    slot.append(wrap);
    revealComp = window.BeautyReveal.mount(host, {
      before: 'img/' + name,
      after: API + '/api/image?key=' + encodeURIComponent(w.image.key),
      autoplay: true,
      caption: 'Визуализация решения команды',
    });
  }

  // Разбор преподавателя приходит вместе с опубликованными итогами
  function renderReference(box) {
    const r = state?.reference;
    box.classList.toggle('hidden', !r);
    if (!r) return;
    box.replaceChildren();
    const h = document.createElement('div'); h.className = 'caps'; h.style.color = 'var(--accent)';
    h.textContent = 'Разбор преподавателя';
    const p = document.createElement('div'); p.style.cssText = 'font-size:14px;line-height:1.45';
    p.textContent = r.problem || '';
    box.append(h, p);
    for (const [title, items] of [['Одежда', r.outfit], ['Стрижка, укладка, цвет', r.hair], ['Макияж', r.makeup]]) {
      if (!items?.length) continue;
      const t = document.createElement('div'); t.className = 'caps dim';
      t.style.cssText = 'font-size:10px;letter-spacing:.14em;padding-top:6px';
      t.textContent = title;
      box.append(t);
      for (const it of items) {
        const row = document.createElement('div');
        row.style.cssText = 'font-size:13px;line-height:1.45;display:flex;gap:8px';
        row.innerHTML = '<span style="opacity:.6">—</span><span></span>';
        row.lastChild.textContent = it;
        box.append(row);
      }
    }
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
    if (answerOnly && !state?.work) {
      const visible = [...document.querySelectorAll('.screen:not(.hidden)')].map((s) => s.id)[0];
      if (['chat', 'card', 'done'].includes(visible)) go('solve');
    }
    if (over && !state?.work) {
      $('#solution').disabled = true;
      $('#send-solution').disabled = true;
      $('#solve-err').textContent = 'Время на ответ закончилось.';
    }
  }

  // --- Праздничные мелочи ---
  // Конфетти на итоговых экранах: канвас растянут по карточке телефона
  function confetti(cv) {
    if (reduced || !cv?.getContext) return;
    const ctx = cv.getContext('2d');
    const dpr = Math.min(2, devicePixelRatio || 1);
    const W = cv.width = Math.round(cv.clientWidth * dpr);
    const H = cv.height = Math.round(cv.clientHeight * dpr);
    if (!W || !H) return;
    const css = getComputedStyle(document.body);
    const cols = ['--g1', '--g2', '--g3'].map((v) => css.getPropertyValue(v).trim() || '#FF7A1A');
    const parts = Array.from({ length: 90 }, () => ({
      x: Math.random() * W, y: -Math.random() * H * 0.5,
      vx: (Math.random() - 0.5) * 2.4 * dpr, vy: (2 + Math.random() * 3.6) * dpr,
      w: (5 + Math.random() * 11) * dpr, h: (3 + Math.random() * 4) * dpr,
      r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.22,
      c: cols[(Math.random() * cols.length) | 0],
    }));
    const t0 = performance.now();
    (function frame(t) {
      const life = (t - t0) / 3800;
      ctx.clearRect(0, 0, W, H);
      for (const p of parts) {
        p.x += p.vx; p.y += p.vy; p.r += p.vr;
        ctx.save(); ctx.globalAlpha = Math.max(0, 1 - life);
        ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(-p.w / 2, -p.h / 2, p.w, p.h, p.h / 2);
        else ctx.rect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.fill(); ctx.restore();
      }
      if (life < 1) requestAnimationFrame(frame); else ctx.clearRect(0, 0, W, H);
    })(t0);
  }

  // Искры от полосы прогресса, когда раскрыт новый факт
  function burst(el) {
    if (reduced || !el) return;
    const r = el.getBoundingClientRect();
    if (!r.width) return;
    const css = getComputedStyle(document.body);
    const cols = ['--g1', '--g2', '--g3'].map((v) => css.getPropertyValue(v).trim() || '#FF7A1A');
    for (let i = 0; i < 14; i++) {
      const p = document.createElement('i');
      p.className = 'particle';
      const s = 4 + Math.random() * 6;
      Object.assign(p.style, {
        width: s + 'px', height: s + 'px',
        left: r.right - s / 2 + 'px', top: r.top + r.height / 2 - s / 2 + 'px',
        background: cols[i % cols.length],
        boxShadow: '0 0 ' + s * 2 + 'px ' + cols[i % cols.length],
      });
      document.body.append(p);
      p.animate([
        { transform: 'translate(0,0) scale(1)', opacity: 1 },
        { transform: `translate(${(Math.random() - 0.35) * 90}px, ${(Math.random() - 0.7) * 70}px) scale(.2)`, opacity: 0 },
      ], { duration: 600 + Math.random() * 400, easing: 'cubic-bezier(.22,1,.36,1)' }).onfinish = () => p.remove();
    }
  }

  function resetToStart() {
    store.set('bc-session', null); sessionId = null; state = null; hits.clear(); extra.length = 0; shown = 0; fresh = new Set();
    draft = ''; scoreVersion = null; revealSig = null;
    try { revealComp?.destroy?.(); } catch {}
    revealComp = null;
    $('#jobs').dataset.sig = '';
    $('#app').style.removeProperty('--accent'); $('#app').style.removeProperty('--accent-soft');
    clearInterval(waitTimer); clearInterval(syncTimer); clearInterval(jobsTimer); $('#code').value = ''; go('start');
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
        apply(r.state);
        // Всё переживает перезагрузку: экран выбираем по состоянию с сервера
        const stage = r.state.timer?.stage;
        go(r.state.phase === 'lobby' ? 'wait'
          : r.state.work ? workScreen()
          : stage === 'answer' || stage === 'over' ? 'solve'
          : r.state.finished ? 'done' : 'chat');
      })
      .catch(() => store.set('bc-session', null));
  }
})();
