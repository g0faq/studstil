(() => {
  const API = window.API_URL || '';
  const $ = (s) => document.querySelector(s);
  const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
  const params = new URLSearchParams(location.search);
  let key = params.get('key') || ls.get('bc-admin-key') || '';
  if (params.get('key')) { ls.set('bc-admin-key', key); history.replaceState(null, '', location.pathname + (params.get('min') ? '?min=' + params.get('min') : '')); } // не держим ключ в адресной строке
  let pollTimer;

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
      const card = el('div', 'team glass' + (t.finished ? ' win' : ''));
      card.style.setProperty('--accent', (document.documentElement.dataset.palette === 'green' && t.accent_green) || t.accent);
      const head = el('div'); head.style.cssText = 'display:flex;align-items:center;gap:14px;position:relative';
      const av = el('div', 'avatar', t.letter); av.style.cssText = 'width:60px;height:60px;font-size:24px';
      if (t.photo) { const img = new Image(); img.alt = ''; img.onerror = () => img.remove(); img.src = t.photo; av.append(img); }
      const who = el('div'); who.style.cssText = 'display:flex;flex-direction:column;gap:2px';
      const tn = el('div', 'display', t.team); tn.style.cssText = 'font-weight:600;font-size:20px';
      who.append(tn, el('div', 'dim', `${t.name}, ${t.age} · код ${t.code}`));
      head.append(av, who);
      const score = el('div'); score.style.cssText = 'display:flex;align-items:baseline;gap:8px';
      score.append(el('span', 'big', t.done), el('span', 'dim', `/ ${t.total} факта`));
      score.lastChild.style.cssText = 'font-size:20px;font-weight:700';
      const track = el('div', 'track'); track.style.height = '12px';
      const fill = el('div', 'fill'); fill.style.width = (t.done / t.total * 100) + '%'; track.append(fill);
      const tags = el('div'); tags.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
      for (const g of t.tags) tags.append(el('span', 'tag' + (g.on ? ' on' : ''), g.on ? g.label : '• • •')); // закрытые не подсказываем
      for (const x of t.extra) tags.append(el('span', 'tag', '+ ' + x));
      const status = t.finished ? '✅ Проблема сформулирована' : t.sessions ? `Идёт консультация · устройств: ${t.sessions}` : 'Ждём команду…';
      const st = el('div', 'dim', status); st.style.cssText = 'font-size:15px;font-weight:600';
      card.append(head, score, track, tags, st);
      grid.append(card);
    }
    $('#updated').textContent = 'Обновлено ' + new Date().toLocaleTimeString('ru-RU');
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

  key ? showBoard() : showLogin();
})();
