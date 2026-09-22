(() => {
  const API = window.API_URL || '';
  const IDLE_MS = 30000; // «завис» → подсказка-триггер
  const $ = (s) => document.querySelector(s);
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
  };

  let sessionId = store.get('bc-session');
  let state = null;
  let busy = false;
  let idleTimer = null;
  const hits = new Set(); // индексы сообщений, раскрывших факт (для обводки)
  const extra = []; // системные строки в ленте: { after: индекс сообщения, text, err }

  async function api(path, body) {
    const res = await fetch(API + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'Нет связи с сервером'), { status: res.status, code: data.code });
    return data;
  }

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
    for (const s of document.querySelectorAll('.screen')) s.classList.toggle('hidden', s.id !== screen);
    if (screen === 'chat') { scrollDown(); armIdle(); setTimeout(() => $('#q').focus({ preventScroll: true }), 50); } else clearTimeout(idleTimer);
    if (screen === 'done') renderDone();
  }
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-go]'); if (b) go(b.dataset.go); });

  // --- Вход по коду ---
  $('#code-form').onsubmit = async (e) => {
    e.preventDefault();
    const code = $('#code').value.trim();
    if (!code) return ($('#code-err').textContent = 'Введите код команды');
    $('#enter-btn').disabled = true; $('#code-err').textContent = '';
    try {
      const r = await api('/api/session', { code });
      sessionId = r.sessionId; store.set('bc-session', sessionId);
      hits.clear(); extra.length = 0;
      apply(r.state); go('card');
    } catch (err) { $('#code-err').textContent = err.message; }
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
    if (c.photo) for (const el of document.querySelectorAll('.avatar[data-f="letter"]')) addPhoto(el, c.photo);
    renderProgress(); renderMsgs(); renderChips();
  }

  // Фото героини поверх буквы; если файла нет — остаётся буква
  function addPhoto(el, src) {
    if (el.querySelector('img')) return;
    const img = new Image(); img.alt = ''; img.onerror = () => img.remove(); img.src = src;
    el.append(img);
  }

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
      box.append(bubble(m.who + (hits.has(i) ? ' hit' : ''), m.text));
      for (const x of extra.filter((x) => x.after === i)) box.append(bubble('sys' + (x.err ? ' err' : ''), x.text));
    });
    if (state.finished && state.final) { box.append(bubble('them hit', state.final.message)); box.append(bubble('sys', '🎉 Вы выяснили запрос клиентки! Нажмите «Сформулировать проблему»')); }
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
  }

  // --- Отправка вопроса ---
  $('#composer').onsubmit = async (e) => {
    e.preventDefault();
    const input = $('#q');
    const text = input.value.trim();
    if (!text || busy || state.finished) return;
    busy = true; input.value = ''; clearTimeout(idleTimer);
    state.messages.push({ who: 'me', text });
    renderMsgs(true);
    try {
      const r = await api('/api/message', { sessionId, text });
      const before = state.messages.length;
      apply(r.state);
      const last = state.messages.length - 1;
      if (r.newly.length) { hits.add(last); for (const f of r.newly) extra.push({ after: last, text: '🔓 Факт раскрыт: ' + f.label }); }
      if (before > state.messages.length) {/* сервер источник истины */}
      renderMsgs();
    } catch (err) {
      state.messages.pop(); input.value = text;
      extra.push({ after: state.messages.length - 1, text: err.message, err: true });
      renderMsgs();
      if (err.status === 404) return resetToStart();
    } finally { busy = false; armIdle(); }
  };
  $('#q').addEventListener('input', armIdle);

  // --- Подсказка, если команда зависла ---
  function armIdle() {
    clearTimeout(idleTimer);
    if (!state || state.finished || $('#chat').classList.contains('hidden')) return;
    idleTimer = setTimeout(async () => {
      if (busy || $('#q').value.trim()) return armIdle();
      try {
        const r = await api('/api/nudge', { sessionId });
        if (r.text) { state.messages.push({ who: 'them', text: r.text }); renderMsgs(); armIdle(); }
      } catch {}
    }, IDLE_MS);
  }

  function resetToStart() {
    store.set('bc-session', null); sessionId = null; state = null; hits.clear(); extra.length = 0;
    $('#app').style.removeProperty('--accent'); $('#app').style.removeProperty('--accent-soft');
    $('#code').value = ''; go('start');
  }
  $('#restart-btn').onclick = resetToStart;

  $('#dossier-btn').onclick = () => {
    const d = $('#dossier'); d.classList.toggle('hidden');
    $('#dossier-btn').setAttribute('aria-expanded', String(!d.classList.contains('hidden')));
  };

  // --- Восстановление после перезагрузки страницы ---
  if (sessionId) {
    api('/api/session?id=' + encodeURIComponent(sessionId))
      .then((r) => { apply(r.state); go(r.state.finished ? 'done' : 'chat'); })
      .catch(() => store.set('bc-session', null));
  }
})();
