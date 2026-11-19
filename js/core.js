/* Parses content.md and builds cards and quiz questions. Used by the app and by the tests. */
(function (root) {
  'use strict';

  // Split on → only outside parentheses
  function splitArrows(text) {
    var parts = [], depth = 0, cur = '';
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (ch === '(') { depth++; } else if (ch === ')') { depth = Math.max(0, depth - 1); }
      if (ch === '→' && depth === 0) { parts.push(cur); cur = ''; } else { cur += ch; }
    }
    parts.push(cur);
    return parts.map(function (s) { return s.trim(); }).filter(Boolean);
  }

  // "이름(설명)" → { name, detail }
  function parseStep(text) {
    var t = text.trim();
    if (t.charAt(t.length - 1) === ')') {
      var depth = 0;
      for (var i = t.length - 1; i >= 0; i--) {
        if (t[i] === ')') { depth++; } else if (t[i] === '(') {
          depth--;
          if (depth === 0) {
            var name = t.slice(0, i).trim();
            if (name) { return { name: name, detail: t.slice(i + 1, -1).trim() }; }
            break;
          }
        }
      }
    }
    return { name: t, detail: '' };
  }

  function parse(md) {
    var text = String(md).replace(/<!--[\s\S]*?-->/g, '');
    var eras = [], topics = [], era = null, topic = null, lastPair = null;
    text.split(/\r?\n/).forEach(function (raw) {
      var line = raw.trim();
      if (!line) { return; }
      var m;
      if ((m = /^##\s+(.+)$/.exec(line))) {
        if (!era) { era = { name: '기타', topics: [] }; eras.push(era); }
        topic = { id: 't' + (topics.length + 1), no: topics.length + 1, title: m[1].replace(/^\d+\.\s*/, '').trim(), era: era.name, flows: [], pairs: [], cores: [], memos: [] };
        topics.push(topic); era.topics.push(topic); lastPair = null;
        return;
      }
      if ((m = /^#\s+(.+)$/.exec(line))) {
        era = { name: m[1].trim(), topics: [] }; eras.push(era); topic = null; lastPair = null;
        return;
      }
      if (!topic) { return; }
      if ((m = /^흐름(?:\(([^)]*)\))?\s*:\s*(.+)$/.exec(line))) {
        var steps = splitArrows(m[2]).map(parseStep);
        if (steps.length >= 2) {
          topic.flows.push({ id: topic.id + 'f' + (topic.flows.length + 1), label: (m[1] || '').trim(), steps: steps });
        }
        lastPair = null;
      } else if ((m = /^핵심\s*:\s*(.+)$/.exec(line))) {
        topic.cores.push(splitArrows(m[1]));
      } else if ((m = /^짝\s*:\s*(.+?)\s*=\s*(.+)$/.exec(line))) {
        lastPair = { id: topic.id + 'p' + (topic.pairs.length + 1), front: m[1].trim(), back: m[2].trim(), note: '', traps: [] };
        topic.pairs.push(lastPair);
      } else if ((m = /^설명\s*:\s*(.+)$/.exec(line)) && lastPair) {
        lastPair.note = m[1].trim();
      } else if ((m = /^오답\s*:\s*(.+)$/.exec(line)) && lastPair) {
        lastPair.traps = m[1].split(/\s*,\s*/).filter(Boolean);
      } else if ((m = /^메모\s*:\s*(.+)$/.exec(line))) {
        topic.memos.push(m[1].trim());
      }
    });
    eras = eras.filter(function (e) { return e.topics.length; });
    return { eras: eras, topics: topics };
  }

  // ---------- cards ----------
  function flowTitle(topic, flow) { return flow.label ? topic.title + ' · ' + flow.label : topic.title; }

  function buildCards(data) {
    var cards = [];
    data.topics.forEach(function (t) {
      cards.push({ id: 'c:' + t.id, kind: 'topic', topic: t });
      t.flows.forEach(function (f) {
        for (var i = 0; i < f.steps.length - 1; i++) {
          cards.push({ id: 'n:' + f.id + ':' + i, kind: 'next', topic: t, flow: f, index: i });
        }
      });
      t.pairs.forEach(function (p) { cards.push({ id: 'p:' + p.id, kind: 'pair', topic: t, pair: p }); });
    });
    return cards;
  }

  // ---------- quiz ----------
  function shuffle(arr, rnd) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  // Wrong choices: same flow first, then same topic, then same era, then anywhere
  function pickDistractors(answer, pools, exclude, n, rnd) {
    var out = [], seen = {};
    seen[answer] = true;
    (exclude || []).forEach(function (x) { seen[x] = true; });
    for (var p = 0; p < pools.length && out.length < n; p++) {
      var pool = shuffle(pools[p], rnd);
      for (var k = 0; k < pool.length && out.length < n; k++) {
        var v = pool[k];
        if (v && !seen[v]) { seen[v] = true; out.push(v); }
      }
    }
    return out;
  }

  function stepNames(steps) { return steps.map(function (s) { return s.name; }); }

  function poolsForFlow(data, topic, flow) {
    var same = stepNames(flow.steps);
    var inTopic = [];
    topic.flows.forEach(function (f) { if (f !== flow) { inTopic = inTopic.concat(stepNames(f.steps)); } });
    var inEra = [], all = [];
    data.topics.forEach(function (t) {
      t.flows.forEach(function (f) {
        var names = stepNames(f.steps);
        if (t !== topic && t.era === topic.era) { inEra = inEra.concat(names); }
        if (t !== topic) { all = all.concat(names); }
      });
    });
    return [same, inTopic, inEra, all];
  }

  function makeChoice(q, answer, wrongs, rnd) {
    q.options = shuffle([answer].concat(wrongs), rnd);
    q.answer = answer;
    return q;
  }

  // Every question the content can produce, by type
  function buildQuestions(data, rnd) {
    rnd = rnd || Math.random;
    var list = [];
    data.topics.forEach(function (t) {
      t.flows.forEach(function (f) {
        var pools = poolsForFlow(data, t, f);
        var n = f.steps.length;
        for (var i = 0; i < n - 1; i++) {
          list.push({ type: 'next', id: 'qn:' + f.id + ':' + i, topic: t, flow: f, index: i });
        }
        for (var j = 1; j < n - 1; j++) {
          list.push({ type: 'blank', id: 'qb:' + f.id + ':' + j, topic: t, flow: f, index: j });
        }
        if (n >= 4) {
          // One order question per flow position window, so long flows give several
          for (var s = 0; s + 3 < n; s += 3) {
            list.push({ type: 'order', id: 'qo:' + f.id + ':' + s, topic: t, flow: f, index: s });
          }
        }
        f.steps.forEach(function (st, k) {
          if (st.detail && !/^[\d.·~\s]+$/.test(st.detail)) {
            list.push({ type: 'detail', id: 'qd:' + f.id + ':' + k, topic: t, flow: f, index: k });
          }
        });
        list.forEach(function (q) { if (q.flow === f && !q.pools) { q.pools = pools; } });
      });
      t.pairs.forEach(function (p) { list.push({ type: 'pair', id: 'qp:' + p.id, topic: t, pair: p }); });
    });
    return list;
  }

  // Fill in the concrete prompt and options (random each time)
  function realize(data, q, rnd) {
    rnd = rnd || Math.random;
    var f = q.flow, t = q.topic, r = { id: q.id, type: q.type, topic: t, title: f ? flowTitle(t, f) : t.title };
    if (q.type === 'next') {
      var cur = f.steps[q.index], nxt = f.steps[q.index + 1];
      r.prompt = '다음에 일어난 일은?';
      r.question = cur.name;
      r.context = q.index > 0 ? f.steps[q.index - 1].name + ' → ' + cur.name + ' → ?' : cur.name + ' → ?';
      r.explain = nxt.detail;
      return makeChoice(r, nxt.name, pickDistractors(nxt.name, q.pools, [cur.name], 3, rnd), rnd);
    }
    if (q.type === 'blank') {
      var a = f.steps[q.index - 1], b = f.steps[q.index], c = f.steps[q.index + 1];
      r.prompt = '빈칸에 들어갈 것은?';
      r.question = a.name + ' → ( ? ) → ' + c.name;
      r.explain = b.detail;
      return makeChoice(r, b.name, pickDistractors(b.name, q.pools, [a.name, c.name], 3, rnd), rnd);
    }
    if (q.type === 'order') {
      var n = f.steps.length, start = q.index, end = Math.min(n, start + 6);
      var idx = [];
      for (var i = start; i < end; i++) { idx.push(i); }
      // 4 steps from a window of up to 6, kept in flow order
      idx = shuffle(idx, rnd).slice(0, 4).sort(function (x, y) { return x - y; });
      r.prompt = '일어난 순서대로 누르세요';
      r.answerOrder = idx.map(function (k) { return f.steps[k].name; });
      r.options = shuffle(r.answerOrder, rnd);
      if (r.options.join('|') === r.answerOrder.join('|')) { r.options = r.options.slice().reverse(); }
      return r;
    }
    if (q.type === 'detail') {
      var st = f.steps[q.index];
      r.prompt = '이 설명에 해당하는 것은?';
      r.question = st.detail;
      return makeChoice(r, st.name, pickDistractors(st.name, q.pools, [], 3, rnd), rnd);
    }
    if (q.type === 'pair') {
      var p = q.pair;
      r.prompt = '알맞은 것은?';
      r.question = p.front;
      r.explain = p.note;
      var backs = [], topicBacks = t.pairs.filter(function (x) { return x !== p; }).map(function (x) { return x.back; });
      var eraBacks = [], allBacks = [];
      data.topics.forEach(function (o) {
        o.pairs.forEach(function (x) {
          if (o !== t && o.era === t.era) { eraBacks.push(x.back); }
          if (o !== t) { allBacks.push(x.back); }
        });
      });
      backs = pickDistractors(p.back, [p.traps, topicBacks, eraBacks, allBacks], [], 3, rnd);
      return makeChoice(r, p.back, backs, rnd);
    }
    return r;
  }

  var api = { splitArrows: splitArrows, parseStep: parseStep, parse: parse, buildCards: buildCards, buildQuestions: buildQuestions, realize: realize, shuffle: shuffle, flowTitle: flowTitle };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; } else { root.HistoryCore = api; }
})(this);
