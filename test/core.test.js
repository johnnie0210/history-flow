// Run: node --test test/core.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const C = require('../js/core.js');

const md = fs.readFileSync(path.join(__dirname, '..', 'content.md'), 'utf8');
const data = C.parse(md);
const flowOf = (title, label = '') => data.topics.find(t => t.title === title).flows.find(f => f.label === label);
const names = f => f.steps.map(s => s.name);

// Seeded random so failures can be reproduced
function rng(seed) { return () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648); }

test('splits arrows outside parentheses only', () => {
  assert.deepStrictEqual(C.splitArrows('A(x → y) → B'), ['A(x → y)', 'B']);
  assert.deepStrictEqual(C.parseStep('교조신원운동(삼례집회 → 서울 복합상소)'), { name: '교조신원운동', detail: '삼례집회 → 서울 복합상소' });
  assert.deepStrictEqual(C.parseStep('바보온달'), { name: '바보온달', detail: '' });
});

test('reads 29 topics in 6 eras', () => {
  assert.strictEqual(data.topics.length, 29);
  assert.deepStrictEqual(data.eras.map(e => e.name), ['고대', '고려', '조선', '근대', '일제강점기', '현대']);
  data.topics.forEach(t => assert.ok(t.flows.length >= 1, t.title + ' has no flow'));
});

test('every question has 4 distinct options including the answer', () => {
  const qs = C.buildQuestions(data);
  assert.ok(qs.length > 500);
  for (let seed = 1; seed <= 3; seed++) {
    const r = rng(seed);
    qs.forEach(q => {
      const x = C.realize(data, q, r);
      assert.strictEqual(new Set(x.options).size, x.options.length, q.id + ' duplicate options');
      if (x.type === 'order') {
        assert.strictEqual(x.options.length, 4, q.id);
        assert.deepStrictEqual([...x.options].sort(), [...x.answerOrder].sort(), q.id);
        assert.notDeepStrictEqual(x.options, x.answerOrder, q.id + ' already in order');
      } else {
        assert.strictEqual(x.options.length, 4, q.id + ' option count');
        assert.ok(x.options.includes(x.answer), q.id + ' answer missing');
      }
    });
  }
});

test('order answers follow the flow order', () => {
  const qs = C.buildQuestions(data).filter(q => q.type === 'order');
  const r = rng(7);
  qs.forEach(q => {
    const x = C.realize(data, q, r);
    const idx = x.answerOrder.map(n => names(q.flow).indexOf(n));
    assert.deepStrictEqual(idx, [...idx].sort((a, b) => a - b), q.id);
  });
});

test('trap choices are used for the Triple Intervention question', () => {
  const q = C.buildQuestions(data).find(x => x.type === 'pair' && x.pair.front.startsWith('삼국간섭'));
  const x = C.realize(data, q, rng(3));
  assert.strictEqual(x.answer, '랴오둥반도');
  ['타이완', '펑후 제도', '산둥반도'].forEach(t => assert.ok(x.options.includes(t)));
});

test('corrections from the review are in the content', () => {
  const fall = names(flowOf('조선이 망하는 과정'));
  assert.ok(fall.indexOf('독도 불법 편입') > fall.indexOf('제1차 한일협약'), '독도 편입은 1차 한일협약 뒤');
  assert.ok(fall.indexOf('한일의정서') < fall.indexOf('독도 불법 편입'));

  const imjin = names(flowOf('임진왜란'));
  assert.ok(imjin.indexOf('훈련도감 설치') < imjin.indexOf('선조 한양 복귀'), '훈련도감이 환도보다 먼저');

  const s1930 = flowOf('1930년대 무장투쟁').steps;
  assert.strictEqual(s1930[0].name, '만주사변');
  assert.strictEqual(s1930[0].detail, '1931');

  assert.strictEqual(flowOf('1920년대 국외 무장투쟁').steps.find(s => s.name === '자유시참변').detail, '1921.6');
  assert.match(flowOf('붕당의 흐름').steps.find(s => s.name === '갑술환국').detail, /희빈으로 강등, 1701년 사망/);
  assert.strictEqual(flowOf('동학농민운동').steps[0].detail, '삼례집회 → 서울 복합상소');

  const triple = flowOf('1890년대 사건', '자세히').steps.find(s => s.name === '삼국간섭');
  assert.ok(triple.detail.includes('랴오둥반도') && !triple.detail.includes('타이완'));
});
