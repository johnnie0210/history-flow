/* Screen logic: cards, quiz, flow list, records */
(function () {
  'use strict';
  var C = window.HistoryCore;
  var STORE_KEY = 'history-flow.v1';
  var $ = function (id) { return document.getElementById(id); };

  var data, cards, questions, topicById = {}, details = {};
  var DETAIL_KEYS = ['요약', '배경', '전개', '결과', '비고'];
  var store = loadStore();

  // ---------- storage ----------
  function loadStore() {
    var s = null;
    try { s = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (e) { s = null; }
    s = s || {};
    s.known = s.known || {};
    s.q = s.q || {};
    s.total = s.total || { c: 0, w: 0 };
    s.ui = s.ui || {};
    return s;
  }
  function saveStore() { try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { /* private mode */ } }

  // ---------- helpers ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var toastTimer;
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.add('hidden'); }, 1600);
  }
  function segValue(segId, attr) { var b = $(segId).querySelector('.seg-btn.active'); return b ? b.getAttribute(attr) : null; }
  function bindSeg(segId, onChange) {
    $(segId).addEventListener('click', function (e) {
      var b = e.target.closest('.seg-btn'); if (!b) { return; }
      $(segId).querySelectorAll('.seg-btn').forEach(function (x) { x.classList.toggle('active', x === b); });
      if (onChange) { onChange(); }
    });
  }
  function setSeg(segId, attr, value) {
    $(segId).querySelectorAll('.seg-btn').forEach(function (x) { x.classList.toggle('active', x.getAttribute(attr) === String(value)); });
  }
  function inRange(topic, range) {
    if (!range || range === 'all') { return true; }
    if (range.indexOf('era:') === 0) { return topic.era === range.slice(4); }
    if (range.indexOf('topic:') === 0) { return topic.id === range.slice(6); }
    return true;
  }
  function fillRange(select) {
    var html = '<option value="all">전체 (' + data.topics.length + '개 주제)</option>';
    data.eras.forEach(function (era) {
      html += '<optgroup label="' + esc(era.name) + '"><option value="era:' + esc(era.name) + '">' + esc(era.name) + ' 전체</option>';
      era.topics.forEach(function (t) { html += '<option value="topic:' + t.id + '">' + t.no + '. ' + esc(t.title) + '</option>'; });
      html += '</optgroup>';
    });
    select.innerHTML = html;
  }
  // linkSteps: steps with a detail entry open the detail sheet (flow list only)
  function flowHtml(topic, q, linkSteps) {
    var h = '';
    topic.flows.forEach(function (f) {
      if (f.label) { h += '<div class="tl-label">' + hl(f.label, q) + '</div>'; }
      h += '<ol class="tl">' + f.steps.map(function (s) {
        var link = linkSteps && details[s.name];
        return '<li' + (link ? ' class="has-detail" role="button" tabindex="0" data-step="' + esc(s.name) + '"' : '') + '><b>' + hl(s.name, q) + '</b>' +
          (link ? '<span class="more" aria-hidden="true">›</span>' : '') +
          (s.detail ? '<small>' + hl(s.detail, q) + '</small>' : '') + '</li>';
      }).join('') + '</ol>';
    });
    topic.cores.forEach(function (c) { h += '<div class="core">핵심: ' + c.map(function (x) { return hl(x, q); }).join(' → ') + '</div>'; });
    if (topic.pairs.length) {
      h += '<div class="pairs">' + topic.pairs.map(function (p) {
        return '<div><b>' + hl(p.front, q) + '</b> — ' + hl(p.back, q) + (p.note ? '<br><small>' + hl(p.note, q) + '</small>' : '') + '</div>';
      }).join('') + '</div>';
    }
    topic.memos.forEach(function (m) { h += '<div class="memo">' + hl(m, q) + '</div>'; });
    return h;
  }
  function hl(text, q) {
    var s = esc(text);
    if (!q) { return s; }
    var eq = esc(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return s.replace(new RegExp(eq, 'gi'), function (m) { return '<mark>' + m + '</mark>'; });
  }

  // ---------- tabs ----------
  document.querySelector('.tabbar').addEventListener('click', function (e) {
    var b = e.target.closest('.tab'); if (!b) { return; }
    var tab = b.getAttribute('data-tab');
    document.querySelectorAll('.tab').forEach(function (x) { x.classList.toggle('active', x === b); });
    ['card', 'quiz', 'list'].forEach(function (v) { $('view-' + v).classList.toggle('hidden', v !== tab); });
    if (tab === 'list') { renderList(); }
    window.scrollTo(0, 0);
  });

  // ---------- cards ----------
  var deck = [], pos = 0;

  function buildDeck() {
    var kind = segValue('card-kind-seg', 'data-kind');
    var range = $('card-range').value;
    var hide = $('card-hide-known').checked;
    deck = cards.filter(function (c) {
      return (kind === 'all' || c.kind === kind) && inRange(c.topic, range) && !(hide && store.known[c.id]);
    });
    if ($('card-shuffle').checked) { deck = C.shuffle(deck, Math.random); }
    pos = 0;
    store.ui.card = { kind: kind, range: range, shuffle: $('card-shuffle').checked, hide: hide };
    saveStore();
    showCard(false);
  }

  function cardFaces(c) {
    var t = c.topic, front = '', back = '', scrollBack = false;
    if (c.kind === 'next') {
      var f = c.flow, i = c.index, cur = f.steps[i], nxt = f.steps[i + 1];
      var label = '<div class="card-type"><span>흐름 · ' + esc(C.flowTitle(t, f)) + '</span></div>';
      front = label + (i > 0 ? '<div class="card-prev">' + esc(f.steps[i - 1].name) + ' →</div>' : '') +
        '<div class="card-big">' + esc(cur.name) + '</div>' +
        (cur.detail ? '<div class="card-detail">' + esc(cur.detail) + '</div>' : '') +
        '<div class="card-ask">다음은?</div><div class="card-hint">탭해서 확인</div>';
      var lo = Math.max(0, i - 1), hi = Math.min(f.steps.length - 1, i + 2), mf = [];
      for (var k = lo; k <= hi; k++) { mf.push('<span class="mf' + (k === i + 1 ? ' on' : '') + '">' + esc(f.steps[k].name) + '</span>'); }
      back = label + '<div class="card-prev">' + esc(cur.name) + ' →</div><div class="card-big">' + esc(nxt.name) + '</div>' +
        (nxt.detail ? '<div class="card-detail">' + esc(nxt.detail) + '</div>' : '') +
        '<div class="mini-flow">' + mf.join('<span class="arr">→</span>') + '</div>' +
        '<div class="card-hint">' + (i + 2) + ' / ' + f.steps.length + '단계</div>';
    } else if (c.kind === 'pair') {
      var p = c.pair, plabel = '<div class="card-type"><span>짝 · ' + esc(t.title) + '</span></div>';
      front = plabel + '<div class="card-big">' + esc(p.front) + '</div><div class="card-hint">탭해서 확인</div>';
      back = plabel + '<div class="card-prev">' + esc(p.front) + '</div><div class="card-big mid">' + esc(p.back) + '</div>' +
        (p.note ? '<div class="card-note">' + esc(p.note) + '</div>' : '');
    } else {
      var steps = t.flows.reduce(function (n, f2) { return n + f2.steps.length; }, 0);
      front = '<div class="card-type"><span>주제 · ' + esc(t.era) + '</span></div><div class="card-big">' + esc(t.title) + '</div>' +
        '<div class="card-detail">흐름 ' + t.flows.length + '개 · ' + steps + '단계' + (t.pairs.length ? ' · 짝 ' + t.pairs.length + '개' : '') + '</div>' +
        '<div class="card-ask">전체 흐름을 떠올려 보세요</div><div class="card-hint">탭해서 확인</div>';
      back = '<div class="topic-title">' + esc(t.title) + '</div>' + flowHtml(t, '', true);
      scrollBack = true;
    }
    return { front: front, back: back, scrollBack: scrollBack };
  }

  function showCard(animate) {
    var fc = $('flip-card');
    // Flip back to the front without showing the next card's answer
    fc.classList.add('noanim'); fc.classList.remove('flipped'); void fc.offsetWidth; fc.classList.remove('noanim');
    var c = deck[pos];
    if (!c) {
      $('card-front').innerHTML = '<p class="empty">' + ($('card-hide-known').checked ? '모든 카드를 외웠어요. "외운 것 숨기기"를 끄면 다시 볼 수 있어요.' : '카드가 없어요. 범위를 바꿔 보세요.') + '</p>';
      $('card-back').innerHTML = '';
      $('card-progress-text').textContent = '0 / 0';
      $('card-progress-fill').style.width = '0';
      $('btn-known').classList.add('hidden');
      updateKnownCount();
      return;
    }
    var faces = cardFaces(c);
    $('card-front').innerHTML = faces.front;
    $('card-back').innerHTML = faces.back;
    $('card-back').classList.toggle('scroll', faces.scrollBack);
    $('card-back').scrollTop = 0;
    $('card-progress-text').textContent = (pos + 1) + ' / ' + deck.length;
    $('card-progress-fill').style.width = ((pos + 1) / deck.length * 100) + '%';
    $('btn-known').classList.remove('hidden');
    var on = !!store.known[c.id];
    $('btn-known').classList.toggle('on', on);
    $('btn-known').textContent = on ? '★ 외웠어요' : '☆ 외웠어요';
    updateKnownCount();
  }
  function updateKnownCount() {
    var kind = segValue('card-kind-seg', 'data-kind'), range = $('card-range').value;
    var all = cards.filter(function (c) { return (kind === 'all' || c.kind === kind) && inRange(c.topic, range); });
    var known = all.filter(function (c) { return store.known[c.id]; }).length;
    $('card-known-count').textContent = '외운 카드 ' + known + ' / ' + all.length;
  }
  function flip() { if (deck[pos]) { $('flip-card').classList.toggle('flipped'); } }
  function move(d) {
    if (!deck.length) { return; }
    pos = (pos + d + deck.length) % deck.length;
    showCard(true);
  }

  var touch = null, swiped = false;
  $('flip-card').addEventListener('touchstart', function (e) { var p = e.touches[0]; touch = { x: p.clientX, y: p.clientY }; swiped = false; }, { passive: true });
  $('flip-card').addEventListener('touchend', function (e) {
    if (!touch) { return; }
    var p = e.changedTouches[0], dx = p.clientX - touch.x, dy = p.clientY - touch.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) { swiped = true; move(dx < 0 ? 1 : -1); }
    touch = null;
  });
  // A linked step on the flipped topic card opens the detail sheet instead of flipping
  function cardStepLink(e) {
    var li = e.target.closest('li.has-detail');
    return li && $('flip-card').classList.contains('flipped') ? li.getAttribute('data-step') : null;
  }
  $('flip-card').addEventListener('click', function (e) {
    if (swiped) { swiped = false; return; }
    var step = cardStepLink(e);
    if (step) { openDetail(step); return; }
    flip();
  });
  $('flip-card').addEventListener('keydown', function (e) {
    if (e.key !== ' ' && e.key !== 'Enter') { return; }
    e.preventDefault();
    var step = cardStepLink(e);
    if (step) { openDetail(step); } else { flip(); }
  });
  document.addEventListener('keydown', function (e) {
    if ($('view-card').classList.contains('hidden') || /INPUT|SELECT/.test(document.activeElement.tagName)) { return; }
    if (e.key === 'ArrowRight') { move(1); } else if (e.key === 'ArrowLeft') { move(-1); }
  });
  $('btn-flip').addEventListener('click', flip);
  $('btn-prev').addEventListener('click', function () { move(-1); });
  $('btn-next').addEventListener('click', function () { move(1); });
  $('btn-known').addEventListener('click', function () {
    var c = deck[pos]; if (!c) { return; }
    if (store.known[c.id]) { delete store.known[c.id]; } else { store.known[c.id] = 1; }
    saveStore();
    if (store.known[c.id] && $('card-hide-known').checked) {
      deck.splice(pos, 1);
      if (pos >= deck.length) { pos = 0; }
      toast('외운 카드로 표시했어요');
      showCard(true);
    } else {
      var on = !!store.known[c.id];
      $('btn-known').classList.toggle('on', on);
      $('btn-known').textContent = on ? '★ 외웠어요' : '☆ 외웠어요';
      updateKnownCount();
    }
  });
  bindSeg('card-kind-seg', buildDeck);
  ['card-range', 'card-shuffle', 'card-hide-known'].forEach(function (id) { $(id).addEventListener('change', buildDeck); });

  // ---------- quiz ----------
  var quiz = null;

  function quizPool() {
    var type = segValue('quiz-type-seg', 'data-qtype'), range = $('quiz-range').value;
    return questions.filter(function (q) { return (type === 'mix' || q.type === type) && inRange(q.topic, range); });
  }
  function updateQuizInfo() {
    var n = quizPool().length;
    $('quiz-info').textContent = n ? '이 범위에서 낼 수 있는 문제 ' + n + '개' : '이 범위에는 해당 유형 문제가 없어요';
    $('btn-start-quiz').disabled = !n;
    store.ui.quiz = { type: segValue('quiz-type-seg', 'data-qtype'), range: $('quiz-range').value, count: segValue('quiz-count-seg', 'data-count'), order: segValue('quiz-order-seg', 'data-order') };
    saveStore();
  }
  function weakScore(q) { var r = store.q[q.id]; return r ? (r.w + 1) / (r.c + r.w + 2) : 0.5; }

  function startQuiz(list) {
    var pool = list || quizPool();
    if (!pool.length) { return; }
    var count = +segValue('quiz-count-seg', 'data-count');
    if (!list) {
      pool = C.shuffle(pool, Math.random);
      if (segValue('quiz-order-seg', 'data-order') === 'weak') {
        pool.sort(function (a, b) { return weakScore(b) - weakScore(a); });
      }
      if (count) { pool = pool.slice(0, count); }
    } else { pool = C.shuffle(pool, Math.random); }
    quiz = { list: pool, i: 0, score: 0, wrong: [] };
    $('quiz-setup').classList.add('hidden'); $('quiz-result').classList.add('hidden'); $('quiz-play').classList.remove('hidden');
    showQuestion();
  }

  function showQuestion() {
    var base = quiz.list[quiz.i];
    var q = quiz.cur = C.realize(data, base, Math.random);
    quiz.picked = []; quiz.done = false;
    $('quiz-counter').textContent = (quiz.i + 1) + ' / ' + quiz.list.length;
    $('quiz-score').textContent = quiz.score + '점';
    $('quiz-progress-fill').style.width = (quiz.i / quiz.list.length * 100) + '%';
    $('quiz-topic').textContent = q.title;
    $('quiz-prompt').textContent = q.prompt;
    $('quiz-question').textContent = q.question || '';
    $('quiz-question').classList.toggle('long', !!q.question && q.question.length > 28);
    $('quiz-question').classList.toggle('hidden', !q.question);
    $('quiz-context').textContent = q.type === 'next' && q.context.indexOf('→ ' + q.question) > 0 ? q.context : '';
    $('quiz-explain').classList.add('hidden');
    $('order-picked').classList.toggle('hidden', q.type !== 'order');
    $('order-picked').textContent = q.type === 'order' ? '잘못 눌렀으면 다시 눌러 취소' : '';
    $('btn-quiz-next').disabled = true;
    $('btn-quiz-next').textContent = quiz.i + 1 < quiz.list.length ? '다음' : '결과 보기';
    $('quiz-options').innerHTML = q.options.map(function (o, k) {
      return '<button class="opt" data-k="' + k + '"><span class="num">' + (q.type === 'order' ? '' : (k + 1)) + '</span><span>' + esc(o) + '</span></button>';
    }).join('');
  }

  function record(ok) {
    var q = quiz.cur, r = store.q[q.id] || { c: 0, w: 0 };
    if (ok) { r.c++; store.total.c++; quiz.score++; } else { r.w++; store.total.w++; }
    store.q[q.id] = r; saveStore();
    $('quiz-score').textContent = quiz.score + '점';
    quiz.done = true;
    $('btn-quiz-next').disabled = false;
  }

  $('quiz-options').addEventListener('click', function (e) {
    var b = e.target.closest('.opt'); if (!b || !quiz || quiz.done) { return; }
    var q = quiz.cur, k = +b.getAttribute('data-k'), btns = $('quiz-options').querySelectorAll('.opt');
    if (q.type === 'order') {
      var at = quiz.picked.indexOf(k);
      if (at >= 0) { quiz.picked.splice(at, 1); } else { quiz.picked.push(k); }
      btns.forEach(function (x, idx) {
        var p = quiz.picked.indexOf(idx);
        x.classList.toggle('picked', p >= 0);
        x.querySelector('.num').textContent = p >= 0 ? p + 1 : '';
      });
      if (quiz.picked.length === q.options.length) {
        var chosen = quiz.picked.map(function (idx) { return q.options[idx]; });
        var ok = chosen.join('|') === q.answerOrder.join('|');
        btns.forEach(function (x, idx) {
          var p = quiz.picked.indexOf(idx);
          x.classList.add(q.answerOrder[p] === q.options[idx] ? 'correct' : 'wrong');
          x.disabled = true;
        });
        $('quiz-explain').innerHTML = (ok ? '정답! ' : '') + '바른 순서<ol>' + q.answerOrder.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>';
        $('quiz-explain').classList.remove('hidden');
        if (!ok) { quiz.wrong.push({ base: quiz.list[quiz.i], title: q.title, q: chosen.join(' → '), a: q.answerOrder.join(' → ') }); }
        record(ok);
      }
      return;
    }
    var okc = q.options[k] === q.answer;
    btns.forEach(function (x, idx) {
      x.disabled = true;
      if (q.options[idx] === q.answer) { x.classList.add('correct'); } else if (idx === k) { x.classList.add('wrong'); }
    });
    if (q.explain) { $('quiz-explain').textContent = q.answer + ' — ' + q.explain; $('quiz-explain').classList.remove('hidden'); }
    if (!okc) { quiz.wrong.push({ base: quiz.list[quiz.i], title: q.title, q: q.question || q.prompt, a: q.answer }); }
    record(okc);
  });

  $('btn-quiz-next').addEventListener('click', function () {
    if (!quiz || !quiz.done) { return; }
    quiz.i++;
    if (quiz.i < quiz.list.length) { showQuestion(); window.scrollTo(0, 0); } else { showResult(); }
  });
  function showResult() {
    var n = quiz.list.length, pct = Math.round(quiz.score / n * 100);
    $('quiz-play').classList.add('hidden'); $('quiz-result').classList.remove('hidden');
    $('result-emoji').textContent = pct >= 90 ? '🏆' : pct >= 70 ? '🎉' : pct >= 50 ? '👍' : '📚';
    $('result-title').textContent = pct >= 90 ? '흐름을 잘 잡고 있어요' : pct >= 70 ? '잘했어요' : pct >= 50 ? '조금만 더' : '카드로 한 번 더 보고 와요';
    $('result-score').textContent = n + '문제 중 ' + quiz.score + '개 정답 (' + pct + '%)';
    $('result-wrong').innerHTML = quiz.wrong.map(function (w) {
      return '<div class="rw"><b>' + esc(w.title) + '</b>' + esc(w.q) + '<br>정답: <span>' + esc(w.a) + '</span></div>';
    }).join('');
    $('btn-review-wrong').classList.toggle('hidden', !quiz.wrong.length);
    window.scrollTo(0, 0);
  }
  function backToSetup() {
    $('quiz-play').classList.add('hidden'); $('quiz-result').classList.add('hidden'); $('quiz-setup').classList.remove('hidden');
    quiz = null; updateQuizInfo();
  }
  $('btn-start-quiz').addEventListener('click', function () { startQuiz(); });
  $('btn-quiz-again').addEventListener('click', backToSetup);
  $('btn-quiz-quit').addEventListener('click', function () { if (quiz && quiz.i > 0) { showResultPartial(); } else { backToSetup(); } });
  function showResultPartial() { quiz.list = quiz.list.slice(0, quiz.i + (quiz.done ? 1 : 0)); if (!quiz.list.length) { backToSetup(); return; } showResult(); }
  $('btn-review-wrong').addEventListener('click', function () { startQuiz(quiz.wrong.map(function (w) { return w.base; })); });
  bindSeg('quiz-type-seg', updateQuizInfo);
  bindSeg('quiz-count-seg', updateQuizInfo);
  bindSeg('quiz-order-seg', updateQuizInfo);
  $('quiz-range').addEventListener('change', updateQuizInfo);

  // ---------- flow list ----------
  function topicText(t) {
    var parts = [t.title, t.era];
    t.flows.forEach(function (f) { parts.push(f.label); f.steps.forEach(function (s) { parts.push(s.name, s.detail); }); });
    t.pairs.forEach(function (p) { parts.push(p.front, p.back, p.note); });
    parts = parts.concat(t.memos);
    return parts.join(' ').toLowerCase();
  }
  function renderList() {
    if (!data) { return; }
    var q = $('list-search').value.trim(), era = segValue('list-era-seg', 'data-era') || 'all';
    var shown = data.topics.filter(function (t) { return (era === 'all' || t.era === era) && (!q || topicText(t).indexOf(q.toLowerCase()) >= 0); });
    $('list-count').textContent = shown.length + '개 주제' + (q ? ' · "' + q + '" 검색' : '');
    $('list-body').innerHTML = shown.map(function (t) {
      var f = t.flows[0], sub = f ? f.steps[0].name + ' → … → ' + f.steps[f.steps.length - 1].name : '';
      return '<details class="entry"' + (q ? ' open' : '') + '><summary><span class="no">' + t.no + '</span><span class="tt">' + hl(t.title, q) +
        '<span class="sub">' + esc(t.era) + ' · ' + esc(sub) + '</span></span></summary><div class="body">' + flowHtml(t, q, true) + '</div></details>';
    }).join('') || '<p class="empty">찾는 내용이 없어요.</p>';
  }
  $('list-search').addEventListener('input', renderList);
  bindSeg('list-era-seg', renderList);

  // ---------- event detail sheet ----------
  function openDetail(name) {
    var d = details[name]; if (!d) { return; }
    var tops = data.topics.filter(function (t) { return t.flows.some(function (f) { return f.steps.some(function (s) { return s.name === name; }); }); });
    $('detail-title').textContent = name;
    $('detail-topics').textContent = tops.map(function (t) { return t.era + ' · ' + t.title; }).join('  /  ');
    $('detail-body').innerHTML = DETAIL_KEYS.filter(function (k) { return d[k]; }).map(function (k) {
      return '<div class="dt-sec' + (k === '비고' ? ' note' : '') + '"><h3>' + (k === '비고' ? '시험 포인트' : k) + '</h3><p>' + esc(d[k]).replace(/\n/g, '<br>') + '</p></div>';
    }).join('');
    $('detail-backdrop').classList.remove('hidden');
    $('detail-backdrop').querySelector('.sheet').scrollTop = 0;
  }
  function closeDetail() { $('detail-backdrop').classList.add('hidden'); }
  $('list-body').addEventListener('click', function (e) {
    var li = e.target.closest('li.has-detail'); if (li) { openDetail(li.getAttribute('data-step')); }
  });
  $('list-body').addEventListener('keydown', function (e) {
    var li = e.target.closest('li.has-detail');
    if (li && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openDetail(li.getAttribute('data-step')); }
  });
  $('detail-backdrop').addEventListener('click', function (e) { if (e.target === $('detail-backdrop')) { closeDetail(); } });
  $('btn-detail-close').addEventListener('click', closeDetail);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closeDetail(); } });

  // ---------- info sheet ----------
  function openInfo() {
    $('info-topics').textContent = data ? data.topics.length + '개 (' + data.eras.map(function (e) { return e.name; }).join(' · ') + ')' : '—';
    $('info-cards').textContent = cards ? cards.length + '장' : '—';
    $('info-questions').textContent = questions ? questions.length + '개' : '—';
    var ids = {}; (cards || []).forEach(function (c) { ids[c.id] = 1; });
    $('stat-known').textContent = Object.keys(store.known).filter(function (k) { return ids[k]; }).length;
    var tot = store.total.c + store.total.w;
    $('stat-quiz').textContent = tot;
    $('stat-acc').textContent = tot ? Math.round(store.total.c / tot * 100) + '%' : '0%';
    var byEra = {};
    Object.keys(store.q).forEach(function (id) {
      var m = /:(t\d+)/.exec(id), t = m && topicById[m[1]]; if (!t) { return; }
      var e = byEra[t.era] = byEra[t.era] || { c: 0, w: 0 };
      e.c += store.q[id].c; e.w += store.q[id].w;
    });
    $('stat-era').innerHTML = data ? data.eras.map(function (era) {
      var e = byEra[era.name] || { c: 0, w: 0 }, n = e.c + e.w, pct = n ? Math.round(e.c / n * 100) : 0;
      return '<div class="era-row"><span>' + esc(era.name) + '</span><span class="bar"><i style="width:' + pct + '%"></i></span><span>' + (n ? pct + '% · ' + n : '—') + '</span></div>';
    }).join('') : '';
    $('sheet-backdrop').classList.remove('hidden');
  }
  $('btn-info').addEventListener('click', openInfo);
  $('sheet-backdrop').addEventListener('click', function (e) { if (e.target === $('sheet-backdrop')) { $('sheet-backdrop').classList.add('hidden'); } });
  $('btn-reset').addEventListener('click', function () {
    if (!confirm('외운 카드와 퀴즈 기록을 모두 지울까요?')) { return; }
    store.known = {}; store.q = {}; store.total = { c: 0, w: 0 }; saveStore();
    openInfo(); showCard(false); toast('학습 기록을 지웠어요');
  });

  // ---------- start ----------
  function init(md) {
    data = C.parse(md);
    data.topics.forEach(function (t) { topicById[t.id] = t; });
    cards = C.buildCards(data);
    questions = C.buildQuestions(data);
    $('topbar-sub').textContent = data.eras.length + '개 시대 · ' + data.topics.length + '개 주제';
    fillRange($('card-range')); fillRange($('quiz-range'));
    $('list-era-seg').innerHTML = '<button class="seg-btn active" data-era="all">전체</button>' +
      data.eras.map(function (e) { return '<button class="seg-btn" data-era="' + esc(e.name) + '">' + esc(e.name) + '</button>'; }).join('');

    var ui = store.ui;
    if (ui.card) {
      setSeg('card-kind-seg', 'data-kind', ui.card.kind);
      if ($('card-range').querySelector('option[value="' + ui.card.range + '"]')) { $('card-range').value = ui.card.range; }
      $('card-shuffle').checked = !!ui.card.shuffle; $('card-hide-known').checked = !!ui.card.hide;
    }
    if (ui.quiz) {
      setSeg('quiz-type-seg', 'data-qtype', ui.quiz.type); setSeg('quiz-count-seg', 'data-count', ui.quiz.count); setSeg('quiz-order-seg', 'data-order', ui.quiz.order);
      if ($('quiz-range').querySelector('option[value="' + ui.quiz.range + '"]')) { $('quiz-range').value = ui.quiz.range; }
    }
    buildDeck(); updateQuizInfo();
  }

  // details.json is optional: without it the app works as before
  var detailsReady = fetch('details.json', { cache: 'no-cache' })
    .then(function (r) { return r.ok ? r.json() : {}; })
    .then(function (d) { details = d || {}; })
    .catch(function () { details = {}; });

  fetch('content.md', { cache: 'no-cache' })
    .then(function (r) { if (!r.ok) { throw new Error(r.status); } return r.text(); })
    .then(function (md) { init(md); return detailsReady; })
    .then(function () { if (!$('view-list').classList.contains('hidden')) { renderList(); } })
    .catch(function () {
      $('topbar-sub').textContent = '내용을 불러오지 못했어요';
      $('card-front').innerHTML = '<p class="empty">content.md를 불러오지 못했어요. 인터넷 연결을 확인하거나, PC에서는 웹 서버로 열어 주세요.</p>';
    });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
})();
