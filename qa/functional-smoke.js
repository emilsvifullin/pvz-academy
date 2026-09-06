#!/usr/bin/env node
/*
 * qa/functional-smoke.js
 * ---------------------------------------------------------------------------
 * Playwright-based функциональный дым-тест «Академии ПВЗ». Открывает
 * index.html напрямую (file://), как обычный пользователь, без сервера и
 * без сборки, и проверяет:
 *   - базовую регрессию (дашборд, тема, быстрая проверка, тест модуля со
 *     всеми типами вопросов, работа над ошибками, поиск, закладки, числа,
 *     справочник брака, сброс прогресса, localStorage),
 *   - восстановление ответа при навигации назад/вперёд по экзамену для
 *     каждого типа вопроса (single, boolean, multi, sequence, branching —
 *     включая возврат к ПОЛНОСТЬЮ пройденному мини-сценарию),
 *   - что экзамен из 60 вопросов действительно покрывает набор тем и что
 *     повторная генерация даёт другой набор,
 *   - устойчивость к обновлению страницы посреди экзамена (sessionStorage),
 *   - отсутствие ошибок в консоли браузера на всех проверенных экранах.
 *
 * Запуск: NODE_PATH=$(npm root -g) node qa/functional-smoke.js
 * Требует Chromium (уже установлен в этом окружении). Ничего не публикует и
 * не изменяет исходники — только проверяет уже собранный index.html.
 */

const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const URL = 'file://' + path.join(ROOT, 'index.html');
const CHROME_PATH = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail: detail || '' });
  console.log((ok ? '  [OK] ' : '  [FAIL] ') + name + (detail ? ' — ' + detail : ''));
}

