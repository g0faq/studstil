/**
 * Итоги игры на проекторе: таблица мест + разбор работы команды поверх неё.
 * Данные — GET /api/admin/results, ключ преподавателя из localStorage 'bc-admin-key'.
 */
(() => {
  const API = window.API_URL || '';
  const $ = (s) => document.querySelector(s);
  const ls = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* приватный режим */ } },
  };

  const params = new URLSearchParams(location.search);
  let key = params.get('key') || ls.get('bc-admin-key') || '';
  if (params.get('key')) { ls.set('bc-admin-key', key); history.replaceState(null, '', location.pathname); }

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const green = document.documentElement.dataset.palette === 'green';

  // Порядок критериев — как в рубрике методики
  const CRIT = ['diagnostics', 'understanding', 'outfit', 'hair', 'makeup', 'coherence', 'realism'];
  const CRIT_TITLE = {
    diagnostics: 'Диагностика в разговоре', understanding: 'Понимание запроса', outfit: 'Одежда',
    hair: 'Волосы', makeup: 'Макияж', coherence: 'Целостность образа', realism: 'Реалистичность и защита',
  };
  const STATUS = { not_submitted: 'работа не сдана', processing: 'оценивается', eval_error: 'ошибка оценки', evaluated: '' };
  const IMG_STATUS = {
    queued: 'Преображение в очереди — обновите страницу через минуту',
    running: 'Преображение как раз рисуется',
    error: 'Преображение собрать не удалось',
    skipped: 'Преображение для этой клиентки не делали',
  };
  const CROWN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 18h18l-1.4-9.6-4.3 3.4L12 5l-3.3 6.8-4.3-3.4z" fill="currentColor"/><rect x="3.6" y="19.4" width="16.8" height="2.4" rx="1.2" fill="currentColor" opacity=".55"/></svg>';

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const accentOf = (t) => (green && t.accent_green) || t.accent || '#FF7A1A';
  const plural = (n, a, b, c) => { const m = n % 100, k = n % 10; return m > 10 && m < 20 ? c : k === 1 ? a : k > 1 && k < 5 ? b : c; };

  let data = null;
  let sheetShot = null;   // «до/после» внутри разбора
  let stageShot = null;   // «до/после» во весь экран
  let opener = null;      // строка, из которой открыли разбор
  let stageOpener = null; // кнопка, из которой открыли полный экран
  let celebrated = false; // конфетти сыплем один раз за открытие страницы
  let poll = null;        // опрос, пока есть незаконченные оценки

  // ===================== Вход по ключу и загрузка =====================

  function showLogin(err = '') {
    $('#wrap').classList.add('hidden');
    $('#login').classList.remove('hidden');
    $('#login-err').textContent = err;
    $('#key').focus();
  }

  function showBoard() {
    $('#login').classList.add('hidden');
    $('#wrap').classList.remove('hidden');
  }

  async function open() {
    showBoard();
    splitTitle();
    $('#board').replaceChildren(el('div', 'r-empty', 'Собираем итоги…'));
    try {
      const res = await fetch(API + '/api/admin/results', { headers: { 'X-Admin-Key': key } });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(json.error || 'Нет связи с сервером'), { status: res.status });
      data = json;
      render();
    } catch (e) {
      if (e.status === 401) { showLogin('Неверный ключ преподавателя'); return; }
      $('#board').replaceChildren(el('div', 'r-empty', e.message + '.\nПроверьте связь с сервером и обновите страницу.'));
    }
  }

  $('#login-btn').onclick = () => {
    key = $('#key').value.trim();
    if (!key) { $('#login-err').textContent = 'Введите ключ'; return; }
    ls.set('bc-admin-key', key);
    open();
  };
  $('#key').onkeydown = (e) => { if (e.key === 'Enter') $('#login-btn').click(); };

  /** Пока идут оценки и картинки — тихо перезапрашиваем итоги. */
  const signature = (d) => (d && d.teams || [])
    .map((t) => [t.id, t.score, t.status, t.image_status].join('~')).join('|') + '#' + (d && d.published);

  function schedulePoll() {
    clearTimeout(poll);
    const busy = (data && data.teams || []).some((t) => t.status === 'processing'
      || t.image_status === 'queued' || t.image_status === 'running');
    if (busy) poll = setTimeout(refresh, 20000);
  }

  async function refresh() {
    try {
      const res = await fetch(API + '/api/admin/results', { headers: { 'X-Admin-Key': key } });
      if (!res.ok) throw new Error();
      const json = await res.json();
      const changed = signature(json) !== signature(data);
      data = json;
      // пока открыт разбор — не дёргаем экран под руками преподавателя
      if (changed && $('#sheet').hidden) render();
      else schedulePoll();
    } catch {
      schedulePoll();
    }
  }

  // ===================== Таблица мест =====================

  function render() {
    splitTitle();
    renderNotice();

    const teams = data.teams || [];
    const rated = teams.filter((t) => Number.isFinite(t.score)).slice().sort((a, b) => b.score - a.score);
    const rest = teams.filter((t) => !Number.isFinite(t.score));

    // Равные баллы — одинаковое место: 1, 1, 3
    let place = 0, prev = null;
    rated.forEach((t, i) => { if (t.score !== prev) { place = i + 1; prev = t.score; } t.place = place; });

    const asked = teams.reduce((n, t) => n + (t.questions || 0), 0);
    const hints = teams.reduce((n, t) => n + (t.hints || 0), 0);
    $('#subline').textContent = teams.length
      ? `${teams.length} ${plural(teams.length, 'команда', 'команды', 'команд')} · ${asked} ${plural(asked, 'вопрос', 'вопроса', 'вопросов')} клиенткам · ${hints} ${plural(hints, 'подсказка', 'подсказки', 'подсказок')}`
      : '';

    const board = $('#board');
    board.replaceChildren();

    schedulePoll();

    if (!teams.length) {
      board.append(el('div', 'r-empty', 'Команд пока нет. Соберите игру в панели преподавателя.'));
      return;
    }

    if (rated.length) {
      const cols = el('div', 'r-cols');
      for (const c of ['Место', 'Команда', 'Клиентка', 'Балл']) cols.append(el('i', null, c));
      board.append(cols);
    }

    let i = 0;
    for (const t of rated) board.append(row(t, i++));
    if (rest.length) {
      const split = el('div', 'r-split', 'Без оценки');
      split.style.animationDelay = (240 + i * 85) + 'ms';
      board.append(split);
      for (const t of rest) board.append(row(t, i++));
    }

    if (rated.length && !reduced && !celebrated) { celebrated = true; setTimeout(() => rain(), 250); }
  }

  function row(t, i) {
    const rated = Number.isFinite(t.score);
    const node = el('button', 'r-row' + (rated ? '' : ' pending') + (t.place === 1 ? ' top' : ''));
    node.type = 'button';
    node.style.setProperty('--accent', accentOf(t));
    node.style.setProperty('--i', i);

    const can = !!(t.eval || t.text || (t.image && t.image.key));
    node.dataset.open = can ? '1' : '0';
    if (!can) node.disabled = true;
    else node.onclick = () => openTeam(t, node);

    // Место
    const pl = el('div', 'r-place');
    if (t.place === 1) { const c = el('span'); c.innerHTML = CROWN; pl.append(c); }
    pl.append(el('span', null, rated ? String(t.place) : '—'));

    // Команда
    const team = el('div', 'r-team');
    const av = el('div', 'avatar r-ava', t.letter || '?');
    const photo = t.photo;
    if (photo) { const img = new Image(); img.alt = ''; img.onerror = () => img.remove(); img.src = photo; av.append(img); }
    team.append(av, el('div', 'r-name', t.team || '—'));

    // Клиентка
    const client = el('div', 'r-client', t.client || '—');

    node.append(pl, team, client);

    if (rated) {
      const score = el('div', 'r-score');
      const b = el('b', null, reduced ? String(t.score) : '0');
      score.append(b, el('i', null, '/100'));
      node.append(score);
      if (!reduced) setTimeout(() => countUp(b, t.score), 420 + i * 85);
    } else {
      const label = STATUS[t.status] || (t.eval_status === 'error' ? 'ошибка оценки' : 'оценивается');
      const cls = t.status === 'eval_error' ? ' bad' : t.status === 'processing' ? ' work' : '';
      node.append(el('div', 'r-status' + cls, label));
    }
    return node;
  }

  function countUp(node, to, ms = 850) {
    const t0 = performance.now();
    (function f(t) {
      const k = Math.min(1, (t - t0) / ms);
      node.textContent = String(Math.round(to * (1 - Math.pow(1 - k, 3))));
      if (k < 1) requestAnimationFrame(f);
    })(t0);
  }

  function splitTitle() {
    const h = $('#title');
    if (h.dataset.split) return;
    h.dataset.split = '1';
    const text = h.textContent;
    h.replaceChildren();
    [...text].forEach((ch, i) => {
      const s = el('span', 'ch', ch === ' ' ? ' ' : ch);
      s.style.setProperty('--i', i);
      h.append(s);
    });
  }

  function renderNotice() {
    const box = $('#notice');
    box.replaceChildren();
    if (data.published) return;

    const plate = el('div', 'r-notice');
    plate.append(el('i', 'r-dot'), el('span', null, 'Итоги ещё не опубликованы — команды их не видят.'));
    const btn = el('button', 'r-btn solid', 'Опубликовать');
    btn.type = 'button';
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = 'Публикую…';
      try {
        const res = await fetch(API + '/api/admin/publish', { method: 'POST', headers: { 'X-Admin-Key': key } });
        if (!res.ok) throw new Error();
        data.published = true;
        renderNotice();
        if (!reduced) rain(60);
      } catch {
        btn.disabled = false;
        btn.textContent = 'Не вышло, ещё раз';
      }
    };
    plate.append(btn);
    box.append(plate);
  }

  // ===================== Преображение «До / После» =====================

  const beforeOf = (t) => (t.photo_full ? 'img/' + String(t.photo_full).split('/').pop() : '');
  const hasShot = (t) => !!(beforeOf(t) && t.image && t.image.key);

  /**
   * Собирает кадр «до/после» вместе с метками «что изменилось».
   * Возвращает узлы и способ снять всё за собой.
   */
  function shot(t) {
    const frame = el('div', 'r-frame');
    const host = el('div');
    frame.append(host);

    const changed = el('div', 'r-changed');
    (t.image.changed || []).slice(0, 8).forEach((c, i) => {
      const chip = el('i', null, c);
      chip.style.setProperty('--i', i);
      changed.append(chip);
    });

    const inst = window.BeautyReveal.mount(host, {
      before: beforeOf(t),
      after: API + '/api/image?key=' + encodeURIComponent(t.image.key),
      autoplay: true,
      caption: 'Образ по решению команды ' + (t.team || ''),
    });

    // Луч дошёл до конца — зажигаем ореол, сыплем искры, показываем «что изменилось»
    let obs = new MutationObserver(() => {
      if (!host.classList.contains('ready')) return;
      obs.disconnect();
      obs = null;
      frame.classList.add('lit');
      changed.classList.add('on');
      if (reduced) return;
      burst(host.getBoundingClientRect());
      compare(host);
    });
    obs.observe(host, { attributes: true, attributeFilter: ['class'] });

    return {
      frame,
      changed,
      destroy() {
        if (obs) { obs.disconnect(); obs = null; }
        try { inst.destroy(); } catch { /* уже снят */ }
      },
    };
  }

  /**
   * После преображения — медленная протяжка шторки: весь кадр «до», затем весь «после».
   * Зрителям с задних парт видно разницу целиком. Первое касание отменяет.
   */
  function compare(host) {
    if (reduced) return;
    const legs = [[42, 100, 1000], [100, 0, 1500], [0, 42, 900]];
    const wait = [700, 420, 260];
    const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
    let leg = 0, t0 = 0, stopped = false;

    const stop = () => { stopped = true; host.removeEventListener('pointerdown', stop); };
    host.addEventListener('pointerdown', stop);

    function step(now) {
      if (stopped || !host.isConnected) { stop(); return; }
      if (!t0) t0 = now;
      const [a, b, ms] = legs[leg];
      const k = Math.min(1, (now - t0) / ms);
      host.style.setProperty('--pos', (a + (b - a) * ease(k)) + '%');
      if (k < 1) { requestAnimationFrame(step); return; }
      t0 = 0;
      leg += 1;
      if (leg < legs.length) setTimeout(() => requestAnimationFrame(step), wait[leg]);
      else stop();
    }
    setTimeout(() => requestAnimationFrame(step), wait[0]);
  }

  // ===================== Преображение во весь экран =====================

  function openStage(t, from) {
    if (!hasShot(t)) return;
    stageOpener = from || null;

    const stage = $('#stage');
    $('#stage-in').style.setProperty('--accent', accentOf(t));
    $('#stage-team').textContent = t.team || '—';

    const meta = $('#stage-meta');
    meta.replaceChildren(document.createTextNode(t.client || ''));
    if (Number.isFinite(t.score)) {
      meta.append(document.createTextNode(' · '), el('b', null, t.place + ' место · ' + t.score + ' из 100'));
    }

    stageShot = shot(t);
    $('#stage-frame').replaceChildren(stageShot.frame);
    $('#stage-changed').replaceChildren(stageShot.changed);

    stage.hidden = false;
    $('#sheet').inert = true;
    $('#stage-close').focus();
  }

  function closeStage() {
    const stage = $('#stage');
    if (stage.hidden) return;
    if (stageShot) { stageShot.destroy(); stageShot = null; }
    stage.hidden = true;
    $('#stage-frame').replaceChildren();
    $('#stage-changed').replaceChildren();
    $('#sheet').inert = false;
    if (stageOpener && stageOpener.isConnected) stageOpener.focus();
    stageOpener = null;
  }

  $('#stage-close').onclick = closeStage;
  $('#stage').addEventListener('click', (e) => { if (e.target.dataset.close != null) closeStage(); });

  // ===================== Разбор команды =====================

  function openTeam(t, from) {
    clearTimeout(poll);
    if (sheetShot) { sheetShot.destroy(); sheetShot = null; }
    opener = from || null;
    const card = $('#sheet-card');
    card.replaceChildren();
    card.scrollTop = 0;
    card.style.setProperty('--accent', accentOf(t));

    // Панель показываем до сборки: «До / После» стартует сам, когда видит себя на экране
    const sheet = $('#sheet');
    sheet.hidden = false;
    $('#wrap').setAttribute('aria-hidden', 'true');
    $('#wrap').inert = true;
    document.body.style.overflow = 'hidden';

    const ev = t.eval || null;
    let order = 0;
    const block = (cap) => {
      const b = el('div', 'r-block');
      b.style.setProperty('--i', order++);
      if (cap) b.append(el('div', 'r-cap', cap));
      return b;
    };

    // Шапка
    const head = el('div', 'r-card-head');
    const rated = Number.isFinite(t.score);
    head.append(el('div', 'r-badge' + (rated ? '' : ' mute'), rated ? t.place + ' место' : (STATUS[t.status] || 'без оценки')));
    const who = el('div', 'r-card-who');
    who.append(el('div', 'r-card-team', t.team || '—'), el('div', 'r-card-meta', t.client || ''));
    head.append(who);
    if (rated) {
      const sc = el('div', 'r-card-score');
      sc.append(el('b', null, String(t.score)), el('i', null, '/100'));
      head.append(sc);
    }
    card.append(head);

    if (ev && ev.verdict) card.append(el('div', 'r-verdict', ev.verdict));

    const grid = el('div', 'r-grid');
    const left = el('div', 'r-col');
    const right = el('div', 'r-col');
    grid.append(left, right);
    card.append(grid);

    // --- Финал: До / После ---
    const shotBlock = block('Преображение');
    if (hasShot(t)) {
      sheetShot = shot(t);
      shotBlock.append(sheetShot.frame);
      if (sheetShot.changed.children.length) shotBlock.append(sheetShot.changed);

      const full = el('button', 'r-btn r-full', 'Во весь экран');
      full.type = 'button';
      full.onclick = () => openStage(t, full);
      shotBlock.append(full);
    } else {
      const why = !beforeOf(t) ? 'У клиентки нет исходного фото'
        : IMG_STATUS[t.image_status] || (t.image_error ? 'Преображение собрать не удалось' : 'Преображения нет');
      shotBlock.append(el('div', 'r-noimg', why));
    }
    left.append(shotBlock);

    // Цифры работы
    const stats = block('Как шла работа');
    const strip = el('div', 'r-stats');
    const q = t.questions ?? 0, h = t.hints ?? 0, dev = t.devices ?? 0;
    const nums = [
      [t.work_minutes != null ? t.work_minutes + ' мин' : '—', 'времени'],
      [String(q), plural(q, 'вопрос', 'вопроса', 'вопросов')],
      [String(h), plural(h, 'подсказка', 'подсказки', 'подсказок')],
      [`${t.done ?? 0}/${t.total ?? 0}`, 'фактов'],
      [String(dev), plural(dev, 'устройство', 'устройства', 'устройств')],
    ];
    for (const [v, k] of nums) {
      const s = el('div', 'r-stat');
      s.append(el('b', null, v), el('span', null, k));
      strip.append(s);
    }
    stats.append(strip);
    left.append(stats);

    // --- Баллы по критериям ---
    if (ev && ev.criteria) {
      const crits = block('Баллы по критериям');
      const list = el('div', 'r-crits');
      const keys = CRIT.filter((k) => ev.criteria[k]).concat(Object.keys(ev.criteria).filter((k) => !CRIT.includes(k)));
      keys.forEach((k, i) => {
        const c = ev.criteria[k] || {};
        const max = Number(c.max) || 0;
        const val = Number(c.score) || 0;
        const pct = max ? Math.round((val / max) * 100) : 0;
        const box = el('div', 'r-c' + (pct < 50 ? ' r-c-low' : ''));
        box.append(el('div', 'r-c-title', c.title || CRIT_TITLE[k] || k));
        const num = el('div', 'r-c-num');
        num.append(document.createTextNode(String(val)), el('em', null, ' / ' + max));
        box.append(num);
        const track = el('div', 'r-c-track');
        const fill = el('div', 'r-c-fill');
        fill.style.setProperty('--w', pct + '%');
        fill.style.setProperty('--i', i);
        track.append(fill);
        box.append(track);
        if (c.evidence) box.append(el('div', 'r-c-ev', c.evidence));
        list.append(box);
      });
      crits.append(list);
      right.append(crits);
    } else if (t.status === 'processing') {
      const b = block(null);
      b.append(el('div', 'r-note flag', 'Оценка ещё считается. Обновите страницу через минуту.'));
      right.append(b);
    } else if (t.eval_error) {
      const b = block(null);
      b.append(el('div', 'r-note flag', 'Оценка не посчиталась: ' + t.eval_error));
      right.append(b);
    }

    // --- Сильные стороны и рекомендации ---
    if (ev && ((ev.strengths || []).length || (ev.recommendations || []).length)) {
      const b = block(null);
      const two = el('div', 'r-two');
      if ((ev.strengths || []).length) two.append(listBox('good', 'Что получилось', ev.strengths));
      if ((ev.recommendations || []).length) two.append(listBox('next', 'Что доработать', ev.recommendations));
      b.append(two);
      right.append(b);
    }

    // --- Что клиентке было нужно на самом деле ---
    if (t.problem) {
      const b = block('Настоящая потребность клиентки');
      b.append(el('div', 'r-need', t.problem));
      right.append(b);
    }

    // --- Потребности и границы ---
    if (ev) {
      const rows = [
        ['Выяснили', ev.found_needs, 'ok'],
        ['Упустили', ev.missed_needs, 'miss'],
        ['Учли ограничения', ev.respected_limits, 'ok'],
        ['Нарушили ограничения', ev.violated_limits, 'bad'],
      ].filter(([, arr]) => (arr || []).length);
      if (rows.length) {
        const b = block('Потребности клиентки');
        for (const [cap, arr, cls] of rows) {
          const line = el('div', 'r-tags');
          line.append(el('span', 'r-tag cap', cap));
          for (const v of arr) line.append(el('span', 'r-tag ' + cls, v));
          b.append(line);
        }
        right.append(b);
      }
    }

    // --- Текст работы ---
    if (t.text) {
      const b = block('Работа команды' + (t.version > 1 ? ` · версия ${t.version}` : ''));
      b.append(el('div', 'r-text', t.text));
      right.append(b);
    }

    // --- Пометки преподавателя ---
    const notes = [];
    if (ev && ev.teacher_edit) {
      const te = ev.teacher_edit;
      notes.push(`Баллы поправил преподаватель: ${te.from} → ${te.to}. ${te.comment || ''}`.trim());
    }
    if (ev && ev.needs_teacher_review) notes.push('ИИ отметил оценку как спорную — стоит проверить.');
    if (notes.length) {
      const b = block(null);
      for (const n of notes) b.append(el('div', 'r-note flag', n));
      right.append(b);
    }

    $('#sheet-close').focus();
  }

  function listBox(cls, title, items) {
    const box = el('div', 'r-box ' + cls);
    box.append(el('h3', null, title));
    const ul = el('ul');
    for (const v of items) ul.append(el('li', null, v));
    box.append(ul);
    return box;
  }

  function closeSheet() {
    const sheet = $('#sheet');
    if (sheet.hidden) return;
    closeStage();
    if (sheetShot) { sheetShot.destroy(); sheetShot = null; }
    sheet.hidden = true;
    $('#sheet-card').replaceChildren();
    $('#wrap').removeAttribute('aria-hidden');
    $('#wrap').inert = false;
    document.body.style.overflow = '';
    if (opener && opener.isConnected) opener.focus();
    opener = null;
    schedulePoll();
  }

  $('#sheet-close').onclick = closeSheet;
  $('#sheet').addEventListener('click', (e) => { if (e.target.dataset.close != null) closeSheet(); });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('#stage').hidden) closeStage();  // сначала выходим из полного экрана
    else closeSheet();
  });

  // ===================== Конфетти =====================

  const cv = $('#confetti');
  const ctx = cv.getContext('2d');
  let parts = [], running = false, dpr = 1;

  function fit() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    cv.width = Math.max(1, innerWidth * dpr);
    cv.height = Math.max(1, innerHeight * dpr);
  }
  fit();
  addEventListener('resize', fit);

  function palette() {
    const css = getComputedStyle(document.body);
    return ['--g1', '--g2', '--g3', '--accent'].map((v) => css.getPropertyValue(v).trim() || '#FF7A1A');
  }

  function push(p) { parts.push(p); }

  function tick() {
    if (running) return;
    running = true;
    let last = performance.now();
    (function frame(now) {
      const dt = Math.min(50, now - last) / 16.67;
      last = now;
      ctx.clearRect(0, 0, cv.width, cv.height);
      for (const p of parts) {
        p.life += dt;
        p.vy += p.g * dt;
        p.vx *= 0.996;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.r += p.vr * dt;
        const a = Math.max(0, 1 - p.life / p.max);
        if (a <= 0) continue;
        ctx.save();
        ctx.globalAlpha = a;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.r);
        ctx.fillStyle = p.c;
        ctx.beginPath();
        ctx.roundRect(-p.w / 2, -p.h / 2, p.w, p.h * (0.4 + 0.6 * Math.abs(Math.cos(p.r))), p.h / 2);
        ctx.fill();
        ctx.restore();
      }
      parts = parts.filter((p) => p.life < p.max && p.y < cv.height + 60 * dpr);
      if (parts.length) requestAnimationFrame(frame);
      else { ctx.clearRect(0, 0, cv.width, cv.height); running = false; }
    })(last);
  }

  /** Дождь по всему экрану — один раз при открытии итогов. */
  function rain(n = 140) {
    if (reduced) return;
    const cols = palette();
    for (let i = 0; i < n; i++) {
      push({
        x: Math.random() * cv.width, y: -Math.random() * cv.height * 0.5,
        vx: (Math.random() - 0.5) * 2.4 * dpr, vy: (2 + Math.random() * 3.2) * dpr, g: 0.03 * dpr,
        w: (6 + Math.random() * 13) * dpr, h: (4 + Math.random() * 6) * dpr,
        r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.24,
        c: cols[(Math.random() * cols.length) | 0], life: 0, max: 190 + Math.random() * 90,
      });
    }
    tick();
  }

  /** Взрыв из рамки «до/после» — в момент, когда образ открылся. */
  function burst(rect) {
    if (reduced || !rect || !rect.width) return;
    const cols = palette();
    const cx = (rect.left + rect.width / 2) * dpr;
    const cy = (rect.top + rect.height * 0.45) * dpr;
    for (let i = 0; i < 90; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = (4 + Math.random() * 11) * dpr;
      push({
        x: cx + (Math.random() - 0.5) * rect.width * dpr * 0.5,
        y: cy + (Math.random() - 0.5) * rect.height * dpr * 0.5,
        vx: Math.cos(a) * v, vy: Math.sin(a) * v - 3 * dpr, g: 0.14 * dpr,
        w: (5 + Math.random() * 12) * dpr, h: (4 + Math.random() * 5) * dpr,
        r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4,
        c: cols[(Math.random() * cols.length) | 0], life: 0, max: 85 + Math.random() * 55,
      });
    }
    tick();
  }

  // ===================== Кнопка «В начало» =====================

  $('#restart').onclick = async () => {
    if (!confirm('Начать заново? Игра, коды и прогресс будут сброшены. Логи диалогов сохранятся.')) return;
    try {
      await fetch(API + '/api/admin/end', { method: 'POST', headers: { 'X-Admin-Key': key } });
    } catch { /* всё равно уходим в панель */ }
    location.href = 'admin/';
  };

  key ? open() : showLogin();
})();
