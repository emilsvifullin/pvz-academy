#!/usr/bin/env node
/*
 * qa/validate-data.js
 * ---------------------------------------------------------------------------
 * Автономный валидатор данных «Академии ПВЗ» — не требует браузера, npm-пакетов
 * или сборки. Загружает content.js и questions.js как есть (те же файлы, что
 * подключает index.html) в изолированный контекст Node.js (vm) и проверяет
 * целостность данных.
 *
 * Запуск:  node qa/validate-data.js
 * Выход:   код 0 — если ошибок целостности нет (предупреждения не блокируют),
 *          код 1 — если найдена хотя бы одна ошибка.
 *
 * Это dev-инструмент. Сам сайт (index.html/styles.css/content.js/questions.js/app.js)
 * по-прежнему открывается напрямую в браузере без Node и без сборки.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

function loadAppData() {
  // content.js/questions.js declare their data with top-level `const`, which (exactly as in a
  // browser <script>) creates bindings in the realm's global lexical scope rather than properties
  // on the global object — so we pull them out explicitly with one more script in the same context.
  const sandbox = { console };
  vm.createContext(sandbox);
  ['content.js', 'questions.js'].forEach(file => {
    const code = fs.readFileSync(path.join(ROOT, file), 'utf8');
    vm.runInContext(code, sandbox, { filename: file });
  });
  return vm.runInContext(
    '({ PVZ_MODULES, PVZ_BLOCKS, PVZ_NUMBERS, PVZ_DEFECTS, PVZ_QUESTIONS })',
    sandbox
  );
}

function main() {
  const sandbox = loadAppData();
  const { PVZ_MODULES, PVZ_BLOCKS, PVZ_NUMBERS, PVZ_DEFECTS, PVZ_QUESTIONS } = sandbox;

  const errors = [];
  const warnings = [];
  const err = (msg) => errors.push(msg);
  const warn = (msg) => warnings.push(msg);

  // ---- 1) 15 модулей, уникальные id 1..15 ----
  if (!Array.isArray(PVZ_MODULES)) err('PVZ_MODULES отсутствует или не массив');
  else {
    if (PVZ_MODULES.length !== 15) err(`Ожидалось 15 модулей, найдено ${PVZ_MODULES.length}`);
    const ids = PVZ_MODULES.map(m => m.id);
    const idSet = new Set(ids);
    if (idSet.size !== ids.length) err('Дублирующиеся id модулей: ' + ids.join(','));
    for (let i = 1; i <= 15; i++) if (!idSet.has(i)) err(`Отсутствует модуль с id=${i}`);
  }
  const moduleIds = new Set((PVZ_MODULES || []).map(m => m.id));

  // ---- 2) Уникальность id блоков, ссылки на модули ----
  const blockIds = new Set();
  (PVZ_BLOCKS || []).forEach(b => {
    if (blockIds.has(b.id)) err(`Дублирующийся id блока: ${b.id}`);
    blockIds.add(b.id);
    if (!moduleIds.has(b.moduleId)) err(`Блок ${b.id} ссылается на несуществующий модуль ${b.moduleId}`);
    if (!b.title) err(`Блок ${b.id} без заголовка`);
    if (!b.type) err(`Блок ${b.id} без типа`);
  });

  // ---- 3) Вопросы ----
  const qIds = new Set();
  const VALID_TYPES = ['single', 'multi', 'boolean', 'sequence', 'branching'];
  const perTopic = {}, perType = {}, perDifficulty = {}, perTag = {};
  let examEligibleCount = 0;
  let metaSourceCount = 0;

  (PVZ_QUESTIONS || []).forEach(q => {
    // id uniqueness
    if (qIds.has(q.id)) err(`Дублирующийся id вопроса: ${q.id}`);
    qIds.add(q.id);

    // module ref
    if (!moduleIds.has(q.moduleId)) err(`Вопрос ${q.id} ссылается на несуществующий модуль ${q.moduleId}`);

    // relatedBlockId existence
    if (q.relatedBlockId && !blockIds.has(q.relatedBlockId)) {
      err(`Вопрос ${q.id} ссылается на несуществующий блок ${q.relatedBlockId}`);
    }
    if (!q.relatedBlockId) warn(`Вопрос ${q.id} без relatedBlockId`);

    // explanation
    if (!q.explanation || !String(q.explanation).trim()) err(`Вопрос ${q.id} без объяснения`);

    // type
    if (!VALID_TYPES.includes(q.type)) err(`Вопрос ${q.id} имеет неизвестный тип: ${q.type}`);

    // difficulty
    if (!['easy', 'medium', 'hard'].includes(q.difficulty)) warn(`Вопрос ${q.id} имеет нестандартную сложность: ${q.difficulty}`);

    // stats accumulation
    perTopic[q.moduleId] = (perTopic[q.moduleId] || 0) + 1;
    perType[q.type] = (perType[q.type] || 0) + 1;
    perDifficulty[q.difficulty] = (perDifficulty[q.difficulty] || 0) + 1;
    (q.tags || []).forEach(t => { perTag[t] = (perTag[t] || 0) + 1; });
    if (Array.isArray(q.tags) && q.tags.includes('meta-source')) metaSourceCount++;
    else examEligibleCount++;

    if (q.type === 'branching') {
      if (!Array.isArray(q.steps) || !q.steps.length) { err(`Branching-вопрос ${q.id} без шагов`); return; }
      q.steps.forEach((s, i) => {
        if (!Array.isArray(s.options) || s.options.length < 2) err(`Вопрос ${q.id}, шаг ${i + 1}: менее 2 вариантов`);
        if (s.options && new Set(s.options.map(o => (o || '').trim().toLowerCase())).size !== s.options.length) {
          err(`Вопрос ${q.id}, шаг ${i + 1}: повторяющиеся варианты`);
        }
        if (s.options && s.options.some(o => !o || !String(o).trim())) err(`Вопрос ${q.id}, шаг ${i + 1}: пустой вариант`);
        if (typeof s.correct !== 'number' || s.correct < 0 || !s.options || s.correct >= s.options.length) {
          err(`Вопрос ${q.id}, шаг ${i + 1}: некорректный индекс правильного ответа (${s.correct})`);
        }
        if (!s.explanation || !String(s.explanation).trim()) warn(`Вопрос ${q.id}, шаг ${i + 1}: без объяснения`);
      });
      return;
    }

    // non-branching: options / correct
    if (!Array.isArray(q.options) || q.options.length < 2) { err(`Вопрос ${q.id}: менее 2 вариантов ответа`); return; }
    if (q.options.some(o => !o || !String(o).trim())) err(`Вопрос ${q.id}: пустой вариант ответа`);
    const normOpts = q.options.map(o => String(o).trim().toLowerCase());
    if (new Set(normOpts).size !== normOpts.length) err(`Вопрос ${q.id}: повторяющиеся варианты ответа`);

    if (!Array.isArray(q.correct) || !q.correct.length) { err(`Вопрос ${q.id}: нет правильного ответа`); return; }
    const badIdx = q.correct.some(c => c < 0 || c >= q.options.length);
    if (badIdx) err(`Вопрос ${q.id}: индекс правильного ответа вне диапазона`);

    if (q.type === 'single' && q.correct.length !== 1) err(`Вопрос ${q.id}: single должен иметь ровно 1 правильный ответ (найдено ${q.correct.length})`);
    if (q.type === 'multi' && q.correct.length < 2) err(`Вопрос ${q.id}: multi должен иметь минимум 2 правильных ответа (найдено ${q.correct.length})`);
    if (q.type === 'boolean' && (q.options.length !== 2 || q.correct.length !== 1)) err(`Вопрос ${q.id}: некорректный boolean-вопрос`);
    if (q.type === 'sequence') {
      // sequence: correct порядок задаётся индексами options 0..n-1 по порядку; сама валидность
      // гарантируется структурой (options перечислены в правильном порядке), проверяем количество.
      if (q.options.length < 3) warn(`Вопрос ${q.id}: sequence из менее чем 3 шагов — слабо проверяет порядок`);
    }
  });

  // ---- 4) meta-source исключены из пула экзамена (логическая проверка соответствия app.js) ----
  // Дублируем правило app.js: isExamEligible(q) = !tags.includes('meta-source')
  const metaSourceIds = (PVZ_QUESTIONS || []).filter(q => Array.isArray(q.tags) && q.tags.includes('meta-source')).map(q => q.id);
  if (metaSourceIds.length === 0) {
    warn('Не найдено ни одного вопроса с тегом meta-source (ожидались минимум q6-09, q15-18, q15-20)');
  }

  // ---- 5) Покрытие тем: у каждого модуля должно быть достаточно вопросов, ПОСЛЕ исключения meta-source, для EXAM_MIN_PER_MODULE=2 ----
  const EXAM_MIN_PER_MODULE = 2;
  (PVZ_MODULES || []).forEach(m => {
    const eligible = (PVZ_QUESTIONS || []).filter(q => q.moduleId === m.id && !(Array.isArray(q.tags) && q.tags.includes('meta-source')));
    if (eligible.length < EXAM_MIN_PER_MODULE) {
      err(`Модуль ${m.id} (${m.title}): после исключения meta-source осталось ${eligible.length} вопросов, минимум для экзамена — ${EXAM_MIN_PER_MODULE}`);
    }
  });

  // ---- Отчёт ----
  console.log('=== Валидация данных «Академии ПВЗ» ===\n');
  console.log(`Модулей: ${(PVZ_MODULES || []).length}`);
  console.log(`Блоков материала: ${(PVZ_BLOCKS || []).length}`);
  console.log(`Карточек чисел и сроков: ${(PVZ_NUMBERS || []).length}`);
  console.log(`Записей справочника брака: ${(PVZ_DEFECTS || []).length}`);
  console.log(`Всего вопросов: ${(PVZ_QUESTIONS || []).length}`);
  console.log(`  из них meta-source (исключены из экзамена): ${metaSourceCount}`);
  console.log(`  доступно для экзамена: ${examEligibleCount}`);

  console.log('\nПо темам:');
  Object.keys(perTopic).map(Number).sort((a, b) => a - b).forEach(id => {
    const m = (PVZ_MODULES || []).find(x => x.id === id);
    console.log(`  ${id}. ${m ? m.title : '?'}: ${perTopic[id]}`);
  });

  console.log('\nПо типу вопроса:');
  Object.keys(perType).sort().forEach(t => console.log(`  ${t}: ${perType[t]}`));

  console.log('\nПо сложности:');
  ['easy', 'medium', 'hard'].forEach(d => console.log(`  ${d}: ${perDifficulty[d] || 0}`));

  console.log('\nПо тегам:');
  Object.keys(perTag).sort().forEach(t => console.log(`  ${t}: ${perTag[t]}`));
  if (metaSourceIds.length) console.log(`\nmeta-source вопросы: ${metaSourceIds.join(', ')}`);

  console.log(`\nПредупреждений: ${warnings.length}`);
  if (warnings.length) warnings.forEach(w => console.log('  [warn] ' + w));

  console.log(`\nОшибок: ${errors.length}`);
  if (errors.length) {
    errors.forEach(e => console.log('  [error] ' + e));
    console.log('\nВАЛИДАЦИЯ НЕ ПРОЙДЕНА.');
    process.exit(1);
  } else {
    console.log('\nВАЛИДАЦИЯ ПРОЙДЕНА.');
    process.exit(0);
  }
}

main();
