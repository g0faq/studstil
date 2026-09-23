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

  // ===== Правила игры: показ по экранам приложения, «запись» внутри телефона =====
  const demo = (() => {
    const wrap = $('#dm-wrap');
    if (!wrap) return { start() {}, stop() {} };
    const stage = $('#dm-stage'), dotsBox = $('#dm-dots'), kicker = $('#dm-kicker'), title = $('#dm-title'),
      text = $('#dm-text'), toggle = $('#dm-toggle'), restart = $('#dm-restart'), skip = $('#dm-skip'),
      listBox = $('#dm-still'), note = $('#dm-note');
    const FACE = '../img/olga-face.jpg';
    const motionMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
    let reduce = motionMQ.matches;
    // слова реплики поднимаются по очереди
    const words = (s, q) => s.split(' ').map((w, i) => `<span class="dm-w" style="--q:${q};--i:${i}">${w}</span>`).join(' ');
    const SOLUTION = 'Одежда: тёмно-синий костюм и трикотаж, который переживёт метро и детей. Волосы: каре до плеч, укладка за десять минут. Макияж: гипоаллергенный тон, тёплый нюд.';

    const SCENES = [
      {
        title: 'Вход по коду', dur: 4600,
        text: 'Команда открывает studstil.ru и вводит код, который вы выдали. У каждой команды своя клиентка.',
        html: () => `
          <div class="dm-scene">
            <svg class="dm-sw" viewBox="0 0 320 132" aria-hidden="true">
              <path class="sw sw1" pathLength="1" d="M18 40 C 70 22, 130 30, 176 26 S 262 18, 300 30"/>
              <path class="sw sw2" pathLength="1" d="M30 78 C 90 64, 150 84, 206 70 S 270 62, 292 74"/>
              <path class="sw sw3" pathLength="1" d="M22 112 C 64 104, 104 116, 150 106"/>
            </svg>
            <div class="dm-brand dm-in" style="--d:.35s">Beauty<br>Case</div>
            <p class="dm-lead dm-in" style="--d:.5s">Разгадай клиента. Задавай вопросы, собирай факты, найди настоящий запрос.</p>
            <div class="dm-spacer"></div>
            <div class="dm-cap dm-in" style="--d:.66s">Код команды</div>
            <div class="dm-field dm-in" style="--d:.74s;--p:1.9s"><span data-type="900:230:1234"></span><i class="dm-caret"></i></div>
            <button class="dm-btn dm-grad dm-tap" style="--d:.86s;--p:2.5s" type="button" tabindex="-1">Войти</button>
          </div>`,
      },
      {
        title: 'Карточка клиентки', dur: 5000,
        text: 'Видно только имя, возраст и одну фразу. Главного клиентка сама не скажет.',
        html: () => `
          <div class="dm-scene center">
            <div class="dm-top" style="width:100%"><span class="dm-back">←</span><span class="dm-cap">Карточка клиента</span><span style="width:1.7em"></span></div>
            <div class="dm-portrait dm-pop" style="--d:.1s">
              <svg class="dm-orbit" viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="57"/><circle class="dm-spark" cx="60" cy="3" r="3.2"/></svg>
              <img src="${FACE}" alt="">
            </div>
            <div class="dm-name dm-in" style="--d:.55s">Ольга, 38</div>
            <div class="dm-sub dm-in" style="--d:.66s">Салон красоты · возвращается из декрета</div>
            <div class="dm-quote glass dm-in" style="--d:.8s">
              <div class="dm-cap accent">Она сказала только это</div>
              <p>${words('Последнее время совсем перестала заниматься собой. Хочу выглядеть более собранно.', '1s')}</p>
            </div>
            <div class="dm-spacer"></div>
            <button class="dm-btn dm-accent dm-tap" style="--d:1s;--p:3.4s" type="button" tabindex="-1">Начать консультацию</button>
          </div>`,
      },
      {
        title: 'Вопросы и факты', dur: 6000,
        text: 'Клиентка отвечает только на точные вопросы. Каждый раскрытый факт падает в досье и двигает шкалу — всего их четыре.',
        html: () => `
          <div class="dm-scene">
            <div class="dm-chat-head dm-in">
              <img src="${FACE}" alt="">
              <div style="flex:1;min-width:0"><b>Ольга</b><span>в сети</span></div>
              <span class="dm-hint">Подсказка</span>
            </div>
            <div class="dm-prog dm-in" style="--d:.1s">
              <div>Раскрыто <b data-from="0" data-set="3080:1,5320:2">2</b> из 4 фактов</div>
              <div class="dm-track"><i class="dm-fill" style="--to:50%" data-seq="0:0%,3080:25%,5320:50%"></i></div>
            </div>
            <div class="dm-msgs">
              <div class="dm-msg me dm-in" style="--d:1.78s">Почему решили обновить образ сейчас?</div>
              <div class="dm-dots3" style="--d:1.98s"><i></i><i></i><i></i></div>
              <div class="dm-msg them hit dm-in" style="--d:2.78s">Через три недели выхожу управляющей в салон, где меня помнят администратором.</div>
              <div class="dm-stamp dm-pop" style="--d:3.08s">Факт раскрыт · Контекст</div>
              <div class="dm-msg me dm-in" style="--d:4.08s">А чего вы боитесь?</div>
              <div class="dm-dots3" style="--d:4.28s"><i></i><i></i><i></i></div>
              <div class="dm-msg them hit dm-in" style="--d:5.02s">Что во мне увидят прежнюю девочку-администратора после декрета.</div>
              <div class="dm-stamp dm-pop" style="--d:5.32s">Факт раскрыт · Эмоция</div>
            </div>
            <div class="dm-composer dm-in" style="--d:.2s">
              <div class="dm-input"><span data-type="520:32:Почему решили обновить образ сейчас?|1760:0:|3420:32:А чего вы боитесь?|4060:0:"></span><i class="dm-caret"></i></div>
              <span class="dm-send">↑</span>
            </div>
          </div>`,
      },
      {
        title: 'Разбор и сдача', dur: 5600,
        text: 'Когда факты собраны, команда описывает полный образ: одежда, волосы, макияж — и сдаёт работу.',
        html: () => `
          <div class="dm-scene">
            <div class="dm-top"><span class="dm-back">←</span><span class="dm-cap">Разбор клиента</span><span class="dm-clock">04:12</span></div>
            <div class="dm-client dm-in" style="--d:.1s">
              <img src="${FACE}" alt="">
              <div><b>Ольга, 38</b><span>Через три недели — новая должность</span></div>
            </div>
            <div class="dm-area dm-in hot" style="--d:.2s"><span data-type="600:20:${SOLUTION}"></span><i class="dm-caret"></i></div>
            <div class="dm-small dm-in" style="--d:.3s">Одежда, волосы и макияж — одним сообщением</div>
            <button class="dm-btn dm-grad dm-tap" style="--d:.4s;--p:4.4s" type="button" tabindex="-1">Сдать решение</button>
          </div>`,
      },
      {
        title: 'Результат', dur: 6000,
        text: 'ИИ ставит баллы по семи критериям и рисует клиентку после преображения. До и после — рядом, на одном экране.',
        html: () => `
          <div class="dm-scene center">
            <div class="dm-top" style="width:100%"><span class="dm-cap">Итог команды</span><span class="dm-clock">готово</span></div>
            <div class="dm-ring">
              <svg viewBox="0 0 120 120" aria-hidden="true">
                <circle class="bg" cx="60" cy="60" r="52" pathLength="1"/>
                <circle class="val" cx="60" cy="60" r="52" pathLength="1" style="--to:.14" data-seq="0:1,420:.14"/>
              </svg>
              <div class="dm-ring-n"><b data-count="0" data-at="420" data-dur="1150">86</b><span>из 100</span></div>
            </div>
            <div class="dm-verdict dm-in" style="--d:1.5s">Клиентку услышали: образ собран под новую роль и её три недели.</div>
            <div class="dm-ba">
              <figure class="dm-shot before dm-pop" style="--d:2s"><img src="${FACE}" alt=""><figcaption>До</figcaption></figure>
              <figure class="dm-shot after dm-pop" style="--d:2.2s;--h:3.05s">
                <img class="dm-tint" style="--d:2.55s" src="${FACE}" alt="">
                <i class="dm-beam" style="--d:2.6s"></i>
                <figcaption>После</figcaption>
              </figure>
              <div class="dm-sparks">
                <i style="--sd:2.78s;--dx:-2.4em;--dy:-2.9em"></i><i style="--sd:2.86s;--dx:2.1em;--dy:-2.2em"></i>
                <i style="--sd:2.94s;--dx:-2.9em;--dy:1.8em"></i><i style="--sd:3.02s;--dx:2.6em;--dy:2.4em"></i>
                <i style="--sd:3.1s;--dx:.3em;--dy:-3.2em"></i><i style="--sd:3.18s;--dx:-.6em;--dy:3.1em"></i>
              </div>
            </div>
            <div class="dm-badge dm-pop" style="--d:3.4s">Преображение</div>
          </div>`,
      },
    ];

    // Инструкцию смотрят с проектора всем классом: показ идёт медленнее обычного интерфейса
    const SLOW = 1.85;
    const slowHtml = (html) => html
      .replace(/--d:\s*([\d.]+)s/g, (_, v) => `--d:${(+v * SLOW).toFixed(2)}s`)
      .replace(/--p:\s*([\d.]+)s/g, (_, v) => `--p:${(+v * SLOW).toFixed(2)}s`);

    const N = SCENES.length;
    let idx = 0, playing = false, flat = true, listed = false;
    let jobs = [], ids = [], t0 = 0, elapsed = 0, dur = 0;

    // Разбираем разметку сцены: печать текста, шаги шкалы, счётчики
    function collect(root, isFlat) {
      const out = [];
      root.querySelectorAll('[data-type]').forEach((el) => {
        const parts = el.dataset.type.split('|').map((p) => {
          const a = p.indexOf(':'), b = p.indexOf(':', a + 1);
          return { at: +p.slice(0, a) * SLOW, step: +p.slice(a + 1, b) * SLOW, t: p.slice(b + 1) };
        });
        if (isFlat) { el.textContent = parts[parts.length - 1].t; return; }
        el.textContent = '';
        for (const p of parts) {
          out.push({ at: p.at, fn: () => { el.textContent = ''; } });
          for (let i = 1; i <= p.t.length; i++) {
            const slice = p.t.slice(0, i);
            out.push({ at: p.at + i * p.step, fn: () => { el.textContent = slice; } });
          }
        }
      });
      root.querySelectorAll('[data-seq]').forEach((el) => {
        if (isFlat) return; // статичный кадр: остаётся конечное значение из --to
        const steps = el.dataset.seq.split(',').map((s) => { const i = s.indexOf(':'); return { at: +s.slice(0, i) * SLOW, v: s.slice(i + 1) }; });
        el.style.setProperty('--to', steps[0].v);
        let prev = steps[0].v;
        for (const s of steps.slice(1)) {
          const from = prev, to = s.v; prev = s.v;
          out.push({ at: s.at, fn: () => {
            el.classList.remove('go'); el.getBoundingClientRect();
            el.style.setProperty('--from', from); el.style.setProperty('--to', to); el.classList.add('go');
          } });
        }
      });
      root.querySelectorAll('[data-set]').forEach((el) => {
        if (isFlat) return;
        el.textContent = el.dataset.from || '';
        for (const s of el.dataset.set.split(',')) {
          const i = s.indexOf(':'), at = +s.slice(0, i) * SLOW, v = s.slice(i + 1);
          out.push({ at, fn: () => { el.textContent = v; el.classList.remove('bump'); el.getBoundingClientRect(); el.classList.add('bump'); } });
        }
      });
      root.querySelectorAll('[data-count]').forEach((el) => {
        const to = parseInt(el.textContent, 10) || 0;
        if (isFlat) return;
        const from = +el.dataset.count || 0, at = (+el.dataset.at || 0) * SLOW, d = (+el.dataset.dur || 1000) * SLOW, n = 26;
        el.textContent = String(from);
        for (let i = 1; i <= n; i++) {
          const p = i / n, v = String(Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3))));
          out.push({ at: at + Math.round(d * p), fn: () => { el.textContent = v; } });
        }
      });
      return out.sort((a, b) => a.at - b.at);
    }

    function halt() { for (const id of ids) clearTimeout(id); ids = []; }

    function schedule() {
      t0 = performance.now() - elapsed;
      for (const j of jobs) if (j.at >= elapsed) ids.push(setTimeout(j.fn, j.at - elapsed));
      ids.push(setTimeout(() => build((idx + 1) % N, true), Math.max(0, dur - elapsed)));
    }

    function build(i, play) {
      halt();
      idx = ((i % N) + N) % N; elapsed = 0;
      const sc = SCENES[idx];
      dur = Math.round(sc.dur * SLOW);
      flat = reduce || !play;
      wrap.classList.toggle('flat', flat);
      wrap.classList.remove('paused');
      stage.innerHTML = flat ? sc.html() : slowHtml(sc.html());
      jobs = collect(stage, flat);
      kicker.textContent = `Сцена ${idx + 1} из ${N}`;
      title.textContent = sc.title;
      text.textContent = sc.text;
      if (!reduce) for (const el of [kicker, title, text]) { el.classList.remove('dm-swap'); el.getBoundingClientRect(); el.classList.add('dm-swap'); }
      for (const d of dotsBox.children) d.classList.remove('on', 'done');
      dotsBox.getBoundingClientRect();
      [...dotsBox.children].forEach((d, k) => {
        if (k < idx) d.classList.add('done');
        if (k === idx) { d.style.setProperty('--dur', dur + 'ms'); d.classList.add('on'); }
      });
      playing = !flat;
      toggle.textContent = playing ? 'Пауза' : 'Продолжить';
      if (playing) schedule();
    }

    function pause() {
      if (!playing) return;
      elapsed = performance.now() - t0; halt();
      playing = false; wrap.classList.add('paused'); toggle.textContent = 'Продолжить';
    }

    function resume() {
      if (playing || reduce) return;
      if (flat) return build(idx, true);
      playing = true; wrap.classList.remove('paused'); toggle.textContent = 'Пауза'; schedule();
    }

    // Точки-индикаторы и текстовый вариант правил
    SCENES.forEach((s, i) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'dm-dot'; b.innerHTML = '<i></i>';
      b.setAttribute('aria-label', `Сцена ${i + 1}: ${s.title}`);
      b.onclick = () => build(i, playing);
      dotsBox.append(b);
    });
    listBox.innerHTML = SCENES.map((s, i) => `<div class="rule glass"><b>${i + 1}</b><span>${s.title}. ${s.text}</span></div>`).join('');
    note.hidden = !reduce;
    toggle.hidden = reduce;

    toggle.onclick = () => (playing ? pause() : resume());
    restart.onclick = () => build(0, !reduce);
    skip.onclick = () => {
      listed = !listed;
      wrap.hidden = listed; listBox.hidden = !listed;
      skip.textContent = listed ? 'Показать снова' : 'Пропустить показ';
      if (listed) { halt(); playing = false; } else build(idx, !reduce);
    };

    // Настройку «меньше движения» могли включить уже при открытой панели:
    // тогда CSS обрубит анимации на полукадре, поэтому пересобираем сцену статичной.
    motionMQ.addEventListener('change', () => {
      reduce = motionMQ.matches;
      note.hidden = !reduce;
      toggle.hidden = reduce;
      if (listed) return;
      if (!wrap.closest('.step').classList.contains('on')) { halt(); playing = false; return; }
      build(idx, !reduce);
    });

    return {
      start() { if (!listed) build(idx, !reduce); },
      stop() { halt(); playing = false; },
    };
  })();

  const show = (id) => {
    for (const s of document.querySelectorAll('.step')) s.classList.toggle('on', s.id === id);
    if (id === 's-splash') setTimeout(() => { if ($('#s-splash').classList.contains('on')) show('s-rules'); }, 3800);
    id === 's-rules' ? demo.start() : demo.stop();
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
    // Экран показываем сразу, не дожидаясь сервера: иначе на медленной связи панель
    // висит пустой чёрной страницей, и непонятно, работает она вообще или нет.
    if (location.hash === '#rules') { history.replaceState(null, '', location.pathname); show('s-rules'); }
    else show('s-splash');
    try {
      const r = await api('/api/admin/game');
      game = r.game;
      if (game?.phase === 'running') return location.replace('../board.html'); // игра уже идёт → дашборд
      if (game?.phase === 'lobby') { renderCodes(); show('s-codes'); startPoll(); }
    } catch {}
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
      input.autocomplete = 'off'; input.value = '';
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
      fetch('../img/qr.svg').then((r) => r.text()).then((svg) => { $('#qr').innerHTML = svg; }).catch(() => {
        $('#qr').textContent = 'studstil.ru';
      });
    }
  }

  // Кто уже в комнате ожидания. Начинать можно в любой момент — даже если зашли не все команды
  function startPoll() {
    clearTimeout(poll); clearInterval(poll);
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
        btn.disabled = false;
        btn.textContent = 'Начать игру';
        // Команд столько, сколько сценариев на сервере, — число не зашиваем
        $('#waiting').textContent = all
          ? 'Все команды на месте — можно начинать'
          : `Подключились ${ready} из ${teams.length} — начать можно и сейчас, остальные войдут по коду позже`;
      } catch {}
    };
    // Следующий опрос запускаем только после ответа: иначе на медленной сети запросы
    // копятся в очереди браузера и блокируют нажатия кнопок.
    const loop = async () => { await tick(); poll = setTimeout(loop, 2500); };
    loop();
  }

  // Бесплатный Vercel усыпляет функцию, и первое действие после паузы ждёт около секунды.
  // Пока панель открыта, раз в 45 секунд дёргаем сервер — к нажатию он уже не спит.
  setInterval(() => { if (!document.hidden) fetch(API + '/api/health').catch(() => {}); }, 45000);

  // Кнопка «Сброс»: все игры заканчиваются, команды возвращаются на стартовый экран,
  // преподаватель — на правила. Первое нажатие только предупреждает, второе выполняет.
  const resetBtn = $('#reset-all');
  let armed = null;
  resetBtn.onclick = async () => {
    if (!armed) {
      resetBtn.classList.add('armed');
      resetBtn.textContent = 'Точно сбросить?';
      armed = setTimeout(() => { armed = null; resetBtn.classList.remove('armed'); resetBtn.textContent = 'Сброс'; }, 4000);
      return;
    }
    clearTimeout(armed); armed = null;
    resetBtn.disabled = true;
    resetBtn.textContent = 'Сбрасываем…';
    try {
      await api('/api/admin/end', 'POST');
      clearTimeout(poll); clearInterval(poll);
      game = null;
      show('s-rules');
    } catch (e) { alert(e.message); }
    finally { resetBtn.disabled = false; resetBtn.classList.remove('armed'); resetBtn.textContent = 'Сброс'; }
  };

  $('#start-btn').onclick = async () => {
    if ($('#start-btn').disabled) return;
    $('#start-btn').disabled = true;
    try { await api('/api/admin/start', 'POST'); clearInterval(poll); location.href = '../board.html'; }
    catch (e) { $('#start-btn').disabled = false; alert(e.message); }
  };

  key ? enter() : show('s-key');
})();
