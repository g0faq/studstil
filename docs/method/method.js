(() => {
  const API = window.API_URL || '';
  const $ = (s) => document.querySelector(s);
  const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
  const params = new URLSearchParams(location.search);
  let key = params.get('key') || ls.get('bc-admin-key') || '';
  if (params.get('key')) { ls.set('bc-admin-key', key); history.replaceState(null, '', location.pathname); }
  const green = document.documentElement.dataset.palette === 'green';

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const list = (items) => { const ul = el('ul'); for (const t of items || []) ul.append(el('li', null, t)); return ul; };
  const box = (title, node) => { const b = el('div', 'box'); b.append(el('h3', null, title), node); return b; };

  async function load() {
    const res = await fetch(API + '/api/admin/method', { headers: { 'X-Admin-Key': key } });
    const data = await res.json();
    if (!res.ok) throw Object.assign(new Error(data.error || 'Нет связи с сервером'), { status: res.status });
    render(data.clients);
  }

  function render(clients) {
    const nav = $('#nav'); nav.replaceChildren();
    const wrap = $('#clients'); wrap.replaceChildren();

    clients.forEach((c, i) => {
      const a = el('a', null, `${i + 1}. ${c.name}, ${c.age}`);
      a.href = '#' + c.id; nav.append(a);

      const card = el('div', 'client'); card.id = c.id;
      card.style.setProperty('--accent', (green && c.accent_green) || c.accent);

      // Шапка
      const head = el('div', 'c-head');
      const av = el('div', 'avatar');
      av.textContent = c.letter;
      const photo = (green && c.photo_green) || c.photo;
      if (photo) { const img = new Image(); img.alt = ''; img.onerror = () => img.remove(); img.src = '../' + photo; av.append(img); }
      const who = el('div');
      who.append(el('div', 'c-name', `${c.name}, ${c.age}`), el('div', 'dim', c.meta));
      head.append(av, who, el('span', 'badge', `код ${c.code}`));
      card.append(head);

      // Легенда и как себя ведёт
      const g1 = el('div', 'grid2');
      const legend = el('div');
      legend.append(el('p', null, c.persona.description || ''));
      if (c.persona.character) legend.append(el('p', 'dim', c.persona.character));
      g1.append(box('Легенда клиентки', legend));
      const first = el('div');
      first.append(el('div', 'quote', `«${c.greeting}»`), el('p', 'dim', c.deflection));
      g1.append(box('С чего начинается разговор', first));
      card.append(g1);

      // Факты
      const table = el('table');
      table.innerHTML = '<thead><tr><th>Факт</th><th>Что узнают</th><th>Каким вопросом открывается</th></tr></thead>';
      const tb = el('tbody');
      for (const f of c.facts) {
        const tr = el('tr');
        const lbl = el('td', 'lbl');
        lbl.append(el('span', f.required ? 'req' : 'opt', f.label));
        lbl.append(el('div', 'dim', f.required ? 'обязательный' : 'дополнительный'));
        tr.append(lbl, el('td', null, f.text), el('td', 'dim', f.reveal_when));
        tb.append(tr);
      }
      table.append(tb);
      card.append(box(`Скрытые факты · ${c.facts.filter((f) => f.required).length} обязательных из ${c.facts.length}`, table));

      // Подсказки и финал
      const g2 = el('div', 'grid2');
      g2.append(box('Подсказки, если команда застряла', list(c.triggers)));
      const fin = el('div');
      fin.append(el('div', 'quote', `«${c.final_message}»`), el('p', null, c.problem));
      g2.append(box('Настоящая потребность', fin));
      card.append(g2);

      // Полный образ
      if (c.solution) {
        card.append(box('Задача команды', el('p', null, c.solution.goal)));
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
    });

    const rules = el('div');
    rules.append(el('h3', null, 'Как система оценивает решение'));
    rules.append(list([
      'Команда присылает один финальный ответ в свободной форме — что и как она будет делать.',
      'Модель сверяет ответ с настоящей потребностью клиентки, обязательными фактами и ориентиром решения выше.',
      'Обязателен полный образ: одежда, стрижка с укладкой и цветом, макияж. Если одна часть пропущена — балл не выше 6, если раскрыта только одна — не выше 4.',
      '9–10 баллов: учтены все ключевые факты, есть конкретика (силуэты, длина, форма, цвет, техника), решение реально по времени и бюджету клиентки.',
      '7–8: главное понято, часть деталей общая. 5–6: направление верное, но много общих слов. 3–4: слабо связано с запросом. 0–2: не по теме.',
      'Балл снижается, если решение противоречит тому, чего клиентка боится или не хочет.',
      'Команда видит балл, короткий вывод, сильные стороны и что доработать. Преподаватель видит то же самое на экране итогов.',
    ]));
    $('#rules-box').replaceChildren(rules);
  }

  function showLogin(err = '') { $('#page').classList.add('hidden'); $('#login').classList.remove('hidden'); $('#login-err').textContent = err; }
  async function open() {
    try { await load(); $('#login').classList.add('hidden'); $('#page').classList.remove('hidden'); }
    catch (e) { showLogin(e.status === 401 ? 'Неверный ключ' : e.message); }
  }
  $('#login-btn').onclick = () => { key = $('#key').value.trim(); ls.set('bc-admin-key', key); open(); };
  $('#key').onkeydown = (e) => { if (e.key === 'Enter') $('#login-btn').click(); };
  $('#print-btn').onclick = () => print();

  key ? open() : showLogin();
})();
