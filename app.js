/*
 * app.js — логика обучающего приложения ПВЗ.
 * Vanilla JS, без сборки и внешних библиотек. Хранение — localStorage.
 */
(function () {
  'use strict';

  /* ===================== ХРАНИЛИЩЕ ===================== */

  const STORAGE_KEY = 'pvzAcademyState.v2';
  const LEGACY_STORAGE_KEY = 'pvzAcademyState.v1';
  const QUICK_CHECK_SESSION_KEY = 'pvzAcademyQuickChecks.v2';
  const PROGRESS = Object.freeze({
    NOT_STARTED: 'NOT_STARTED',
    IN_PROGRESS: 'IN_PROGRESS',
    CONTENT_COMPLETED: 'CONTENT_COMPLETED',
  });

  function defaultState() {
    return {
      version: 2,
      moduleProgress: {},        // { moduleId: {status, completedAt?} }
      viewedModules: {},         // { moduleId: true }  — модуль открывали
      testResults: {},           // { moduleId: [ {date, correct, total, percent} ] }
      mistakes: {},              // { questionId: { moduleId, blockId, wrongCount, lastWrongAt } }
      examAttempts: [],          // [ {date, correct, total, percent, byModule:{id:{correct,total}}, wrongIds:[]} ]
      bookmarks: {},             // { blockId: true }
      lastScreen: null,          // '#/dashboard'
      lastModuleId: null,
    };
  }

  let STATE = loadState();
  let saveTimer = null;

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return Object.assign(defaultState(), JSON.parse(raw), { version: 2 });
      const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (!legacyRaw) return defaultState();
      const legacy = JSON.parse(legacyRaw);
      const migrated = defaultState();
      ['viewedModules', 'testResults', 'mistakes', 'examAttempts', 'bookmarks', 'lastScreen', 'lastModuleId', 'settings'].forEach(key => {
        if (legacy[key] != null) migrated[key] = legacy[key];
      });
      // viewedBlocks v1 заполнялся IntersectionObserver и не доказывает изучение.
      Object.keys(migrated.viewedModules || {}).forEach(id => {
        if (migrated.viewedModules[id]) migrated.moduleProgress[id] = { status: PROGRESS.IN_PROGRESS };
      });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      return migrated;
    } catch (e) {
      console.error('Не удалось прочитать сохранённый прогресс, используется пустой прогресс.', e);
      return defaultState();
    }
  }

  function saveState() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(STATE)); }
      catch (e) { console.error('Не удалось сохранить прогресс', e); }
    }, 120);
  }

  function resetProgress() {
    STATE = defaultState();
    examSession = null;
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      sessionStorage.removeItem(QUICK_CHECK_SESSION_KEY);
      sessionStorage.removeItem('pvzAcademyExamSession.v3');
      sessionStorage.removeItem('pvzAcademyExamSession.v2');
      sessionStorage.removeItem('pvzAcademyExamSession.v1');
    } catch (e) { /* noop */ }
    saveState();
  }

  /* ===================== УТИЛИТЫ ===================== */

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  function shuffled(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function sample(arr, n) { return shuffled(arr).slice(0, Math.min(n, arr.length)); }

  function formatDate(iso) {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' +
        d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    } catch (e) { return iso; }
  }

  function pct(correct, total) { return total > 0 ? Math.round((correct / total) * 100) : 0; }

  function debounce(fn, ms) {
    let t; return function (...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), ms); };
  }

  const ICONS = {
    home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9"/>',
    book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5"/><path d="M4 5.5v15A2.5 2.5 0 0 0 6.5 23H20"/>',
    hash: '<path d="M9 3 7 21"/><path d="M17 3l-2 18"/><path d="M4 9h17"/><path d="M3 15h17"/>',
    alert: '<path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4"/><path d="M12 17h.01"/>',
    exam: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8"/><path d="M8 12h8"/><path d="M8 16h5"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    bookmark: '<path d="M6 3h12v18l-6-4-6 4V3Z"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    x: '<path d="M18 6 6 18"/><path d="M6 6l12 12"/>',
    chevron: '<path d="m9 18 6-6-6-6"/>',
    star: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9L18.2 21 12 17.8 5.8 21 7 14.2l-5-4.9 6.9-1L12 2Z"/>',
    trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/>',
    flag: '<path d="M5 3v18"/><path d="M5 4h13l-3 4 3 4H5"/>',
    warn: '<path d="M12 9v4"/><path d="M12 17h.01"/><circle cx="12" cy="12" r="9"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 8h.01"/><path d="M11 12h1v5h1"/>',
    box: '<path d="M21 8 12 3 3 8v8l9 5 9-5V8Z"/><path d="M3 8l9 5 9-5"/><path d="M12 13v8"/>',
    layers: '<path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 16 9 5 9-5"/>',
    arrowRight: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
  };
  function icon(name, cls) {
    return `<svg class="icon ${cls || ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  }

  /* ===================== ОБЩИЙ APP-MODAL ===================== */

  let modalSequence = 0;
  function openModal(options) {
    const opts = Object.assign({
      title: '', body: '', confirmText: 'Продолжить', cancelText: 'Отмена',
      destructive: false, showCancel: true,
    }, options || {});
    const trigger = document.activeElement;
    const titleId = `app-modal-title-${++modalSequence}`;
    const backdrop = document.createElement('div');
    backdrop.className = 'app-modal-backdrop';
    backdrop.innerHTML = `
      <section class="app-modal" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
        <div class="modal-brand"><img src="assets/icon-192.png" alt="" /></div>
        <h2 id="${titleId}">${escapeHtml(opts.title)}</h2>
        <div class="modal-body">${opts.body}</div>
        <div class="modal-actions">
          ${opts.showCancel ? `<button type="button" class="btn btn-ghost" data-modal-cancel>${escapeHtml(opts.cancelText)}</button>` : ''}
          <button type="button" class="btn ${opts.destructive ? 'btn-danger' : 'btn-primary'}" data-modal-confirm>${escapeHtml(opts.confirmText)}</button>
        </div>
      </section>`;
    document.body.appendChild(backdrop);
    document.body.classList.add('modal-open');

    return new Promise(resolve => {
      let closed = false;
      const focusables = () => $all('button:not(:disabled), a[href], input:not(:disabled), [tabindex]:not([tabindex="-1"])', backdrop);
      function close(result) {
        if (closed) return;
        closed = true;
        document.removeEventListener('keydown', onKeydown, true);
        backdrop.remove();
        document.body.classList.remove('modal-open');
        if (trigger && document.contains(trigger) && typeof trigger.focus === 'function') trigger.focus();
        resolve(result);
      }
      function onKeydown(event) {
        if (event.key === 'Escape') { event.preventDefault(); close(false); return; }
        if (event.key !== 'Tab') return;
        const items = focusables();
        if (!items.length) { event.preventDefault(); return; }
        const first = items[0], last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
      backdrop.querySelector('[data-modal-confirm]').addEventListener('click', () => close(true));
      const cancel = backdrop.querySelector('[data-modal-cancel]');
      if (cancel) cancel.addEventListener('click', () => close(false));
      backdrop.addEventListener('click', event => { if (event.target === backdrop) close(false); });
      document.addEventListener('keydown', onKeydown, true);
      requestAnimationFrame(() => (cancel || backdrop.querySelector('[data-modal-confirm]')).focus());
    });
  }

  function focusQuestionHeading(id) {
    requestAnimationFrame(() => {
      const heading = document.getElementById(id);
      if (heading) heading.focus({ preventScroll: true });
    });
  }

  const BLOCK_TYPE_LABELS = {
    know: 'Что нужно знать', process: 'Основной процесс', algorithm: 'Алгоритм', branch: 'Развилка',
    important: 'Важно', forbidden: 'Нельзя', exception: 'Исключение', mistake: 'Частая ошибка',
    remember: 'Запомнить', desktop: 'Настольное приложение', mobile: 'Мобильное приложение',
    compare: 'Сравнение', example: 'Практический пример', numbers: 'Числа и сроки',
    discrepancy: 'Расхождение в обучении', gap: 'Пробел в источнике',
  };
  const BLOCK_TYPE_ICONS = {
    know: 'book', process: 'arrowRight', algorithm: 'layers', branch: 'hash', important: 'alert',
    forbidden: 'x', exception: 'flag', mistake: 'warn', remember: 'star', desktop: 'box', mobile: 'box',
    compare: 'layers', example: 'info', numbers: 'hash', discrepancy: 'warn', gap: 'info',
  };

  /* ===================== ROUTER ===================== */

  const routes = {};
  function route(pattern, handler) { routes[pattern] = handler; }

  function parseHash() {
    let h = location.hash.replace(/^#\/?/, '');
    if (!h) h = 'dashboard';
    const [path, query] = h.split('?');
    const parts = path.split('/').filter(Boolean);
    const params = {};
    if (query) query.split('&').forEach(kv => { const [k, v] = kv.split('='); params[decodeURIComponent(k)] = decodeURIComponent(v || ''); });
    return { parts, params };
  }

  function navigate(hash) { location.hash = hash; }

  function onRouteChange() {
    const { parts, params } = parseHash();
    STATE.lastScreen = '#/' + parts.join('/');
    saveState();
    renderNavActive(parts[0]);
    const main = $('#app-main');
    main.classList.remove('fade-in'); void main.offsetWidth; main.classList.add('fade-in');
    try {
      dispatch(parts, params, main);
    } catch (e) {
      console.error('Ошибка рендера экрана', e);
      main.innerHTML = `<div class="empty-state">${icon('alert')}<h2>Что-то пошло не так</h2><p>Попробуйте вернуться на главную.</p><button class="btn btn-primary" onclick="location.hash='#/dashboard'">На главную</button></div>`;
    }
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function dispatch(parts, params, main) {
    const p0 = parts[0] || 'dashboard';
    if (p0 === 'dashboard') return renderDashboard(main);
    if (p0 === 'modules' && !parts[1]) return renderModulesList(main);
    if (p0 === 'module' && parts[1] && !parts[2]) return renderModuleDetail(main, Number(parts[1]), params);
    if (p0 === 'module' && parts[1] && parts[2] === 'test') return renderModuleTest(main, Number(parts[1]));
    if (p0 === 'numbers') return renderNumbers(main, params);
    if (p0 === 'defects') return renderDefects(main, params);
    if (p0 === 'mistakes') return renderMistakes(main);
    if (p0 === 'bookmarks') return renderBookmarks(main);
    if (p0 === 'search') return renderSearch(main, params);
    if (p0 === 'exam' && !parts[1]) return renderExamIntro(main);
    if (p0 === 'exam' && parts[1] === 'run') return renderExamRun(main);
    if (p0 === 'exam' && parts[1] === 'result') return renderExamResult(main);
    if (p0 === 'review') return renderPreExamReview(main);
    return renderDashboard(main);
  }

  function renderNavActive(section) {
    const activeSection = section === 'module' ? 'modules' : section === 'review' ? 'exam' : section;
    $all('.nav-link').forEach(a => {
      const s = a.getAttribute('data-section');
      const active = s === activeSection || (activeSection === undefined && s === 'dashboard');
      a.classList.toggle('active', active);
      if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  }

  window.addEventListener('hashchange', onRouteChange);


  /* ===================== ПРОГРЕСС / АГРЕГАЦИЯ ===================== */

  function moduleBlocks(moduleId) { return blocksForModule(moduleId); }

  function moduleProgressStatus(moduleId) {
    const item = STATE.moduleProgress[moduleId];
    return item && Object.values(PROGRESS).includes(item.status) ? item.status : PROGRESS.NOT_STARTED;
  }

  function moduleProgressPct(moduleId) {
    const status = moduleProgressStatus(moduleId);
    return status === PROGRESS.CONTENT_COMPLETED ? 100 : status === PROGRESS.IN_PROGRESS ? 50 : 0;
  }

  function lastTestResult(moduleId) {
    const arr = STATE.testResults[moduleId];
    return arr && arr.length ? arr[arr.length - 1] : null;
  }

  function bestTestResult(moduleId) {
    const arr = STATE.testResults[moduleId];
    if (!arr || !arr.length) return null;
    return arr.reduce((best, r) => (r.percent > best.percent ? r : best), arr[0]);
  }

  function overallAveragePct() {
    const ids = PVZ_MODULES.map(m => m.id);
    const vals = ids.map(moduleProgressPct);
    return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  }

  function averageTestScorePct() {
    const scores = [];
    Object.keys(STATE.testResults).forEach(mid => {
      const r = lastTestResult(mid);
      if (r) scores.push(r.percent);
    });
    if (!scores.length) return null;
    return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  }

  function completedModulesCount() {
    return PVZ_MODULES.filter(m => moduleProgressPct(m.id) === 100).length;
  }

  function weakModules(limit) {
    const withScores = PVZ_MODULES.map(m => {
      const r = lastTestResult(m.id);
      return { module: m, percent: r ? r.percent : null, attempted: !!r };
    }).filter(x => x.attempted);
    withScores.sort((a, b) => a.percent - b.percent);
    return withScores.slice(0, limit || 3);
  }

  function mistakeCount() { return Object.keys(STATE.mistakes).length; }

  function bestExamPercent() {
    if (!STATE.examAttempts.length) return null;
    return Math.max(...STATE.examAttempts.map(a => a.percent));
  }

  function lastOpenedModule() {
    if (STATE.lastModuleId) return moduleById(STATE.lastModuleId);
    return null;
  }

  function recordMistake(question) {
    const m = STATE.mistakes[question.id] || { moduleId: question.moduleId, blockId: question.relatedBlockId, wrongCount: 0 };
    m.wrongCount += 1;
    m.lastWrongAt = new Date().toISOString();
    m.moduleId = question.moduleId;
    m.blockId = question.relatedBlockId;
    STATE.mistakes[question.id] = m;
    saveState();
  }

  function clearMistake(questionId) {
    if (STATE.mistakes[questionId]) { delete STATE.mistakes[questionId]; saveState(); }
  }

  function markModuleInProgress(moduleId) {
    if (moduleProgressStatus(moduleId) === PROGRESS.NOT_STARTED) {
      STATE.moduleProgress[moduleId] = { status: PROGRESS.IN_PROGRESS };
      saveState();
    }
  }

  function markModuleContentCompleted(moduleId) {
    STATE.moduleProgress[moduleId] = { status: PROGRESS.CONTENT_COMPLETED, completedAt: new Date().toISOString() };
    saveState();
  }

  function toggleBookmark(blockId) {
    if (STATE.bookmarks[blockId]) delete STATE.bookmarks[blockId];
    else STATE.bookmarks[blockId] = true;
    saveState();
  }

  /* ===================== ЛЭЙАУТ / НАВИГАЦИЯ ===================== */

  function renderShell() {
    const root = $('#app-root');
    root.innerHTML = `
      <a class="skip-link" href="#app-main">Перейти к содержимому</a>
      <header class="topbar">
        <div class="topbar-inner">
          <a href="#/dashboard" class="brand" aria-label="WB Академия — на главную">
            <img class="brand-mark" src="assets/icon-192.png" alt="" /><span class="brand-text">WB Академия</span>
          </a>
          <form class="search-form" id="global-search-form" role="search">
            <label class="sr-only" for="global-search-input">Поиск по материалу</label>
            ${icon('search', 'search-icon')}
            <input id="global-search-input" type="search" placeholder="Поиск: IMEI, DBS, 14 дней…" autocomplete="off" />
          </form>
          <nav class="topnav" aria-label="Основная навигация">
            <a class="nav-link" data-section="dashboard" href="#/dashboard">${icon('home')}<span>Главная</span></a>
            <a class="nav-link" data-section="modules" href="#/modules">${icon('book')}<span>Темы</span></a>
            <a class="nav-link" data-section="exam" href="#/exam">${icon('exam')}<span>Экзамен</span></a>
            <a class="nav-link" data-section="defects" href="#/defects">${icon('alert')}<span>Брак</span></a>
            <a class="nav-link" data-section="numbers" href="#/numbers">${icon('hash')}<span>Числа</span></a>
            <a class="nav-link utility-link" data-section="mistakes" href="#/mistakes" aria-label="Работа над ошибками">${icon('warn')}</a>
            <a class="nav-link utility-link" data-section="bookmarks" href="#/bookmarks" aria-label="Закладки">${icon('bookmark')}</a>
          </nav>
        </div>
      </header>
      <main id="app-main" tabindex="-1"></main>
      <nav class="bottomnav" aria-label="Навигация">
        <a class="nav-link" data-section="dashboard" href="#/dashboard">${icon('home')}<span>Главная</span></a>
        <a class="nav-link" data-section="modules" href="#/modules">${icon('book')}<span>Темы</span></a>
        <a class="nav-link" data-section="exam" href="#/exam">${icon('exam')}<span>Экзамен</span></a>
        <a class="nav-link" data-section="defects" href="#/defects">${icon('alert')}<span>Брак</span></a>
        <a class="nav-link" data-section="numbers" href="#/numbers">${icon('hash')}<span>Числа</span></a>
      </nav>
    `;
    $('#global-search-form').addEventListener('submit', e => {
      e.preventDefault();
      const q = $('#global-search-input').value.trim();
      if (q) navigate('#/search?q=' + encodeURIComponent(q));
    });
    $('.bottomnav').addEventListener('click', event => {
      const link = event.target.closest('.nav-link');
      if (!link || !link.classList.contains('active')) return;
      event.preventDefault();
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
    });
  }

  /* ===================== ДАШБОРД ===================== */

  function renderDashboard(main) {
    const avg = overallAveragePct();
    const completed = completedModulesCount();
    const avgTest = averageTestScorePct();
    const weak = weakModules(3);
    const mistakes = mistakeCount();
    const bestExam = bestExamPercent();
    const examAttempts = STATE.examAttempts.length;
    const last = lastOpenedModule();

    main.innerHTML = `
      <div class="page page-dashboard">
        <section class="academy-hero">
          <div class="hero-copy">
            <span class="eyebrow">WB Академия</span>
            <h1>Знания для уверенной работы в ПВЗ</h1>
            <p>15 практических тем, тренировки и итоговая проверка — весь прогресс сохраняется на устройстве.</p>
            <div class="hero-actions">
              ${last ? `<a class="btn btn-light btn-lg" href="#/module/${last.id}">${icon('arrowRight')}Продолжить обучение</a>` : `<a class="btn btn-light btn-lg" href="#/modules">${icon('book')}Открыть темы</a>`}
              <a class="btn btn-glass" href="#/exam">${icon('exam')}Экзамен</a>
            </div>
          </div>
          <img class="hero-icon" src="assets/icon-512.png" alt="" />
        </section>

        <div class="page-head dashboard-heading">
          <div><span class="eyebrow dark">Ваш прогресс</span><h2>Продолжайте в своём темпе</h2></div>
          <a class="text-link" href="#/modules">Все темы ${icon('arrowRight')}</a>
        </div>

        <div class="stat-grid dashboard-stats">
          <div class="stat-card stat-primary">
            <div class="stat-value">${avg}%</div>
            <div class="stat-label">Материал изучен</div>
            <div class="progress-track"><div class="progress-fill" style="width:${avg}%"></div></div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${completed}/${PVZ_MODULES.length}</div>
            <div class="stat-label">Тем пройдено полностью</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${avgTest === null ? '—' : avgTest + '%'}</div>
            <div class="stat-label">Средний результат тестов</div>
          </div>
          <div class="stat-card stat-exam">
            <div class="stat-value">${bestExam === null ? '—' : bestExam + '%'}</div>
            <div class="stat-label">Лучший результат экзамена</div>
            <div class="stat-meta">${examAttempts ? `Попыток: ${examAttempts}` : 'Попыток пока нет'}</div>
          </div>
        </div>

        <div class="quick-actions">
          ${last ? `<a class="qa-btn" href="#/module/${last.id}">${icon('arrowRight')}Продолжить обучение</a>` : ''}
          <a class="qa-btn" href="#/mistakes">${icon('warn')}Повторить ошибки${mistakes ? ` <span class="badge">${mistakes}</span>` : ''}</a>
          <a class="qa-btn" href="#/numbers">${icon('hash')}Числа и сроки</a>
          <a class="qa-btn" href="#/defects">${icon('alert')}Справочник брака</a>
          <a class="qa-btn qa-primary" href="#/exam">${icon('exam')}Итоговый экзамен</a>
        </div>

        ${weak.length ? `
        <section class="section">
          <h2>Слабые темы</h2>
          <div class="card-grid">
            ${weak.map(w => `
              <a class="module-card weak" href="#/module/${w.module.id}">
                <div class="module-card-top">
                  <span class="module-num">${w.module.id}</span>
                  <span class="score-chip ${scoreClass(w.percent)}">${w.percent}%</span>
                </div>
                <h3>${escapeHtml(w.module.title)}</h3>
                <p class="muted small">${escapeHtml(w.module.short)}</p>
              </a>`).join('')}
          </div>
        </section>` : ''}

        <section class="section">
          <h2>15 тем курса</h2>
          <div class="card-grid">
            ${PVZ_MODULES.map(renderModuleCard).join('')}
          </div>
        </section>

        <section class="section danger-zone">
          <button class="btn btn-ghost btn-sm" id="reset-progress-btn">${icon('trash')}Сбросить весь прогресс</button>
        </section>
      </div>
    `;
    const resetBtn = $('#reset-progress-btn');
    if (resetBtn) resetBtn.addEventListener('click', async () => {
      const confirmed = await openModal({
        title: 'Сбросить весь прогресс?',
        body: '<p>Будут удалены прогресс материалов, результаты тестов, экзамены, ошибки и закладки.</p><p><strong>Это действие нельзя отменить.</strong></p>',
        confirmText: 'Сбросить', destructive: true,
      });
      if (confirmed) {
        resetProgress();
        navigate('#/dashboard');
        renderDashboard($('#app-main'));
      }
    });
  }

  function scoreClass(p) { return p >= 85 ? 'good' : p >= 60 ? 'mid' : 'bad'; }

  function renderModuleCard(m) {
    const progress = moduleProgressPct(m.id);
    const progressStatus = moduleProgressStatus(m.id);
    const test = lastTestResult(m.id);
    return `
      <a class="module-card" href="#/module/${m.id}">
        <div class="module-card-top">
          <span class="module-num">${m.id}</span>
          <span class="module-chevron" aria-hidden="true">${icon('chevron')}</span>
        </div>
        <h3>${escapeHtml(m.title)}</h3>
        <p class="muted small">${escapeHtml(m.short)}</p>
        <div class="progress-track thin"><div class="progress-fill" style="width:${progress}%"></div></div>
        <div class="module-metrics">
          <span><small>Материал</small><strong>${progressStatus === PROGRESS.CONTENT_COMPLETED ? 'изучен' : progressStatus === PROGRESS.IN_PROGRESS ? 'в процессе' : 'не начат'}</strong></span>
          <span><small>Тест</small><strong>${test ? test.percent + '%' : 'не пройден'}</strong></span>
        </div>
      </a>`;
  }

  function renderModulesList(main) {
    main.innerHTML = `
      <div class="page">
        <div class="page-head">
          <h1>Все темы</h1>
          <p class="muted">Пройдите модули по порядку или выборочно — прогресс сохраняется автоматически.</p>
        </div>
        <div class="card-grid">${PVZ_MODULES.map(renderModuleCard).join('')}</div>
      </div>
    `;
  }

  /* ===================== ДЕТАЛЬ МОДУЛЯ / КОНТЕНТ ===================== */

  function renderBlockContent(b) {
    let inner = '';
    if (b.steps) {
      inner += `<ol class="stepper">${b.steps.map(s => `<li><span class="step-dot"></span><span class="step-text">${escapeHtml(s)}</span></li>`).join('')}</ol>`;
    }
    if (b.branches) {
      inner += `<div class="branch-list">${b.branches.map(br => `
        <div class="branch-row">
          <div class="branch-cond"><strong>ЕСЛИ</strong> ${escapeHtml(br.cond)}</div>
          <div class="branch-action"><strong>ТО</strong> ${escapeHtml(br.action)}</div>
        </div>`).join('')}</div>`;
    }
    if (b.compare) {
      const cols = [b.compare.a, b.compare.b, b.compare.c].filter(Boolean);
      inner += `<div class="compare-grid compare-cols-${cols.length}">${cols.map(col => `
        <div class="compare-col">
          <div class="compare-col-title">${escapeHtml(col.label)}</div>
          <ul>${col.items.map(it => `<li>${escapeHtml(it)}</li>`).join('')}</ul>
        </div>`).join('')}</div>`;
    }
    if (b.bodyList) {
      inner += `<ul class="fact-list">${b.bodyList.map(t => `<li>${escapeHtml(t)}</li>`).join('')}</ul>`;
    }
    if (b.body) {
      inner += `<p>${escapeHtml(b.body)}</p>`;
    }
    return inner;
  }

  function renderModuleDetail(main, moduleId, params) {
    const m = moduleById(moduleId);
    if (!m) { main.innerHTML = '<div class="empty-state">Тема не найдена.</div>'; return; }
    STATE.lastModuleId = moduleId; STATE.viewedModules[moduleId] = true; markModuleInProgress(moduleId); saveState();

    const blocks = moduleBlocks(moduleId);
    const idx = PVZ_MODULES.findIndex(x => x.id === moduleId);
    const prev = PVZ_MODULES[idx - 1];
    const next = PVZ_MODULES[idx + 1];
    const test = lastTestResult(moduleId);
    const best = bestTestResult(moduleId);
    const quickChecks = quickChecksForModule(moduleId, blocks);
    const quickByBlock = quickChecks.reduce((map, q) => {
      (map[q.relatedBlockId] = map[q.relatedBlockId] || []).push(q);
      return map;
    }, {});

    main.innerHTML = `
      <div class="page page-module">
        <nav class="breadcrumbs"><a href="#/modules">Темы</a><span>/</span><span>${m.id}. ${escapeHtml(m.title)}</span></nav>
        <div class="page-head module-head">
          <div>
            <h1>${m.id}. ${escapeHtml(m.title)}</h1>
            <p class="muted">${escapeHtml(m.short)}</p>
          </div>
          <div class="module-head-actions">
            ${best ? `<span class="score-chip ${scoreClass(best.percent)}">Лучший тест: ${best.percent}%</span>` : ''}
            <a class="btn btn-primary" href="#/module/${moduleId}/test">${icon('exam')}Пройти тест темы</a>
          </div>
        </div>

        <div id="module-blocks" class="block-list"></div>

        <div class="content-completion">
          <button class="btn ${moduleProgressStatus(moduleId) === PROGRESS.CONTENT_COMPLETED ? 'btn-ghost' : 'btn-primary'}" id="complete-content-btn" ${moduleProgressStatus(moduleId) === PROGRESS.CONTENT_COMPLETED ? 'disabled' : ''}>
            ${moduleProgressStatus(moduleId) === PROGRESS.CONTENT_COMPLETED ? icon('check') + 'Материал отмечен изученным' : icon('check') + 'Отметить материал изученным'}
          </button>
          <p class="muted small">Прогресс материала засчитывается только после этого осознанного действия.</p>
        </div>

        ${discrepancyNoteIfAny(moduleId)}

        <div class="module-nav">
          ${prev ? `<a class="btn btn-ghost" href="#/module/${prev.id}">${icon('chevron', 'rotate-180')} ${prev.id}. ${escapeHtml(prev.title)}</a>` : '<span></span>'}
          ${next ? `<a class="btn btn-ghost" href="#/module/${next.id}">${next.id}. ${escapeHtml(next.title)} ${icon('chevron')}</a>` : '<span></span>'}
        </div>
      </div>
    `;

    const container = $('#module-blocks');
    blocks.forEach((b, i) => {
      const isBookmarked = !!STATE.bookmarks[b.id];
      const card = document.createElement('article');
      card.className = 'block-card block-' + b.type;
      card.id = 'block-' + b.id;
      card.innerHTML = `
        <header class="block-card-head">
          <span class="block-type-badge">${icon(BLOCK_TYPE_ICONS[b.type] || 'info')}${BLOCK_TYPE_LABELS[b.type] || b.type}</span>
          <button class="icon-btn bookmark-toggle ${isBookmarked ? 'active' : ''}" data-block="${b.id}" aria-pressed="${isBookmarked}" aria-label="${isBookmarked ? 'Убрать из закладок' : 'Добавить в закладки'}">${icon('bookmark')}</button>
        </header>
        <h3>${escapeHtml(b.title)}</h3>
        <div class="block-body">${renderBlockContent(b)}</div>
      `;
      container.appendChild(card);

      // Проверка появляется только после блока, который обучает проверяемому правилу.
      (quickByBlock[b.id] || []).forEach(q => container.appendChild(renderQuickCheck(q)));
    });

    container.addEventListener('click', e => {
      const btn = e.target.closest('.bookmark-toggle');
      if (btn) {
        toggleBookmark(btn.getAttribute('data-block'));
        btn.classList.toggle('active');
        const active = btn.classList.contains('active');
        btn.setAttribute('aria-pressed', String(active));
        btn.setAttribute('aria-label', active ? 'Убрать из закладок' : 'Добавить в закладки');
      }
    });

    $('#complete-content-btn').addEventListener('click', () => {
      markModuleContentCompleted(moduleId);
      renderModuleDetail(main, moduleId, params || {});
    });

    if (params && params.block) {
      const target = document.getElementById('block-' + params.block);
      if (target) setTimeout(() => target.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
    }
  }

  function quickCheckCandidatesForModule(moduleId, blocks) {
    const blockIds = new Set(blocks.map(b => b.id));
    return questionsForModule(moduleId).filter(q =>
      isScoredEligible(q) && q.difficulty === 'easy' &&
      (q.type === 'single' || q.type === 'boolean') && blockIds.has(q.relatedBlockId));
  }

  function quickChecksForModule(moduleId, blocks) {
    const eligible = quickCheckCandidatesForModule(moduleId, blocks);
    try {
      const all = JSON.parse(sessionStorage.getItem(QUICK_CHECK_SESSION_KEY) || '{}');
      const saved = Array.isArray(all[moduleId]) ? all[moduleId].map(id => eligible.find(q => q.id === id)).filter(Boolean) : [];
      if (saved.length) return saved;
      const chosen = sample(eligible, Math.min(2, eligible.length));
      all[moduleId] = chosen.map(q => q.id);
      sessionStorage.setItem(QUICK_CHECK_SESSION_KEY, JSON.stringify(all));
      return chosen;
    } catch (e) { return sample(eligible, Math.min(2, eligible.length)); }
  }

  function quickCheckIdsForModule(moduleId) {
    try {
      const all = JSON.parse(sessionStorage.getItem(QUICK_CHECK_SESSION_KEY) || '{}');
      return new Set(Array.isArray(all[moduleId]) ? all[moduleId] : []);
    } catch (e) { return new Set(); }
  }

  function discrepancyNoteIfAny(moduleId) {
    if (moduleId !== 3) return '';
    return `<div class="callout callout-warn">
      ${icon('warn')}
      <div><strong>Это официально зафиксированное расхождение источника обучения</strong> — оно не разрешено в пользу одного варианта. Ориентируйтесь на экранную подсказку программы и действующую локальную инструкцию вашего ПВЗ.</div>
    </div>`;
  }

  function renderQuickCheck(q) {
    const wrap = document.createElement('div');
    wrap.className = 'quick-check';
    wrap.dataset.mode = 'QUICK_CHECK';
    wrap.dataset.relatedBlockId = q.relatedBlockId;
    const state = { submitted: false, answer: null };
    const opts = q.options.map((opt, i) => `<button class="qc-option" type="button" role="radio" aria-checked="false" data-i="${i}">${escapeHtml(opt)}</button>`).join('');
    wrap.innerHTML = `
      <div class="quick-check-head">
        <div class="quick-check-badge">${icon('info')}Быстрая проверка</div>
        <span class="type-chip qc-type">${TYPE_LABELS[q.type]}</span>
      </div>
      <p class="qc-prompt">${escapeHtml(q.prompt)}</p>
      <div class="qc-options" role="radiogroup">${opts}</div>
      <div class="qc-feedback" role="status" aria-live="polite" hidden></div>
    `;
    wrap.addEventListener('click', e => {
      const btn = e.target.closest('.qc-option');
      if (!btn || state.submitted) return;
      state.submitted = true;
      state.answer = Number(btn.getAttribute('data-i'));
      wrap.classList.add('answered');
      wrap.dataset.submittedAnswer = String(state.answer);
      const i = state.answer;
      const isCorrect = q.correct.includes(i);
      $all('.qc-option', wrap).forEach((b, bi) => {
        b.disabled = true;
        b.classList.toggle('selected', bi === i);
        b.setAttribute('aria-checked', String(bi === i));
        if (q.correct.includes(bi)) b.classList.add('correct');
        else if (bi === i) b.classList.add('incorrect');
      });
      const fb = $('.qc-feedback', wrap);
      fb.hidden = false;
      fb.innerHTML = `<div class="qc-status ${isCorrect ? 'good' : 'bad'}">${icon(isCorrect ? 'check' : 'x')}${isCorrect ? 'Верно!' : 'Неверно'}</div><p>${escapeHtml(q.explanation)}</p>` +
        (q.relatedBlockId ? `<button class="btn btn-ghost btn-sm" data-jump="${q.relatedBlockId}">Повторить правило</button>` : '');
      const jumpBtn = $('[data-jump]', fb);
      if (jumpBtn) jumpBtn.addEventListener('click', () => {
        const el = document.getElementById('block-' + jumpBtn.getAttribute('data-jump'));
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    });
    return wrap;
  }

  /* ===================== ДВИЖОК ВОПРОСОВ (общий) ===================== */

  const QUIZ_MODES = Object.freeze({
    QUICK_CHECK: 'QUICK_CHECK',
    MODULE_TEST: 'MODULE_TEST',
    ERROR_REVIEW: 'ERROR_REVIEW',
    FINAL_EXAM: 'FINAL_EXAM',
  });

  function isScoredEligible(q) { return !Array.isArray(q.tags) || !q.tags.includes('meta-source'); }

  function prepareInstance(q) {
    const copy = JSON.parse(JSON.stringify(q));
    if (copy.type === 'sequence') {
      const displayOrder = shuffled(copy.options.map((_, i) => i));
      copy._displayOrder = displayOrder;
      copy._options = displayOrder.map(i => copy.options[i]);
    } else if (copy.type === 'branching') {
      copy.steps = copy.steps.map(s => {
        const idxs = shuffled(s.options.map((_, i) => i));
        return Object.assign({}, s, { _options: idxs.map(i => s.options[i]), _correct: idxs.indexOf(s.correct) });
      });
    } else if (copy.options) {
      const idxs = shuffled(copy.options.map((_, i) => i));
      copy._options = idxs.map(i => copy.options[i]);
      copy._correct = copy.correct.map(c => idxs.indexOf(c));
    }
    return copy;
  }

  function isAnswerCorrect(qi, userAnswer) {
    const raw = userAnswer && typeof userAnswer === 'object' && !Array.isArray(userAnswer) && Object.prototype.hasOwnProperty.call(userAnswer, 'value')
      ? userAnswer.value : userAnswer;
    if (qi.type === 'single' || qi.type === 'boolean') {
      return raw != null && qi._correct.includes(raw);
    }
    if (qi.type === 'multi') {
      if (!Array.isArray(raw) || !raw.length) return false;
      const a = [...raw].sort((x, y) => x - y);
      const b = [...qi._correct].sort((x, y) => x - y);
      return a.length === b.length && a.every((v, i) => v === b[i]);
    }
    if (qi.type === 'sequence') {
      if (!Array.isArray(raw) || raw.length !== qi._options.length) return false;
      const orig = raw.map(slot => qi._displayOrder[slot]);
      return orig.every((v, i) => v === i);
    }
    if (qi.type === 'branching') {
      return Array.isArray(raw) && raw.length === qi.steps.length && raw.every((a, idx) => a === qi.steps[idx]._correct);
    }
    return false;
  }

  function isAnswerComplete(question, answer) {
    if (!question) return false;
    if (question.type === 'single' || question.type === 'boolean') return Number.isInteger(answer);
    if (question.type === 'multi') {
      return !!answer && !Array.isArray(answer) && answer.confirmed === true && Array.isArray(answer.value) && answer.value.length > 0;
    }
    if (question.type === 'sequence') {
      return Array.isArray(answer) && answer.length === question._options.length && new Set(answer).size === question._options.length;
    }
    if (question.type === 'branching') {
      return Array.isArray(answer) && answer.length === question.steps.length && answer.every(Number.isInteger);
    }
    return false;
  }

  function completeAnswer(question, draft) {
    return question.type === 'multi' ? { value: Array.isArray(draft) ? draft.slice() : [], confirmed: true } :
      Array.isArray(draft) ? draft.slice() : draft;
  }

  function buildResult(questions, answers) {
    let correct = 0, incorrect = 0, unanswered = 0;
    const wrongIds = [];
    questions.forEach(q => {
      const answer = answers[q.id];
      if (!isAnswerComplete(q, answer)) { unanswered++; return; }
      if (isAnswerCorrect(q, answer)) correct++;
      else { incorrect++; wrongIds.push(q.id); }
    });
    return { correct, incorrect, unanswered, total: questions.length, percent: pct(correct, questions.length), wrongIds };
  }

  const TYPE_LABELS = { single: 'Один ответ', multi: 'Несколько ответов', boolean: 'Верно / неверно', sequence: 'Порядок действий', branching: 'Мини-сценарий' };

  // Рендерит интерактивную часть вопроса (без заголовка).
  // initialAnswer — ранее сохранённый ответ (для восстановления при возврате к вопросу), либо null/undefined.
  // callback(answer, ready) вызывается при каждом изменении.
  function renderInteraction(container, qi, initialAnswer, onChange) {
    container.innerHTML = '';
    let interactionLocked = false;
    const lock = () => {
      interactionLocked = true;
      $all('button, input, select, textarea', container).forEach(control => { control.disabled = true; });
    };
    if (qi.type === 'single' || qi.type === 'boolean') {
      let answer = (typeof initialAnswer === 'number') ? initialAnswer : null;
      const list = document.createElement('div');
      list.className = 'choice-list';
      list.setAttribute('role', 'radiogroup');
      qi._options.forEach((opt, i) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'choice-option'; b.setAttribute('role', 'radio');
        const isSel = answer === i;
        b.setAttribute('aria-checked', String(isSel));
        if (isSel) b.classList.add('selected');
        b.innerHTML = `<span class="choice-mark"></span><span>${escapeHtml(opt)}</span>`;
        b.addEventListener('click', () => {
          if (interactionLocked) return;
          answer = i;
          $all('.choice-option', list).forEach((el, ei) => { el.classList.toggle('selected', ei === i); el.setAttribute('aria-checked', String(ei === i)); });
          onChange(answer, true);
        });
        list.appendChild(b);
      });
      container.appendChild(list);
    } else if (qi.type === 'multi') {
      let answer = Array.isArray(initialAnswer) ? initialAnswer.slice() : [];
      const list = document.createElement('div');
      list.className = 'choice-list';
      qi._options.forEach((opt, i) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'choice-option multi';
        const isSel = answer.includes(i);
        b.setAttribute('aria-pressed', String(isSel));
        if (isSel) b.classList.add('selected');
        b.innerHTML = `<span class="choice-mark checkbox"></span><span>${escapeHtml(opt)}</span>`;
        b.addEventListener('click', () => {
          if (interactionLocked) return;
          if (answer.includes(i)) answer = answer.filter(x => x !== i); else answer = answer.concat(i);
          b.classList.toggle('selected', answer.includes(i)); b.setAttribute('aria-pressed', String(answer.includes(i)));
          onChange(answer, answer.length > 0);
        });
        list.appendChild(b);
      });
      const hint = document.createElement('p'); hint.className = 'muted small'; hint.textContent = 'Можно выбрать несколько вариантов.';
      container.appendChild(hint); container.appendChild(list);
    } else if (qi.type === 'sequence') {
      let picked = Array.isArray(initialAnswer) ? initialAnswer.slice() : [];
      const pool = document.createElement('div'); pool.className = 'seq-pool';
      const built = document.createElement('ol'); built.className = 'seq-built';
      const hint = document.createElement('p'); hint.className = 'muted small'; hint.textContent = 'Нажимайте шаги в правильном порядке. Ошиблись — уберите последний.';
      const undoWrap = document.createElement('div');
      function renderPool() {
        pool.innerHTML = '';
        qi._options.forEach((opt, slot) => {
          if (picked.includes(slot)) return;
          const b = document.createElement('button'); b.type = 'button'; b.className = 'seq-chip';
          b.textContent = opt;
          b.addEventListener('click', () => {
            if (interactionLocked) return;
            picked.push(slot); renderPool(); renderBuilt(); onChange(picked, picked.length === qi._options.length);
          });
          pool.appendChild(b);
        });
      }
      function renderBuilt() {
        built.innerHTML = '';
        picked.forEach((slot) => {
          const li = document.createElement('li');
          li.innerHTML = `<span>${escapeHtml(qi._options[slot])}</span>`;
          built.appendChild(li);
        });
        undoWrap.innerHTML = '';
        const undo = document.createElement('button');
        undo.type = 'button'; undo.className = 'btn btn-ghost btn-sm'; undo.textContent = 'Отменить последний шаг';
        undo.disabled = picked.length === 0;
        undo.addEventListener('click', () => {
          if (interactionLocked) return;
          picked.pop(); renderPool(); renderBuilt(); onChange(picked, picked.length === qi._options.length);
        });
        undoWrap.appendChild(undo);
      }
      container.appendChild(hint); container.appendChild(built); container.appendChild(pool); container.appendChild(undoWrap);
      renderPool(); renderBuilt();
    }
    return Object.freeze({ lock });
  }

  function renderExplanationBlock(q, userWasCorrect, answer) {
    return `
      <div class="feedback-box ${userWasCorrect ? 'good' : 'bad'}" role="status" aria-live="polite">
        <div class="feedback-status">${icon(userWasCorrect ? 'check' : 'x')}${userWasCorrect ? 'Верно' : 'Неверно'}</div>
        ${!userWasCorrect && q.type === 'sequence' ? renderAnswerReview(q, answer) : ''}
        <p>${escapeHtml(q.explanation)}</p>
        ${q.relatedBlockId ? `<a class="btn btn-ghost btn-sm" href="#/module/${q.moduleId}?block=${q.relatedBlockId}">Открыть материал</a>` : ''}
      </div>`;
  }

  /* ===================== ПРАКТИЧЕСКИЙ ТЕСТ (модуль / ошибки) ===================== */

  function startPracticeQuiz(main, sourceQuestions, opts) {
    const questions = sourceQuestions.map(prepareInstance);
    const mode = opts.mode;
    const immediate = mode === QUIZ_MODES.ERROR_REVIEW;
    const answers = {};
    let i = 0, locked = false, currentAnswer = null, ready = false;

    function renderQ() {
      const qi = questions[i];
      main.innerHTML = `
        <div class="page quiz-page" data-quiz-mode="${mode}">
          <div class="quiz-topbar">
            <a class="btn btn-ghost btn-sm" href="${opts.backHash}">${icon('x')}Выйти</a>
            <div class="quiz-progress-text">Вопрос ${i + 1} из ${questions.length}</div>
            ${immediate ? `<div class="quiz-score-text">Отвечено: ${Object.keys(answers).length}</div>` : ''}
          </div>
          <div class="progress-track"><div class="progress-fill" style="width:${(i / questions.length) * 100}%"></div></div>
          <div class="quiz-card">
            <span class="type-chip">${TYPE_LABELS[qi.type]}</span>
            <h2 class="quiz-prompt" id="quiz-question-heading" tabindex="-1">${escapeHtml(qi.prompt)}</h2>
            <div id="quiz-interaction"></div>
            <div id="quiz-feedback"></div>
            <div class="quiz-actions">
              <button class="btn btn-primary" id="quiz-submit" disabled>${immediate ? 'Проверить ответ' : (i === questions.length - 1 ? 'Завершить тест' : 'Следующий вопрос')}</button>
              <button class="btn btn-primary" id="quiz-next" hidden>${i === questions.length - 1 ? 'Завершить' : 'Следующий вопрос'}</button>
            </div>
          </div>
        </div>`;

      locked = false; currentAnswer = null; ready = false;

      $('#quiz-next').addEventListener('click', goNext);

      if (qi.type === 'branching') {
        renderBranching(qi);
        return;
      }

      const interaction = renderInteraction($('#quiz-interaction'), qi, null, (ans, isReady) => {
        if (locked) return;
        currentAnswer = ans; ready = isReady; $('#quiz-submit').disabled = !ready;
      });

      $('#quiz-submit').addEventListener('click', () => {
        if (!ready || locked) return;
        locked = true;
        answers[qi.id] = completeAnswer(qi, currentAnswer);
        const ok = isAnswerCorrect(qi, answers[qi.id]);
        recordAnswerOutcome(qi, ok);
        if (!immediate) { goNext(); return; }
        interaction.lock();
        applyFeedbackStyles(qi, currentAnswer);
        $('#quiz-feedback').innerHTML = renderExplanationBlock(qi, ok, answers[qi.id]);
        $('#quiz-submit').hidden = true;
        $('#quiz-submit').disabled = true;
        $('#quiz-next').hidden = false;
      });
    }

    function applyFeedbackStyles(qi, ans) {
      if (qi.type === 'sequence') {
        $all('.seq-built li').forEach((li, slot) => {
          const correctOrig = slot;
          const chosenOrig = qi._displayOrder[ans[slot]];
          li.classList.add(chosenOrig === correctOrig ? 'correct' : 'incorrect');
        });
        return;
      }
      const marks = qi.type === 'multi' ? ans : [ans];
      $all('.choice-option', document).forEach((el, idx) => {
        if (qi._correct.includes(idx)) el.classList.add('correct');
        else if (marks.includes(idx)) el.classList.add('incorrect');
        el.disabled = true;
      });
    }

    function renderBranching(qi) {
      let stepIndex = 0;
      const chosen = [];
      $('#quiz-submit').hidden = true;
      function renderStep() {
        const s = qi.steps[stepIndex];
        $('#quiz-interaction').innerHTML = `<p class="muted small">Шаг ${stepIndex + 1} из ${qi.steps.length}</p><p class="step-prompt"><strong>${escapeHtml(s.prompt)}</strong></p><div class="choice-list" id="branch-choices" role="radiogroup"></div><div id="branch-feedback"></div><button class="btn btn-primary" id="branch-step-next" hidden style="margin-top:12px">${stepIndex === qi.steps.length - 1 ? 'Завершить сценарий' : 'Следующий шаг'}</button>`;
        const list = $('#branch-choices');
        let selected = null;
        let stepLocked = false;
        s._options.forEach((opt, i) => {
          const b = document.createElement('button');
          b.type = 'button'; b.className = 'choice-option'; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', 'false');
          b.innerHTML = `<span class="choice-mark"></span><span>${escapeHtml(opt)}</span>`;
          b.addEventListener('click', () => {
            if (locked || stepLocked) return;
            selected = i;
            $all('.choice-option', list).forEach((el, ei) => { el.classList.toggle('selected', ei === i); el.setAttribute('aria-checked', String(ei === i)); });
            if (immediate) {
              stepLocked = true;
              const ok = selected === s._correct;
              $all('.choice-option', list).forEach((el, ei) => { el.disabled = true; if (ei === s._correct) el.classList.add('correct'); else if (ei === selected) el.classList.add('incorrect'); });
              $('#branch-feedback').innerHTML = `<div class="feedback-box ${ok ? 'good' : 'bad'}"><div class="feedback-status">${icon(ok ? 'check' : 'x')}${ok ? 'Верно' : 'Неверно'}</div><p>${escapeHtml(s.explanation)}</p></div>`;
            }
            $('#branch-step-next').hidden = false;
          });
          list.appendChild(b);
        });
        $('#branch-step-next').addEventListener('click', () => {
          if (!Number.isInteger(selected) || locked) return;
          chosen[stepIndex] = selected;
          if (stepIndex < qi.steps.length - 1) { stepIndex++; renderStep(); }
          else finishBranching();
        });
      }
      function finishBranching() {
        locked = true;
        answers[qi.id] = chosen.slice();
        const ok = isAnswerCorrect(qi, answers[qi.id]);
        recordAnswerOutcome(qi, ok);
        $('#quiz-interaction').innerHTML = `<p class="empty-note">${icon('check')}Сценарий завершён. Ответ сохранён.</p>`;
        if (immediate) $('#quiz-feedback').innerHTML = renderExplanationBlock(qi, ok, answers[qi.id]);
        $('#quiz-next').hidden = false;
      }
      renderStep();
    }

    function recordAnswerOutcome(qi, ok) {
      if (ok) clearMistake(qi.id); else recordMistake(qi);
    }

    function goNext() {
      if (i < questions.length - 1) { i++; renderQ(); focusQuestionHeading('quiz-question-heading'); }
      else finish();
    }

    function finish() {
      const result = buildResult(questions, answers);
      if (opts.onComplete) opts.onComplete(result);
      renderQuizSummary(main, Object.assign(result, { answers, questions, opts }));
    }

    renderQ();
  }

  function renderQuizSummary(main, res) {
    const wrongQ = res.questions.filter(q => res.wrongIds.includes(q.id));
    main.innerHTML = `
      <div class="page quiz-summary">
        <div class="result-hero ${scoreClass(res.percent)}">
          <div class="result-percent">${res.percent}%</div>
          <div class="result-sub">${res.correct} из ${res.total} правильно</div>
          <div class="result-counts">${res.incorrect} ${pluralizeErrors(res.incorrect)}${res.unanswered ? ` · без ответа: ${res.unanswered}` : ''}</div>
        </div>
        ${wrongQ.length ? `
        <section class="section">
          <h2>Разбор ошибок</h2>
          <div class="review-list">
            ${wrongQ.map(q => `
              <div class="review-item">
                <p class="review-prompt">${escapeHtml(q.prompt)}</p>
                ${renderAnswerReview(q, res.answers[q.id])}
                <p class="review-explain"><strong>Почему:</strong> ${escapeHtml(q.explanation)}</p>
                ${q.relatedBlockId ? `<a class="btn btn-ghost btn-sm" href="#/module/${q.moduleId}?block=${q.relatedBlockId}">Открыть материал</a>` : ''}
              </div>`).join('')}
          </div>
        </section>` : res.unanswered === 0 && res.correct === res.total ? `<p class="empty-note">${icon('check')} Ошибок нет — отличный результат!</p>` : ''}
        <div class="quiz-actions">
          <a class="btn btn-ghost" id="result-back" href="${res.opts.backHash}">${icon('chevron', 'rotate-180')}Вернуться</a>
          <button class="btn btn-primary" id="retry-btn">Пройти ещё раз</button>
        </div>
      </div>`;
    $('#retry-btn').addEventListener('click', res.opts.onRetry);
  }

  function pluralizeErrors(n) { return n === 1 ? 'ошибка' : (n >= 2 && n <= 4 ? 'ошибки' : 'ошибок'); }

  function answerTexts(q, answer, correct) {
    if (q.type === 'branching') {
      const raw = Array.isArray(answer) ? answer : [];
      return q.steps.map((s, idx) => `${idx + 1}. ${correct ? s._options[s._correct] : (Number.isInteger(raw[idx]) ? s._options[raw[idx]] : '—')}`).join(' · ');
    }
    if (q.type === 'sequence') {
      if (correct) return q.options.join(' → ');
      return Array.isArray(answer) ? answer.map(slot => q._options[slot]).join(' → ') : '—';
    }
    const raw = answer && !Array.isArray(answer) && typeof answer === 'object' ? answer.value : answer;
    const indexes = correct ? q._correct : (Array.isArray(raw) ? raw : Number.isInteger(raw) ? [raw] : []);
    return indexes.map(idx => q._options[idx]).join('; ') || '—';
  }

  function renderAnswerReview(q, answer) {
    const yourLabel = q.type === 'sequence' ? 'Ваш порядок' : q.type === 'branching' ? 'Ваши ответы по шагам' : 'Ваш ответ';
    const correctLabel = q.type === 'sequence' ? 'Правильный порядок' : q.type === 'branching' ? 'Правильные ответы по шагам' : 'Правильный ответ';
    if (q.type === 'sequence') {
      const chosen = Array.isArray(answer) ? answer.map(slot => q._options[slot]) : [];
      const ordered = items => `<ol class="answer-order">${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ol>`;
      return `<div class="sequence-review"><h3>${yourLabel}</h3>${ordered(chosen)}<h3>${correctLabel}</h3>${ordered(q.options)}</div>`;
    }
    return `<dl class="answer-review"><dt>${yourLabel}</dt><dd>${escapeHtml(answerTexts(q, answer, false))}</dd><dt>${correctLabel}</dt><dd>${escapeHtml(answerTexts(q, answer, true))}</dd></dl>`;
  }

  function renderModuleTest(main, moduleId) {
    const m = moduleById(moduleId);
    const excludedQuickChecks = quickCheckIdsForModule(moduleId);
    const bank = questionsForModule(moduleId).filter(q => isScoredEligible(q) && !excludedQuickChecks.has(q.id));
    if (!m || bank.length < 15) { main.innerHTML = '<div class="empty-state">Тест недоступен: требуется не менее 15 уникальных вопросов.</div>'; return; }
    const size = 15;
    const run = () => {
      const chosen = sample(bank, size);
      startPracticeQuiz(main, chosen, {
        mode: QUIZ_MODES.MODULE_TEST,
        backHash: `#/module/${moduleId}`,
        onRetry: run,
        onComplete: (res) => {
          const arr = STATE.testResults[moduleId] || (STATE.testResults[moduleId] = []);
          arr.push({ date: new Date().toISOString(), correct: res.correct, incorrect: res.incorrect, unanswered: res.unanswered, total: res.total, percent: res.percent });
          saveState();
        },
      });
    };
    run();
  }

  function renderMistakes(main) {
    const ids = Object.keys(STATE.mistakes);
    if (!ids.length) {
      main.innerHTML = `<div class="page"><div class="empty-state">${icon('check')}<h2>Ошибок пока нет</h2><p class="muted">Проходите тесты по темам — вопросы с ошибками появятся здесь для повторения.</p><a class="btn btn-primary" href="#/modules">К темам</a></div></div>`;
      return;
    }
    const qs = ids.map(id => PVZ_QUESTIONS.find(q => q.id === id)).filter(Boolean);
    const byModule = {};
    qs.forEach(q => { (byModule[q.moduleId] = byModule[q.moduleId] || []).push(q); });

    main.innerHTML = `
      <div class="page">
        <div class="page-head"><h1>Работа над ошибками</h1><p class="muted">${qs.length} вопрос(ов) для повторения из ${Object.keys(byModule).length} тем.</p></div>
        <div class="card-grid">
          ${Object.keys(byModule).map(mid => {
            const mm = moduleById(Number(mid));
            return `<div class="module-card static"><div class="module-card-top"><span class="module-num">${mm.id}</span><span class="badge">${byModule[mid].length}</span></div><h3>${escapeHtml(mm.title)}</h3></div>`;
          }).join('')}
        </div>
        <div class="quiz-actions" style="margin-top:24px"><button class="btn btn-primary" id="start-mistakes">${icon('exam')}Повторить все ошибки (${qs.length})</button></div>
      </div>`;
    $('#start-mistakes').addEventListener('click', () => {
      const run = () => startPracticeQuiz(main, shuffled(qs), {
        mode: QUIZ_MODES.ERROR_REVIEW, backHash: `#/module/${qs[0].moduleId}`, onRetry: run, onComplete: () => {},
      });
      run();
    });
  }

  /* ===================== ЭКЗАМЕН ===================== */

  const EXAM_SIZE_DEFAULT = 60;
  const EXAM_PASS_PERCENT = 85;
  const EXAM_WEIGHTS = { 1: 3, 2: 3, 3: 1, 4: 1, 5: 2, 6: 1, 7: 1, 8: 1, 9: 2, 10: 2, 11: 3, 12: 3, 13: 3, 14: 4, 15: 4 };
  const EXAM_MIN_PER_MODULE = 2;

  let examSession = null; // { questions, answers:{qid:answer}, flagged:Set, current }

  const EXAM_SESSION_VERSION = 3;
  const EXAM_SESSION_KEY = 'pvzAcademyExamSession.v3';
  const LEGACY_EXAM_SESSION_KEYS = ['pvzAcademyExamSession.v2', 'pvzAcademyExamSession.v1'];

  function isValidExamQuestionSet(questions) {
    if (!Array.isArray(questions) || questions.length !== EXAM_SIZE_DEFAULT) return false;
    const ids = new Set();
    const moduleCounts = new Map(PVZ_MODULES.map(module => [module.id, 0]));
    for (const question of questions) {
      const sourceQuestion = question && PVZ_QUESTIONS.find(candidate => candidate.id === question.id);
      if (!sourceQuestion || ids.has(question.id) || !isScoredEligible(sourceQuestion)) return false;
      if (question.moduleId !== sourceQuestion.moduleId || question.type !== sourceQuestion.type) return false;
      if (!Array.isArray(question._options) && question.type !== 'branching') return false;
      if (question.type === 'branching' && (!Array.isArray(question.steps) || question.steps.length !== sourceQuestion.steps.length || question.steps.some(step => !Array.isArray(step._options) || !Number.isInteger(step._correct)))) return false;
      ids.add(question.id);
      moduleCounts.set(question.moduleId, (moduleCounts.get(question.moduleId) || 0) + 1);
    }
    return PVZ_MODULES.every(module => (moduleCounts.get(module.id) || 0) >= EXAM_MIN_PER_MODULE);
  }

  // Сохраняет состояние текущей попытки экзамена в sessionStorage, чтобы случайное
  // обновление страницы (F5) не обнуляло прогресс прохождения — сессия переживает
  // перезагрузку той же вкладки и автоматически исчезает при закрытии вкладки.
  function persistExamSession() {
    if (!examSession || examSession.lastResult) { clearExamSessionStorage(); return; }
    try {
      sessionStorage.setItem(EXAM_SESSION_KEY, JSON.stringify({
        version: EXAM_SESSION_VERSION,
        questions: examSession.questions,
        answers: examSession.answers,
        flagged: Array.from(examSession.flagged),
        current: examSession.current || 0,
      }));
    } catch (e) { console.error('Не удалось сохранить состояние экзамена', e); }
  }

  function loadExamSessionFromStorage() {
    try {
      const sourceKey = [EXAM_SESSION_KEY, ...LEGACY_EXAM_SESSION_KEYS].find(key => sessionStorage.getItem(key));
      const raw = sourceKey ? sessionStorage.getItem(sourceKey) : null;
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const currentVersionValid = sourceKey !== EXAM_SESSION_KEY || parsed.version === EXAM_SESSION_VERSION;
      if (!parsed || !currentVersionValid || !isValidExamQuestionSet(parsed.questions)) {
        clearExamSessionStorage();
        return null;
      }
      const validIds = new Set(parsed.questions.map(question => question.id));
      const restored = {
        questions: parsed.questions,
        answers: parsed.answers && typeof parsed.answers === 'object'
          ? Object.fromEntries(Object.entries(parsed.answers).filter(([id]) => validIds.has(id)))
          : {},
        flagged: new Set(Array.isArray(parsed.flagged) ? parsed.flagged.filter(id => validIds.has(id)) : []),
        current: Number.isInteger(parsed.current) && parsed.current >= 0 && parsed.current < parsed.questions.length ? parsed.current : 0,
      };
      restored.questions.forEach(q => {
        const answer = restored.answers[q.id];
        if (q.type === 'multi' && Array.isArray(answer)) restored.answers[q.id] = { value: answer, confirmed: true };
      });
      if (sourceKey !== EXAM_SESSION_KEY) {
        sessionStorage.setItem(EXAM_SESSION_KEY, JSON.stringify({
          version: EXAM_SESSION_VERSION,
          questions: restored.questions,
          answers: restored.answers,
          flagged: Array.from(restored.flagged),
          current: restored.current,
        }));
        LEGACY_EXAM_SESSION_KEYS.forEach(key => sessionStorage.removeItem(key));
      }
      return restored;
    } catch (e) { clearExamSessionStorage(); return null; }
  }

  function clearExamSessionStorage() {
    try {
      sessionStorage.removeItem(EXAM_SESSION_KEY);
      LEGACY_EXAM_SESSION_KEYS.forEach(key => sessionStorage.removeItem(key));
    } catch (e) { /* noop */ }
  }

  // Meta-source описывает ограничения конспекта, а не проверяемые рабочие знания.
  function examPoolForModule(moduleId) { return questionsForModule(moduleId).filter(isScoredEligible); }

  function buildExam(size) {
    const byModule = {};
    PVZ_MODULES.forEach(m => { byModule[m.id] = examPoolForModule(m.id); });

    const selectedIds = new Set();
    const selected = [];

    // 1) минимум с каждой темы
    PVZ_MODULES.forEach(m => {
      const take = sample(byModule[m.id], Math.min(EXAM_MIN_PER_MODULE, byModule[m.id].length));
      take.forEach(q => { selectedIds.add(q.id); selected.push(q); });
    });

    let remaining = Math.max(0, size - selected.length);
    const totalWeight = PVZ_MODULES.reduce((s, m) => s + EXAM_WEIGHTS[m.id], 0);

    // 2) взвешенное распределение остатка (метод наибольшего остатка), с учётом доступности
    const quotas = PVZ_MODULES.map(m => {
      const available = byModule[m.id].filter(q => !selectedIds.has(q.id)).length;
      const raw = remaining * (EXAM_WEIGHTS[m.id] / totalWeight);
      return { id: m.id, base: Math.min(Math.floor(raw), available), frac: raw - Math.floor(raw), available };
    });
    let used = quotas.reduce((s, q) => s + q.base, 0);
    let leftover = remaining - used;
    quotas.sort((a, b) => b.frac - a.frac);
    for (let i = 0; leftover > 0 && quotas.length; i = (i + 1) % quotas.length) {
      const q = quotas[i];
      if (q.base < q.available) { q.base++; leftover--; }
      if (quotas.every(x => x.base >= x.available)) break;
    }
    quotas.forEach(q => {
      const pool = byModule[q.id].filter(x => !selectedIds.has(x.id));
      sample(pool, q.base).forEach(x => { selectedIds.add(x.id); selected.push(x); });
    });

    // 3) если банка не хватило на весь size — по возможности дозаполняем из оставшегося
    if (selected.length < size) {
      const rest = PVZ_QUESTIONS.filter(q => isScoredEligible(q) && !selectedIds.has(q.id));
      sample(rest, size - selected.length).forEach(q => { selectedIds.add(q.id); selected.push(q); });
    }

    return shuffled(selected).map(prepareInstance);
  }

  function renderExamIntro(main) {
    if (!examSession || examSession.lastResult) examSession = loadExamSessionFromStorage();
    const activeExam = examSession && !examSession.lastResult && isValidExamQuestionSet(examSession.questions);
    const attempts = STATE.examAttempts;
    const best = bestExamPercent();
    const activeCompleted = activeExam ? examSession.questions.filter(q => isAnswerComplete(q, examSession.answers[q.id])).length : 0;
    main.innerHTML = `
      <div class="page page-exam-intro">
        <div class="exam-intro-hero">
          <span class="eyebrow">Финальная проверка</span>
          <h1>Итоговый экзамен</h1>
          <p>60 вопросов по всем 15 темам. Ответы сохраняются в этой вкладке.</p>
        </div>
        ${activeExam ? `
        <section class="exam-resume-card" aria-labelledby="exam-resume-title">
          <div>
            <span class="status-pill">Экзамен в процессе</span>
            <h2 id="exam-resume-title">Вопрос ${examSession.current + 1} из ${examSession.questions.length}</h2>
            <p class="muted">Отвечено: ${activeCompleted} из ${examSession.questions.length}. Порядок вопросов и ответы сохранены.</p>
            <div class="progress-track"><div class="progress-fill" style="width:${pct(activeCompleted, examSession.questions.length)}%"></div></div>
          </div>
          <div class="resume-actions">
            <button class="btn btn-primary btn-lg" id="resume-exam-btn">${icon('arrowRight')}Продолжить экзамен</button>
            <button class="btn btn-ghost" id="start-exam-btn">Начать заново</button>
          </div>
        </section>` : ''}
        <div class="exam-info-grid">
          <div class="info-card">${icon('exam')}<div><strong>${Math.min(EXAM_SIZE_DEFAULT, PVZ_QUESTIONS.length)} вопросов</strong><span>случайно из банка ${PVZ_QUESTIONS.length}, с гарантированным покрытием всех 15 тем</span></div></div>
          <div class="info-card">${icon('star')}<div><strong>${EXAM_PASS_PERCENT}% — проходной балл этой обучалки</strong><span>это внутренний ориентир тренажёра, а не официальное правило Wildberries</span></div></div>
          <div class="info-card">${icon('layers')}<div><strong>Разные типы вопросов</strong><span>один ответ, несколько ответов, верно/неверно, порядок действий, мини-сценарии</span></div></div>
          <div class="info-card">${icon('flag')}<div><strong>Можно возвращаться к вопросам</strong><span>отмечайте «вернуться позже» и переходите между вопросами свободно</span></div></div>
        </div>
        ${attempts.length ? `
        <section class="section">
          <h2>История попыток</h2>
          <div class="attempts-list">
            ${attempts.slice().reverse().slice(0, 8).map(a => `
              <div class="attempt-row">
                <span class="score-chip ${scoreClass(a.percent)}">${a.percent}%</span>
                <span>${a.correct}/${a.total}</span>
                <span class="muted small">${formatDate(a.date)}</span>
              </div>`).join('')}
          </div>
          <p class="muted small">Лучший результат: <strong>${best}%</strong> · попыток: ${attempts.length}</p>
        </section>` : ''}
        <div class="quiz-actions">
          <a class="btn btn-ghost" href="#/review">${icon('book')}Повторение перед экзаменом</a>
          ${activeExam ? '' : `<button class="btn btn-primary btn-lg" id="start-exam-btn">${icon('exam')}Начать экзамен</button>`}
        </div>
      </div>`;
    const resumeBtn = $('#resume-exam-btn');
    if (resumeBtn) resumeBtn.addEventListener('click', () => navigate('#/exam/run'));
    $('#start-exam-btn').addEventListener('click', async () => {
      if (activeExam) {
        const confirmed = await openModal({
          title: 'Начать экзамен заново?',
          body: '<p>Текущая попытка и сохранённые в ней ответы будут удалены.</p><p><strong>Это действие нельзя отменить.</strong></p>',
          confirmText: 'Начать заново', destructive: true,
        });
        if (!confirmed) return;
      }
      examSession = { questions: buildExam(EXAM_SIZE_DEFAULT), answers: {}, flagged: new Set(), current: 0 };
      persistExamSession();
      navigate('#/exam/run');
    });
  }

  function renderExamRun(main) {
    if (!examSession) examSession = loadExamSessionFromStorage();
    if (!examSession) { navigate('#/exam'); return; }
    let current = Math.min(Math.max(examSession.current || 0, 0), examSession.questions.length - 1);
    renderCurrent();

    function renderCurrent() {
      const qs = examSession.questions;
      const qi = qs[current];
      const answered = isAnswerComplete(qi, examSession.answers[qi.id]);
      const completedCount = examSession.questions.filter(q => isAnswerComplete(q, examSession.answers[q.id])).length;

      main.innerHTML = `
        <div class="page exam-run">
          <div class="exam-topbar">
            <div class="exam-progress-text">Вопрос ${current + 1} из ${qs.length}</div>
            <button class="btn btn-ghost btn-sm" id="exam-nav-toggle">${icon('layers')}Список вопросов</button>
          </div>
          <div class="progress-track"><div class="progress-fill" style="width:${(completedCount / qs.length) * 100}%"></div></div>
          <div id="exam-navigator" class="exam-navigator" hidden></div>
          <div class="quiz-card">
            <div class="exam-card-head">
              <span class="type-chip">${TYPE_LABELS[qi.type]}</span>
              <button class="icon-btn flag-toggle ${examSession.flagged.has(qi.id) ? 'active' : ''}" id="flag-btn" aria-pressed="${examSession.flagged.has(qi.id)}">${icon('flag')}<span class="sr-only">Вернуться позже</span></button>
            </div>
            <h2 class="quiz-prompt" id="exam-question-heading" tabindex="-1">${escapeHtml(qi.prompt)}</h2>
            <div id="quiz-interaction"></div>
          </div>
          <div class="exam-bottom-nav">
            <button class="btn btn-ghost" id="exam-prev" ${current === 0 ? 'disabled' : ''}>${icon('chevron', 'rotate-180')}Назад</button>
            ${current === qs.length - 1
              ? `<button class="btn btn-primary" id="exam-submit" ${answered ? '' : 'disabled'}>${qi.type === 'multi' && !answered ? 'Подтвердить и завершить' : 'Завершить экзамен'}</button>`
              : `<button class="btn btn-primary" id="exam-next" ${answered ? '' : 'disabled'}>${qi.type === 'multi' && !answered ? 'Подтвердить и дальше' : 'Дальше'}</button>`}
          </div>
        </div>`;

      buildExamNavigator();

      if (qi.type === 'branching') {
        // В экзамене мини-сценарий проходится как последовательность обязательных под-выборов без немедленной обратной связи.
        renderExamBranching(qi);
      } else {
        const stored = examSession.answers[qi.id];
        const savedAns = stored && !Array.isArray(stored) && typeof stored === 'object' && Object.prototype.hasOwnProperty.call(stored, 'value') ? stored.value : stored;
        renderInteraction($('#quiz-interaction'), qi, savedAns, (ans, draftReady) => {
          examSession.answers[qi.id] = qi.type === 'multi' ? { value: ans, confirmed: false } : ans;
          updateNavigatorDot(current);
          const action = $('#exam-next') || $('#exam-submit');
          if (action) action.disabled = !draftReady;
          persistExamSession();
        });
      }

      $('#flag-btn').addEventListener('click', () => {
        if (examSession.flagged.has(qi.id)) examSession.flagged.delete(qi.id); else examSession.flagged.add(qi.id);
        $('#flag-btn').classList.toggle('active');
        updateNavigatorDot(current);
        persistExamSession();
      });
      $('#exam-nav-toggle').addEventListener('click', () => { const nav = $('#exam-navigator'); nav.hidden = !nav.hidden; });
      $('#exam-prev') && $('#exam-prev').addEventListener('click', () => { current--; examSession.current = current; persistExamSession(); renderCurrent(); focusQuestionHeading('exam-question-heading'); });
      const nextBtn = $('#exam-next'); if (nextBtn) nextBtn.addEventListener('click', () => {
        confirmCurrentMulti(qi);
        if (!isAnswerComplete(qi, examSession.answers[qi.id])) return;
        current++; examSession.current = current; persistExamSession(); renderCurrent(); focusQuestionHeading('exam-question-heading');
      });
      const submitBtn = $('#exam-submit'); if (submitBtn) submitBtn.addEventListener('click', () => { confirmCurrentMulti(qi); tryFinish(); });
    }

    function confirmCurrentMulti(qi) {
      const answer = examSession.answers[qi.id];
      if (qi.type === 'multi' && answer && Array.isArray(answer.value) && answer.value.length) answer.confirmed = true;
    }

    // Рендерит мини-сценарий (branching) в экзамене. Поддерживает возврат к вопросу:
    // - если сценарий пройден частично, продолжает с первого неотвеченного шага;
    // - если сценарий пройден полностью, показывает сводку выбранных ответов по каждому
    //   шагу (а не пустую карточку) и позволяет пройти сценарий заново, чтобы изменить ответы.
    function renderExamBranching(qi) {
      const key = qi.id;
      let saved = Array.isArray(examSession.answers[key]) ? examSession.answers[key].slice() : [];
      let stepIndex = saved.length;

      function renderSummary() {
        const rows = qi.steps.map((s, idx) => {
          const chosenIdx = saved[idx];
          const chosenText = (chosenIdx != null && s._options[chosenIdx] != null) ? s._options[chosenIdx] : '—';
          return `<div class="branch-row">
            <div class="branch-cond">Шаг ${idx + 1}. ${escapeHtml(s.prompt)}</div>
            <div class="branch-action">Ваш ответ: ${escapeHtml(chosenText)}</div>
          </div>`;
        }).join('');
        $('#quiz-interaction').innerHTML = `
          <p class="muted small">Сценарий пройден полностью (${qi.steps.length} из ${qi.steps.length} шагов).</p>
          <div class="branch-list">${rows}</div>
          <button type="button" class="btn btn-ghost btn-sm" id="branch-redo-btn" style="margin-top:12px">${icon('chevron', 'rotate-180')}Пройти сценарий заново</button>
        `;
        const redoBtn = $('#branch-redo-btn');
        const action = $('#exam-next') || $('#exam-submit');
        if (action) action.disabled = false;
        if (redoBtn) redoBtn.addEventListener('click', () => {
          saved = [];
          stepIndex = 0;
          examSession.answers[key] = saved;
          if (action) action.disabled = true;
          updateNavigatorDot(current);
          persistExamSession();
          renderStep();
        });
      }

      function renderStep() {
        if (stepIndex >= qi.steps.length) {
          examSession.answers[key] = saved;
          updateNavigatorDot(current);
          persistExamSession();
          renderSummary();
          return;
        }
        const s = qi.steps[stepIndex];
        $('#quiz-interaction').innerHTML = `<p class="muted small">Шаг ${stepIndex + 1} из ${qi.steps.length}</p><p class="step-prompt"><strong>${escapeHtml(s.prompt)}</strong></p><div class="choice-list" id="branch-choices" role="radiogroup"></div><button class="btn btn-primary" id="exam-branch-step" hidden style="margin-top:12px">${stepIndex === qi.steps.length - 1 ? 'Завершить сценарий' : 'Следующий шаг'}</button>`;
        const list = $('#branch-choices');
        let selected = Number.isInteger(saved[stepIndex]) ? saved[stepIndex] : null;
        s._options.forEach((opt, i) => {
          const b = document.createElement('button');
          b.type = 'button'; b.className = 'choice-option'; b.setAttribute('role', 'radio');
          const isSel = saved[stepIndex] === i;
          b.setAttribute('aria-checked', String(isSel));
          if (isSel) b.classList.add('selected');
          b.innerHTML = `<span class="choice-mark"></span><span>${escapeHtml(opt)}</span>`;
          b.addEventListener('click', () => {
            $all('.choice-option', list).forEach(el => { el.classList.remove('selected'); el.setAttribute('aria-checked', 'false'); });
            b.classList.add('selected'); b.setAttribute('aria-checked', 'true');
            selected = i;
            saved[stepIndex] = i;
            saved = saved.slice(0, stepIndex + 1);
            examSession.answers[key] = saved.slice();
            updateNavigatorDot(current);
            persistExamSession();
            $('#exam-branch-step').hidden = false;
          });
          list.appendChild(b);
        });
        if (Number.isInteger(selected)) $('#exam-branch-step').hidden = false;
        $('#exam-branch-step').addEventListener('click', () => {
          if (!Number.isInteger(selected)) return;
          if (stepIndex < qi.steps.length - 1) { stepIndex++; renderStep(); }
          else { stepIndex++; renderSummary(); }
        });
      }
      renderStep();
    }

    function buildExamNavigator() {
      const nav = $('#exam-navigator');
      nav.innerHTML = examSession.questions.map((q, i) => {
        const state = isAnswerComplete(q, examSession.answers[q.id]) ? 'answered' : 'unanswered';
        const flagged = examSession.flagged.has(q.id) ? 'flagged' : '';
        return `<button class="exam-nav-dot ${state} ${flagged}" data-i="${i}" aria-label="Вопрос ${i + 1}${state === 'answered' ? ', отвечен' : ', без ответа'}">${i + 1}</button>`;
      }).join('');
      $all('.exam-nav-dot', nav).forEach(btn => btn.addEventListener('click', () => {
        const target = Number(btn.getAttribute('data-i'));
        const currentQuestion = examSession.questions[current];
        if (target > current && !isAnswerComplete(currentQuestion, examSession.answers[currentQuestion.id])) return;
        current = target; examSession.current = current; persistExamSession(); renderCurrent(); focusQuestionHeading('exam-question-heading');
      }));
    }
    function updateNavigatorDot(i) {
      const btn = $(`.exam-nav-dot[data-i="${i}"]`);
      if (!btn) return;
      const q = examSession.questions[i];
      const complete = isAnswerComplete(q, examSession.answers[q.id]);
      btn.classList.toggle('answered', complete);
      btn.setAttribute('aria-label', `Вопрос ${i + 1}${complete ? ', отвечен' : ', без ответа'}`);
      btn.classList.toggle('flagged', examSession.flagged.has(q.id));
    }

    async function tryFinish() {
      const total = examSession.questions.length;
      const answeredCount = examSession.questions.filter(q => isAnswerComplete(q, examSession.answers[q.id])).length;
      if (answeredCount < total) {
        const missing = total - answeredCount;
        await openModal({
          title: 'Экзамен ещё не завершён',
          body: `<p>Чтобы завершить экзамен, ответьте ещё на <strong>${missing}</strong> вопрос(ов).</p>`,
          confirmText: 'Понятно', showCancel: false,
        });
        return;
      }
      finishExam();
    }

    function finishExam() {
      let correct = 0;
      const byModule = {};
      const wrongIds = [];
      examSession.questions.forEach(qi => {
        byModule[qi.moduleId] = byModule[qi.moduleId] || { correct: 0, total: 0 };
        byModule[qi.moduleId].total++;
        const ans = examSession.answers[qi.id];
        let ok = false;
        if (qi.type === 'branching') {
          ok = Array.isArray(ans) && ans.length === qi.steps.length && ans.every((a, idx) => a === qi.steps[idx]._correct);
        } else {
          ok = isAnswerCorrect(qi, ans);
        }
        if (ok) { correct++; byModule[qi.moduleId].correct++; clearMistake(qi.id); }
        else { wrongIds.push(qi.id); recordMistake(qi); }
      });
      const percent = pct(correct, examSession.questions.length);
      STATE.examAttempts.forEach(previous => {
        delete previous.answers;
        delete previous.questions;
        delete previous.reviewQuestions;
      });
      const attempt = {
        date: new Date().toISOString(),
        correct,
        incorrect: examSession.questions.length - correct,
        unanswered: 0,
        total: examSession.questions.length,
        percent,
        byModule,
        wrongIds,
        answers: examSession.answers,
        reviewQuestions: examSession.questions.filter(q => wrongIds.includes(q.id)),
      };
      STATE.examAttempts.push(attempt);
      saveState();
      examSession.lastResult = attempt;
      clearExamSessionStorage();
      navigate('#/exam/result');
    }
  }

  function renderExamResult(main) {
    const attempt = examSession && examSession.lastResult ? examSession.lastResult : STATE.examAttempts[STATE.examAttempts.length - 1];
    if (!attempt) { navigate('#/exam'); return; }
    const moduleBreakdown = PVZ_MODULES.map(m => {
      const b = attempt.byModule[m.id];
      return { module: m, percent: b ? pct(b.correct, b.total) : null, total: b ? b.total : 0 };
    }).filter(x => x.total > 0);
    const strongest = moduleBreakdown.slice().sort((a, b) => b.percent - a.percent).slice(0, 3);
    const weakest = moduleBreakdown.slice().sort((a, b) => a.percent - b.percent).slice(0, 3);
    const reviewQuestions = examSession && examSession.questions
      ? examSession.questions
      : (Array.isArray(attempt.reviewQuestions)
        ? attempt.reviewQuestions
        : (Array.isArray(attempt.questions) ? attempt.questions : PVZ_QUESTIONS));
    const wrongQs = reviewQuestions.filter(q => attempt.wrongIds.includes(q.id));
    const passed = attempt.percent >= EXAM_PASS_PERCENT;

    main.innerHTML = `
      <div class="page exam-result">
        <div class="result-hero ${passed ? 'good' : scoreClass(attempt.percent)}">
          <div class="result-percent">${attempt.percent}%</div>
          <div class="result-sub">${attempt.correct} из ${attempt.total} правильно</div>
          <div class="result-pass ${passed ? 'good' : 'bad'}">${passed ? icon('check') + 'Экзамен сдан' : icon('x') + 'Ниже проходного балла'} · порог этой обучалки ${EXAM_PASS_PERCENT}%</div>
        </div>

        <section class="section">
          <h2>Разбивка по темам</h2>
          <div class="breakdown-list">
            ${moduleBreakdown.map(x => `
              <div class="breakdown-row">
                <span class="breakdown-name">${x.module.id}. ${escapeHtml(x.module.title)}</span>
                <div class="progress-track thin"><div class="progress-fill ${scoreClass(x.percent)}" style="width:${x.percent}%"></div></div>
                <span class="score-chip ${scoreClass(x.percent)}">${x.percent}%</span>
              </div>`).join('')}
          </div>
        </section>

        <section class="section two-col">
          <div>
            <h2>Сильные темы</h2>
            <ul class="plain-list">${strongest.map(x => `<li>${escapeHtml(x.module.title)} — ${x.percent}%</li>`).join('')}</ul>
          </div>
          <div>
            <h2>Слабые темы</h2>
            <ul class="plain-list">${weakest.map(x => `<li>${escapeHtml(x.module.title)} — ${x.percent}%</li>`).join('')}</ul>
          </div>
        </section>

        ${wrongQs.length ? `
        <section class="section">
          <h2>Разбор ошибок (${wrongQs.length})</h2>
          <div class="review-list">
            ${wrongQs.map(q => `
              <div class="review-item">
                <p class="review-prompt">${escapeHtml(q.prompt)}</p>
                 ${attempt.answers ? renderAnswerReview(q, attempt.answers[q.id]) : ''}
                 <p class="review-explain"><strong>Почему:</strong> ${escapeHtml(q.explanation)}</p>
                ${q.relatedBlockId ? `<a class="btn btn-ghost btn-sm" href="#/module/${q.moduleId}?block=${q.relatedBlockId}">Открыть материал</a>` : ''}
              </div>`).join('')}
          </div>
        </section>` : `<p class="empty-note">${icon('check')} Ни одной ошибки — превосходно!</p>`}

        <div class="quiz-actions">
          <a class="btn btn-ghost" id="result-back" href="#/exam">${icon('chevron', 'rotate-180')}Вернуться к экзамену</a>
          <a class="btn btn-ghost" href="#/mistakes">${icon('warn')}Повторить ошибки</a>
          <button class="btn btn-primary" id="new-exam-btn">${icon('exam')}Новый экзамен</button>
        </div>
      </div>`;
    $('#new-exam-btn').addEventListener('click', () => {
      examSession = { questions: buildExam(EXAM_SIZE_DEFAULT), answers: {}, flagged: new Set(), current: 0 };
      persistExamSession();
      navigate('#/exam/run');
    });
  }

  function renderPreExamReview(main) {
    main.innerHTML = `
      <div class="page">
        <div class="page-head"><h1>Повторение перед экзаменом</h1><p class="muted">Ключевые сроки, числа, запреты и исключения — не заменяет полный курс.</p></div>
        <section class="section">
          <h2>${icon('hash')}Ключевые числа и сроки</h2>
          <div class="numbers-grid">${sample(PVZ_NUMBERS, PVZ_NUMBERS.length).map(renderNumberCard).join('')}</div>
        </section>
        <section class="section">
          <h2>${icon('warn')}Расхождение в обучении</h2>
          <div class="callout callout-warn">${icon('warn')}<div>${escapeHtml(blockById('discrepancy-summary').body)}</div></div>
        </section>
        <section class="section">
          <h2>${icon('alert')}Похожие типы брака — не перепутайте</h2>
          <div class="compare-grid compare-cols-2">
            <div class="compare-col"><div class="compare-col-title">Дыра</div><ul><li>${escapeHtml(defectById('hole').signs)}</li></ul></div>
            <div class="compare-col"><div class="compare-col-title">Порез</div><ul><li>${escapeHtml(defectById('cut').signs)}</li></ul></div>
          </div>
          <div class="compare-grid compare-cols-2" style="margin-top:12px">
            <div class="compare-col"><div class="compare-col-title">Разрыв шва</div><ul><li>${escapeHtml(defectById('seam-tear').signs)}</li></ul></div>
            <div class="compare-col"><div class="compare-col-title">Дефекты швов</div><ul><li>${escapeHtml(defectById('seam-defect').signs)}</li></ul></div>
          </div>
        </section>
        <div class="quiz-actions"><a class="btn btn-primary" href="#/exam">${icon('exam')}К экзамену</a></div>
      </div>`;
  }

  /* ===================== ЧИСЛА И СРОКИ ===================== */

  function renderNumberCard(n) {
    const m = moduleById(n.moduleId);
    return `
      <a class="number-card" href="#/module/${n.moduleId}?block=${n.blockId}">
        <div class="number-value">${escapeHtml(n.value)}</div>
        <div class="number-context">${escapeHtml(n.context)}</div>
        <div class="number-source">${m ? m.id + '. ' + escapeHtml(m.title) : ''}</div>
      </a>`;
  }

  function renderNumbers(main) {
    const modules = ['all'].concat(PVZ_MODULES.map(m => m.id));
    main.innerHTML = `
      <div class="page">
        <div class="page-head"><h1>Числа и сроки</h1><p class="muted">${PVZ_NUMBERS.length} проверенных по источнику карточек со сроками, лимитами и порогами.</p></div>
        <div class="filter-row" id="numbers-filter">
          <button class="filter-chip active" data-m="all">Все темы</button>
          ${PVZ_MODULES.map(m => `<button class="filter-chip" data-m="${m.id}">${m.id}</button>`).join('')}
        </div>
        <div class="numbers-grid" id="numbers-grid"></div>
      </div>`;
    function draw(filter) {
      const list = filter === 'all' ? PVZ_NUMBERS : PVZ_NUMBERS.filter(n => n.moduleId === Number(filter));
      $('#numbers-grid').innerHTML = list.map(renderNumberCard).join('') || '<p class="muted">Нет карточек для этой темы.</p>';
    }
    $('#numbers-filter').addEventListener('click', e => {
      const btn = e.target.closest('.filter-chip'); if (!btn) return;
      $all('.filter-chip', $('#numbers-filter')).forEach(b => b.classList.toggle('active', b === btn));
      draw(btn.getAttribute('data-m'));
    });
    draw('all');
  }

  /* ===================== СПРАВОЧНИК БРАКА ===================== */

  function defectCategories() { return Array.from(new Set(PVZ_DEFECTS.map(d => d.category))); }

  function renderDefectCard(d) {
    const rows = [];
    if (d.signs) rows.push(['Признаки', d.signs]);
    if (d.isDefect) rows.push(['Когда считается браком', d.isDefect]);
    if (d.notDefect) rows.push(['Когда НЕ считается браком', d.notDefect]);
    if (d.exception) rows.push(['Исключение', d.exception]);
    if (d.numberNote) rows.push(['Числовое условие', d.numberNote]);
    if (d.mistake) rows.push(['Частая ошибка', d.mistake]);
    if (d.gap) rows.push(['Пробел источника', d.gap]);
    const confused = (d.confusedWith || []).map(id => defectById(id)).filter(Boolean);
    return `
      <article class="defect-card" id="defect-${d.id}" data-name="${escapeHtml(d.name.toLowerCase())}">
        <div class="defect-card-head">
          <span class="defect-category-chip">${escapeHtml(d.category)}</span>
          <a class="icon-btn" href="#/module/${d.moduleId}?block=${d.blockId}" aria-label="Открыть материал темы">${icon('arrowRight')}</a>
        </div>
        <h3>${escapeHtml(d.name)}</h3>
        <dl class="defect-facts">
          ${rows.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('')}
        </dl>
        ${confused.length ? `<div class="confused-with"><span>Легко перепутать с:</span> ${confused.map(c => `<button class="chip-link" data-goto="defect-${c.id}">${escapeHtml(c.name)}</button>`).join('')}</div>` : ''}
      </article>`;
  }

  function renderDefects(main, params) {
    const cats = defectCategories();
    main.innerHTML = `
      <div class="page">
        <div class="page-head"><h1>Справочник брака</h1><p class="muted">Темы 14–15 источника: только доступные в материале поля, без домыслов.</p></div>
        <div class="filter-row" id="defect-filter">
          <button class="filter-chip active" data-c="all">Все категории</button>
          ${cats.map(c => `<button class="filter-chip" data-c="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join('')}
        </div>
        <div class="defect-grid" id="defect-grid"></div>
      </div>`;
    function draw(cat) {
      const list = cat === 'all' ? PVZ_DEFECTS : PVZ_DEFECTS.filter(d => d.category === cat);
      $('#defect-grid').innerHTML = list.map(renderDefectCard).join('');
    }
    $('#defect-filter').addEventListener('click', e => {
      const btn = e.target.closest('.filter-chip'); if (!btn) return;
      $all('.filter-chip', $('#defect-filter')).forEach(b => b.classList.toggle('active', b === btn));
      draw(btn.getAttribute('data-c'));
    });
    $('#defect-grid').addEventListener('click', e => {
      const btn = e.target.closest('.chip-link'); if (!btn) return;
      const target = document.getElementById(btn.getAttribute('data-goto'));
      if (target) { target.scrollIntoView({ behavior: 'smooth', block: 'center' }); target.classList.add('flash'); setTimeout(() => target.classList.remove('flash'), 1200); }
    });
    draw(params && params.cat ? params.cat : 'all');
  }

  /* ===================== ЗАКЛАДКИ ===================== */

  function renderBookmarks(main) {
    const ids = Object.keys(STATE.bookmarks);
    if (!ids.length) {
      main.innerHTML = `<div class="page"><div class="empty-state">${icon('bookmark')}<h2>Закладок пока нет</h2><p class="muted">Нажмите на значок закладки у любого блока материала, чтобы быстро вернуться к нему позже.</p><a class="btn btn-primary" href="#/modules">К темам</a></div></div>`;
      return;
    }
    const blocks = ids.map(blockById).filter(Boolean);
    main.innerHTML = `
      <div class="page">
        <div class="page-head"><h1>Закладки</h1><p class="muted">${blocks.length} сохранённых блоков материала.</p></div>
        <div class="block-list" id="bookmarks-list">
          ${blocks.map(b => {
            const m = moduleById(b.moduleId);
            return `
            <article class="block-card block-${b.type}">
              <header class="block-card-head">
                <span class="block-type-badge">${icon(BLOCK_TYPE_ICONS[b.type] || 'info')}${BLOCK_TYPE_LABELS[b.type] || b.type}</span>
                <button class="icon-btn bookmark-toggle active" data-block="${b.id}" aria-pressed="true" aria-label="Убрать из закладок">${icon('bookmark')}</button>
              </header>
              <p class="muted small">${m.id}. ${escapeHtml(m.title)}</p>
              <h3>${escapeHtml(b.title)}</h3>
              <div class="block-body">${renderBlockContent(b)}</div>
              <a class="btn btn-ghost btn-sm" href="#/module/${b.moduleId}?block=${b.id}">Открыть в теме</a>
            </article>`;
          }).join('')}
        </div>
      </div>`;
    $('#bookmarks-list').addEventListener('click', e => {
      const btn = e.target.closest('.bookmark-toggle'); if (!btn) return;
      toggleBookmark(btn.getAttribute('data-block'));
      renderBookmarks(main);
    });
  }

  /* ===================== ПОИСК ===================== */

  function normalizeSearch(s) { return s.toLowerCase().replace(/ё/g, 'е'); }

  function searchableBlockText(block) {
    const developerOnlyKeys = new Set(['id', 'moduleId', 'blockId', 'relatedBlockId', 'type', 'correct', 'difficulty', 'tags', '_displayOrder', '_correct']);
    const collect = value => {
      if (typeof value === 'string' || typeof value === 'number') return String(value);
      if (Array.isArray(value)) return value.map(collect).join(' ');
      if (value && typeof value === 'object') return Object.keys(value)
        .filter(key => !developerOnlyKeys.has(key))
        .map(key => collect(value[key])).join(' ');
      return '';
    };
    return collect(block);
  }

  function renderSearch(main, params) {
    const q = (params && params.q) || '';
    main.innerHTML = `
      <div class="page">
        <div class="page-head"><h1>Поиск по материалу</h1></div>
        <form class="search-form-inline" id="search-inline-form">
          ${icon('search')}
          <input id="search-inline-input" type="search" value="${escapeHtml(q)}" placeholder="Например: IMEI, DBS, 14 дней, пломба" />
          <button class="search-clear" id="search-clear-btn" type="button" aria-label="Очистить поиск" ${q ? '' : 'hidden'}>${icon('x')}</button>
        </form>
        <div id="search-results"></div>
      </div>`;
    function runSearch(query) {
      const results = $('#search-results');
      if (!query.trim()) { results.innerHTML = '<p class="muted">Введите запрос — например «IMEI», «TRBX», «14 дней», «DBS», «пломба».</p>'; return; }
      const needle = normalizeSearch(query.trim());
      const blockHits = PVZ_BLOCKS.filter(b => {
        const hay = normalizeSearch(searchableBlockText(b));
        return hay.includes(needle);
      });
      const defectHits = PVZ_DEFECTS.filter(d => normalizeSearch(searchableBlockText(d)).includes(needle));
      const numberHits = PVZ_NUMBERS.filter(n => normalizeSearch(n.value + ' ' + n.context).includes(needle));
      const questionHits = PVZ_QUESTIONS.filter(question => isScoredEligible(question) && normalizeSearch(searchableBlockText(question)).includes(needle));

      if (!blockHits.length && !defectHits.length && !numberHits.length && !questionHits.length) {
        results.innerHTML = `<div class="empty-state">${icon('search')}<h2>Ничего не найдено</h2><p class="muted">Попробуйте другой запрос.</p></div>`;
        return;
      }
      results.innerHTML = `
        ${numberHits.length ? `<section class="section"><h2>Числа и сроки (${numberHits.length})</h2><div class="numbers-grid">${numberHits.map(renderNumberCard).join('')}</div></section>` : ''}
        ${defectHits.length ? `<section class="section"><h2>Справочник брака (${defectHits.length})</h2><div class="defect-grid">${defectHits.map(renderDefectCard).join('')}</div></section>` : ''}
        ${questionHits.length ? `<section class="section"><h2>Вопросы тренажёра (${questionHits.length})</h2><div class="block-list">${questionHits.map(question => {
          const module = moduleById(question.moduleId);
          return `<a class="search-hit" href="#/module/${question.moduleId}?block=${question.relatedBlockId}">
            <span class="block-type-badge">${icon('exam')}${TYPE_LABELS[question.type] || 'Вопрос'}</span>
            <strong>${escapeHtml(question.prompt)}</strong>
            <span class="muted small">${module.id}. ${escapeHtml(module.title)}</span>
          </a>`;
        }).join('')}</div></section>` : ''}
        ${blockHits.length ? `<section class="section"><h2>Материал тем (${blockHits.length})</h2><div class="block-list">${blockHits.map(b => {
          const m = moduleById(b.moduleId);
          return `<a class="search-hit" href="#/module/${b.moduleId}?block=${b.id}">
            <span class="block-type-badge">${icon(BLOCK_TYPE_ICONS[b.type] || 'info')}${BLOCK_TYPE_LABELS[b.type] || b.type}</span>
            <strong>${escapeHtml(b.title)}</strong>
            <span class="muted small">${m.id}. ${escapeHtml(m.title)}</span>
          </a>`;
        }).join('')}</div></section>` : ''}
      `;
    }
    $('#search-inline-form').addEventListener('submit', e => { e.preventDefault(); navigate('#/search?q=' + encodeURIComponent($('#search-inline-input').value)); });
    const searchInput = $('#search-inline-input');
    const clearButton = $('#search-clear-btn');
    searchInput.addEventListener('input', () => { clearButton.hidden = !searchInput.value; });
    clearButton.addEventListener('click', () => {
      searchInput.value = '';
      clearButton.hidden = true;
      runSearch('');
      searchInput.focus();
    });
    runSearch(q);
  }

  /* ===================== DEV VALIDATION (см. также _validate.js) ===================== */

  function devValidateContent() {
    const moduleIds = new Set(PVZ_MODULES.map(m => m.id));
    const blockIds = new Set();
    PVZ_BLOCKS.forEach(b => {
      if (blockIds.has(b.id)) console.error('[validate] Дублирующийся id блока:', b.id);
      blockIds.add(b.id);
      if (!moduleIds.has(b.moduleId)) console.error('[validate] Блок ссылается на несуществующий модуль:', b.id, b.moduleId);
    });
    const qIds = new Set();
    PVZ_QUESTIONS.forEach(q => {
      if (qIds.has(q.id)) console.error('[validate] Дублирующийся id вопроса:', q.id);
      qIds.add(q.id);
      if (!moduleIds.has(q.moduleId)) console.error('[validate] Вопрос ссылается на несуществующий модуль:', q.id);
      if (q.relatedBlockId && !blockIds.has(q.relatedBlockId)) console.error('[validate] Вопрос ссылается на несуществующий блок:', q.id, q.relatedBlockId);
      if (!q.explanation) console.error('[validate] Вопрос без объяснения:', q.id);
      if (!['single', 'multi', 'boolean', 'sequence', 'branching'].includes(q.type)) console.error('[validate] Неизвестный тип вопроса:', q.id, q.type);
      if (q.type === 'branching') return;
      if (!Array.isArray(q.options) || q.options.length < 2) { console.error('[validate] Менее 2 вариантов:', q.id); return; }
      if (new Set(q.options.map(o => o.trim().toLowerCase())).size !== q.options.length) console.error('[validate] Повторяющиеся варианты ответа:', q.id);
      if (q.options.some(o => !o || !o.trim())) console.error('[validate] Пустой вариант ответа:', q.id);
      if (!Array.isArray(q.correct) || !q.correct.length) console.error('[validate] Нет правильного ответа:', q.id);
      if (q.type === 'single' && q.correct.length !== 1) console.error('[validate] single должен иметь ровно 1 правильный ответ:', q.id);
      if (q.type === 'multi' && q.correct.length < 2) console.error('[validate] multi должен иметь минимум 2 правильных ответа:', q.id);
      if (q.type === 'boolean' && (q.options.length !== 2 || q.correct.length !== 1)) console.error('[validate] некорректный boolean-вопрос:', q.id);
    });
  }

  /* ===================== ИНИЦИАЛИЗАЦИЯ ===================== */

  function init() {
    renderShell();
    devValidateContent();
    onRouteChange();
  }

  window.PVZAcademyCore = Object.freeze({ QUIZ_MODES, PROGRESS, isAnswerComplete, isAnswerCorrect, buildResult, buildExam, isScoredEligible, isValidExamQuestionSet, quickCheckCandidatesForModule, searchableBlockText });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();
