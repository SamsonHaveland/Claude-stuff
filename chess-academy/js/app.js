/* Chess Academy — app shell, router and views. */
(function () {
  const $ = (s, el = document) => el.querySelector(s);
  const app = $('#app');
  const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const strip = s => s.replace(/[+#?!]/g, '');
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ---------------- Progress store ---------------- */
  const KEY = 'chessAcademy.v1';
  // Can this browser keep data between visits? (Some block storage for embedded pages.)
  const localOk = (() => { try { localStorage.setItem(KEY + '.t', '1'); localStorage.removeItem(KEY + '.t'); return true; } catch (e) { return false; } })();
  const hasProgress = d => !!(d && ((d.rating && d.rating.n) || Object.keys(d.lessons || {}).length || Object.keys(d.srs || {}).length || d.game));

  /* Cloud save: when the app runs inside Claude, progress is also kept in the
   * signed-in viewer's private area of the artifact database
   * (data/users/<id>/progress), so it survives cleared/blocked browser storage
   * and follows the viewer between devices. Elsewhere this stays inactive. */
  const Cloud = { ref: null, status: 'local', busy: false, pending: false, timer: null };
  Cloud.push = function () {
    if (!Cloud.ref) return;
    clearTimeout(Cloud.timer);
    Cloud.timer = setTimeout(async () => {
      if (Cloud.busy) { Cloud.pending = true; return; }
      Cloud.busy = true;
      try {
        await Cloud.ref.set({ json: JSON.stringify(Store.data), updatedAt: Store.data.updatedAt || Date.now() });
        Cloud.status = 'cloud';
      } catch (e) {
        const code = e && e.code;
        if (code === 'unavailable' || code === 'resource_exhausted') { Cloud.pending = true; }
        else { Cloud.ref = null; Cloud.status = 'local'; }
      }
      Cloud.busy = false; renderHeader();
      if (Cloud.pending) { Cloud.pending = false; setTimeout(Cloud.push, 3000 + Math.random() * 2000); }
    }, 1200);
  };
  async function initCloud() {
    for (let i = 0; i < 20 && !(window.claude && typeof window.claude.use === 'function'); i++) await new Promise(r => setTimeout(r, 150));
    if (!(window.claude && typeof window.claude.use === 'function')) return;
    try {
      const [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
      if (!db || !user) return;
      const id = await user.id();
      if (!id) return;
      const ref = db.doc('data/users/' + id + '/progress');
      const snap = await Promise.race([ref.get(), new Promise((_, rej) => setTimeout(() => rej({ code: 'timeout' }), 10000))]);
      Cloud.ref = ref; Cloud.status = 'cloud';
      let remote = null;
      try { remote = snap.exists ? JSON.parse((snap.data() || {}).json || 'null') : null; } catch (e) { remote = null; }
      if (remote && hasProgress(remote) && (remote.updatedAt || 0) > (Store.data.updatedAt || 0)) {
        Store.data = Object.assign(freshData(), remote);
        try { localStorage.setItem(KEY, JSON.stringify(Store.data)); } catch (e) {}
        renderHeader(); route(); toast('Progress loaded from your Claude account');
      } else if (hasProgress(Store.data)) Cloud.push();
      renderHeader();
    } catch (e) { /* stay on device storage */ }
  }
  function freshData() {
    return { lessons: {}, srs: {}, streak: { last: null, count: 0 }, settings: { coach: true, level: 1 },
      rating: { r: 400, n: 0, ex: 0, games: 0 }, rated: {}, lessonPos: {}, game: null, updatedAt: 0 };
  }
  const Store = {
    data: Object.assign(freshData(),
      (() => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } })()),
    save() {
      this.data.updatedAt = Date.now();
      try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch (e) { /* storage blocked: Cloud (if available) still saves */ }
      Cloud.push();
      renderHeader();
    },
    today() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; },
    touch() {
      const t = this.today(), s = this.data.streak;
      if (s.last !== t) {
        const y = new Date(); y.setDate(y.getDate() - 1);
        const yk = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
        s.count = s.last === yk ? s.count + 1 : 1;
        s.last = t;
      }
      this.save();
    },
    // Spaced repetition (Leitner boxes)
    INTERVALS: [0, 1, 3, 7, 14, 30, 60],
    card(key) { return this.data.srs[key] || { box: 0, due: 0, seen: 0 }; },
    grade(key, ok) {
      const c = this.card(key);
      c.box = ok ? Math.min(c.box + 1, this.INTERVALS.length - 1) : 1;
      c.seen++;
      c.due = Date.now() + this.INTERVALS[ok ? c.box : 0] * 864e5 + (ok ? 0 : 10 * 60e3);
      this.data.srs[key] = c;
      this.save();
      return c;
    },
    isDue(key) { const c = this.data.srs[key]; return c && c.due <= Date.now(); },
    dueCount(opId) {
      const ops = opId ? OPENINGS.filter(o => o.id === opId) : OPENINGS;
      let n = 0; ops.forEach(o => o.lines.forEach((_, i) => { if (this.isDue(`${o.id}:${i}`)) n++; })); return n;
    }
  };

  /* ---------------- Rating estimate ----------------
   * An Elo-style guess. Every rated event is treated as a "game" against an
   * opponent of known strength: a lesson exercise (first attempt only) has a
   * difficulty rating; a bot game uses the bot's estimated rating.
   * The step size shrinks as evidence accumulates, and the displayed range
   * narrows with it. Both difficulty and bot ratings are informed guesses,
   * not calibrated against rated players — the UI says so. */
  const Rating = {
    // Difficulty of the exercises in each lesson (roughly Chess.com rapid scale).
    LESSON: { board: 250, rook: 200, bishop: 250, queen: 250, king: 200, knight: 300, pawn: 300,
      capture: 400, castling: 450, special: 500, mates1: 600, mates2: 700, cct: 650, fork: 850,
      pin: 950, discovery: 1000, principles: 700, mistakes: 750, history: 600, 'rep-intro': 700,
      kqk: 900, pawnend: 1000 },
    get() { return Store.data.rating; },
    expected(r, opp) { return 1 / (1 + Math.pow(10, (opp - r) / 400)); },
    record(opp, score, kind) {
      const R = this.get(), before = Math.round(R.r);
      const weight = kind === 'game' ? 3 : 1;
      const k = (R.n < 10 ? 70 : R.n < 30 ? 45 : R.n < 80 ? 30 : 20) * (kind === 'game' ? 1.5 : 1);
      R.r = Math.max(100, Math.min(2400, R.r + k * (score - this.expected(R.r, opp))));
      R.n += weight;
      if (kind === 'game') R.games++; else R.ex++;
      Store.save();
      return { before, after: Math.round(R.r) };
    },
    range() { const R = this.get(); return Math.max(75, Math.round(350 / Math.sqrt(1 + R.n / 3))); },
    label() {
      const R = this.get(); if (!R.n) return 'Not yet rated';
      return `≈ ${Math.round(R.r)}`;
    },
    describe(r) {
      if (r < 600) return 'New to the game — learning how pieces work together.';
      if (r < 900) return 'Beginner — knows the rules, still losing pieces to simple tactics.';
      if (r < 1200) return 'Improving beginner — spots basic tactics, plays sound openings.';
      if (r < 1500) return 'Club player — solid fundamentals; games are decided by calculation and plans.';
      return 'Strong club player.';
    }
  };

  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast'; t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.classList.add('show'), 10);
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 1600);
  }

  function renderHeader() {
    const d = Store.data;
    const R = d.rating;
    const saveTag = Cloud.status === 'cloud'
      ? '<span class="save-tag ok" title="Your progress is saved to your Claude account and follows you between devices.">☁︎ Saved</span>'
      : localOk ? '' : '<a href="#/library" class="save-tag bad" title="This browser is blocking storage, so progress will be lost when you close the app. Tap for options.">⚠︎ Not saving</a>';
    $('#stats').innerHTML = `${saveTag}<span title="Daily streak">🔥 ${d.streak.count}</span><a href="#/learn" class="lvl" title="Estimated rating — a rough guess from your exercises and bot games">${R.n ? `Rating ≈ ${Math.round(R.r)}` : 'Unrated'}</a>`;
    const due = Store.dueCount();
    const badge = $('#due-badge');
    if (badge) { badge.textContent = due; badge.hidden = !due; }
  }

  /* ---------------- Router ---------------- */
  let cleanup = null;
  function route() {
    if (cleanup) { cleanup(); cleanup = null; }
    const [path, query] = (location.hash.slice(1) || '/').split('?');
    const params = Object.fromEntries(new URLSearchParams(query || ''));
    const parts = path.split('/').filter(Boolean);
    document.querySelectorAll('nav a').forEach(a => a.classList.toggle('active', a.dataset.tab === (parts[0] || 'learn')));
    window.scrollTo(0, 0);
    if (!parts.length || parts[0] === 'learn') viewLearn();
    else if (parts[0] === 'lesson') viewLesson(parts[1]);
    else if (parts[0] === 'openings' && !parts[1]) viewOpenings();
    else if (parts[0] === 'openings') viewOpening(parts[1]);
    else if (parts[0] === 'explore') viewExplore(parts[1], +parts[2] || 0);
    else if (parts[0] === 'setup') viewSetup(parts[1]);
    else if (parts[0] === 'drill') viewDrill(parts[1], params);
    else if (parts[0] === 'play') viewPlay(params);
    else if (parts[0] === 'library') viewLibrary();
    else viewLearn();
  }
  window.addEventListener('hashchange', route);

  /* ---------------- Learn: the path ---------------- */
  function allLessons() { return CURRICULUM.flatMap(u => u.lessons.map(l => Object.assign({ unit: u }, l))); }
  function nextLesson() { return allLessons().find(l => !Store.data.lessons[l.id]); }

  function viewLearn() {
    const next = nextLesson();
    const total = allLessons().length, done = allLessons().filter(l => Store.data.lessons[l.id]).length;
    const due = Store.dueCount();
    app.innerHTML = `
      <section class="hero">
        <div>
          <h1>Learn chess the scholar’s way</h1>
          <p>Short, hands-on lessons that build from the rules to real openings — with the <i>why</i> behind every move.</p>
          <div class="hero-actions">
            ${next ? `<a class="btn primary" href="#/lesson/${next.id}">${done ? 'Continue' : 'Start'}: ${esc(next.title)}</a>` : '<a class="btn primary" href="#/openings">Study openings</a>'}
            ${due ? `<a class="btn" href="#/drill/all">Review ${due} due line${due > 1 ? 's' : ''}</a>` : ''}
          </div>
        </div>
        <div class="progress-ring" style="--p:${Math.round(done / total * 100)}"><span>${done}/${total}<small>lessons</small></span></div>
      </section>
      ${ratingCard()}
      <div class="path">
        ${CURRICULUM.map((u, ui) => `
          <section class="unit">
            <header><span class="unit-icon">${u.icon}</span><div><h2>Unit ${ui + 1} · ${esc(u.title)}</h2><p>${esc(u.blurb)}</p></div></header>
            <div class="nodes">
              ${u.lessons.map(l => {
                const st = Store.data.lessons[l.id];
                const cls = st ? 'done' : (next && next.id === l.id ? 'next' : '');
                return `<a class="node ${cls}" href="#/lesson/${l.id}"><span class="dot">${st ? '✓' : ''}</span><span class="name">${esc(l.title)}</span><span class="xp" title="Approximate rating level of this lesson’s exercises">~${Rating.LESSON[l.id] || ''}</span></a>`;
              }).join('')}
              ${u.id === 'u6' ? '<a class="node link" href="#/openings"><span class="dot">→</span><span class="name">Open the Openings study</span></a>' : ''}
            </div>
          </section>`).join('')}
      </div>`;
  }

  function ratingCard() {
    const R = Rating.get();
    if (!R.n) return `<section class="rating-card"><div class="rating-num">?</div><div><h2>Your estimated rating</h2>
      <p>Complete a few lessons or play the bot and the Academy will estimate your playing strength. Only your <b>first attempt</b> at each exercise counts.</p></div></section>`;
    const r = Math.round(R.r), u = Rating.range();
    return `<section class="rating-card"><div class="rating-num">${r}<small>estimated</small></div><div>
      <h2>Your estimated rating</h2>
      <p><b>Likely between ${Math.max(100, r - u)} and ${r + u}.</b> ${Rating.describe(r)}</p>
      <p class="muted">Based on ${R.ex} exercise${R.ex === 1 ? '' : 's'} and ${R.games} rated bot game${R.games === 1 ? '' : 's'}. This is a rough guess on a Chess.com-style scale, not an official rating; it gets more reliable as you play the bot. <a href="#/library">How it works</a></p>
    </div></section>`;
  }

  /* ---------------- Lesson player ---------------- */
  function viewLesson(id) {
    const lesson = allLessons().find(l => l.id === id);
    if (!lesson) return viewLearn();
    Store.data.lessonPos = Store.data.lessonPos || {};
    let idx = Store.data.lessonPos[id] || 0, mistakes = 0, stepStartMistakes = 0, rBefore = Math.round(Rating.get().r), ratedAny = false;
    if (idx >= lesson.steps.length) idx = 0;
    if (idx > 0) setTimeout(() => toast('Picked up where you left off'), 50);
    app.innerHTML = `
      <div class="lesson">
        <div class="lesson-top"><a href="#/learn" class="close" aria-label="Back to path">✕</a><div class="bar"><div class="fill"></div></div><span class="count"></span><button class="restart" title="Restart this lesson from the beginning" aria-label="Restart lesson">↺</button></div>
        <div class="lesson-body">
          <div class="board-col"><div id="board"></div></div>
          <div class="panel" id="panel"></div>
        </div>
      </div>`;
    const board = new Board($('#board'));
    const panel = $('#panel');
    let stepCleanup = null;

    function show() {
      if (stepCleanup) { stepCleanup(); stepCleanup = null; }
      const st = lesson.steps[idx];
      if ((Store.data.lessonPos[id] || 0) !== idx) { Store.data.lessonPos[id] = idx; Store.save(); }
      $('.fill').style.width = (idx / lesson.steps.length * 100) + '%';
      $('.count').textContent = `${idx + 1} / ${lesson.steps.length}`;
      board.onSquareClick = null; board.onMove = null; board.destsFn = () => [];
      board.showCoords = true; board.setArrows([]); board.setStars([]); board.setCheck(null); board.lastMove = null;
      board.highlights = st.highlights || {};
      board.setOrientation(st.fen && st.fen.split(' ')[1] === 'b' && st.type !== 'text' ? 'black' : 'white');
      board.setFen(st.fen || (st.type === 'stars' || st.type === 'square' ? '8/8/8/8/8/8/8/8 w - - 0 1' : START));
      $('.board-col').classList.toggle('dim', !st.fen && st.type !== 'stars' && st.type !== 'square');
      if (st.arrows) board.setArrows(st.arrows);
      stepStartMistakes = mistakes;
      const steppers = { text: stepText, quiz: stepQuiz, square: stepSquare, stars: stepStars, move: stepMove, play: stepPlay };
      stepCleanup = steppers[st.type](st, board, panel, next, () => mistakes++);
    }
    function next() {
      const st = lesson.steps[idx], key = `${lesson.id}:${idx}`;
      if (['move', 'quiz', 'play'].includes(st.type) && Rating.LESSON[lesson.id] && !Store.data.rated[key]) {
        Store.data.rated[key] = 1;
        Rating.record(Rating.LESSON[lesson.id], mistakes === stepStartMistakes ? 1 : 0, 'exercise');
        ratedAny = true;
      }
      idx++;
      if (idx < lesson.steps.length) return show();
      $('.fill').style.width = '100%';
      const prev = Store.data.lessons[lesson.id];
      const perfect = mistakes === 0;
      Store.data.lessons[lesson.id] = { done: true };
      delete Store.data.lessonPos[lesson.id];
      Store.touch();
      const rAfter = Math.round(Rating.get().r);
      const ratingLine = ratedAny
        ? `<p class="rating-change">Estimated rating: ${rBefore} → <b>${rAfter}</b> (${rAfter >= rBefore ? '+' : ''}${rAfter - rBefore})</p>`
        : '<p class="muted">Repeat attempts don’t change your rating estimate.</p>';
      const nxt = nextLesson();
      panel.innerHTML = `<div class="complete"><div class="big">✓</div><h2>Lesson complete!</h2>
        <p>${perfect ? 'No mistakes.' : `${mistakes} mistake${mistakes > 1 ? 's' : ''} — mistakes are how you learn.`}</p>${ratingLine}
        <div class="row">${nxt ? `<a class="btn primary" href="#/lesson/${nxt.id}">Next: ${esc(nxt.title)}</a>` : ''}<a class="btn" href="#/learn">Back to path</a></div></div>`;
      board.setInteractive(false);
    }
    $('.restart').onclick = () => { idx = 0; mistakes = 0; show(); };
    show();
    cleanup = () => { if (stepCleanup) stepCleanup(); };
  }

  function continueBtn(label = 'Continue') { return `<button class="btn primary continue">${label}</button>`; }

  function stepText(st, board, panel, next) {
    board.setInteractive(false);
    panel.innerHTML = `<h2>${esc(st.title || '')}</h2><div class="prose">${st.body}</div>${continueBtn()}`;
    $('.continue', panel).onclick = next;
  }

  function stepQuiz(st, board, panel, next, miss) {
    board.setInteractive(false);
    panel.innerHTML = `<h2>Question</h2><p class="q">${esc(st.q)}</p><div class="options">${st.options.map((o, i) => `<button class="opt" data-i="${i}">${esc(o)}</button>`).join('')}</div><div class="feedback"></div>`;
    let answered = false;
    panel.querySelectorAll('.opt').forEach(b => b.onclick = () => {
      if (answered) return;
      const i = +b.dataset.i;
      if (i === st.answer) {
        answered = true;
        b.classList.add('right');
        $('.feedback', panel).innerHTML = `<div class="fb good"><b>Correct.</b> ${esc(st.explain)}</div>${continueBtn()}`;
        $('.continue', panel).onclick = next;
      } else {
        miss(); b.classList.add('wrong'); b.disabled = true;
        $('.feedback', panel).innerHTML = '<div class="fb bad">Not quite — try again.</div>';
      }
    });
  }

  function stepSquare(st, board, panel, next, miss) {
    const files = 'abcdefgh';
    let n = 0, target, errs = 0;
    board.showCoords = false; board.render();
    panel.innerHTML = `<h2>Coordinate drill</h2><p>${esc(st.prompt)}</p><div class="target-sq"></div><p class="muted">Coordinates are hidden — use “light on the right”. <span class="score"></span></p><div class="feedback"></div>`;
    function pick() { target = files[Math.floor(Math.random() * 8)] + (1 + Math.floor(Math.random() * 8)); $('.target-sq', panel).textContent = target; $('.score', panel).textContent = `${n}/${st.count}`; }
    board.onSquareClick = (sq) => {
      if (n >= st.count) return;
      if (sq === target) { board.flash(sq, 'good'); n++; if (n >= st.count) finish(); else pick(); }
      else { board.flash(sq, 'bad'); errs++; miss(); $('.feedback', panel).innerHTML = `<div class="fb bad">That was ${sq}.</div>`; }
    };
    function finish() {
      $('.target-sq', panel).textContent = '✓';
      $('.score', panel).textContent = `${n}/${st.count}`;
      $('.feedback', panel).innerHTML = `<div class="fb good">${errs ? `Done, with ${errs} slip${errs > 1 ? 's' : ''}.` : 'Perfect!'}</div>${continueBtn()}`;
      $('.continue', panel).onclick = next;
    }
    pick();
    return () => { board.onSquareClick = null; board.showCoords = true; };
  }

  // Piece movement on an otherwise empty board (for star exercises)
  function freeDests(piece, from) {
    const f = 'abcdefgh'.indexOf(from[0]), r = +from[1] - 1, out = [];
    const add = (x, y) => { if (x >= 0 && x < 8 && y >= 0 && y < 8) out.push('abcdefgh'[x] + (y + 1)); };
    const rays = { R: [[1, 0], [-1, 0], [0, 1], [0, -1]], B: [[1, 1], [1, -1], [-1, 1], [-1, -1]] };
    rays.Q = rays.R.concat(rays.B);
    const t = piece[1];
    if (rays[t]) for (const [dx, dy] of rays[t]) for (let k = 1; k < 8; k++) add(f + dx * k, r + dy * k);
    if (t === 'K') for (const [dx, dy] of rays.Q) add(f + dx, r + dy);
    if (t === 'N') for (const [dx, dy] of [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]]) add(f + dx, r + dy);
    if (t === 'P') { add(f, r + 1); if (r === 1) add(f, r + 2); }
    return out;
  }

  function stepStars(st, board, panel, next) {
    let pos = st.start, stars = st.stars.slice(), moves = 0;
    const draw = () => { board.setPosition({ [pos]: st.piece }); board.setStars(stars); };
    board.destsFn = (sq) => sq === pos ? freeDests(st.piece, pos) : [];
    board.noPromotion = true;
    board.setInteractive(true);
    panel.innerHTML = `<h2>Collect the stars</h2><p>${esc(st.prompt)}</p><p class="muted">Moves: <b class="mv">0</b> · Stars left: <b class="left">${stars.length}</b></p><div class="feedback"></div><button class="btn small reset">Restart</button>`;
    board.onMove = (from, to) => {
      pos = to; moves++;
      if (stars.includes(to)) { stars = stars.filter(s => s !== to); board.flash(to, 'good'); }
      draw();
      $('.mv', panel).textContent = moves; $('.left', panel).textContent = stars.length;
      if (!stars.length) {
        board.setInteractive(false);
        $('.feedback', panel).innerHTML = `<div class="fb good">All stars collected in ${moves} moves!</div>${continueBtn()}`;
        $('.continue', panel).onclick = next;
      }
    };
    $('.reset', panel).onclick = () => { pos = st.start; stars = st.stars.slice(); moves = 0; draw(); board.setInteractive(true); $('.mv', panel).textContent = 0; $('.left', panel).textContent = stars.length; $('.feedback', panel).innerHTML = ''; };
    draw();
    return () => { board.noPromotion = false; };
  }

  function chessDests(game) {
    return (sq) => game.moves({ square: sq, verbose: true }).map(m => m.to);
  }
  function syncBoard(board, game, last) {
    board.setFen(game.fen());
    if (last) board.setLastMove(last.from, last.to);
    let check = null;
    if (game.in_check()) {
      const b = game.board();
      for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) { const p = b[r][f]; if (p && p.type === 'k' && p.color === game.turn()) check = 'abcdefgh'[f] + (8 - r); }
    }
    board.setCheck(check);
  }
  function sanToMove(fen, san) { const g = new Chess(fen); return g.move(san); }

  /* Explain why a move the student played is not the move being taught.
   * 1) a written "why not" note for that position, if there is one;
   * 2) otherwise the engine's concrete punishment (best reply + material swing);
   * 3) otherwise an honest "not a blunder, but not the move we're learning". */
  const PIECE = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
  let bookByFen = null;
  function bookElsewhere(fen, san) {
    if (!bookByFen) {
      bookByFen = {};
      for (const o of OPENINGS) for (const l of o.lines) {
        const g = new Chess();
        for (const [m] of l.moves) {
          const k = g.fen().split(' ').slice(0, 2).join(' ');
          (bookByFen[k] = bookByFen[k] || {})[strip(m)] = bookByFen[k][strip(m)] || { name: o.name, tier: (TIERS.find(t => t.id === o.tier) || {}).name };
          if (!g.move(m)) break;
        }
      }
    }
    const hit = bookByFen[fen.split(' ').slice(0, 2).join(' ')];
    return hit && hit[strip(san)];
  }
  let whyNotByFen = null;
  function whyNotFor(fen) {
    if (!whyNotByFen) {
      whyNotByFen = {};
      for (const k of Object.keys(WHY_NOT)) { const g = new Chess(); if (!k || k.split(' ').every(m => g.move(m))) whyNotByFen[g.fen().split(' ').slice(0, 2).join(' ')] = WHY_NOT[k]; }
    }
    return whyNotByFen[fen.split(' ').slice(0, 2).join(' ')];
  }
  function explainWrongMove(fenBefore, san, bookSan, key, mateGoal) {
    const notes = key !== null ? WHY_NOT[key] : whyNotFor(fenBefore);
    const note = notes && Object.entries(notes).find(([m]) => strip(m) === strip(san));
    if (note) return { html: `<p class="whynot-h">Why not ${esc(san)}?</p><p>${esc(note[1])}</p>`, arrow: null };
    const other = bookElsewhere(fenBefore, san);
    if (other) return { html: `<p><b>${esc(san)}</b> is a good move: it’s the <b>${esc(other.name)}</b>${other.tier ? ` (${esc(other.tier)} level)` : ''}, also in this course. It just isn’t the opening this ${key !== null ? 'line' : 'exercise'} is teaching.</p>`, arrow: null };
    const g = new Chess(fenBefore); g.move(san);
    if (g.in_stalemate()) return { html: '<p>That is <b>stalemate</b>: your opponent has no legal move but is not in check, so the game is a draw.</p>', arrow: null };
    const r = Engine.search(g.fen(), 2, 0);
    if (!r) return { html: '', arrow: null };
    const reply = r.move, arrow = { from: reply.from, to: reply.to, color: 'red' };
    const replyTxt = `<b>${esc(reply.san)}</b>`;
    if (reply.san.includes('#')) return { html: `<p>It allows checkmate: your opponent replies ${replyTxt}.</p>`, arrow };
    const after = -r.score;
    let book = null;
    if (bookSan) { const gb = new Chess(fenBefore); if (gb.move(bookSan)) book = -Engine.scoreFor(gb.fen(), 2); }
    const drop = book === null ? 0 : book - after;
    if (r.score > Engine.MATE - 100) return { html: `<p>It walks into a forced mate, starting with ${replyTxt}.</p>`, arrow };
    if (drop >= 150) {
      const what = reply.captured ? ` capturing your ${PIECE[reply.captured]}` : '';
      return { html: `<p>It loses material: your opponent replies ${replyTxt}${what}. The engine rates it about <b>${Math.round(drop / 100)} pawn${Math.round(drop / 100) === 1 ? '' : 's'}</b> worse than the right move.</p>`, arrow };
    }
    if (mateGoal) return { html: `<p>It isn’t checkmate: your opponent can answer ${replyTxt}.</p>`, arrow };
    return { html: `<p>It isn’t a blunder: the engine sees no material loss after ${esc(san)}. But it isn’t the move this ${key !== null ? 'line' : 'exercise'} teaches, and it doesn’t carry out the plan explained here.</p>`, arrow: null };
  }

  function stepMove(st, board, panel, next, miss) {
    const game = new Chess(st.fen);
    let ply = 0, tries = 0, timer = null;
    const userColor = game.turn();
    board.destsFn = (sq) => game.turn() === userColor ? chessDests(game)(sq) : [];
    board.setInteractive(true);
    panel.innerHTML = `<h2>${userColor === 'w' ? 'White' : 'Black'} to move</h2><p class="q">${esc(st.prompt)}</p><div class="feedback"></div><div class="row"><button class="btn small hint">Hint</button><button class="btn small reset">Reset</button></div>`;
    const fb = $('.feedback', panel);
    const expected = () => { const e = st.solution && st.solution[ply]; return e ? (Array.isArray(e) ? e : [e]) : null; };
    function reset() { game.load(st.fen); ply = 0; syncBoard(board, game); board.setArrows([]); board.setInteractive(true); fb.innerHTML = ''; }
    board.onMove = (from, to, promotion) => {
      const fenBefore = game.fen();
      const mv = game.move({ from, to, promotion: promotion || 'q' });
      if (!mv) return syncBoard(board, game);
      let ok;
      if (st.goal === 'mate') ok = game.in_checkmate();
      else ok = expected().map(strip).includes(strip(mv.san));
      if (!ok) {
        game.undo(); miss(); tries++;
        board.shake(); board.flash(to, 'bad'); syncBoard(board, game);
        const ex = explainWrongMove(fenBefore, mv.san, st.goal === 'mate' ? null : expected()[0], null, st.goal === 'mate');
        fb.innerHTML = `<div class="fb bad"><b>${esc(mv.san)}</b> isn’t it. ${ex.html}<p>${tries >= 2 ? 'The blue arrow shows the right move.' : 'Try again.'}</p></div>`;
        board.setArrows(ex.arrow ? [ex.arrow] : []);
        if (tries >= 2) showAnswer(fenBefore, ex.arrow);
        return;
      }
      board.setArrows([]);
      syncBoard(board, game, mv); board.flash(to, 'good');
      ply++;
      const done = st.goal === 'mate' || ply >= st.solution.length;
      if (done) {
        board.setInteractive(false);
        fb.innerHTML = `<div class="fb good"><b>${esc(mv.san)}!</b> ${esc(st.explain || '')}</div>${continueBtn()}`;
        $('.continue', panel).onclick = next;
        return;
      }
      fb.innerHTML = `<div class="fb good"><b>${esc(mv.san)}</b> — good. Opponent replies…</div>`;
      timer = setTimeout(() => {
        const reply = game.move(st.solution[ply]); ply++; tries = 0;
        syncBoard(board, game, reply);
        fb.innerHTML = `<div class="fb">Opponent played <b>${esc(reply.san)}</b>. Your move.</div>`;
      }, 600);
    };
    function showAnswer(fen, extra) {
      let m;
      if (st.goal === 'mate') {
        const g = new Chess(fen);
        m = g.moves({ verbose: true }).find(m => { g.move(m); const r = g.in_checkmate(); g.undo(); return r; });
      } else m = sanToMove(fen, expected()[0]);
      if (m) board.setArrows([{ from: m.from, to: m.to, color: 'blue' }].concat(extra ? [extra] : []));
    }
    $('.hint', panel).onclick = () => { fb.innerHTML = `<div class="fb">💡 ${esc(st.hint || 'Look for checks, captures and threats.')}</div>`; };
    $('.reset', panel).onclick = reset;
    syncBoard(board, game);
    return () => clearTimeout(timer);
  }

  function stepPlay(st, board, panel, next, miss) {
    let game, moves, timer;
    panel.innerHTML = `<h2>Your turn</h2><p class="q">${esc(st.prompt)}</p><p class="muted">Moves used: <b class="used">0</b> / ${st.maxMoves}</p><div class="feedback"></div><button class="btn small reset">Restart</button>`;
    const fb = $('.feedback', panel);
    function start() {
      game = new Chess(st.fen); moves = 0;
      board.destsFn = (sq) => game.turn() === 'w' ? chessDests(game)(sq) : [];
      board.setInteractive(true); syncBoard(board, game); fb.innerHTML = ''; $('.used', panel).textContent = 0;
    }
    board.onMove = (from, to, promotion) => {
      const mv = game.move({ from, to, promotion: promotion || 'q' });
      if (!mv) return syncBoard(board, game);
      moves++; $('.used', panel).textContent = moves;
      syncBoard(board, game, mv);
      if (game.in_checkmate()) {
        board.setInteractive(false);
        fb.innerHTML = `<div class="fb good"><b>Checkmate in ${moves} moves!</b> You’ve mastered a fundamental technique.</div>${continueBtn()}`;
        $('.continue', panel).onclick = next; return;
      }
      if (game.in_draw() || game.in_stalemate()) { miss(); board.setInteractive(false); fb.innerHTML = `<div class="fb bad"><b>${game.in_stalemate() ? 'Stalemate!' : 'Draw.'}</b> Leave the king a square until the final blow. Press Restart.</div>`; return; }
      if (moves >= st.maxMoves) { miss(); board.setInteractive(false); fb.innerHTML = '<div class="fb bad">Out of moves. Shrink the box faster and bring your king. Press Restart.</div>'; return; }
      board.setInteractive(false);
      timer = setTimeout(() => {
        const r = Engine.search(game.fen(), st.depth || 2, 0);
        const reply = game.move(r.move);
        syncBoard(board, game, reply); board.setInteractive(true);
      }, 300);
    };
    $('.reset', panel).onclick = start;
    start();
    return () => clearTimeout(timer);
  }

  /* ---------------- Openings ---------------- */
  const TIERS = [
    { id: 'beginner', name: 'Beginner', range: 'roughly under 800',
      blurb: 'Pure opening principles: develop, castle, control the centre. Little to memorise.' },
    { id: 'novice', name: 'Novice', range: 'roughly 800–1200',
      blurb: 'Solid, classical systems with a few key lines you need to know.' },
    { id: 'pro', name: 'Pro', range: 'roughly 1200–1800',
      blurb: 'Deeper strategic openings with real theory and long-term plans.' },
    { id: 'champ', name: 'Champ', range: 'roughly 1800+',
      blurb: 'Elite, theory-heavy weapons used in World Championship play. Learn these once your tactics are strong.' }
  ];
  function tierFor(rating) { return rating < 800 ? 'beginner' : rating < 1200 ? 'novice' : rating < 1800 ? 'pro' : 'champ'; }
  let openingFilter = 'all';
  function viewOpenings() {
    const R = Rating.get();
    const rec = R.n ? tierFor(R.r) : 'beginner';
    const card = o => {
      const due = Store.dueCount(o.id);
      const learned = o.lines.filter((_, i) => Store.data.srs[`${o.id}:${i}`]).length;
      return `<a class="op-card" href="#/openings/${o.id}">
        <div class="mini" data-fen="${finalFen(o.lines[0])}" data-orient="${o.side}"></div>
        <div><p class="side-tag ${o.side}">${o.side === 'white' ? 'As White' : 'As Black'}</p><h3>${esc(o.name)}</h3><p class="first">${esc(o.first)}</p><p>${esc(o.tagline)}</p>
        <p class="muted">${o.lines.length} lines · ${learned} studied${due ? ` · <b class="due">${due} due</b>` : ''}</p></div></a>`;
    };
    const shown = o => openingFilter === 'all' || o.side === openingFilter;
    app.innerHTML = `
      <section class="page-head"><h1>Openings</h1><p>${OPENINGS.length} sound, established openings in four levels. For each one you get <b>why</b> it works, the plans, and lines with an explanation for <i>every</i> move. Then train it with spaced repetition.</p>
      <div class="row">
        <div class="seg" role="tablist">${[['all', 'All'], ['white', 'As White'], ['black', 'As Black']].map(([k, l]) => `<button role="tab" class="${openingFilter === k ? 'on' : ''}" data-f="${k}">${l}</button>`).join('')}</div>
        ${Store.dueCount() ? `<a class="btn primary small" href="#/drill/all">Review all due lines (${Store.dueCount()})</a>` : ''}
      </div></section>
      ${TIERS.map(t => {
        const ops = OPENINGS.filter(o => o.tier === t.id && shown(o));
        if (!ops.length) return '';
        return `<section class="tier">
          <div class="tier-head"><h2 class="group">${t.name}</h2><span class="tier-range">${t.range}</span>${t.id === rec ? `<span class="tier-rec">${R.n ? 'Recommended for your rating' : 'Start here'}</span>` : ''}</div>
          <p class="tier-blurb">${t.blurb}</p>
          <div class="op-grid">${ops.map(card).join('')}</div></section>`;
      }).join('')}
      <section class="note"><h3>How these were chosen</h3><p>Every opening here is a sound main line that is still played by strong players. There are no dubious gambits or trick openings. Each line was checked move by move for legality, and an engine check confirmed that no line ends with your side materially worse. The levels are a guide to how much theory and calculation an opening demands, not a rule: a beginner can play the Ruy Lopez, and champions still play the Italian. The rating ranges are rough and use the same scale as your estimate. A sensible repertoire is one opening as White, one against 1.e4 and one against 1.d4, chosen from your level.</p></section>`;
    app.querySelectorAll('.seg button').forEach(b => b.onclick = () => { openingFilter = b.dataset.f; viewOpenings(); });
    renderMinis();
  }

  function finalFen(line) { const g = new Chess(); line.moves.forEach(([m]) => g.move(m)); return g.fen(); }
  function renderMinis() {
    document.querySelectorAll('.mini').forEach(el => {
      const b = new Board(el, { coords: false, orientation: el.dataset.orient });
      b.setInteractive(false); b.setFen(el.dataset.fen);
    });
  }

  function viewOpening(id) {
    const o = OPENINGS.find(x => x.id === id);
    if (!o) return viewOpenings();
    app.innerHTML = `
      <a href="#/openings" class="back">← All openings</a>
      <section class="op-head">
        <div class="mini big" data-fen="${finalFen(o.lines[0])}" data-orient="${o.side}"></div>
        <div>
          <p class="eyebrow">${(TIERS.find(t => t.id === o.tier) || {}).name || ''} · You play ${o.side === 'white' ? 'White' : 'Black'} · ECO ${esc(o.eco)}</p>
          <h1>${esc(o.name)}</h1><p class="first">${esc(o.first)}</p><p>${esc(o.tagline)}</p>
          <h3>Why play it</h3><ul class="why">${o.why.map(w => `<li>${w}</li>`).join('')}</ul>
          <div class="prose">${o.plans}</div>
          <div class="row"><a class="btn primary" href="#/setup/${o.id}">How to set it up</a><a class="btn" href="#/explore/${o.id}/0">Explore the main line</a></div>
        </div>
      </section>
      <h2 class="group">Lines</h2>
      <div class="lines">${o.lines.map((l, i) => {
        const c = Store.data.srs[`${o.id}:${i}`];
        const status = !c ? '<span class="tag">New</span>' : Store.isDue(`${o.id}:${i}`) ? '<span class="tag due">Due</span>' : `<span class="tag ok">Box ${c.box}</span>`;
        return `<div class="line-row"><div><h4>${esc(l.name)} ${status}</h4><p class="muted mono">${esc(pgn(l.moves.map(m => m[0])))}</p></div>
          <div class="row"><a class="btn small" href="#/explore/${o.id}/${i}">Explore</a><a class="btn small primary" href="#/drill/${o.id}?line=${i}">Drill</a><a class="btn small" href="#/play?opening=${o.id}&line=${i}">Play from here</a></div></div>`;
      }).join('')}</div>
      <div class="row center"><a class="btn primary" href="#/drill/${o.id}">Drill all ${o.lines.length} lines</a></div>`;
    renderMinis();
  }

  function pgn(sans, startPly = 0) {
    return sans.map((s, i) => { const p = i + startPly; return (p % 2 === 0 ? `${p / 2 + 1}.` : (i === 0 ? `${Math.floor(p / 2) + 1}...` : '')) + s; }).join(' ');
  }

  /* ---------------- Setup guide ----------------
   * Shows the formation the student is aiming for (main line, final position),
   * with arrows from each of their pieces' starting squares, then the moves in
   * plain English, step by step. */
  const PNAME = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
  function plainMove(m) {
    const chk = m.san.includes('#') ? ' Checkmate!' : m.san.includes('+') ? ' (This gives check.)' : '';
    if (m.flags.includes('k')) return `Castle kingside: your king goes to ${m.to} and the rook jumps to ${m.color === 'w' ? 'f1' : 'f8'}.` + chk;
    if (m.flags.includes('q')) return `Castle queenside: your king goes to ${m.to} and the rook jumps to ${m.color === 'w' ? 'd1' : 'd8'}.` + chk;
    if (m.piece === 'p') {
      if (m.captured) return `Your ${m.from[0]}-pawn captures the ${PNAME[m.captured]} on ${m.to}.` + chk;
      return `Push your ${m.from[0]}-pawn ${m.flags.includes('b') ? 'two squares' : 'one square'} to ${m.to}.` + chk;
    }
    if (m.captured) return `Your ${PNAME[m.piece]} on ${m.from} captures the ${PNAME[m.captured]} on ${m.to}.` + chk;
    return `Move your ${PNAME[m.piece]} from ${m.from} to ${m.to}.` + chk;
  }
  function plainTheirs(m) {
    if (m.flags.includes('k')) return 'castles kingside';
    if (m.flags.includes('q')) return 'castles queenside';
    if (m.piece === 'p') return m.captured ? `takes on ${m.to} with a pawn` : `pushes a pawn to ${m.to}`;
    return `${m.captured ? 'takes on ' + m.to + ' with the ' + PNAME[m.piece] : 'puts the ' + PNAME[m.piece] + ' on ' + m.to}`;
  }
  // Track every piece from its starting square through a line of moves.
  function trackPieces(moves) {
    const g = new Chess(), origin = {};
    for (const row of g.board()) for (const p of row) if (p) origin[p.square] = p.square;
    const verbose = [];
    for (const [san] of moves) {
      const m = g.move(san); verbose.push(m);
      const o = origin[m.from]; delete origin[m.from];
      if (m.flags.includes('e')) delete origin[m.to[0] + m.from[1]];
      origin[m.to] = o;
      if (m.flags.includes('k') || m.flags.includes('q')) {
        const r = m.color === 'w' ? '1' : '8';
        const [rf, rt] = m.flags.includes('k') ? ['h' + r, 'f' + r] : ['a' + r, 'd' + r];
        origin[rt] = origin[rf]; delete origin[rf];
      }
    }
    return { game: g, origin, verbose };
  }

  function viewSetup(id) {
    const o = OPENINGS.find(x => x.id === id);
    if (!o) return viewOpenings();
    const line = o.lines[0];
    const me = o.side === 'white' ? 'w' : 'b';
    const { game: finalGame, origin, verbose } = trackPieces(line.moves);
    const finalArrows = [], finalHl = {};
    for (const row of finalGame.board()) for (const p of row) {
      if (!p || p.color !== me) continue;
      const from = origin[p.square];
      if (from && from !== p.square) { finalArrows.push({ from, to: p.square, color: 'green' }); finalHl[p.square] = 'green'; }
    }
    const myPlies = verbose.map((m, k) => m.color === me ? k : -1).filter(k => k >= 0);
    const total = myPlies.length;

    app.innerHTML = `
      <a href="#/openings/${o.id}" class="back">← ${esc(o.name)}</a>
      <div class="lesson-top"><div class="bar"><div class="fill"></div></div><span class="count"></span>
        <button class="restart" title="Start again" aria-label="Start again">↺</button></div>
      <div class="lesson-body">
        <div class="board-col"><div id="board"></div></div>
        <div class="panel" id="panel"></div>
      </div>`;
    const board = new Board($('#board'), { orientation: o.side });
    const panel = $('#panel');
    const game = new Chess();
    let ply = 0, timer = null, tries = 0;

    const stepNo = () => myPlies.filter(k => k < ply).length;           // my moves already made
    function progress() {
      const done = stepNo();
      $('.fill').style.width = (done / total * 100) + '%';
      $('.count').textContent = done < total ? `Step ${Math.min(done + 1, total)} of ${total}` : 'Done';
    }
    function rebuild(toPly) {
      clearTimeout(timer);
      game.reset(); for (let j = 0; j < toPly; j++) game.move(line.moves[j][0]);
      ply = toPly;
    }

    // The opponent moves on their own, with a short explanation.
    function opponentTurn(after) {
      const [san, why] = line.moves[ply];
      board.setInteractive(false);
      timer = setTimeout(() => {
        const m = game.move(san); ply++;
        syncBoard(board, game, m);
        board.setArrows([{ from: m.from, to: m.to, color: 'red' }]); board.setHighlights({});
        after(m, why);
      }, 650);
    }

    function intro() {
      rebuild(0); progress();
      syncBoard(board, game); board.setLastMove(null); board.setArrows(finalArrows); board.setHighlights(finalHl); board.setInteractive(false);
      panel.innerHTML = `<p class="eyebrow">How to set it up · you play ${o.side === 'white' ? 'White' : 'Black'}</p>
        <h2>${esc(o.name)}: step by step</h2>
        <p>The board shows the <b>goal</b>: the green squares are where your pieces will stand, and the arrows show where each one comes from.</p>
        <p>We’ll get there in <b>${total} moves</b>. For each step you’ll see which piece to move and where it goes. Make the move yourself, and I’ll explain why it’s played and what your opponent does next.</p>
        ${me === 'b' ? '<p class="muted">You play Black, so your opponent moves first.</p>' : ''}
        <button class="btn primary continue" id="go">Start step 1</button>`;
      $('#go').onclick = () => { rebuild(0); syncBoard(board, game); board.setHighlights({}); board.setArrows([]); next(); };
    }

    function next(oppMove, oppWhy) {
      progress();
      if (ply >= line.moves.length) return finish(oppMove, oppWhy);
      if (game.turn() !== me) {
        panel.innerHTML = `<p class="eyebrow">${stepNo() ? `Step ${stepNo()} done` : 'Your opponent starts'}</p><p class="muted">Your opponent is moving…</p>`;
        return opponentTurn((m, why) => next(m, why));
      }
      tries = 0;
      const want = verbose[ply], stepPly = ply;
      const n = stepNo() + 1;
      board.setHighlights({ [want.from]: 'blue', [want.to]: 'green' });
      board.setArrows(oppMove ? [{ from: oppMove.from, to: oppMove.to, color: 'red' }] : []);
      board.destsFn = sq => game.turn() === me ? chessDests(game)(sq) : [];
      board.setInteractive(true);
      panel.innerHTML = `
        ${oppMove ? `<div class="opp-move"><p class="eyebrow">Your opponent played ${esc(pgn([oppMove.san], ply - 1))}</p><p>${esc(oppWhy)}</p></div>` : ''}
        <p class="eyebrow">Step ${n} of ${total}</p>
        <h2 class="step-do">${esc(plainMove(want))}</h2>
        <p class="muted">The <span class="key blue"></span> square is the piece to move and the <span class="key green"></span> square is where it goes. Drag it there, or tap it then tap the square.</p>
        <div class="feedback"></div>
        <div class="row"><button class="btn small" id="showme">Show me</button>${n > 1 ? '<button class="btn small" id="back">← Previous step</button>' : ''}</div>`;
      $('#showme').onclick = () => played(game.move(want.san), true);
      if ($('#back')) $('#back').onclick = () => {
        const prevMine = myPlies.filter(k => k < stepPly).pop();
        rebuild(prevMine); syncBoard(board, game);
        const prev = ply > 0 ? game.history({ verbose: true }).slice(-1)[0] : null;
        next(prev && prev.color !== me ? prev : null, prev && prev.color !== me ? line.moves[ply - 1][1] : '');
      };
      board.onMove = (from, to, promotion) => {
        const fenBefore = game.fen();
        const mv = game.move({ from, to, promotion: promotion || 'q' });
        if (!mv) return syncBoard(board, game);
        if (strip(mv.san) !== strip(want.san)) {
          game.undo(); tries++;
          board.shake(); syncBoard(board, game); board.setHighlights({ [want.from]: 'blue', [want.to]: 'green' });
          const ex = explainWrongMove(fenBefore, mv.san, want.san, line.moves.slice(0, ply).map(x => x[0]).join(' '), false);
          board.setArrows([{ from: want.from, to: want.to, color: 'blue' }].concat(ex.arrow ? [ex.arrow] : []));
          $('.feedback', panel).innerHTML = `<div class="fb bad"><p><b>Not ${esc(mv.san)}.</b></p>${ex.html}<p>Move the piece on the blue square to the green square.</p></div>`;
          return;
        }
        played(mv, false);
      };
    }

    function played(mv, shown) {
      ply++;
      board.setInteractive(false);
      syncBoard(board, game, mv); board.setHighlights({ [mv.to]: 'green' }); board.setArrows([]); board.flash(mv.to, 'good');
      const why = line.moves[ply - 1][1];
      const last = ply >= line.moves.length;
      $('.feedback', panel).innerHTML = `<div class="fb good"><p><b>${shown ? 'Here it is:' : '✓ Well done!'} ${esc(pgn([mv.san], ply - 1))}</b></p><p><b>Why:</b> ${esc(why)}</p></div>
        <button class="btn primary continue" id="nx">${last ? 'See the finished setup' : 'Next step'}</button>`;
      $('#showme').remove();
      $('#nx').onclick = () => next();
      progress();
    }

    function finish(oppMove, oppWhy) {
      board.setInteractive(false);
      syncBoard(board, game); board.setLastMove(null); board.setArrows(finalArrows); board.setHighlights(finalHl);
      panel.innerHTML = `
        ${oppMove ? `<div class="opp-move"><p class="eyebrow">Your opponent played ${esc(pgn([oppMove.san], ply - 1))}</p><p>${esc(oppWhy)}</p></div>` : ''}
        <div class="complete"><div class="big">✓</div><h2>Setup complete!</h2>
        <p>You’ve built the ${esc(o.name)} in ${total} moves. The arrows show where every piece came from.</p></div>
        <div class="note setup-tip"><p>${o.plans}</p><p class="muted">Opponents won’t always play these exact moves. Keep the goal formation in mind, and check the “Why not …?” notes in Explore.</p></div>
        <div class="row"><button class="btn" id="again">Do it again</button><a class="btn primary" href="#/drill/${o.id}?line=0">Practise from memory</a><a class="btn" href="#/play?opening=${o.id}&line=0">Play a game from here</a></div>`;
      $('#again').onclick = intro;
      Store.touch();
    }

    $('.restart').onclick = intro;
    cleanup = () => clearTimeout(timer);
    intro();
  }

  function whyNotHtml(key, bookSan, plyIndex) {
    const alts = Object.entries(WHY_NOT[key] || {}).filter(([m]) => strip(m) !== strip(bookSan));
    if (!alts.length) return '';
    return `<div class="whynot">${alts.map(([m, r]) => `<p class="whynot-h">Why not ${esc(pgn([m], plyIndex))}?</p><p>${esc(r)}</p>`).join('')}</div>`;
  }

  function viewExplore(id, li) {
    const o = OPENINGS.find(x => x.id === id);
    if (!o || !o.lines[li]) return viewOpenings();
    const line = o.lines[li];
    let ply = 0;
    app.innerHTML = `
      <a href="#/openings/${o.id}" class="back">← ${esc(o.name)}</a>
      <div class="lesson-body">
        <div class="board-col"><div id="board"></div>
          <div class="row center controls"><button class="btn small" data-a="first" aria-label="Start">⏮</button><button class="btn small" data-a="prev" aria-label="Previous">◀</button><button class="btn small primary" data-a="next" aria-label="Next">▶</button><button class="btn small" data-a="last" aria-label="End">⏭</button><button class="btn small" data-a="flip" aria-label="Flip board">⇅</button></div>
        </div>
        <div class="panel"><p class="eyebrow">Explore · ${esc(o.name)}</p><h2>${esc(line.name)}</h2><div class="comment"></div><div class="movelist"></div>
          <div class="row"><a class="btn primary" href="#/drill/${o.id}?line=${li}">Drill this line</a><a class="btn" href="#/play?opening=${o.id}&line=${li}">Play from the end</a></div>
          <p class="muted">Tip: use ← → keys.</p></div>
      </div>`;
    const board = new Board($('#board'), { orientation: o.side });
    board.setInteractive(false);
    function draw() {
      const g = new Chess(); let last = null;
      for (let i = 0; i < ply; i++) last = g.move(line.moves[i][0]);
      board.setFen(g.fen()); board.setLastMove(last && last.from, last && last.to);
      const nextMv = line.moves[ply];
      board.setArrows(nextMv ? [(() => { const m = sanToMove(g.fen(), nextMv[0]); return { from: m.from, to: m.to, color: 'blue' }; })()] : []);
      const cur = line.moves[ply - 1];
      $('.comment').innerHTML = ply === 0
        ? `<p>Starting position. The blue arrow shows the next move. Press ▶ to step through the line.</p>`
        : `<p class="mv-title">${esc(pgn([cur[0]], ply - 1))}</p><p>${esc(cur[1])}</p>${whyNotHtml(line.moves.slice(0, ply - 1).map(m => m[0]).join(' '), cur[0], ply - 1)}`;
      $('.movelist').innerHTML = line.moves.map((m, i) => `${i % 2 === 0 ? `<span class="num">${i / 2 + 1}.</span>` : ''}<button class="mv ${i === ply - 1 ? 'cur' : ''}" data-p="${i + 1}">${esc(m[0])}</button>`).join('');
      $('.movelist').querySelectorAll('.mv').forEach(b => b.onclick = () => { ply = +b.dataset.p; draw(); });
    }
    const act = a => { if (a === 'first') ply = 0; if (a === 'prev') ply = Math.max(0, ply - 1); if (a === 'next') ply = Math.min(line.moves.length, ply + 1); if (a === 'last') ply = line.moves.length; if (a === 'flip') board.flip(); draw(); };
    document.querySelectorAll('.controls button').forEach(b => b.onclick = () => act(b.dataset.a));
    const key = e => { if (e.key === 'ArrowRight') act('next'); if (e.key === 'ArrowLeft') act('prev'); };
    window.addEventListener('keydown', key);
    cleanup = () => window.removeEventListener('keydown', key);
    draw();
  }

  /* ---------------- Drill (spaced repetition) ---------------- */
  function viewDrill(id, params) {
    let queue = [];
    const ops = id === 'all' ? OPENINGS : OPENINGS.filter(o => o.id === id);
    if (!ops.length) return viewOpenings();
    ops.forEach(o => o.lines.forEach((l, i) => {
      if (params.line !== undefined && +params.line !== i) return;
      const key = `${o.id}:${i}`;
      if (id === 'all' && !Store.isDue(key)) return;
      queue.push({ o, l, i, key, due: Store.card(key).due });
    }));
    queue.sort((a, b) => a.due - b.due);
    if (!queue.length) {
      app.innerHTML = `<section class="page-head"><h1>Nothing due</h1><p>All your studied lines are scheduled for later. Come back tomorrow, or drill an opening anyway.</p><a class="btn primary" href="#/openings">Openings</a></section>`;
      return;
    }
    let qi = 0, results = [];
    app.innerHTML = `
      <a href="#/openings${id === 'all' ? '' : '/' + id}" class="back">← Back</a>
      <div class="lesson-body">
        <div class="board-col"><div id="board"></div></div>
        <div class="panel" id="panel"></div>
      </div>`;
    const board = new Board($('#board'));
    const panel = $('#panel');
    let timer = null;
    cleanup = () => clearTimeout(timer);

    function runLine() {
      const { o, l, key } = queue[qi];
      const user = o.side === 'white' ? 'w' : 'b';
      const game = new Chess();
      let ply = 0, failed = false, mustPlay = null;
      board.setOrientation(o.side); syncBoard(board, game); board.setArrows([]); board.setLastMove(null);
      panel.innerHTML = `<p class="eyebrow">Drill ${qi + 1} / ${queue.length} · ${esc(o.name)}</p><h2>${esc(l.name)}</h2>
        <p>Play the <b>${o.side}</b> moves from memory. Opponent moves are played for you.</p>
        <div class="comment"></div><div class="feedback"></div><p class="muted mono progress-moves"></p>`;
      const fb = $('.feedback', panel), cm = $('.comment', panel);
      board.destsFn = sq => (game.turn() === user && ply < l.moves.length) ? chessDests(game)(sq) : [];
      const showMoves = () => { $('.progress-moves', panel).textContent = pgn(game.history()); };
      function advance() {
        showMoves();
        if (ply >= l.moves.length) return finishLine();
        if (game.turn() !== user) {
          board.setInteractive(false);
          timer = setTimeout(() => {
            const [san, why] = l.moves[ply];
            const mv = game.move(san); ply++;
            syncBoard(board, game, mv);
            cm.innerHTML = why ? `<p><b>${esc(pgn([san], ply - 1))}</b> — ${esc(why)}</p>` : '';
            board.setInteractive(true);
            advance();
          }, 500);
        } else board.setInteractive(true);
      }
      board.onMove = (from, to, promotion) => {
        const [want, why] = l.moves[ply];
        const mv = game.move({ from, to, promotion: promotion || 'q' });
        if (!mv) return;
        if (strip(mv.san) !== strip(want)) {
          game.undo(); failed = true;
          board.shake(); syncBoard(board, game);
          const m = sanToMove(game.fen(), want);
          const ex = explainWrongMove(game.fen(), mv.san, want, l.moves.slice(0, ply).map(x => x[0]).join(' '), false);
          board.setArrows([{ from: m.from, to: m.to, color: 'blue' }].concat(ex.arrow ? [ex.arrow] : []));
          fb.innerHTML = `<div class="fb bad"><p><b>Not ${esc(mv.san)}.</b></p>${ex.html}
            <p class="whynot-h">The book move: ${esc(want)} (blue arrow)</p><p>${esc(why || '')}</p><p class="muted">Play it to continue.${ex.arrow ? ' The red arrow shows the punishing reply.' : ''}</p></div>`;
          return;
        }
        ply++; board.setArrows([]);
        syncBoard(board, game, mv); board.flash(to, 'good');
        fb.innerHTML = '';
        cm.innerHTML = why ? `<p><b>${esc(pgn([mv.san], ply - 1))}</b> — ${esc(why)}</p>` : '';
        advance();
      };
      function finishLine() {
        board.setInteractive(false);
        const c = Store.grade(key, !failed);
        results.push(!failed);
        Store.touch();
        const days = Store.INTERVALS[c.box];
        fb.innerHTML = `<div class="fb ${failed ? 'bad' : 'good'}">${failed ? 'Line finished with a slip — it will come back soon.' : `Perfect line! Next review in ${days} day${days > 1 ? 's' : ''}.`}</div>
          <div class="row">${qi + 1 < queue.length ? continueBtn('Next line') : continueBtn('Finish')}<a class="btn" href="#/play?opening=${o.id}&line=${queue[qi].i}">Play from here</a></div>`;
        $('.continue', panel).onclick = () => { qi++; if (qi < queue.length) runLine(); else summary(); };
      }
      advance();
    }
    function summary() {
      const ok = results.filter(Boolean).length;
      panel.innerHTML = `<div class="complete"><div class="big">✓</div><h2>Session complete</h2><p>${ok} / ${results.length} lines perfect.</p><div class="row"><a class="btn primary" href="#/openings">Openings</a><a class="btn" href="#/learn">Path</a></div></div>`;
    }
    runLine();
  }

  /* ---------------- Practice vs. the bot ---------------- */
  const LEVELS = [
    { name: 'Novice', depth: 1, rand: 150, elo: 600 },
    { name: 'Casual', depth: 2, rand: 40, elo: 900 },
    { name: 'Club', depth: 3, rand: 0, elo: 1250 }
  ];
  function viewPlay(params) {
    let startFen = START, startNote = 'Standard starting position', userColor = 'w', preMoves = [];
    const saved = !params.opening && Store.data.game && Array.isArray(Store.data.game.moves) ? Store.data.game : null;
    if (saved) { startFen = saved.startFen; startNote = saved.startNote; userColor = saved.userColor; preMoves = saved.preMoves || []; }
    if (params.opening) {
      const o = OPENINGS.find(x => x.id === params.opening);
      const l = o && o.lines[+params.line || 0];
      if (l) {
        const g = new Chess(); l.moves.forEach(([m]) => g.move(m));
        startFen = g.fen(); preMoves = g.history(); startNote = `${o.name}: ${l.name}`; userColor = o.side === 'white' ? 'w' : 'b';
      }
    }
    const s = Store.data.settings;
    app.innerHTML = `
      <div class="lesson-body">
        <div class="board-col"><div id="board"></div>
          <div class="row center controls"><button class="btn small" id="undo">Take back</button><button class="btn small" id="hint">Hint</button><button class="btn small" id="flip">Flip</button><button class="btn small" id="resign">Resign</button><button class="btn small primary" id="new">New game</button></div>
        </div>
        <div class="panel">
          <p class="eyebrow">Practice</p><h2>Play the Academy bot</h2>
          <p class="muted">${esc(startNote)}</p>
          <div class="settings">
            <label>You play <select id="color"><option value="w">White</option><option value="b">Black</option></select></label>
            <label>Bot <select id="level">${LEVELS.map((l, i) => `<option value="${i}">${l.name} (~${l.elo})</option>`).join('')}</select></label>
            <label class="check"><input type="checkbox" id="coach"> Coach warns about blunders</label>
          </div>
          <p class="rated-note muted"></p>
          <div class="status"></div><div class="feedback"></div>
          <div class="movelist mono" id="moves"></div>
        </div>
      </div>`;
    $('#color').value = userColor; $('#level').value = s.level; $('#coach').checked = s.coach;
    const board = new Board($('#board'));
    let game, thinking = false, timer = null, gameLevel = 1, assisted = false, assistWhy = '', recorded = false, resigned = false, savedLen = -1;
    const assist = (why) => { if (!assisted && !recorded) { assisted = true; assistWhy = why; noteRated(why); saveGame(true); } };
    // Keep the unfinished game in progress storage so it survives closing the app.
    function saveGame(force) {
      const over = recorded || resigned || game.game_over();
      const len = game.history().length;
      if (!force && len === savedLen && !over) return;
      savedLen = len;
      Store.data.game = over || !len ? null : { startFen, startNote, preMoves, userColor, level: gameLevel, moves: game.history(), assisted, assistWhy };
      Store.save();
    }
    function noteRated(why) {
      const lv = LEVELS[gameLevel];
      $('.rated-note').innerHTML = assisted
        ? `Unrated game — ${esc(why)}. Your rating estimate won’t change.`
        : `Rated game vs ${lv.name} (~${lv.elo}). Hint, Take back, the Coach’s warning or changing the bot level make it unrated.`;
    }
    const fb = $('.feedback'), status = $('.status');
    cleanup = () => clearTimeout(timer);

    function newGame(resume) {
      clearTimeout(timer); thinking = false;
      if (resume) { $('#color').value = resume.userColor; $('#level').value = resume.level; }
      userColor = $('#color').value;
      game = new Chess(startFen);
      if (resume) resume.moves.forEach(m => game.move(m));
      gameLevel = +$('#level').value; recorded = false; resigned = false; savedLen = game.history().length;
      assisted = !!(resume && resume.assisted); assistWhy = (resume && resume.assistWhy) || '';
      noteRated(assistWhy);
      if (resume) toast('Resumed your unfinished game');
      else if (Store.data.game) { Store.data.game = null; Store.save(); }
      board.setInteractive(true);
      board.setOrientation(userColor === 'w' ? 'white' : 'black');
      board.destsFn = sq => (!thinking && game.turn() === userColor && !game.game_over()) ? chessDests(game)(sq) : [];
      board.setArrows([]); syncBoard(board, game); fb.innerHTML = '';
      if (resume && game.history().length) { const h = game.history({ verbose: true }); const last = h[h.length - 1]; board.setLastMove(last.from, last.to); }
      update();
      if (game.turn() !== userColor && !game.game_over()) botMove();
    }
    function finishGame() {
      if (recorded || !(game.game_over() || resigned) || !game.history().length) return '';
      recorded = true;
      if (assisted) return '';
      const score = resigned ? 0 : game.in_checkmate() ? (game.turn() === userColor ? 0 : 1) : 0.5;
      const { before, after } = Rating.record(LEVELS[gameLevel].elo, score, 'game');
      Store.touch();
      const msg = `Rating estimate ${before} → ${after} (${after >= before ? '+' : ''}${after - before})`;
      toast(msg);
      return msg;
    }
    function update() {
      const h = game.history();
      const rmsg = finishGame();
      if (rmsg) $('.rated-note').innerHTML = `<b>${esc(rmsg)}</b>`;
      if (resigned) { saveGame(true); status.innerHTML = '<div class="fb bad"><b>You resigned.</b> Start a new game when ready.</div>'; return; }
      $('#moves').innerHTML = esc(pgn(preMoves.concat(h)));
      if (game.in_checkmate()) status.innerHTML = `<div class="fb ${game.turn() === userColor ? 'bad' : 'good'}"><b>Checkmate.</b> ${game.turn() === userColor ? 'The bot wins — review the game and try again.' : 'You win! 🎉'}</div>`;
      else if (game.in_draw() || game.in_stalemate() || game.in_threefold_repetition()) status.innerHTML = '<div class="fb">Draw.</div>';
      else status.innerHTML = `<p>${thinking ? 'Bot is thinking…' : game.turn() === userColor ? 'Your move.' : ''}${game.in_check() ? ' <b>Check!</b>' : ''}</p>`;
      saveGame();
    }
    function botMove() {
      thinking = true; update();
      timer = setTimeout(() => {
        const lv = LEVELS[+$('#level').value];
        const r = Engine.search(game.fen(), lv.depth, lv.rand);
        if (r) { const mv = game.move(r.move); syncBoard(board, game, mv); }
        thinking = false; update();
      }, 250);
    }
    board.onMove = (from, to, promotion) => {
      const fenBefore = game.fen();
      const mv = game.move({ from, to, promotion: promotion || 'q' });
      if (!mv) return syncBoard(board, game);
      syncBoard(board, game, mv); board.setArrows([]); fb.innerHTML = '';
      update();
      if (game.game_over()) return;
      if ($('#coach').checked) {
        thinking = true; update();
        timer = setTimeout(() => {
          const before = Engine.scoreFor(fenBefore, 2);           // for user
          const after = -Engine.scoreFor(game.fen(), 2);          // for user
          thinking = false;
          const drop = before - after;
          if (drop >= 200 && after < 150) {
            assist('the Coach warned you about a blunder');
            fb.innerHTML = `<div class="fb bad"><b>Coach:</b> careful — <b>${esc(mv.san)}</b> looks like it gives away about ${Math.round(drop / 100)} pawns of material. Check: what can your opponent capture or attack now?
              <div class="row"><button class="btn small" id="tb">Take it back</button><button class="btn small" id="go">Play it anyway</button></div></div>`;
            update();
            $('#tb').onclick = () => { game.undo(); syncBoard(board, game); fb.innerHTML = ''; update(); };
            $('#go').onclick = () => { fb.innerHTML = ''; botMove(); };
          } else botMove();
        }, 30);
      } else botMove();
    };
    $('#undo').onclick = () => {
      if (thinking || resigned) return;
      assist('you used Take back');
      game.undo(); if (game.turn() !== userColor) game.undo();
      syncBoard(board, game); fb.innerHTML = ''; update();
    };
    $('#hint').onclick = () => {
      if (thinking || resigned || game.turn() !== userColor || game.game_over()) return;
      assist('you used a Hint');
      const r = Engine.search(game.fen(), 2, 0);
      if (r) { board.setArrows([{ from: r.move.from, to: r.move.to, color: 'blue' }]); fb.innerHTML = `<div class="fb">💡 Consider <b>${esc(r.move.san)}</b>. Why might it be good?</div>`; }
    };
    $('#flip').onclick = () => board.flip();
    $('#new').onclick = () => newGame();
    $('#resign').onclick = () => {
      if (recorded || resigned || game.game_over() || !game.history().length) return;
      clearTimeout(timer); thinking = false; resigned = true; board.setInteractive(false); update();
    };
    $('#color').onchange = () => newGame();
    $('#level').onchange = () => { s.level = +$('#level').value; Store.save(); if (+$('#level').value !== gameLevel && game.history().length) assist('the bot level changed mid-game'); else { gameLevel = +$('#level').value; noteRated(); } };
    $('#coach').onchange = () => { s.coach = $('#coach').checked; Store.save(); };
    newGame(saved);
  }

  /* ---------------- Library ---------------- */
  function viewLibrary() {
    app.innerHTML = `<section class="page-head"><h1>Library</h1><p>Reference material: how to study, key terms, and further reading.</p></section>
      <div class="lib">${LIBRARY.map(sec => `<section class="note"><h2>${esc(sec.title)}</h2>${sec.html}</section>`).join('')}</div>
      <section class="note" id="backup"><h2>Your progress: where it’s saved</h2>
        <p>${Cloud.status === 'cloud'
          ? '<b>☁︎ Saved to your Claude account.</b> Your lessons, rating, drill schedule and any unfinished game are kept privately for you and follow you to any device where you open this page signed in.'
          : localOk ? '<b>Saved on this device only</b>, in this browser. Clearing browsing data, using private mode, or opening the app on another device or browser starts fresh. Use a backup code to move your progress.'
          : '<b>⚠︎ This browser is blocking storage, so progress is lost when you close the app.</b> Open the app in your normal browser (not private mode), or keep a backup code below and restore it next time.'}</p>
        <p class="muted">Lessons save after every step, bot games after every move, and drills after every line.</p>
        <h3>Backup code</h3>
        <p class="muted">Copy this code to keep a backup, or paste it on another device to move your progress there.</p>
        <textarea id="bk-out" class="code" readonly rows="3"></textarea>
        <div class="row"><button class="btn small" id="bk-copy">Copy code</button></div>
        <textarea id="bk-in" class="code" rows="3" placeholder="Paste a backup code here to restore it"></textarea>
        <div class="row"><button class="btn small primary" id="bk-restore">Restore from code</button></div>
        <p class="bk-msg muted"></p>
      </section>
      <section class="note danger"><h3>Reset progress</h3><p>Clears your rating estimate, lessons and drill schedule${Cloud.status === 'cloud' ? ' (here and in your Claude account)' : ' stored in this browser'}.</p><button class="btn small" id="reset">Reset everything</button></section>`;
    const enc = d => btoa(unescape(encodeURIComponent(JSON.stringify(d))));
    const dec = c => JSON.parse(decodeURIComponent(escape(atob(c.replace(/\s+/g, '')))));
    $('#bk-out').value = enc(Store.data);
    $('#bk-copy').onclick = async () => {
      const t = $('#bk-out'); t.select();
      try { await navigator.clipboard.writeText(t.value); $('.bk-msg').textContent = 'Copied. Keep it somewhere safe, like a note on your phone.'; }
      catch (e) { $('.bk-msg').textContent = 'Select the code above and copy it manually.'; }
    };
    $('#bk-restore').onclick = () => {
      try {
        const d = dec($('#bk-in').value.trim());
        if (!d || typeof d !== 'object' || !d.rating || !d.lessons) throw new Error('bad');
        Store.data = Object.assign(freshData(), d);
        Store.save();
        toast('Progress restored');
        location.hash = '#/learn';
      } catch (e) { $('.bk-msg').textContent = 'That code isn’t valid. Copy the whole code and try again.'; }
    };
    $('#reset').onclick = (e) => {
      const b = e.currentTarget;
      if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Click again to confirm'; return; }
      try { localStorage.removeItem(KEY); } catch (err) {}
      Store.data = freshData();
      Store.save(); location.hash = '#/learn';
    };
  }

  renderHeader();
  route();
  initCloud();
})();
