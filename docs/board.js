(() => {
  const API = window.API_URL || '';
  const $ = (s) => document.querySelector(s);
  const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
  const params = new URLSearchParams(location.search);
  const DEMO_MODE = !!params.get('demo');
  let key = params.get('key') || ls.get('bc-admin-key') || '';
  if (params.get('key')) { ls.set('bc-admin-key', key); history.replaceState(null, '', location.pathname + (params.get('min') ? '?min=' + params.get('min') : '')); } // не держим ключ в адресной строке
  let pollTimer;
  const prev = new Map(); // id → { done, tags, status, score } с прошлого опроса
  let works = [];         // команды из /api/admin/results
  const busy = new Set(); // 'сценарий:действие' — пока идёт запрос
  // Свои иконки вместо эмодзи
  const ICON = {
    unlock: '<svg class="ic" viewBox="0 0 20 20" aria-hidden="true"><path d="M6 9V6.6A4 4 0 0 1 13.6 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><rect x="3.2" y="9" width="13.6" height="8.4" rx="2.6" fill="currentColor"/><circle cx="10" cy="13.2" r="1.5" fill="var(--bg2)"/></svg>',
    spark: '<svg class="ic" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 1.6l1.9 5.1 5.1 1.9-5.1 1.9L10 15.6l-1.9-5.1L3 8.6l5.1-1.9z" fill="currentColor"/><circle cx="16.4" cy="15.2" r="1.8" fill="currentColor" opacity=".7"/><circle cx="4.2" cy="14.6" r="1.2" fill="currentColor" opacity=".5"/></svg>',
    done: '<svg class="ic" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="currentColor" opacity=".18"/><path d="M5.6 10.4l2.9 2.9 5.9-6.6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let firstPaint = true;

  async function call(path, method = 'GET', body) {
    const headers = { 'X-Admin-Key': key };
    if (body) headers['Content-Type'] = 'application/json';
    let res;
    try { res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined }); }
    catch { throw new Error('Сервер не отвечает'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'Нет связи с сервером'), { status: res.status });
    return data;
  }

  const accentOf = (t) => (document.documentElement.dataset.palette === 'green' && t.accent_green) || t.accent;

  // --- Короткое сообщение внизу экрана ---
  let toastTimer;
  function toast(text, bad = false) {
    const t = $('#toast');
    t.textContent = text;
    t.classList.toggle('bad', bad);
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('on'), 4500);
  }

  // --- Статус работы команды ---
  function statusOf(w) {
    if (!w) return null;
    if (w.status === 'not_submitted') return { cls: '', text: 'идёт консультация' };
    if (w.status === 'eval_error') return { cls: 'bad', text: 'ошибка оценки' };
    if (w.status === 'evaluated') return { cls: 'ok', text: 'оценена,', score: w.score ?? 0 };
    if (w.eval_status === 'running') return { cls: 'busy', text: 'оценка считается' };
    return { cls: 'sent', text: 'работа сдана' };
  }

  function imageNote(w) {
    if (!w || w.status === 'not_submitted') return '';
    if (w.image_status === 'queued') return 'образ в очереди';
    if (w.image_status === 'running') return 'рисуем образ';
    if (w.image_status === 'error') return 'образ не получился';
    if (w.image_status === 'done') return 'образ готов';
    return '';
  }

  // --- Дорожка: команда движется к финишу, каждый факт — шаг ---
  const ICON_FLAG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 21V3" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/><path d="M7.4 4.2h11.2l-2.6 4 2.6 4H7.4z" fill="currentColor"/></svg>';

  function laneEl(t, was, w) {
    const p = Math.max(0, Math.min(1, t.done / t.total));
    const lane = el('div', 'lane' + (t.finished ? ' done' : ''));
    lane.style.setProperty('--accent', accentOf(t));
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
    const note = t.finished ? 'финиш' : t.sessions ? `в игре · ${t.sessions}` : 'ждём команду';
    const meta = el('div', 'rrow');
    meta.append(el('div', 'caps2', note));
    if (t.hints) meta.append(el('div', 'caps2 hints', `подсказок: ${t.hints}`));
    right.append(score, meta);

    // Статус работы: сдана / считается / оценена / ошибка
    const st = statusOf(w);
    if (st) {
      const changed = was && was.status !== undefined && was.status !== st.cls + st.text;
      const chip = el('div', 'wstat ' + st.cls + (changed && !reduced ? ' flip' : ''));
      chip.append(el('span', 'dot'), el('span', null, st.text));
      if (st.score != null) {
        const from = was && was.score != null ? was.score : 0;
        const numNode = el('b', null, String(from));
        chip.append(document.createTextNode(' '), numNode, el('span', null, '/100'));
        countUp(numNode, from, st.score);
      }
      const row = el('div', 'rrow');
      const sub = imageNote(w);
      if (sub) row.append(el('div', 'wsub', sub));
      row.append(chip);
      right.append(row);
    }

    lane.append(who, track, right);
    return lane;
  }

  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  function render(teams) {
    const byId = new Map(works.map((w) => [w.id, w]));
    const grid = $('#grid'); grid.replaceChildren();
    teams.forEach((t, i) => {
      const was = prev.get(t.id);
      const w = byId.get(t.id);
      const lane = laneEl(t, was, w);
      lane.style.setProperty('--i', i);
      if (firstPaint) lane.classList.add('enter');
      if (was && t.done > was.done) lane.classList.add('bump');
      grid.append(lane);
      const st = statusOf(w);
      prev.set(t.id, {
        done: t.done, tags: t.tags.map((g) => g.on),
        status: st ? st.cls + st.text : undefined,
        score: st && st.score != null ? st.score : null,
      });
    });
    firstPaint = false;
    $('#updated').textContent = (DEMO_MODE ? 'Демонстрация · ' : 'Обновлено ') + new Date().toLocaleTimeString('ru-RU');
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

  // --- Панель управления работами ---
  const ACTIONS = [
    { act: 'eval', label: 'Переоценить', ok: 'оценка пересчитана' },
    { act: 'image', label: 'Перерисовать', ok: 'образ перерисован' },
    { act: 'resubmit', label: 'Разрешить переделать', ok: 'команда может сдать работу заново' },
  ];

  function rowMeta(t) {
    if (t.status === 'evaluated') return `${t.client} · ${t.score}/100`;
    if (t.status === 'eval_error') return `${t.client} · ошибка оценки`;
    if (t.eval_status === 'running') return `${t.client} · оценка считается`;
    return `${t.client} · работа сдана`;
  }

  // Раскрытая панель забирает высоту — дорожки поджимаются, чтобы счёт и статус не обрезались
  function refreshDense() {
    const open = (id) => { const p = $('#' + id); return !p.classList.contains('hidden') && !p.classList.contains('shut'); };
    $('#board').classList.toggle('dense', open('works') || open('tech'));
  }

  function renderWorks(teams) {
    const panel = $('#works');
    const sent = teams.filter((t) => t.status !== 'not_submitted');
    if (!sent.length) { panel.classList.add('hidden'); refreshDense(); return; }
    if (panel.classList.contains('hidden')) { panel.classList.remove('hidden'); panel.classList.add('in'); }
    refreshDense();

    const rated = sent.filter((t) => t.status === 'evaluated').length;
    $('#works-note').textContent = `сдано ${sent.length} из ${teams.length} · оценено ${rated}`;

    const list = $('#works-list');
    const sign = sent.map((t) => `${t.id}/${t.status}/${t.score}/${t.eval_status}/${t.image_status}/${t.version}`).join('|');
    if (list.dataset.sign === sign) return; // зря не перерисовываем: кнопки остаются живыми
    list.dataset.sign = sign;

    list.replaceChildren();
    sent.forEach((t, i) => {
      const row = el('div', 'wrow');
      row.style.setProperty('--i', i);
      row.style.setProperty('--accent', accentOf(t));
      row.append(el('span', 'bead'), el('span', 'nm', t.team), el('span', 'meta', rowMeta(t)), el('span', 'gap'));
      ACTIONS.forEach((a) => {
        const b = el('button', 'pill mini', a.label);
        b.type = 'button';
        if (busy.has(t.id + ':' + a.act)) { b.classList.add('working'); b.disabled = true; }
        b.onclick = () => runAction(t, a, b);
        row.append(b);
      });
      list.append(row);
    });
  }

  async function runAction(t, a, btn) {
    const k = t.id + ':' + a.act;
    if (busy.has(k)) return;
    if (DEMO_MODE) return toast('Демо-режим: запрос не отправляется');
    if (a.act === 'resubmit' && !confirm(`Разрешить команде «${t.team}» переделать работу? Текущая оценка перестанет действовать.`)) return;

    busy.add(k);
    btn.disabled = true;
    btn.classList.add('working');
    const sessionId = 'team:' + t.id;
    let ok = true;
    try {
      if (a.act === 'resubmit') await call('/api/admin/resubmit', 'POST', { sessionId });
      else await call('/api/admin/jobs', 'POST', { sessionId, kind: a.act, force: true });
      toast(`${t.team}: ${a.ok}`);
    } catch (e) {
      ok = false;
      toast(`${t.team}: ${e.message}`, true);
    }
    busy.delete(k);
    btn.classList.remove('working');

    // Короткий ответ остаётся на самой кнопке, потом она возвращается в строй
    btn.textContent = ok ? 'готово' : 'ошибка';
    btn.classList.add(ok ? 'done' : 'fail');
    setTimeout(() => {
      btn.textContent = a.label;
      btn.classList.remove('done', 'fail');
      btn.disabled = false;
      $('#works-list').dataset.sign = ''; // после действия строку собираем заново
      poll();
    }, 1700);
  }

  // --- Технические данные ---
  const msText = (n) => (n >= 60000 ? `${Math.floor(n / 60000)} мин ${Math.round((n % 60000) / 1000)} с` : `${(n / 1000).toFixed(1)} с`);
  const numText = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

  function renderTech(tech) {
    const panel = $('#tech');
    if (!tech) { panel.classList.add('hidden'); refreshDense(); return; }
    if (panel.classList.contains('hidden')) { panel.classList.remove('hidden'); panel.classList.add('in'); }
    refreshDense();
    const errs = tech.errors || [];
    $('#tech-note').textContent = errs.length ? `ошибок: ${errs.length}` : `вызовов: ${tech.calls || 0}`;

    const list = $('#tech-list');
    const sign = JSON.stringify(tech);
    if (list.dataset.sign === sign) return;
    list.dataset.sign = sign;

    list.replaceChildren();
    const stats = el('div', 'tstats');
    [
      [String(tech.calls || 0), 'вызовов'],
      [numText(tech.prompt_tokens || 0), 'токенов в запросах'],
      [numText(tech.completion_tokens || 0), 'токенов в ответах'],
      [msText(tech.total_ms || 0), 'суммарное время'],
    ].forEach(([v, cap]) => {
      const cell = el('div', 'tstat');
      cell.append(el('b', null, v), el('span', null, cap));
      stats.append(cell);
    });
    list.append(stats);

    const models = Object.entries(tech.by_model || {});
    const line = el('div', 'tline');
    if (models.length) {
      line.append(document.createTextNode('По моделям: '));
      models.forEach(([m, n], i) => {
        if (i) line.append(document.createTextNode(' · '));
        line.append(el('b', null, m), document.createTextNode(` — ${n}`));
      });
    } else line.textContent = 'Вызовов модели пока не было.';
    list.append(line);

    if (errs.length) {
      errs.forEach((e) => {
        const parts = [e.eval && 'оценка: ' + e.eval, e.image && 'картинка: ' + e.image].filter(Boolean);
        list.append(el('div', 'terr', `${e.team} — ${parts.join(' · ')}`));
      });
    } else list.append(el('div', 'tline', 'Ошибок нет.'));
  }

  // --- Складные панели; состояние переживает перезагрузку ---
  function bindPanel(id, storeKey, openByDefault) {
    const panel = $('#' + id), head = $('#' + id + '-toggle');
    const saved = ls.get(storeKey);
    const open = saved === null ? openByDefault : saved === '1';
    panel.classList.toggle('shut', !open);
    head.setAttribute('aria-expanded', String(open));
    head.onclick = () => {
      const shut = panel.classList.toggle('shut');
      head.setAttribute('aria-expanded', String(!shut));
      ls.set(storeKey, shut ? '0' : '1');
      refreshDense();
    };
  }
  bindPanel('works', 'bc-board-works', true);
  bindPanel('tech', 'bc-board-tech', false);

  // Фоновые задачи двигаются опросом: если телефон команды закрыт, подтолкнём с табло
  let nudging = false;
  async function nudgeJobs(teams) {
    if (nudging || DEMO_MODE) return;
    const t = teams.find((x) => x.eval_status === 'queued' || x.image_status === 'queued');
    if (!t) return;
    nudging = true;
    try { await call('/api/jobs', 'POST', { sessionId: 'team:' + t.id }); } catch {}
    nudging = false;
  }

  async function poll() {
    clearTimeout(pollTimer);
    const [b, r] = await Promise.allSettled([call('/api/board'), call('/api/admin/results')]);
    const fail = [b, r].find((x) => x.status === 'rejected');
    if (fail && fail.reason && fail.reason.status === 401) return showLogin('Неверный ключ');

    if (r.status === 'fulfilled') works = r.value.teams || [];
    if (b.status === 'fulfilled') { render(b.value.teams); applyTimer(b.value.timer); }
    if (r.status === 'fulfilled') { renderWorks(works); renderTech(r.value.tech); nudgeJobs(works); }
    if (fail) $('#updated').textContent = '⚠️ ' + fail.reason.message;

    pollTimer = setTimeout(poll, 3000);
  }

  function showLogin(err = '') { clearTimeout(pollTimer); $('#board').classList.add('hidden'); $('#login').classList.remove('hidden'); $('#login-err').textContent = err; }
  function showBoard() { $('#login').classList.add('hidden'); $('#board').classList.remove('hidden'); poll(); }

  $('#login-btn').onclick = () => { key = $('#key').value.trim(); ls.set('bc-admin-key', key); showBoard(); };
  $('#key').onkeydown = (e) => { if (e.key === 'Enter') $('#login-btn').click(); };
  $('#end-btn').onclick = async () => {
    if (DEMO_MODE) return location.href = 'results.html?demo=1';
    if (!confirm('Завершить игру и показать итоги? Команды больше не смогут отвечать.')) return;
    try { await call('/api/admin/finish', 'POST'); clearTimeout(pollTimer); location.href = 'results.html'; }
    catch (e) { alert(e.message); }
  };


  // Публикация итогов: если оценены не все, сначала перечислим кого ждём
  $('#publish-btn').onclick = async () => {
    const btn = $('#publish-btn');
    if (DEMO_MODE) { toast('Демо-режим: итоги не публикуются'); setTimeout(() => { location.href = 'results.html?demo=1'; }, 900); return; }
    const pending = works.filter((t) => t.status !== 'evaluated');
    if (pending.length) {
      const lines = pending.map((t) => `• ${t.team} — ${t.status === 'not_submitted' ? 'работа не сдана' : t.status === 'eval_error' ? 'ошибка оценки' : 'оценка ещё считается'}`);
      if (!confirm('Оценены не все работы:\n\n' + lines.join('\n') + '\n\nВсё равно показать итоги классу?')) return;
    }
    btn.disabled = true;
    try { await call('/api/admin/publish', 'POST'); clearTimeout(pollTimer); location.href = 'results.html'; }
    catch (e) { toast(e.message, true); btn.disabled = false; }
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

  // --- Демо-режим: ?demo=1 — прогресс идёт сам, без учеников, без ключа и без запросов к серверу ---
  const DEMO = [
    { id: 'olga', name: 'Ольга', age: 38, letter: 'О', team: 'Команда 1', code: '101', accent: '#FF7A1A', accent_green: '#3DDC84', photo: 'img/olga.svg', photo_green: 'img/olga-green.svg', total: 4,
      labels: ['Повод', 'Стиль сейчас', 'Время на сборы', 'Страх'], extraLabels: ['Успешный образ'] },
    { id: 'marina', name: 'Марина', age: 52, letter: 'М', team: 'Команда 2', code: '202', accent: '#F4C95D', accent_green: '#9FE870', photo: 'img/marina.svg', photo_green: 'img/marina-green.svg', total: 4,
      labels: ['Прошлый образ', 'Страх', 'Не молодиться', 'Образ с характером'], extraLabels: [] },
    { id: 'alina', name: 'Алина', age: 24, letter: 'А', team: 'Команда 3', code: '303', accent: '#FF5A5F', accent_green: '#FF5A5F', photo: 'img/alina.svg', photo_green: 'img/alina-green.svg', total: 4,
      labels: ['Цель', 'Время на сборы', 'Цвет волос', 'Чувство'], extraLabels: ['Референсы'] },
    { id: 'valeria', name: 'Валерия', age: 29, letter: 'В', team: 'Команда 4', code: '404', accent: '#7FB2FF', accent_green: '#5FD3C4', photo: 'img/valeria-face.jpg', photo_green: 'img/valeria-face.jpg', total: 4,
      labels: ['Контекст', 'Эмоция', 'Волосы', 'Макияж'], extraLabels: ['Бюджет'] },
  ];
  let demoDone = [1, 0, 2, 3];
  let demoPhase = [0, 0, 0, 0]; // 0 сдана → 1 считается → 2 оценена
  const DEMO_SCORE = [82, 74, 91, 63];

  function demoTeams() {
    return DEMO.map((d, i) => ({
      ...d, done: demoDone[i], sessions: [2, 3, 2, 2][i], finished: demoDone[i] === d.total,
      tags: d.labels.map((label, j) => ({ label, on: j < demoDone[i] })),
      extra: demoDone[i] === d.total ? d.extraLabels : [],
    }));
  }

  function demoWorks() {
    return DEMO.map((d, i) => {
      const full = demoDone[i] === d.total;
      const ph = full ? demoPhase[i] : -1;
      const broken = i === 3 && ph >= 2;
      return {
        id: d.id, team: d.team, client: `${d.name}, ${d.age}`, name: d.name, age: d.age,
        accent: d.accent, accent_green: d.accent_green, version: 1,
        status: ph < 0 ? 'not_submitted' : broken ? 'eval_error' : ph >= 2 ? 'evaluated' : 'processing',
        eval_status: ph < 0 ? null : broken ? 'error' : ph >= 2 ? 'done' : ph === 1 ? 'running' : 'queued',
        image_status: ph < 0 ? null : ph >= 2 ? 'done' : ph === 1 ? 'running' : 'queued',
        score: ph >= 2 && !broken ? DEMO_SCORE[i] : null,
      };
    });
  }

  function demoTech() {
    const rated = demoWorks().filter((w) => w.status === 'evaluated').length;
    return {
      calls: rated * 2, by_model: { 'gpt-5.6-luna': rated, 'image-edit': rated },
      prompt_tokens: rated * 4120, completion_tokens: rated * 860, total_ms: rated * 9400,
      errors: demoWorks().filter((w) => w.status === 'eval_error').map((w) => ({ team: w.team, eval: 'демонстрация ошибки', image: null })),
    };
  }

  function paintDemo() {
    works = demoWorks();
    render(demoTeams());
    renderWorks(works);
    renderTech(demoTech());
  }

  function runDemo() {
    applyTimer({ stage: 'play', left: 420 });
    $('#login').classList.add('hidden'); $('#board').classList.remove('hidden');
    paintDemo();
    setInterval(() => {
      const i = Math.floor(Math.random() * DEMO.length);
      if (demoDone[i] < DEMO[i].total && Math.random() > 0.35) demoDone[i]++;
      else if (demoDone[i] === DEMO[i].total && demoPhase[i] < 2) demoPhase[i]++;
      if (demoDone.every((d, k) => d === DEMO[k].total) && demoPhase.every((p) => p >= 2)) { demoDone = DEMO.map(() => 0); demoPhase = DEMO.map(() => 0); }
      paintDemo();
    }, 4000);
  }

  if (DEMO_MODE) runDemo();
  else key ? showBoard() : showLogin();
})();
