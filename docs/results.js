(() => {
  const API = window.API_URL || '';
  const $ = (s) => document.querySelector(s);
  const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } } };
  const key = new URLSearchParams(location.search).get('key') || ls.get('bc-admin-key') || '';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const green = document.documentElement.dataset.palette === 'green';

  const MEDAL = ['<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="14" r="7" fill="currentColor"/><path d="M8 2h8l-2.5 5h-3z" fill="currentColor" opacity=".7"/><path d="M9.6 14.2l1.7 1.7 3.3-3.6" fill="none" stroke="var(--bg2)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="14" r="7" fill="currentColor" opacity=".75"/><path d="M8 2h8l-2.5 5h-3z" fill="currentColor" opacity=".5"/></svg>',
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="14" r="7" fill="currentColor" opacity=".55"/><path d="M8 2h8l-2.5 5h-3z" fill="currentColor" opacity=".35"/></svg>'];
  const PLACE = ['1 место', '2 место', '3 место'];

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  async function load() {
    try {
      const res = await fetch(API + '/api/admin/results', { headers: { 'X-Admin-Key': key } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Нет связи с сервером');
      render(data);
    } catch (e) {
      $('#podium').innerHTML = '';
      $('#podium').append(el('div', 'empty', e.message + '. Откройте табло и нажмите «Завершить игру» заново.'));
    }
  }

  function render(data) {
    const teams = data.teams || [];
    const podium = $('#podium'); podium.replaceChildren();
    const played = teams.filter((t) => t.questions > 0 || t.solution);
    $('#subline').textContent = played.length
      ? `Команд: ${teams.length} · вопросов задано: ${teams.reduce((n, t) => n + t.questions, 0)} · подсказок: ${teams.reduce((n, t) => n + (t.hints || 0), 0)}`
      : 'Команды не успели сыграть';
    const best = teams[0];
    $('#winner').textContent = best && (best.solution || best.done) ? `Лучший результат: ${best.team}` : '';

    teams.forEach((t, i) => {
      const card = el('div', 'p-card' + (i === 0 ? ' first' : ''));
      card.style.setProperty('--accent', (green && t.accent_green) || t.accent);
      card.style.setProperty('--i', i);

      const rank = el('div', 'rank');
      rank.innerHTML = MEDAL[Math.min(i, 2)];
      rank.append(el('span', null, PLACE[Math.min(i, 2)]));

      const top = el('div', 'p-top');
      const av = el('div', 'avatar');
      av.style.cssText = 'width:clamp(44px,3.6vw,72px);height:clamp(44px,3.6vw,72px);font-size:clamp(17px,1.5vw,28px)';
      av.textContent = t.letter;
      const photo = (green && t.photo_green) || t.photo;
      if (photo) { const img = new Image(); img.alt = ''; img.onerror = () => img.remove(); img.src = photo; av.append(img); }
      const who = el('div');
      who.append(el('div', 'p-name', t.team), el('div', 'dim', t.client));
      top.append(av, who);

      // Оценка решения — главный показатель
      const body = el('div', 'p-body');
      const ring = el('div', 'vessel');
      ring.innerHTML = scoreRing(t);
      const right = el('div');
      const score = el('div', 'score');
      score.append(el('span', 'big', t.solution ? t.solution.score : '—'), el('span', 'score-note', t.solution ? '/10' : ''));
      right.append(score, el('div', 'caps2', t.solution ? 'балл за решение' : 'решение не прислано'));
      const stats = el('div', 'stats');
      for (const [v, k] of [[`${t.done}/${t.total}`, 'факта'], [t.questions, 'вопросов'], [t.hints || 0, 'подсказок'], [t.minutes != null ? t.minutes + ' мин' : '—', 'время']]) {
        const s = el('div', 'stat'); s.append(el('b', null, String(v)), el('span', null, k)); stats.append(s);
      }
      right.append(stats);
      body.append(ring, right);

      // Как раскрывались факты
      const tl = el('div', 'timeline');
      for (const f of t.facts) {
        const row = el('div', 'tl ' + (f.on ? 'on' : 'off') + (f.bonus ? ' bonus' : ''));
        const dot = el('div', 'dot', f.bonus ? '+' : String(f.order || ''));
        row.append(dot, el('div', 'lbl', f.label), el('div', 'at', f.on ? (f.at != null ? f.at + ' мин' : 'есть') : '—'));
        tl.append(row);
      }

      card.append(rank, top, body, tl);
      if (t.solution?.verdict) card.append(el('div', 'problem', t.solution.verdict));
      podium.append(card);
    });

    if (!reduced && teams[0]?.solution) confetti();
  }

  function scoreRing(t) {
    const v = t.solution ? t.solution.score / 10 : 0;
    return `<svg viewBox="0 0 120 120" style="width:100%;max-width:190px;transform:rotate(-90deg)" aria-hidden="true">
      <circle cx="60" cy="60" r="50" fill="none" stroke="var(--chip)" stroke-width="12"/>
      <circle cx="60" cy="60" r="50" fill="none" stroke="currentColor" stroke-width="12" stroke-linecap="round"
        pathLength="1" stroke-dasharray="1" stroke-dashoffset="${1 - v}" style="transition:stroke-dashoffset 1.2s var(--ease-out)"/>
    </svg>`;
  }

  function confetti() {
    const cv = $('#confetti');
    const ctx = cv.getContext('2d'), dpr = devicePixelRatio || 1;
    const W = cv.width = innerWidth * dpr, H = cv.height = innerHeight * dpr;
    const css = getComputedStyle(document.body);
    const cols = ['--g1', '--g2', '--g3'].map((v) => css.getPropertyValue(v).trim() || '#FF7A1A');
    const parts = Array.from({ length: 120 }, () => ({
      x: Math.random() * W, y: -Math.random() * H * .4,
      vx: (Math.random() - .5) * 3 * dpr, vy: (2 + Math.random() * 4) * dpr,
      w: (6 + Math.random() * 14) * dpr, h: (3 + Math.random() * 5) * dpr,
      r: Math.random() * 6, vr: (Math.random() - .5) * .2, c: cols[(Math.random() * cols.length) | 0],
    }));
    const t0 = performance.now();
    (function frame(t) {
      const life = (t - t0) / 4200;
      ctx.clearRect(0, 0, W, H);
      for (const p of parts) {
        p.x += p.vx; p.y += p.vy; p.r += p.vr;
        ctx.save(); ctx.globalAlpha = Math.max(0, 1 - life); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c;
        ctx.beginPath(); ctx.roundRect(-p.w / 2, -p.h / 2, p.w, p.h, p.h / 2); ctx.fill(); ctx.restore();
      }
      if (life < 1) requestAnimationFrame(frame); else ctx.clearRect(0, 0, W, H);
    })(t0);
  }

  $('#restart').onclick = async () => {
    if (!confirm('Начать заново? Игра, коды и прогресс будут сброшены. Логи диалогов сохранятся.')) return;
    try {
      await fetch(API + '/api/admin/end', { method: 'POST', headers: { 'X-Admin-Key': key } });
      location.href = 'admin/';
    } catch { location.href = 'admin/'; }
  };

  load();
})();
