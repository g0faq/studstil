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
  let waitTimer = null;
  let shown = 0; // сколько сообщений уже анимировано (остальные не переигрываем)
  let fresh = new Set(); // индексы только что раскрывших факт ответов
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
    for (const s of document.querySelectorAll('.screen')) s.classList.toggle('hidden', s.id !== screen);
    if (screen === 'chat') { scrollDown(); armIdle(); setTimeout(() => $('#q').focus({ preventScroll: true }), 50); } else clearTimeout(idleTimer);
    clearInterval(waitTimer);
    if (screen === 'wait') waitTimer = setInterval(checkStart, 3000);
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
        if (x.stamp) { const st = document.createElement('div'); st.className = 'stamp' + (fresh.has(i) ? ' fresh' : ''); st.textContent = '🔓 ' + x.text; box.append(st); }
        else box.append(bubble('sys' + (x.err ? ' err' : '') + old, x.text));
      }
    });
    shown = state.messages.length;
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
    confetti();
  }

  // --- Отправка вопроса ---
  $('#composer').onsubmit = async (e) => {
    e.preventDefault();
    const input = $('#q');
    const text = input.value.trim();
    if (!text || busy || state.finished) return;
    busy = true; input.value = ''; clearTimeout(idleTimer);
    state.messages.push({ who: 'me', text });
    fresh = new Set();
    renderMsgs(true);
    try {
      const r = await api('/api/message', { sessionId, text });
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

  // --- Искры из полосы прогресса при раскрытии факта ---
  function burst(el) {
    if (reduced || !el) return;
    const r = el.getBoundingClientRect();
    const x0 = r.left + r.width, y0 = r.top + r.height / 2;
    const colors = ['var(--g1)', 'var(--g2)', 'var(--g3)', 'var(--accent)'];
    for (let i = 0; i < 14; i++) {
      const p = document.createElement('i'); p.className = 'particle';
      const size = 4 + Math.random() * 6;
      Object.assign(p.style, { left: x0 + 'px', top: y0 + 'px', width: size + 'px', height: size + 'px', background: colors[i % 4] });
      document.body.append(p);
      const a = Math.random() * Math.PI * 2, d = 30 + Math.random() * 60;
      p.animate([
        { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
        { transform: `translate(calc(-50% + ${Math.cos(a) * d}px), calc(-50% + ${Math.sin(a) * d + 20}px)) scale(.3)`, opacity: 0 },
      ], { duration: 700 + Math.random() * 300, easing: 'cubic-bezier(.22,1,.36,1)' }).onfinish = () => p.remove();
    }
  }

  // --- Конфетти из «мазков» на экране итога (один раз) ---
  function confetti() {
    const cv = $('#confetti');
    if (reduced || cv.dataset.done === sessionId) return;
    cv.dataset.done = sessionId;
    const ctx = cv.getContext('2d'), dpr = devicePixelRatio || 1;
    const W = cv.width = cv.offsetWidth * dpr, H = cv.height = cv.offsetHeight * dpr;
    const css = getComputedStyle($('#app'));
    const cols = ['--g1', '--g2', '--g3', '--accent'].map((v) => css.getPropertyValue(v).trim() || '#FF7A1A');
    const parts = Array.from({ length: 90 }, () => ({
      x: W / 2 + (Math.random() - .5) * W * .3, y: H * .22,
      vx: (Math.random() - .5) * 14 * dpr, vy: (-6 - Math.random() * 10) * dpr,
      w: (6 + Math.random() * 12) * dpr, h: (3 + Math.random() * 4) * dpr,
      r: Math.random() * 6, vr: (Math.random() - .5) * .3, c: cols[(Math.random() * cols.length) | 0], round: Math.random() < .35,
    }));
    const t0 = performance.now();
    (function frame(t) {
      ctx.clearRect(0, 0, W, H);
      const life = (t - t0) / 2600;
      for (const p of parts) {
        p.vy += .35 * dpr; p.vx *= .99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        ctx.save(); ctx.globalAlpha = Math.max(0, 1 - life); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c;
        if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.h, 0, 7); ctx.fill(); }
        else { ctx.beginPath(); ctx.roundRect(-p.w / 2, -p.h / 2, p.w, p.h, p.h / 2); ctx.fill(); } // мазок с круглыми краями
        ctx.restore();
      }
      if (life < 1) requestAnimationFrame(frame); else ctx.clearRect(0, 0, W, H);
    })(t0);
  }

  function resetToStart() {
    store.set('bc-session', null); sessionId = null; state = null; hits.clear(); extra.length = 0; shown = 0; fresh = new Set();
    $('#app').style.removeProperty('--accent'); $('#app').style.removeProperty('--accent-soft');
    clearInterval(waitTimer); $('#code').value = ''; go('start');
  }
  $('#restart-btn').onclick = resetToStart;
  $('#wait-exit').onclick = resetToStart;

  $('#dossier-btn').onclick = () => {
    const d = $('#dossier'); d.classList.toggle('hidden');
    $('#dossier-btn').setAttribute('aria-expanded', String(!d.classList.contains('hidden')));
  };

  // --- Восстановление после перезагрузки страницы ---
  if (sessionId) {
    api('/api/session?id=' + encodeURIComponent(sessionId))
      .then((r) => { apply(r.state); go(r.state.phase === 'lobby' ? 'wait' : r.state.finished ? 'done' : 'chat'); })
      .catch(() => store.set('bc-session', null));
  }
})();
