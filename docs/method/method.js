(() => {
  const API = window.API_URL || '';
  const $ = (s) => document.querySelector(s);
  const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
  const params = new URLSearchParams(location.search);
  let key = params.get('key') || ls.get('bc-admin-key') || '';
  if (params.get('key')) { ls.set('bc-admin-key', key); history.replaceState(null, '', location.pathname); }
  const green = document.documentElement.dataset.palette === 'green';
  const calm = (() => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } })();

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const list = (items) => { const ul = el('ul'); for (const t of items || []) ul.append(el('li', null, t)); return ul; };
  const box = (title, node, cls) => { const b = el('div', cls ? 'box ' + cls : 'box'); b.append(el('h3', null, title), node); return b; };

  // Уровень откровенности: чем выше, тем труднее вытянуть факт.
  const LEVELS = {
    1: 'отвечает охотно',
    2: 'отвечает коротко',
    3: 'только на вопрос о чувствах',
  };

  // Рубрика на 100 баллов — названия те же, что видит команда в итогах.
  const RUBRIC = [
    ['Диагностика в разговоре', 20, 'Уместные вопросы; контекст, быт, границы, чувства; подтверждение смысла'],
    ['Понимание запроса', 15, 'Настоящая потребность вместо первой фразы клиентки, без стереотипов'],
    ['Одежда', 15, 'Силуэт, уместность, комфорт, связь с обстоятельствами'],
    ['Волосы', 15, 'Форма, длина и текстура, цвет при обосновании, уход и границы'],
    ['Макияж', 15, 'Интенсивность, текстуры, акценты, привычки, выполнимость'],
    ['Целостность образа', 10, 'Единый характер, узнаваемость клиентки, читаемость решения'],
    ['Реалистичность и защита', 10, 'Время, бюджет, стойкость и уход; объяснение причин и альтернатив'],
  ];

  /* ——— появление блоков ——— */
  let io = null;
  function watch(node) {
    node.classList.add('up');
    if (calm || !('IntersectionObserver' in window)) { node.classList.add('in'); fillBar(node); return; }
    if (!io) {
      io = new IntersectionObserver((entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.classList.add('in');
          fillBar(e.target);
          io.unobserve(e.target);
        }
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    }
    io.observe(node);
  }
  function fillBar(node) {
    // Только собственная полоса строки, а не первая найденная внутри контейнера.
    const bar = node.querySelector && node.querySelector(':scope > .meter > i');
    if (bar && bar.dataset.w) bar.style.width = bar.dataset.w;
  }
  /** Ступенчатая задержка: соседние элементы въезжают волной. */
  function stagger(nodes, step = 60, max = 8) {
    nodes.forEach((n, i) => { if (!calm) n.style.transitionDelay = Math.min(i, max) * step + 'ms'; watch(n); });
  }

  async function load() {
    const res = await fetch(API + '/api/admin/method', { headers: { 'X-Admin-Key': key } });
    const data = await res.json();
    if (!res.ok) throw Object.assign(new Error(data.error || 'Нет связи с сервером'), { status: res.status });
    render(data.clients || []);
  }

  /** Полный кадр клиентки: сервер отдаёт photo_full, иначе выводим его из портрета. */
  function fullPhoto(c) {
    const p = c.photo_full || (c.photo || '').replace('-face.', '-full.') || c.photo;
    return p ? '../' + p : '';
  }

  function render(clients) {
    const nav = $('#nav'); nav.replaceChildren();
    const wrap = $('#clients'); wrap.replaceChildren();
    const navLinks = [];
    // Слой факта приходит не из всех сборок сервера. Если его нет ни у кого —
    // колонка всё равно нужна: в ней остаётся уровень откровенности, он приходит всегда.
    const hasLayers = clients.some((c) => (c.facts || []).some((f) => (f.layer || '').trim()));

    clients.forEach((c, i) => {
      const accent = (green && c.accent_green) || c.accent;
      const a = el('a', null, `${i + 1}. ${c.name}, ${c.age}`);
      a.href = '#' + c.id; a.style.setProperty('--n-accent', accent);
      nav.append(a); navLinks.push(a);

      const card = el('div', 'client'); card.id = c.id;
      card.style.setProperty('--accent', accent);

      /* ——— фото + легенда ——— */
      const top = el('div', 'c-top');
      const fig = el('figure', 'c-photo');
      const src = fullPhoto(c);
      if (src) {
        const img = new Image();
        img.alt = `${c.name}, ${c.age}`; img.loading = 'lazy';
        img.onerror = () => { img.remove(); fig.prepend(el('div', 'noimg', c.letter)); };
        img.src = src;
        fig.append(img);
      } else fig.append(el('div', 'noimg', c.letter));
      if (c.code) fig.append(el('span', 'code', 'код ' + c.code));
      top.append(fig);

      const main = el('div', 'c-main');
      const who = el('div');
      who.append(el('div', 'c-name', `${c.name}, ${c.age}`));
      const meta = el('div', 'c-meta');
      if (c.meta) meta.append(el('span', null, c.meta));
      if (c.task_time) meta.append(el('span', 'badge soft', c.task_time));
      who.append(meta);
      main.append(who);

      const legend = el('div');
      legend.append(el('p', null, c.persona?.description || ''));
      if (c.persona?.character) legend.append(el('p', 'dim', c.persona.character));
      if (c.persona?.speech) legend.append(el('p', 'dim', c.persona.speech));
      main.append(box('Легенда клиентки', legend));

      const first = el('div');
      first.append(el('div', 'say', `«${c.greeting}»`));
      if (c.deflection) first.append(el('p', 'dim', c.deflection));
      main.append(box('С чего начинается разговор', first));
      top.append(main);
      card.append(top);

      /* ——— факты: слой и уровень откровенности ——— */
      const facts = c.facts || [];
      const factsBody = el('div');
      const keyLine = el('div', 'lvl-key');
      for (const lv of [1, 2, 3]) {
        const s = el('span');
        s.append(el('i', 'lvl lvl-' + lv, String(lv)), document.createTextNode(LEVELS[lv]));
        keyLine.append(s);
      }
      factsBody.append(keyLine);

      const table = el('table', 'facts-table');
      const thead = el('thead');
      const headRow = el('tr');
      for (const t of ['Факт', hasLayers ? 'Слой' : 'Уровень', 'Что узнают', 'Каким вопросом открывается']) {
        const th = el('th', null, t); th.scope = 'col'; headRow.append(th);
      }
      thead.append(headRow);
      table.append(thead);
      const tb = el('tbody');
      const rows = [];
      for (const f of facts) {
        const tr = el('tr', f.required ? 'req-row' : 'opt-row');

        const lbl = el('td', 'lbl');
        lbl.append(el('span', null, f.label));
        lbl.append(el('span', 'tag', f.required ? 'обязательный' : 'дополнительный'));

        const layer = el('td', 'layer');
        const name = (f.layer || '').trim();
        // слой «граница» подсвечиваем красным: он ведёт прямо в блок жёстких границ
        const chip = el('span', name === 'граница' ? 'layer-chip edge' : 'layer-chip');
        const lv = LEVELS[f.level] ? Number(f.level) : 0;
        if (lv) {
          const mark = el('i', 'lvl lvl-' + lv, String(lv));
          mark.title = 'Уровень ' + lv + ': ' + LEVELS[lv];
          chip.append(mark);
        }
        // без слоя подпись берём у уровня, иначе в колонке остался бы голый значок
        chip.append(document.createTextNode(name || (lv ? LEVELS[lv] : '—')));
        layer.append(chip);

        const ask = el('td', 'ask');
        ask.append(document.createTextNode(f.reveal_when || ''));
        if (f.hint) ask.append(el('span', 'hint', 'Подсказка команде: ' + f.hint));

        tr.append(lbl, layer, el('td', null, f.text), ask);
        tb.append(tr); rows.push(tr);
      }
      table.append(tb);
      factsBody.append(table);
      const req = facts.filter((f) => f.required).length;
      card.append(box(`Скрытые факты · ${req} обязательных из ${facts.length}`, factsBody));

      /* ——— жёсткие границы ——— */
      const bounds = Array.isArray(c.boundaries) ? c.boundaries.filter(Boolean) : [];
      const b = el('div', bounds.length ? 'bounds' : 'bounds empty');
      const h = el('h3');
      h.append(el('span', 'stop', bounds.length ? '!' : '?'), document.createTextNode('Жёсткие границы'));
      b.append(h);
      if (bounds.length) {
        b.append(el('p', 'why', 'Клиентка так не хочет. Если команда услышала границу и всё равно её нарушила, соответствующий блок — одежда, волосы или макияж — получает не больше 4 баллов из 15, даже когда всё остальное красиво.'));
        const ul = el('ul', 'bound-list');
        for (const t of bounds) ul.append(el('li', null, t));
        b.append(ul);
      } else {
        // Границы есть в сценарии, но эта сборка сервера их не отдаёт. Молча спрятать блок нельзя:
        // преподаватель решит, что у клиентки нет запретов, и разбор на уроке будет неверным.
        b.append(el('p', 'why', 'Сервер этой сборки не передаёт список границ в /api/admin/method. '
          + 'Границы клиентки заданы в её сценарии (поле boundaries) — до обновления сервера смотрите их там. '
          + 'Это пропуск в данных, а не отсутствие запретов у клиентки.'));
      }
      card.append(b);

      /* ——— подсказки и настоящая потребность ——— */
      const g2 = el('div', 'grid2');
      g2.append(box('Подсказки, если команда застряла', list(c.triggers)));
      const fin = el('div');
      fin.append(el('div', 'say', `«${c.final_message}»`), el('p', null, c.problem));
      g2.append(box('Настоящая потребность', fin));
      card.append(g2);

      /* ——— полный образ ——— */
      if (c.solution) {
        const goal = el('div');
        goal.append(el('p', null, c.solution.goal || ''));
        if (c.tasks && c.tasks.length) goal.append(list(c.tasks));
        card.append(box('Задача команды', goal));

        const look = el('div', 'look');
        [['Одежда и силуэт', c.solution.outfit], ['Стрижка, укладка, цвет', c.solution.hair], ['Макияж', c.solution.makeup]]
          .forEach(([title, items], n) => {
            const b = el('div', 'box');
            const h = el('h3');
            h.append(el('span', 'n', String(n + 1)), document.createTextNode(title));
            b.append(h, list(items));
            look.append(b);
          });
        card.append(look);

        const g3 = el('div', 'grid2');
        g3.append(box('Почему именно так', list(c.solution.why)));
        g3.append(box('Межпредметные связи', list(c.solution.cross)));
        card.append(g3);
      }
      if (c.note) card.append(box('Пометка', el('p', 'dim', c.note)));

      wrap.append(card);
      watch(card);
      stagger(rows, 40, 10);
    });

    renderRubric();
    measureNav();
    spy(navLinks);
  }

  /* ——— что оценивает система: рубрика на 100 ——— */
  function renderRubric() {
    const r = el('div', 'rubric');
    const head = el('div', 'rubric-head');
    head.append(el('h2', null, 'Что оценивает система'), el('span', 'total-pill', '100 баллов'));
    r.append(head);
    r.append(el('p', 'dim', 'Команда присылает один финальный ответ в свободной форме. Модель сверяет его с настоящей потребностью клиентки, обязательными фактами и ориентиром решения выше, а потом раскладывает по семи блокам.'));

    const crit = el('div', 'crit');
    const rows = [];
    for (const [title, pts, hint] of RUBRIC) {
      const row = el('div', 'crit-row');
      const t = el('div', 't', title);
      t.append(el('small', null, hint));
      const bar = el('div', 'meter');
      const fill = el('i');
      fill.dataset.w = Math.round((pts / 20) * 100) + '%';
      bar.append(fill);
      const val = el('div', 'pts', String(pts));
      val.append(el('small', null, 'баллов'));
      row.append(t, bar, val);
      crit.append(row); rows.push(row);
    }
    r.append(crit);

    const rules = el('div', 'rules');
    const mk = (title, text, cls) => { const d = el('div', cls ? 'rule ' + cls : 'rule'); d.append(el('h4', null, title), el('p', null, text)); return d; };
    rules.append(mk('Граница нарушена — не выше 4 из 15', 'Если решение идёт против того, что клиентка прямо назвала неприемлемым, соответствующий блок (одежда, волосы или макияж) получает не больше 4 баллов из 15. Остальные блоки считаются как обычно.', 'warn'));
    rules.append(mk('Разные решения принимаются', 'Ориентир в карточке — не единственный верный ответ. Совпадение с ним не требуется: любое другое обоснованное решение засчитывается полностью, если оно отвечает на настоящую потребность и уважает границы.'));
    rules.append(mk('За неуслышанное не штрафуем', 'Если факт не прозвучал в диалоге, его нарушение — не грубая ошибка, а упущенная диагностика: балл теряется в первом блоке, а не в одежде, волосах или макияже.'));
    rules.append(mk('Что видят участники', 'Команда получает сумму, короткий вывод, две сильные стороны и две рекомендации. Преподаватель видит то же самое плюс разбивку по блокам и может поправить баллы с обязательным пояснением.'));
    r.append(rules);

    $('#rules-box').replaceChildren(r);
    watch(r);
    stagger(rows, 70, 7);
  }

  /** Липкая лента ссылок переносится по строкам — держим под неё реальный отступ для якорей. */
  let navRO = null;
  function measureNav() {
    const nav = $('#nav');
    if (!nav) return;
    const set = () => { const h = nav.offsetHeight; if (h) document.documentElement.style.setProperty('--navh', Math.round(h) + 'px'); };
    set();
    if (navRO) return;
    if ('ResizeObserver' in window) { navRO = new ResizeObserver(set); navRO.observe(nav); }
    else addEventListener('resize', set);
  }

  /* ——— подсветка активного пункта навигации ——— */
  function spy(links) {
    if (!('IntersectionObserver' in window) || !links.length) return;
    const obs = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        for (const l of links) l.classList.toggle('on', l.hash === '#' + e.target.id);
      }
    }, { rootMargin: '-15% 0px -70% 0px' });
    for (const l of links) { const t = document.getElementById(l.hash.slice(1)); if (t) obs.observe(t); }
  }

  function showLogin(err = '') { $('#page').classList.add('hidden'); $('#login').classList.remove('hidden'); $('#login-err').textContent = err; }
  async function open() {
    // Мерить ленту ссылок можно только на видимой странице: до этого у неё display:none.
    try { await load(); $('#login').classList.add('hidden'); $('#page').classList.remove('hidden'); measureNav(); }
    catch (e) { showLogin(e.status === 401 ? 'Неверный ключ' : e.message); }
  }
  $('#login-btn').onclick = () => { key = $('#key').value.trim(); ls.set('bc-admin-key', key); open(); };
  $('#key').onkeydown = (e) => { if (e.key === 'Enter') $('#login-btn').click(); };
  /** Перед печатью показываем всё: на бумаге анимации появления не нужны. */
  function revealAll() {
    document.querySelectorAll('.up').forEach((n) => { n.classList.add('in'); n.style.transitionDelay = '0s'; });
    document.querySelectorAll('.meter i').forEach((b) => { if (b.dataset.w) b.style.width = b.dataset.w; });
  }
  addEventListener('beforeprint', revealAll);
  $('#print-btn').onclick = () => { revealAll(); print(); };

  key ? open() : showLogin();
})();
