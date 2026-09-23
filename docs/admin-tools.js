/**
 * Значок настроек преподавателя. Есть на каждом экране игры.
 * Внутри — всё техническое: состояние игры, переходы между экранами, управление работами команд,
 * расход моделей, сброс прогресса и полное обнуление состязания.
 * Подключается одной строкой: <script src="admin-tools.js"></script> (или ../admin-tools.js в подпапке).
 */
(() => {
  const API = window.API_URL || '';
  // На страницах в подпапке (admin/, method/) ссылки и стили ведут на уровень выше
  const ROOT = /\/(admin|method)\/?$/.test(location.pathname.replace(/[^/]*$/, '').replace(/\/$/, '')) ? '../' : '';
  const ls = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
  };

  const GEAR = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z" stroke="currentColor" stroke-width="1.8"/><path d="M19.4 13.5a7.7 7.7 0 0 0 0-3l1.7-1.3-1.9-3.3-2 .8a7.7 7.7 0 0 0-2.6-1.5L14.3 3h-3.8l-.3 2.2a7.7 7.7 0 0 0-2.6 1.5l-2-.8L3.7 9.2l1.7 1.3a7.7 7.7 0 0 0 0 3L3.7 14.8l1.9 3.3 2-.8a7.7 7.7 0 0 0 2.6 1.5l.3 2.2h3.8l.3-2.2a7.7 7.7 0 0 0 2.6-1.5l2 .8 1.9-3.3-1.7-1.3z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  // Стили подключаем сами, чтобы страницу не нужно было менять
  if (![...document.styleSheets].some((s) => (s.href || '').includes('admin-tools.css'))) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = ROOT + 'admin-tools.css';
    document.head.append(link);
  }

  let key = ls.get('bc-admin-key') || '';
  let overlay = null;
  let cache = null;

  const btn = el('button', 'at-btn');
  btn.type = 'button';
  btn.title = 'Настройки преподавателя';
  btn.setAttribute('aria-label', 'Настройки преподавателя');
  btn.innerHTML = GEAR;
  btn.onclick = open;
  document.addEventListener('DOMContentLoaded', () => document.body.append(btn));
  if (document.readyState !== 'loading') document.body.append(btn);

  async function call(path, { method = 'GET', body } = {}) {
    const res = await fetch(API + path, {
      method,
      headers: { 'X-Admin-Key': key, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'Нет связи с сервером'), { status: res.status });
    return data;
  }

  function close() { overlay?.remove(); overlay = null; }

  async function open() {
    if (overlay) return close();
    overlay = el('div', 'at-overlay');
    overlay.onclick = (e) => { if (e.target === overlay) close(); };
    const panel = el('div', 'at-panel');
    overlay.append(panel);
    document.body.append(overlay);
    document.addEventListener('keydown', onEsc);
    render(panel, 'Загружаем состояние…');
    try {
      cache = await call('/api/admin/results');
      render(panel);
    } catch (e) {
      render(panel, e.status === 401 ? 'key' : e.message);
    }
  }

  const onEsc = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onEsc); } };

  function render(panel, state) {
    panel.replaceChildren();
    panel.append(el('h4', null, 'Настройки преподавателя'));

    if (state === 'key') return renderKeyForm(panel);
    if (state) { panel.append(el('div', 'at-note', state)); panel.append(closeBtn()); return; }

    const teams = cache?.teams || [];
    const submitted = teams.filter((t) => t.status !== 'not_submitted');
    const evaluated = teams.filter((t) => t.eval_status === 'done');
    const phase = { lobby: 'ждём команды', running: 'игра идёт', finished: 'игра завершена' }[cache?.phase] || 'игра не создана';

    // Состояние
    const st = el('div', 'at-state');
    const rows = [
      ['Состояние', phase],
      ['Команд', String(teams.length)],
      ['Работ сдано', `${submitted.length} из ${teams.length}`],
      ['Оценено', String(evaluated.length)],
      ['Итоги', cache?.published ? 'опубликованы' : 'скрыты от команд'],
    ];
    for (const [k, v] of rows) { st.append(el('span', null, k), el('b', null, v)); }
    panel.append(st);

    // Переходы между экранами
    const links = el('div', 'at-links');
    const here = location.pathname.replace(/index\.html$/, '');
    for (const [href, label] of [[ROOT + 'admin/', 'Панель'], [ROOT + 'board.html', 'Дашборд'], [ROOT + 'results.html', 'Итоги'], [ROOT + 'method/', 'Разбор клиенток']]) {
      const a = el('a', null, label);
      a.href = href;
      if (here.endsWith(href.replace(ROOT, '')) || (href.endsWith('admin/') && here.endsWith('/admin/'))) a.setAttribute('aria-current', 'page');
      links.append(a);
    }
    panel.append(el('div', 'at-note', 'Экраны'), links);

    const msg = el('div', 'at-msg');

    // Работы команд
    if (submitted.length) {
      panel.append(el('div', 'at-note', 'Работы команд'));
      for (const t of submitted) {
        const row = el('div', 'at-row');
        const name = el('div', null, `${t.team} · ${t.eval_status === 'done' ? t.score + '/100' : t.eval_status === 'error' ? 'ошибка' : 'считается'}`);
        name.style.cssText = 'flex:1;font-size:13px;font-weight:700;min-width:0';
        row.append(name);
        row.append(action('Оценка', () => call('/api/admin/jobs', { method: 'POST', body: { sessionId: 'team:' + t.id, kind: 'eval', force: true } }), msg, panel));
        row.append(action('Картинка', () => call('/api/admin/jobs', { method: 'POST', body: { sessionId: 'team:' + t.id, kind: 'image', force: true } }), msg, panel));
        row.append(action('Переделать', async () => {
          if (!confirm(`Разрешить команде «${t.team}» переделать работу? Текущая версия сохранится в архиве.`)) return null;
          return call('/api/admin/resubmit', { method: 'POST', body: { sessionId: 'team:' + t.id } });
        }, msg, panel));
        panel.append(row);
      }
    }

    // Технические данные
    if (cache?.tech?.calls) {
      const det = el('details');
      det.append(el('summary', 'at-note', 'Технические данные'));
      const t = cache.tech;
      const box = el('div', 'at-state');
      const techRows = [
        ['Вызовов моделей', String(t.calls)],
        ['По моделям', Object.entries(t.by_model).map(([m, n]) => `${m.replace('gpt-', '')} × ${n}`).join(', ') || '—'],
        ['Токены', `${t.prompt_tokens} вход / ${t.completion_tokens} выход`],
        ['Время запросов', `${Math.round(t.total_ms / 1000)} с`],
        ['Ошибки', t.errors.length ? t.errors.map((e) => `${e.team}: ${e.eval || e.image}`).join('; ') : 'нет'],
      ];
      for (const [k, v] of techRows) { box.append(el('span', null, k), el('b', null, v)); }
      det.append(box);
      panel.append(det);
    }

    // Опасные действия
    panel.append(el('div', 'at-note', 'Сброс'));
    const resetRow = el('div', 'at-row');
    resetRow.append(action('Сбросить прогресс', async () => {
      if (!confirm('Сбросить прогресс команд? Коды и названия останутся, диалоги начнутся заново.')) return null;
      return call('/api/admin/reset', { method: 'POST' });
    }, msg, panel));
    panel.append(resetRow);

    const danger = el('button', 'at-act danger', 'Обнулить состязание');
    danger.type = 'button';
    danger.onclick = () => confirmReset(panel, msg);
    panel.append(danger);
    panel.append(el('div', 'at-note', 'Полное обнуление: все сессии команд завершаются, коды, прогресс, работы и оценки удаляются, игра возвращается к самому началу. Логи диалогов сохраняются на сервере.'));

    panel.append(msg);

    // Ключ и палитра
    const bottom = el('div', 'at-row');
    const forget = el('button', 'at-act', 'Забыть ключ');
    forget.type = 'button';
    forget.onclick = () => { ls.set('bc-admin-key', null); key = ''; render(panel, 'key'); };
    const palette = el('button', 'at-act', ls.get('bc-palette') === 'green' ? 'Оранжевая тема' : 'Зелёная тема');
    palette.type = 'button';
    palette.onclick = () => {
      const next = ls.get('bc-palette') === 'green' ? '' : 'green';
      ls.set('bc-palette', next);
      document.documentElement.dataset.palette = next;
      location.reload();
    };
    bottom.append(palette, forget);
    panel.append(bottom);
    panel.append(closeBtn());
  }

  function closeBtn() {
    const b = el('button', 'at-act', 'Закрыть');
    b.type = 'button';
    b.onclick = close;
    return b;
  }

  function action(label, fn, msg, panel) {
    const b = el('button', 'at-act', label);
    b.type = 'button';
    b.onclick = async () => {
      b.disabled = true;
      msg.className = 'at-msg';
      msg.textContent = 'Выполняем…';
      try {
        const out = await fn();
        if (out === null) { msg.textContent = ''; return; }
        msg.className = 'at-msg ok';
        msg.textContent = 'Готово';
        cache = await call('/api/admin/results');
        render(panel);
      } catch (e) {
        msg.className = 'at-msg err';
        msg.textContent = e.message;
      } finally { b.disabled = false; }
    };
    return b;
  }

  function confirmReset(panel, msg) {
    const box = el('div', 'at-confirm');
    box.append(el('p', null, 'Обнулить состязание полностью? Команды выйдут из игры, коды перестанут работать, работы и оценки будут удалены.'));
    const row = el('div', 'at-row');
    const yes = el('button', 'at-act danger', 'Да, обнулить');
    yes.type = 'button';
    yes.onclick = async () => {
      yes.disabled = true;
      btn.classList.add('busy');
      try {
        await call('/api/admin/end', { method: 'POST' });
        location.href = ROOT + 'admin/';
      } catch (e) {
        msg.className = 'at-msg err';
        msg.textContent = e.message;
        yes.disabled = false;
        btn.classList.remove('busy');
      }
    };
    const no = el('button', 'at-act', 'Отмена');
    no.type = 'button';
    no.onclick = () => box.remove();
    row.append(yes, no);
    box.append(row);
    panel.append(box);
  }

  function renderKeyForm(panel) {
    panel.append(el('div', 'at-note', 'Введите ключ преподавателя, чтобы управлять игрой.'));
    const input = document.createElement('input');
    input.type = 'password';
    input.placeholder = 'Ключ преподавателя';
    input.style.cssText = 'padding:12px 14px;border-radius:14px;border:1px solid var(--stroke);background:var(--chip);color:var(--ink);font:inherit';
    const save = el('button', 'at-act', 'Сохранить');
    save.type = 'button';
    save.onclick = async () => {
      key = input.value.trim();
      ls.set('bc-admin-key', key);
      try { cache = await call('/api/admin/results'); render(panel); }
      catch (e) { render(panel, e.status === 401 ? 'key' : e.message); }
    };
    input.onkeydown = (e) => { if (e.key === 'Enter') save.click(); };
    panel.append(input, save, closeBtn());
  }
})();