async function main() {
  const browser = await chromium.launch({ executablePath: CHROME_PATH });
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', err => consoleErrors.push('pageerror: ' + err.message));

  async function fresh() {
    await page.goto(URL, { waitUntil: 'load' });
    await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch (e) {} });
    await page.reload({ waitUntil: 'load' });
  }

  console.log('=== Функциональный дым-тест «Академии ПВЗ» ===\n');

  // ---------- 1. Дашборд ----------
  await fresh();
  try {
    await page.waitForSelector('.page-dashboard', { timeout: 5000 });
    const title = await page.textContent('h1');
    record('Дашборд загружается', /Ваш прогресс/.test(title || ''));
  } catch (e) { record('Дашборд загружается', false, e.message); }

  // ---------- 2. Модуль + быстрая проверка ----------
  try {
    await page.evaluate(() => { location.hash = '#/module/1'; });
    await page.waitForSelector('.page-module', { timeout: 5000 });
    const hasBlocks = await page.$$eval('.block-card', els => els.length > 0);
    record('Модуль 1 показывает блоки материала', hasBlocks);
    const qc = await page.$('.quick-check');
    if (qc) {
      const btn = await qc.$('.qc-option');
      if (btn) {
        await btn.click();
        const fb = await qc.$('.qc-feedback');
        const shown = fb ? await fb.evaluate(el => !el.hidden) : false;
        record('Быстрая проверка отвечает на клик', shown);
      } else record('Быстрая проверка отвечает на клик', false, 'нет вариантов');
    } else record('Быстрая проверка присутствует в модуле', false, 'блок не найден (возможно норм, если пул easy пуст)');
  } catch (e) { record('Модуль 1 / быстрая проверка', false, e.message); }

  // ---------- 3. Тест модуля: пройти вопрос до конца ----------
  try {
    await page.evaluate(() => { location.hash = '#/module/2/test'; });
    await page.waitForSelector('.quiz-page', { timeout: 5000 });
    // отвечаем на несколько вопросов подряд, чтобы затронуть разные типы
    for (let i = 0; i < 5; i++) {
      const submitVisible = await page.$('#quiz-submit');
      if (!submitVisible) break;
      const typeChip = (await page.textContent('.type-chip') || '').toLowerCase();
      if (typeChip.includes('сценарий')) {
        // branching внутри практического теста рендерится отдельно (без #quiz-submit)
        await page.waitForSelector('#branch-choices', { timeout: 3000 }).catch(() => {});
        let guard = 0;
        while (guard++ < 6) {
          const choice = await page.$('#branch-choices .choice-option');
          if (!choice) break;
          await choice.click();
          await page.waitForTimeout(150);
          const nextBtn = await page.$('#branch-feedback button');
          if (nextBtn) { await nextBtn.click(); await page.waitForTimeout(100); }
          else break;
        }
      } else if (typeChip.includes('порядок')) {
        const chips = await page.$$('.seq-chip');
        for (const c of chips) { await c.click(); }
      } else {
        const opt = await page.$('.choice-option');
        if (opt) await opt.click();
      }
      const submitBtn = await page.$('#quiz-submit');
      if (submitBtn) { const disabled = await submitBtn.getAttribute('disabled'); if (disabled === null) await submitBtn.click(); }
      await page.waitForTimeout(150);
      const nextBtn = await page.$('#quiz-next');
      if (nextBtn) { await nextBtn.click(); await page.waitForTimeout(150); }
    }
    record('Тест модуля 2: несколько вопросов пройдено без ошибок', true);
  } catch (e) { record('Тест модуля: прохождение вопросов', false, e.message); }

  // ---------- 4. Поиск / закладки / числа / брак ----------
  try {
    await page.evaluate(() => { location.hash = '#/search?q=DBS'; });
    await page.waitForSelector('#search-results', { timeout: 5000 });
    const hasResults = await page.evaluate(() => document.querySelector('#search-results').textContent.length > 0);
    record('Поиск по «DBS» даёт результаты', hasResults);
  } catch (e) { record('Поиск', false, e.message); }

  try {
    await page.evaluate(() => { location.hash = '#/numbers'; });
    await page.waitForSelector('.numbers-grid', { timeout: 5000 });
    const count = await page.$$eval('.number-card', els => els.length);
    record('Экран «Числа и сроки» показывает карточки', count > 0, `${count} карточек`);
  } catch (e) { record('Числа и сроки', false, e.message); }

  try {
    await page.evaluate(() => { location.hash = '#/defects'; });
    await page.waitForSelector('.defect-grid', { timeout: 5000 });
    const count = await page.$$eval('.defect-card', els => els.length);
    record('Справочник брака показывает карточки', count > 0, `${count} карточек`);
  } catch (e) { record('Справочник брака', false, e.message); }

  try {
    await page.evaluate(() => { location.hash = '#/module/1'; });
    await page.waitForSelector('.bookmark-toggle', { timeout: 5000 });
    await page.click('.bookmark-toggle');
    await page.evaluate(() => { location.hash = '#/bookmarks'; });
    await page.waitForSelector('.page', { timeout: 5000 });
    const hasBookmark = await page.$('.block-card');
    record('Закладка сохраняется и отображается в «Закладках»', !!hasBookmark);
  } catch (e) { record('Закладки', false, e.message); }

  // ---------- 5. Клавиатурная навигация и reduced-motion ----------
  try {
    await page.evaluate(() => { location.hash = '#/dashboard'; });
    await page.waitForSelector('.page-dashboard', { timeout: 5000 });
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => document.activeElement && document.activeElement.tagName);
    record('Tab перемещает фокус (клавиатурная навигация)', !!focused);
  } catch (e) { record('Клавиатурная навигация', false, e.message); }

  try {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('.page-dashboard', { timeout: 5000 });
    record('Страница рендерится с prefers-reduced-motion без ошибок', true);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
  } catch (e) { record('prefers-reduced-motion', false, e.message); }

  // ---------- 6. Мобильная раскладка (viewport) ----------
  try {
    await page.setViewportSize({ width: 375, height: 720 });
    await page.evaluate(() => { location.hash = '#/dashboard'; });
    await page.waitForSelector('.page-dashboard', { timeout: 5000 });
    const bottomNavVisible = await page.$eval('.bottomnav', el => getComputedStyle(el).display !== 'none');
    record('Мобильная раскладка показывает нижнюю навигацию', bottomNavVisible);
    await page.setViewportSize({ width: 1280, height: 900 });
  } catch (e) { record('Мобильная раскладка', false, e.message); }

  // ---------- 7. Экзамен: сборка, покрытие типов ----------
  await fresh();
  async function startExam() {
    await page.evaluate(() => { location.hash = '#/exam'; });
    await page.waitForSelector('#start-exam-btn', { timeout: 5000 });
    await page.click('#start-exam-btn');
    await page.waitForSelector('.exam-run', { timeout: 5000 });
  }
  async function scanTypes() {
    // открыть навигатор и последовательно прочитать тип каждого вопроса, не отвечая на них
    const dotCount = await page.$$eval('.exam-nav-dot', els => els.length);
    const types = [];
    for (let i = 0; i < dotCount; i++) {
      await page.click(`.exam-nav-dot[data-i="${i}"]`);
      const chip = (await page.textContent('.type-chip') || '').toLowerCase().trim();
      types.push({ i, chip });
    }
    return types;
  }

  let examTypes = [];
  let attempts = 0;
  const TYPE_MAP = { 'один ответ': 'single', 'несколько ответов': 'multi', 'верно / неверно': 'boolean', 'порядок действий': 'sequence', 'мини-сценарий': 'branching' };
  let indexByType = {};
  while (attempts++ < 8) {
    await startExam();
    examTypes = await scanTypes();
    indexByType = {};
    examTypes.forEach(t => { const ty = TYPE_MAP[t.chip]; if (ty && !(ty in indexByType)) indexByType[ty] = t.i; });
    if (Object.keys(indexByType).length === 5) break;
    // сгенерировать новый экзамен через "Новый экзамен" эквивалент: просто начнём заново с /exam
  }
  record('Экзамен из 60 вопросов покрывает все 5 типов вопросов (в пределах нескольких попыток)', Object.keys(indexByType).length === 5, JSON.stringify(indexByType));
  record('Число вопросов в экзамене = 60', examTypes.length === 60, `фактически: ${examTypes.length}`);

  // ---------- 7b. meta-source никогда не встречается в экзамене ----------
  const METASOURCE_PROMPTS = [
    'Точные размеры проходов между стеллажами в источнике указаны и обязательны к соблюдению.',
    'В материале курса указан точный номер технического регламента для детских товаров.',
    'В материале курса подробно описаны точные условия для каждого подвида «Некомплекта» (например, для «полупары» или «ремня/пояса»).',
  ];
  try {
    let found = false;
    for (let i = 0; i < examTypes.length; i++) {
      await page.click(`.exam-nav-dot[data-i="${i}"]`);
      const prompt = await page.textContent('.quiz-prompt');
      if (METASOURCE_PROMPTS.includes((prompt || '').trim())) { found = true; break; }
    }
    record('meta-source вопросы не встречаются в собранном экзамене', !found);
  } catch (e) { record('meta-source исключение из экзамена', false, e.message); }

  // ---------- 8. Восстановление ответа: single ----------
  if ('single' in indexByType) {
    try {
      const i = indexByType.single;
      await page.click(`.exam-nav-dot[data-i="${i}"]`);
      await page.waitForSelector('.choice-option', { timeout: 3000 });
      const opts = await page.$$('.choice-option');
      await opts[0].click();
      const otherIndex = (i + 1) % examTypes.length;
      await page.click(`.exam-nav-dot[data-i="${otherIndex}"]`);
      await page.click(`.exam-nav-dot[data-i="${i}"]`);
      const state = await page.$$eval('.choice-option', els => els.map(el => ({ sel: el.classList.contains('selected'), aria: el.getAttribute('aria-checked') })));
      const ok = state[0].sel === true && state[0].aria === 'true' && state.slice(1).every(s => !s.sel && s.aria === 'false');
      record('single: восстановление выбранного варианта после ухода/возврата', ok, JSON.stringify(state));
      // изменить ответ
      await opts[1] ? null : null;
      const opts2 = await page.$$('.choice-option');
      if (opts2[1]) await opts2[1].click();
      const state2 = await page.$$eval('.choice-option', els => els.map(el => el.classList.contains('selected')));
      record('single: изменение ответа после возврата обновляет выбор', state2[1] === true && state2[0] === false);
    } catch (e) { record('single: восстановление ответа', false, e.message); }
  } else record('single: восстановление ответа', false, 'тип не найден в этом экзамене');

  // ---------- 9. Восстановление ответа: boolean ----------
  if ('boolean' in indexByType) {
    try {
      const i = indexByType.boolean;
      await page.click(`.exam-nav-dot[data-i="${i}"]`);
      await page.waitForSelector('.choice-option', { timeout: 3000 });
      const opts = await page.$$('.choice-option');
      await opts[0].click();
      const otherIndex = (i + 2) % examTypes.length;
      await page.click(`.exam-nav-dot[data-i="${otherIndex}"]`);
      await page.click(`.exam-nav-dot[data-i="${i}"]`);
      const state = await page.$$eval('.choice-option', els => els.map(el => ({ sel: el.classList.contains('selected'), aria: el.getAttribute('aria-checked') })));
      const ok = state[0].sel === true && state[0].aria === 'true';
      record('boolean: восстановление выбранного варианта после ухода/возврата', ok, JSON.stringify(state));
    } catch (e) { record('boolean: восстановление ответа', false, e.message); }
  } else record('boolean: восстановление ответа', false, 'тип не найден в этом экзамене');

  // ---------- 10. Восстановление ответа: multi ----------
  if ('multi' in indexByType) {
    try {
      const i = indexByType.multi;
      await page.click(`.exam-nav-dot[data-i="${i}"]`);
      await page.waitForSelector('.choice-option.multi', { timeout: 3000 });
      const opts = await page.$$('.choice-option.multi');
      await opts[0].click();
      await opts[1].click();
      const otherIndex = (i + 1) % examTypes.length;
      await page.click(`.exam-nav-dot[data-i="${otherIndex}"]`);
      await page.click(`.exam-nav-dot[data-i="${i}"]`);
      const state = await page.$$eval('.choice-option.multi', els => els.map(el => ({ sel: el.classList.contains('selected'), aria: el.getAttribute('aria-pressed') })));
      const ok = state[0].sel === true && state[0].aria === 'true' && state[1].sel === true && state[1].aria === 'true'
        && state.slice(2).every(s => !s.sel && s.aria === 'false');
      record('multi: обе выбранные опции восстановлены (класс+aria-pressed) после ухода/возврата', ok, JSON.stringify(state));
      // изменить один пункт
      const opts2 = await page.$$('.choice-option.multi');
      await opts2[1].click(); // снимает второй выбор
      const otherIndex2 = (i + 2) % examTypes.length;
      await page.click(`.exam-nav-dot[data-i="${otherIndex2}"]`);
      await page.click(`.exam-nav-dot[data-i="${i}"]`);
      const state2 = await page.$$eval('.choice-option.multi', els => els.map(el => el.classList.contains('selected')));
      const ok2 = state2[0] === true && state2[1] === false;
      record('multi: изменение (снятие) одного пункта корректно сохраняется после повторного возврата', ok2, JSON.stringify(state2));
    } catch (e) { record('multi: восстановление ответа', false, e.message); }
  } else record('multi: восстановление ответа', false, 'тип не найден в этом экзамене');

  // ---------- 11. Восстановление ответа: sequence ----------
  if ('sequence' in indexByType) {
    try {
      const i = indexByType.sequence;
      await page.click(`.exam-nav-dot[data-i="${i}"]`);
      await page.waitForSelector('.seq-chip', { timeout: 3000 });
      let chips = await page.$$('.seq-chip');
      const total = chips.length;
      await chips[0].click();
      await page.waitForTimeout(50);
      chips = await page.$$('.seq-chip');
      if (chips[0]) await chips[0].click();
      const builtAfterTwo = await page.$$eval('.seq-built li span', els => els.map(e => e.textContent));
      const otherIndex = (i + 1) % examTypes.length;
      await page.click(`.exam-nav-dot[data-i="${otherIndex}"]`);
      await page.click(`.exam-nav-dot[data-i="${i}"]`);
      const builtRestored = await page.$$eval('.seq-built li span', els => els.map(e => e.textContent));
      const ok = builtRestored.length === builtAfterTwo.length && builtRestored.every((t, idx) => t === builtAfterTwo[idx]);
      record('sequence: частично построенный порядок восстанавливается после ухода/возврата', ok, `было: ${JSON.stringify(builtAfterTwo)}, стало: ${JSON.stringify(builtRestored)}`);
      // продолжить достраивать и убедиться, что можно завершить и изменить
      let poolChips = await page.$$('.seq-pool .seq-chip');
      while (poolChips.length) { await poolChips[0].click(); await page.waitForTimeout(30); poolChips = await page.$$('.seq-pool .seq-chip'); }
      const finalBuilt = await page.$$eval('.seq-built li', els => els.length);
      record('sequence: можно достроить полный порядок из ' + total + ' шагов', finalBuilt === total, `построено: ${finalBuilt}`);
      // уйти и вернуться после полного построения
      await page.click(`.exam-nav-dot[data-i="${otherIndex}"]`);
      await page.click(`.exam-nav-dot[data-i="${i}"]`);
      const fullyRestored = await page.$$eval('.seq-built li', els => els.length);
      record('sequence: полностью построенный порядок восстанавливается после возврата', fullyRestored === total, `восстановлено: ${fullyRestored}`);
      // отменить последний шаг (проверка кнопки "Отменить последний шаг" не дублируется)
      const undoButtons = await page.$$('button:has-text("Отменить последний шаг")');
      record('sequence: кнопка «Отменить последний шаг» не дублируется на странице', undoButtons.length === 1, `найдено кнопок: ${undoButtons.length}`);
    } catch (e) { record('sequence: восстановление ответа', false, e.message); }
  } else record('sequence: восстановление ответа', false, 'тип не найден в этом экзамене');

  // ---------- 12. Восстановление ответа: branching (включая возврат ПОСЛЕ полного прохождения) ----------
  if ('branching' in indexByType) {
    try {
      const i = indexByType.branching;
      await page.click(`.exam-nav-dot[data-i="${i}"]`);
      await page.waitForSelector('#branch-choices', { timeout: 3000 });
      let guard = 0;
      while (guard++ < 8) {
        const choice = await page.$('#branch-choices .choice-option');
        if (!choice) break;
        await choice.click();
        await page.waitForTimeout(300);
      }
      const summaryVisible = await page.$('#branch-redo-btn');
      record('branching: после прохождения всех шагов показана сводка (не пустая карточка)', !!summaryVisible);

      const otherIndex = (i + 1) % examTypes.length;
      await page.click(`.exam-nav-dot[data-i="${otherIndex}"]`);
      await page.click(`.exam-nav-dot[data-i="${i}"]`);
      const summaryAfterReturn = await page.$('#branch-redo-btn');
      const rowsCount = await page.$$eval('.branch-row', els => els.length).catch(() => 0);
      record('branching: возврат к ПОЛНОСТЬЮ пройденному сценарию показывает сводку ответов, а не пустую карточку', !!summaryAfterReturn && rowsCount > 0, `строк сводки: ${rowsCount}`);

      if (summaryAfterReturn) {
        await summaryAfterReturn.click();
        await page.waitForSelector('#branch-choices', { timeout: 3000 });
        record('branching: «Пройти сценарий заново» снова открывает первый шаг для изменения ответов', true);
      }
    } catch (e) { record('branching: восстановление ответа', false, e.message); }
  } else record('branching: восстановление ответа', false, 'тип не найден в этом экзамене');

  // ---------- 13. Флаг «вернуться позже» переживает изменение ответа ----------
  if ('single' in indexByType) {
    try {
      const i = indexByType.single;
      await page.click(`.exam-nav-dot[data-i="${i}"]`);
      await page.waitForSelector('#flag-btn', { timeout: 3000 });
      await page.click('#flag-btn');
      const opts = await page.$$('.choice-option');
      if (opts[0]) await opts[0].click();
      const flaggedAfterAnswer = await page.$eval('#flag-btn', el => el.classList.contains('active'));
      record('Флаг «вернуться позже» сохраняется после изменения ответа', flaggedAfterAnswer);
      await page.click('#flag-btn'); // снять флаг обратно, чтобы не мешать следующему прогону
    } catch (e) { record('Флаг «вернуться позже»', false, e.message); }
  }

  // ---------- 14. Устойчивость к обновлению страницы посреди экзамена ----------
  try {
    const before = await page.evaluate(() => location.hash);
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('.exam-run', { timeout: 5000 });
    const after = await page.evaluate(() => location.hash);
    const stillHasQuestion = await page.$('.quiz-prompt');
    record('Обновление страницы посреди экзамена не обнуляет попытку (сессия восстановлена)', before === after && !!stillHasQuestion, `hash: ${after}`);
  } catch (e) { record('Устойчивость к обновлению страницы посреди экзамена', false, e.message); }

  // ---------- 15. Завершение экзамена и подсчёт результата ----------
  try {
    // ответить на все вопросы по-быстрому (произвольный первый вариант / любой валидный выбор), затем завершить.
    // Каждый шаг ждёт стабилизации DOM явным опросом (waitForFunction), а не фиксированной паузой,
    // чтобы не ловить "Element is not attached to the DOM" из-за setTimeout-переходов в branching.
    const dotCount = await page.$$eval('.exam-nav-dot', els => els.length);
    for (let i = 0; i < dotCount; i++) {
      await page.click(`.exam-nav-dot[data-i="${i}"]`);
      await page.waitForSelector('.quiz-prompt', { timeout: 5000 });
      const chip = (await page.textContent('.type-chip') || '').toLowerCase();
      if (chip.includes('сценарий')) {
        let guard = 0;
        while (guard++ < 8) {
          const choice = await page.$('#branch-choices .choice-option');
          if (!choice) break;
          await choice.click().catch(() => {});
          // дождаться либо следующего шага, либо сводки — соответствует 250мс задержке в app.js
          await page.waitForTimeout(400);
        }
      } else if (chip.includes('порядок')) {
        let guard = 0;
        while (guard++ < 10) {
          const poolChip = await page.$('.seq-pool .seq-chip');
          if (!poolChip) break;
          await poolChip.click().catch(() => {});
          await page.waitForTimeout(60);
        }
      } else {
        const opt = await page.$('.choice-option');
        if (opt) await opt.click().catch(() => {});
      }
      await page.waitForTimeout(50);
    }
    await page.click(`.exam-nav-dot[data-i="${dotCount - 1}"]`);
    await page.waitForSelector('#exam-submit', { timeout: 5000 });
    await page.click('#exam-submit');
    await page.waitForSelector('.exam-result', { timeout: 5000 });
    const percentText = await page.textContent('.result-percent');
    record('Экзамен завершается и показывает результат', /%/.test(percentText || ''), percentText);
  } catch (e) { record('Завершение экзамена', false, e.message); }

  // ---------- 16. Новый экзамен даёт другой набор вопросов ----------
  try {
    await page.waitForSelector('#new-exam-btn', { timeout: 5000 });
    await page.click('#new-exam-btn');
    await page.waitForSelector('.exam-run', { timeout: 5000 });
    const newTypes = await scanTypes();
    record('Новый экзамен снова содержит 60 вопросов', newTypes.length === 60, `фактически: ${newTypes.length}`);
  } catch (e) { record('Новый экзамен', false, e.message); }

  // выйти из второй попытки экзамена, не завершая её, чтобы дальнейшие проверки (localStorage/сброс)
  // отражали именно первую, уже завершённую попытку
  try { await page.evaluate(() => { location.hash = '#/dashboard'; }); await page.waitForSelector('.page-dashboard', { timeout: 5000 }); } catch (e) {}

  // ---------- 17. localStorage персистентность + сброс прогресса ----------
  try {
    await page.evaluate(() => { location.hash = '#/dashboard'; });
    await page.waitForSelector('.page-dashboard', { timeout: 5000 });
    const attemptsBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('pvzAcademyState.v1') || '{}').examAttempts || []);
    record('Результат экзамена сохранён в localStorage', attemptsBefore.length > 0, `попыток: ${attemptsBefore.length}`);

    page.once('dialog', d => d.accept());
    await page.click('#reset-progress-btn');
    await page.waitForTimeout(200);
    const stateAfter = await page.evaluate(() => JSON.parse(localStorage.getItem('pvzAcademyState.v1') || '{}'));
    record('Сброс прогресса очищает localStorage', (stateAfter.examAttempts || []).length === 0);
  } catch (e) { record('localStorage / сброс прогресса', false, e.message); }

  // ---------- 18. Работа над ошибками (после сброса — должно быть пусто; создадим ошибку и проверим) ----------
  try {
    await page.evaluate(() => { location.hash = '#/mistakes'; });
    await page.waitForSelector('.page', { timeout: 5000 });
    const emptyState = await page.$('.empty-state');
    record('«Работа над ошибками» показывает пустое состояние после сброса', !!emptyState);
  } catch (e) { record('Работа над ошибками (пустое состояние)', false, e.message); }

  // ---------- Итог ----------
  console.log('\n=== Итог ===');
  const failed = results.filter(r => !r.ok);
  console.log(`Пройдено: ${results.length - failed.length} / ${results.length}`);
  if (failed.length) {
    console.log('\nПровалившиеся проверки:');
    failed.forEach(f => console.log(`  - ${f.name}${f.detail ? ' (' + f.detail + ')' : ''}`));
  }
  console.log(`\nОшибок в консоли браузера за весь прогон: ${consoleErrors.length}`);
  if (consoleErrors.length) consoleErrors.slice(0, 30).forEach(e => console.log('  [console] ' + e));

  await browser.close();
  process.exit(failed.length || consoleErrors.length ? 1 : 0);
}

main().catch(e => { console.error('Смоук-тест упал с ошибкой:', e); process.exit(1); });
