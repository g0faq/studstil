(() => {
  const API = window.API_URL || '';
  const $ = (s) => document.querySelector(s);
  // Свои иконки вместо эмодзи: рисуем в цвете акцента
  const ICON = {
    check: '<svg class="ic" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="currentColor" opacity=".18"/><path d="M5.6 10.4l2.9 2.9 5.9-6.6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    wait: '<svg class="ic" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="none" stroke="currentColor" stroke-width="1.6" opacity=".45" stroke-dasharray="3 3.4"/><circle cx="6.4" cy="10" r="1.5" fill="currentColor"><animate attributeName="opacity" values=".25;1;.25" dur="1.4s" repeatCount="indefinite"/></circle><circle cx="10" cy="10" r="1.5" fill="currentColor"><animate attributeName="opacity" values=".25;1;.25" dur="1.4s" begin=".2s" repeatCount="indefinite"/></circle><circle cx="13.6" cy="10" r="1.5" fill="currentColor"><animate attributeName="opacity" values=".25;1;.25" dur="1.4s" begin=".4s" repeatCount="indefinite"/></circle></svg>',
  };
  const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
  const params = new URLSearchParams(location.search);
  let key = params.get('key') || ls.get('bc-admin-key') || '';
  if (params.get('key')) { ls.set('bc-admin-key', key); history.replaceState(null, '', location.pathname); }
  let game = null, poll = null;

  async function api(path, method = 'GET', body) {
    const res = await fetch(API + path, {
      method, headers: { 'X-Admin-Key': key, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'Нет связи с сервером'), { status: res.status });
    return data;
  }

  const show = (id) => {
    for (const s of document.querySelectorAll('.step')) s.classList.toggle('on', s.id === id);
    if (id === 's-splash') setTimeout(() => { if ($('#s-splash').classList.contains('on')) show('s-rules'); }, 3800);
  };
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-go]'); if (b) show(b.dataset.go); });

  // Вход по ключу
  $('#key-form').onsubmit = async (e) => {
    e.preventDefault();
    key = $('#key').value.trim(); ls.set('bc-admin-key', key);
    try { await api('/api/admin/game'); enter(); }
    catch (err) { $('#key-err').textContent = err.status === 401 ? 'Неверный ключ' : err.message; }
  };

  async function enter() {
    splitTitle();
    try {
      const r = await api('/api/admin/game');
      game = r.game;
      if (game?.phase === 'running') return location.replace('board.html'); // игра уже идёт → дашборд
      if (game?.phase === 'lobby') { renderCodes(); show('s-codes'); startPoll(); return; }
    } catch {}
    show('s-splash');
  }

  function splitTitle() {
    const t = $('#splash-title');
    if (t.dataset.done) return;
    t.dataset.done = '1';
    t.innerHTML = [...t.textContent].map((c, i) => `<span class="ch" style="--i:${i}">${c === ' ' ? '&nbsp;' : c}</span>`).join('');
  }

  // Поля названий: подписи берём из сценариев (их отдаёт табло)
  async function buildNames() {
    const form = $('#names-form');
    if (form.children.length) return;
    let teams = [];
    try { teams = (await api('/api/board')).teams; } catch {}
    form.replaceChildren();
    teams.forEach((t, i) => {
      const card = document.createElement('label');
      card.className = 'name-card glass';
      card.innerHTML = `<div class="caps" style="color:${t.accent}">Клиентка ${i + 1} · ${t.name}, ${t.age}</div>`;
      const input = document.createElement('input');
      input.placeholder = `Команда ${i + 1}`; input.maxLength = 40; input.dataset.i = i;
      input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#make-codes').click(); } };
      card.append(input); form.append(card);
    });
  }

  $('[data-go="s-names"]').addEventListener('click', buildNames);

  $('#make-codes').onclick = async () => {
    const names = [...document.querySelectorAll('#names-form input')].map((i) => i.value.trim());
    $('#names-err').textContent = '';
    try {
      game = (await api('/api/admin/game', 'POST', { names })).game;
      renderCodes(); show('s-codes'); startPoll();
    } catch (e) { $('#names-err').textContent = e.message; }
  };

  $('#recodes').onclick = async () => {
    game = (await api('/api/admin/game', 'POST', { names: game.teams.map((t) => t.name) })).game;
    renderCodes();
  };

  function renderCodes() {
    const box = $('#codes'); box.replaceChildren();
    for (const t of game.teams) {
      const card = document.createElement('div');
      card.className = 'code-card glass';
      card.innerHTML = `<div class="caps dim"></div><div class="code-num"></div><div class="mini"></div><div class="join" data-join="${t.scenario_id}"></div>`;
      card.querySelector('.caps').textContent = t.name;
      card.querySelector('.code-num').textContent = t.code;
      card.querySelector('.mini').textContent = t.client;
      box.append(card);
    }
    // цвета берём из табло, если оно уже отвечало
    api('/api/board').then(({ teams }) => {
      [...box.children].forEach((card, i) => { if (teams[i]) card.style.setProperty('--accent', teams[i].accent); });
    }).catch(() => {});
    if (!$('#qr').children.length) {
      fetch('img/qr.svg').then((r) => r.text()).then((svg) => { $('#qr').innerHTML = svg; }).catch(() => {
        $('#qr').textContent = 'studstil.ru';
      });
    }
  }

  // Кто уже в комнате ожидания: кнопка «Начать» включается, когда зашли все команды
  function startPoll() {
    clearInterval(poll);
    const tick = async () => {
      try {
        const { teams } = await api('/api/board');
        let ready = 0;
        for (const t of teams) {
          const el = document.querySelector(`[data-join="${t.id}"]`);
          const on = t.sessions > 0;
          if (on) ready++;
          if (el) {
            el.innerHTML = on ? `${ICON.check} подключились · ${t.sessions}` : `${ICON.wait} ждём команду`;
            el.classList.toggle('on', on);
            el.closest('.code-card').classList.toggle('ready', on);
          }
        }
        const all = ready === teams.length;
        const btn = $('#start-btn');
        btn.disabled = !all;
        btn.textContent = all ? 'Начать игру' : `Ждём команды · ${ready} из ${teams.length}`;
        $('#waiting').textContent = all ? 'Все команды на месте — можно начинать' : 'Кнопка «Начать» включится, когда зайдут все три команды';
      } catch {}
    };
    tick(); poll = setInterval(tick, 2500);
  }

  $('#start-btn').disabled = true;
  $('#start-btn').onclick = async () => {
    if ($('#start-btn').disabled) return;
    $('#start-btn').disabled = true;
    try { await api('/api/admin/start', 'POST'); clearInterval(poll); location.href = 'board.html'; }
    catch (e) { $('#start-btn').disabled = false; alert(e.message); }
  };

  key ? enter() : show('s-key');
})();
