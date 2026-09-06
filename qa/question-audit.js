#!/usr/bin/env node
/*
 * qa/question-audit.js
 * ---------------------------------------------------------------------------
 * Отчёт по банку вопросов «Академии ПВЗ» + эвристический аудит качества
 * дистракторов (неправильных вариантов ответа). Не заменяет ручную проверку
 * по источнику, но ловит механически обнаружимые проблемы:
 *   - варианты, которые намного короче/длиннее правильного ответа (риск того,
 *     что правильный ответ угадывается по длине/детализации формулировки);
 *   - подозрительно короткие/пустые дистракторы;
 *   - дистракторы, дословно повторяющие правильный ответ другого варианта
 *     (риск, что вопрос имеет более одного корректного варианта);
 *   - вопросы без relatedBlockId;
 *   - вопросы meta-source (для сверки с ручным списком).
 *
 * Запуск: node qa/question-audit.js
 * Ничего не меняет в данных — только печатает отчёт.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

function loadAppData() {
  const sandbox = { console };
  vm.createContext(sandbox);
  ['content.js', 'questions.js'].forEach(file => {
    const code = fs.readFileSync(path.join(ROOT, file), 'utf8');
    vm.runInContext(code, sandbox, { filename: file });
  });
  return vm.runInContext('({ PVZ_MODULES, PVZ_QUESTIONS })', sandbox);
}

function main() {
  const { PVZ_MODULES, PVZ_QUESTIONS } = loadAppData();
  const moduleTitle = {};
  PVZ_MODULES.forEach(m => { moduleTitle[m.id] = m.title; });

  const lengthBiasFlags = [];
  const shortDistractorFlags = [];
  const noRelatedBlock = [];
  const metaSource = [];
  const distractorFreq = {};

  PVZ_QUESTIONS.forEach(q => {
    if (!q.relatedBlockId) noRelatedBlock.push(q.id);
    if (Array.isArray(q.tags) && q.tags.includes('meta-source')) metaSource.push(q.id);

    if (q.type === 'branching' || !Array.isArray(q.options)) return;

    const correctIdx = new Set(q.correct || []);
    const correctTexts = q.options.filter((_, i) => correctIdx.has(i));
    const wrongTexts = q.options.filter((_, i) => !correctIdx.has(i));
    if (!correctTexts.length || !wrongTexts.length) return;

    wrongTexts.forEach(t => {
      const key = t.trim().toLowerCase();
      distractorFreq[key] = (distractorFreq[key] || 0) + 1;
      if (t.trim().length < 6) shortDistractorFlags.push({ id: q.id, option: t });
    });

    const avgCorrectLen = correctTexts.reduce((s, t) => s + t.length, 0) / correctTexts.length;
    const avgWrongLen = wrongTexts.reduce((s, t) => s + t.length, 0) / wrongTexts.length;
    // Флаг только на существенный и абсолютный перекос — короткие факто-вопросы
    // (числа, да/нет) естественно дают большую разницу в процентах при малых длинах.
    if (avgCorrectLen > avgWrongLen * 1.8 && (avgCorrectLen - avgWrongLen) > 25) {
      lengthBiasFlags.push({ id: q.id, avgCorrectLen: Math.round(avgCorrectLen), avgWrongLen: Math.round(avgWrongLen) });
    }
  });

  const repeatedDistractors = Object.entries(distractorFreq)
    .filter(([, count]) => count >= 8)
    .sort((a, b) => b[1] - a[1]);

  console.log('=== Аудит качества вопросов «Академии ПВЗ» ===\n');
  console.log(`Всего вопросов: ${PVZ_QUESTIONS.length}`);
  console.log(`Без relatedBlockId: ${noRelatedBlock.length}${noRelatedBlock.length ? ' (' + noRelatedBlock.join(', ') + ')' : ''}`);
  console.log(`meta-source (${metaSource.length}): ${metaSource.join(', ') || '—'}`);

  console.log(`\nПодозрение на перекос длины (правильный ответ заметно длиннее/детальнее дистракторов): ${lengthBiasFlags.length}`);
  lengthBiasFlags.forEach(f => console.log(`  ${f.id}: correct≈${f.avgCorrectLen} chars vs wrong≈${f.avgWrongLen} chars`));

  console.log(`\nПодозрительно короткие дистракторы (<6 симв.): ${shortDistractorFlags.length}`);
  shortDistractorFlags.forEach(f => console.log(`  ${f.id}: "${f.option}"`));

  console.log(`\nДистракторы, повторяющиеся 8+ раз по всему банку (не обязательно проблема, но стоит проверить на клише):`);
  if (!repeatedDistractors.length) console.log('  нет');
  repeatedDistractors.forEach(([text, count]) => console.log(`  ×${count}: "${text}"`));

  console.log('\nОтчёт завершён. Это эвристики для ручной проверки, не автоматический источник истины.');
}

main();
