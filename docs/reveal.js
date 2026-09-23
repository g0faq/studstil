/**
 * Преображение «До / После».
 * BeautyReveal.mount(el, { before, after, autoplay }) → { play(), destroy() }
 * Сначала кадр «до», по кнопке (или автоматически) по нему проходит луч света,
 * открывая новый образ, летят искры, затем появляется ручка сравнения.
 */
window.BeautyReveal = (() => {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function mount(el, { before, after, autoplay = false, caption = 'Визуализация решения команды' } = {}) {
    el.classList.add('reveal');
    el.innerHTML = '';

    const beforeImg = new Image();
    beforeImg.src = before;
    beforeImg.alt = 'Клиентка до консультации';
    beforeImg.draggable = false;

    const afterWrap = document.createElement('div');
    afterWrap.className = 'after-wrap';
    const afterImg = new Image();
    afterImg.src = after;
    afterImg.alt = caption;
    afterImg.draggable = false;
    afterWrap.append(afterImg);

    const sweep = document.createElement('div');
    sweep.className = 'sweep';
    const flash = document.createElement('div');
    flash.className = 'flash';
    const handle = document.createElement('div');
    handle.className = 'handle';
    const tagB = document.createElement('div');
    tagB.className = 'tag before';
    tagB.textContent = 'До';
    const tagA = document.createElement('div');
    tagA.className = 'tag after';
    tagA.textContent = 'После';

    const play = document.createElement('button');
    play.type = 'button';
    play.className = 'play';
    play.innerHTML = '<span>Показать преображение</span>';

    el.append(beforeImg, afterWrap, sweep, flash, handle, tagB, tagA, play);
    el.style.setProperty('--pos', '100%');

    let state = 'idle';

    const setPos = (pct) => el.style.setProperty('--pos', Math.max(0, Math.min(100, pct)) + '%');

    function sparks() {
      if (reduced) return;
      const rect = el.getBoundingClientRect();
      const colors = ['--accent', '--g1', '--g2', '--g3'].map((v) => getComputedStyle(el).getPropertyValue(v).trim() || '#FF7A1A');
      for (let i = 0; i < 26; i++) {
        const s = document.createElement('i');
        s.className = 'spark';
        const size = 4 + Math.random() * 9;
        const y = Math.random() * rect.height;
        Object.assign(s.style, {
          width: size + 'px', height: size + 'px',
          left: '50%', top: y + 'px',
          background: colors[i % colors.length],
          boxShadow: `0 0 ${size * 2}px ${colors[i % colors.length]}`,
        });
        el.append(s);
        const dx = (Math.random() - 0.35) * rect.width * 0.5;
        const dy = (Math.random() - 0.5) * 90;
        s.animate([
          { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
          { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.2)`, opacity: 0 },
        ], { duration: 900 + Math.random() * 700, delay: Math.random() * 500, easing: 'cubic-bezier(.22,1,.36,1)' })
          .onfinish = () => s.remove();
      }
    }

    function start() {
      if (state !== 'idle') return;
      state = 'playing';
      el.classList.add('playing');

      if (reduced) { finish(); return; }

      // Луч идёт справа налево и открывает новый образ
      requestAnimationFrame(() => setPos(0));
      setTimeout(sparks, 420);
      flash.animate(
        [{ opacity: 0 }, { opacity: .55, offset: .35 }, { opacity: 0 }],
        { duration: 1500, easing: 'ease-out' },
      );
      afterWrap.animate(
        [{ filter: 'saturate(1.35) brightness(1.12)' }, { filter: 'none' }],
        { duration: 1800, easing: 'ease-out' },
      );
      el.animate(
        [{ transform: 'scale(1)' }, { transform: 'scale(1.015)', offset: .5 }, { transform: 'scale(1)' }],
        { duration: 1700, easing: 'cubic-bezier(.22,1,.36,1)' },
      );
      setTimeout(finish, 1700);
    }

    function finish() {
      state = 'ready';
      el.classList.remove('playing');
      el.classList.add('ready');
      setPos(reduced ? 0 : 42); // ставим ручку так, чтобы было видно оба кадра
    }

    // Перетаскивание ручки сравнения
    const drag = (e) => {
      if (state !== 'ready') return;
      const rect = el.getBoundingClientRect();
      const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
      setPos((x / rect.width) * 100);
    };
    const onDown = (e) => {
      e.preventDefault(); // без этого браузер начинает выделять картинку и подсвечивает её синим
      if (state === 'idle') { start(); return; }
      drag(e);
      window.addEventListener('pointermove', drag);
      window.addEventListener('pointerup', onUp, { once: true });
    };
    const onUp = () => window.removeEventListener('pointermove', drag);

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('dragstart', (e) => e.preventDefault());
    el.addEventListener('selectstart', (e) => e.preventDefault());
    play.addEventListener('click', start);

    if (autoplay) {
      const io = new IntersectionObserver((entries) => {
        if (entries.some((x) => x.isIntersecting)) { setTimeout(start, 350); io.disconnect(); }
      }, { threshold: 0.4 });
      io.observe(el);
    }

    return {
      play: start,
      destroy: () => { el.removeEventListener('pointerdown', onDown); onUp(); el.innerHTML = ''; },
    };
  }

  return { mount };
})();
