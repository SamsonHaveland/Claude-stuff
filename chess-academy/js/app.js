/* Chess Academy — app shell, router and views. */
(function () {
  const $ = (s, el = document) => el.querySelector(s);
  const app = $('#app');
  const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const strip = s => s.replace(/[+#?!]/g, '');
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ---------------- Progress store ---------------- */
  const KEY = 'chessAcademy.v1';
  const Store = {
    data: Object.assign({ xp: 0, lessons: {}, srs: {}, streak: { last: null, count: 0 }, settings: { coach: true, level: 1 } },
      JSON.parse(localStorage.getItem(KEY) || '{}')),
    save() { localStorage.setItem(KEY, JSON.stringify(this.data)); renderHeader(); },
    today() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; },
    addXp(n) {
      this.data.xp += n;
      const t = this.today(), s = this.data.streak;
      if (s.last !== t) {
        const y = new Date(); y.setDate(y.getDate() - 1);
        const yk = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
        s.count = s.last === yk ? s.count + 1 : 1;
        s.last = t;
      }
      this.save();
      toast(`+${n} XP`);
    },
    level() { return Math.floor(Math.sqrt(this.data.xp / 25)) + 1; },
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

  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast'; t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.classList.add('show'), 10);
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 1600);
  }

  function renderHeader() {
    const d = Store.data;
    $('#stats').innerHTML = `<span title="Daily streak">🔥 ${d.streak.count}</span><span title="Experience">⭐ ${d.xp} XP</span><span title="Level" class="lvl">Lv ${Store.level()}</span>`;
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
      <div class="path">
        ${CURRICULUM.map((u, ui) => `
          <section class="unit">
            <header><span class="unit-icon">${u.icon}</span><div><h2>Unit ${ui + 1} · ${esc(u.title)}</h2><p>${esc(u.blurb)}</p></div></header>
            <div class="nodes">
              ${u.lessons.map(l => {
                const st = Store.data.lessons[l.id];
                const cls = st ? (st.perfect ? 'done perfect' : 'done') : (next && next.id === l.id ? 'next' : '');
                return `<a class="node ${cls}" href="#/lesson/${l.id}"><span class="dot">${st ? (st.perfect ? '★' : '✓') : ''}</span><span class="name">${esc(l.title)}</span><span class="xp">${l.xp} XP</span></a>`;
              }).join('')}
              ${u.id === 'u6' ? '<a class="node link" href="#/openings"><span class="dot">→</span><span class="name">Open the Openings study</span></a>' : ''}
            </div>
          </section>`).join('')}
      </div>`;
  }

  /* ---------------- Lesson player ---------------- */
  function viewLesson(id) {
    const lesson = allLessons().find(l => l.id === id);
    if (!lesson) return viewLearn();
    let idx = 0, mistakes = 0;
    app.innerHTML = `
      <div class="lesson">
        <div class="lesson-top"><a href="#/learn" class="close" aria-label="Back to path">✕</a><div class="bar"><div class="fill"></div></div><span class="count"></span></div>
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
      $('.fill').style.width = (idx / lesson.steps.length * 100) + '%';
      $('.count').textContent = `${idx + 1} / ${lesson.steps.length}`;
      board.onSquareClick = null; board.onMove = null; board.destsFn = () => [];
      board.showCoords = true; board.setArrows([]); board.setStars([]); board.setCheck(null); board.lastMove = null;
      board.highlights = st.highlights || {};
      board.setOrientation(st.fen && st.fen.split(' ')[1] === 'b' && st.type !== 'text' ? 'black' : 'white');
      board.setFen(st.fen || (st.type === 'stars' || st.type === 'square' ? '8/8/8/8/8/8/8/8 w - - 0 1' : START));
      $('.board-col').classList.toggle('dim', !st.fen && st.type !== 'stars' && st.type !== 'square');
      if (st.arrows) board.setArrows(st.arrows);
      const steppers = { text: stepText, quiz: stepQuiz, square: stepSquare, stars: stepStars, move: stepMove, play: stepPlay };
      stepCleanup = steppers[st.type](st, board, panel, next, () => mistakes++);
    }
    function next() {
      idx++;
      if (idx < lesson.steps.length) return show();
      $('.fill').style.width = '100%';
      const prev = Store.data.lessons[lesson.id];
      const perfect = mistakes === 0;
      const firstTime = !prev;
      Store.data.lessons[lesson.id] = { done: true, perfect: perfect || (prev && prev.perfect) };
      const gain = firstTime ? lesson.xp + (perfect ? 10 : 0) : 5;
      Store.addXp(gain);
      const nxt = nextLesson();
      panel.innerHTML = `<div class="complete"><div class="big">${perfect ? '★' : '✓'}</div><h2>Lesson complete!</h2>
        <p>${perfect ? 'Flawless — no mistakes. ' : `${mistakes} mistake${mistakes > 1 ? 's' : ''} — mistakes are how you learn. `}+${gain} XP</p>
        <div class="row">${nxt ? `<a class="btn primary" href="#/lesson/${nxt.id}">Next: ${esc(nxt.title)}</a>` : ''}<a class="btn" href="#/learn">Back to path</a></div></div>`;
      board.setInteractive(false);
    }
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
        fb.innerHTML = `<div class="fb bad"><b>${esc(mv.san)}</b> isn’t it. ${tries >= 2 ? 'Look at the arrow.' : 'Try again.'}</div>`;
        if (tries >= 2) showAnswer(fenBefore);
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
    function showAnswer(fen) {
      if (st.goal === 'mate') {
        const g = new Chess(fen);
        const m = g.moves({ verbose: true }).find(m => { g.move(m); const r = g.in_checkmate(); g.undo(); return r; });
        if (m) board.setArrows([{ from: m.from, to: m.to, color: 'blue' }]);
      } else {
        const m = sanToMove(fen, expected()[0]);
        board.setArrows([{ from: m.from, to: m.to, color: 'blue' }]);
      }
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
  function viewOpenings() {
    const card = o => {
      const due = Store.dueCount(o.id);
      const learned = o.lines.filter((_, i) => Store.data.srs[`${o.id}:${i}`]).length;
      return `<a class="op-card" href="#/openings/${o.id}">
        <div class="mini" data-fen="${finalFen(o.lines[0])}" data-orient="${o.side}"></div>
        <div><h3>${esc(o.name)}</h3><p class="first">${esc(o.first)}</p><p>${esc(o.tagline)}</p>
        <p class="muted">${o.lines.length} lines · ${learned} studied${due ? ` · <b class="due">${due} due</b>` : ''}</p></div></a>`;
    };
    app.innerHTML = `
      <section class="page-head"><h1>Openings</h1><p>A compact repertoire for improving players. For each one: <b>why</b> it works, the plans, and lines with an explanation for <i>every</i> move. Then train it with spaced repetition.</p>
      ${Store.dueCount() ? `<a class="btn primary" href="#/drill/all">Review all due lines (${Store.dueCount()})</a>` : ''}</section>
      <h2 class="group">Playing White</h2><div class="op-grid">${OPENINGS.filter(o => o.side === 'white').map(card).join('')}</div>
      <h2 class="group">Playing Black</h2><div class="op-grid">${OPENINGS.filter(o => o.side === 'black' && o.id !== 'traps').map(card).join('')}</div>
      <h2 class="group">Survival kit</h2><div class="op-grid">${OPENINGS.filter(o => o.id === 'traps').map(card).join('')}</div>
      <section class="note"><h3>How these were chosen</h3><p>Coaches broadly recommend learning principled openings that develop pieces naturally and create sound structures rather than collecting traps. The Italian Game and London System for White, and the Caro-Kann and Queen’s Gambit Declined for Black, are among the most commonly recommended choices for developing players — and all are still played at the very top. There is no single “best” opening; once you understand these, explore what suits your style.</p></section>`;
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
          <p class="eyebrow">You play ${o.side === 'white' ? 'White' : 'Black'} · ECO ${esc(o.eco)}</p>
          <h1>${esc(o.name)}</h1><p class="first">${esc(o.first)}</p><p>${esc(o.tagline)}</p>
          <h3>Why play it</h3><ul class="why">${o.why.map(w => `<li>${w}</li>`).join('')}</ul>
          <div class="prose">${o.plans}</div>
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
        : `<p class="mv-title">${esc(pgn([cur[0]], ply - 1))}</p><p>${esc(cur[1] || 'A natural move in this line.')}</p>`;
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
          board.setArrows([{ from: m.from, to: m.to, color: 'blue' }]);
          fb.innerHTML = `<div class="fb bad">Not <b>${esc(mv.san)}</b>. The book move is <b>${esc(want)}</b>: ${esc(why || '')} Play it to continue.</div>`;
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
        if (!failed) Store.addXp(5);
        const days = Store.INTERVALS[c.box];
        fb.innerHTML = `<div class="fb ${failed ? 'bad' : 'good'}">${failed ? 'Line finished with a slip — it will come back soon.' : `Perfect line! Next review in ${days} day${days > 1 ? 's' : ''}.`}</div>
          <div class="row">${qi + 1 < queue.length ? continueBtn('Next line') : continueBtn('Finish')}<a class="btn" href="#/play?opening=${o.id}&line=${queue[qi].i}">Play from here</a></div>`;
        $('.continue', panel).onclick = () => { qi++; if (qi < queue.length) runLine(); else summary(); };
      }
      advance();
    }
    function summary() {
      const ok = results.filter(Boolean).length;
      panel.innerHTML = `<div class="complete"><div class="big">${ok === results.length ? '★' : '✓'}</div><h2>Session complete</h2><p>${ok} / ${results.length} lines perfect.</p><div class="row"><a class="btn primary" href="#/openings">Openings</a><a class="btn" href="#/learn">Path</a></div></div>`;
    }
    runLine();
  }

  /* ---------------- Practice vs. the bot ---------------- */
  const LEVELS = [
    { name: 'Novice', depth: 1, rand: 150 },
    { name: 'Casual', depth: 2, rand: 40 },
    { name: 'Club', depth: 3, rand: 0 }
  ];
  function viewPlay(params) {
    let startFen = START, startNote = 'Standard starting position', userColor = 'w', preMoves = [];
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
          <div class="row center controls"><button class="btn small" id="undo">Take back</button><button class="btn small" id="hint">Hint</button><button class="btn small" id="flip">Flip</button><button class="btn small primary" id="new">New game</button></div>
        </div>
        <div class="panel">
          <p class="eyebrow">Practice</p><h2>Play the Academy bot</h2>
          <p class="muted">${esc(startNote)}</p>
          <div class="settings">
            <label>You play <select id="color"><option value="w">White</option><option value="b">Black</option></select></label>
            <label>Bot <select id="level">${LEVELS.map((l, i) => `<option value="${i}">${l.name}</option>`).join('')}</select></label>
            <label class="check"><input type="checkbox" id="coach"> Coach warns about blunders</label>
          </div>
          <div class="status"></div><div class="feedback"></div>
          <div class="movelist mono" id="moves"></div>
        </div>
      </div>`;
    $('#color').value = userColor; $('#level').value = s.level; $('#coach').checked = s.coach;
    const board = new Board($('#board'));
    let game, thinking = false, timer = null;
    const fb = $('.feedback'), status = $('.status');
    cleanup = () => clearTimeout(timer);

    function newGame() {
      clearTimeout(timer); thinking = false;
      userColor = $('#color').value;
      game = new Chess(startFen);
      board.setOrientation(userColor === 'w' ? 'white' : 'black');
      board.destsFn = sq => (!thinking && game.turn() === userColor && !game.game_over()) ? chessDests(game)(sq) : [];
      board.setArrows([]); syncBoard(board, game); fb.innerHTML = '';
      update();
      if (game.turn() !== userColor) botMove();
    }
    function update() {
      const h = game.history();
      $('#moves').innerHTML = esc(pgn(preMoves.concat(h)));
      if (game.in_checkmate()) status.innerHTML = `<div class="fb ${game.turn() === userColor ? 'bad' : 'good'}"><b>Checkmate.</b> ${game.turn() === userColor ? 'The bot wins — review the game and try again.' : 'You win! 🎉'}</div>`;
      else if (game.in_draw() || game.in_stalemate() || game.in_threefold_repetition()) status.innerHTML = '<div class="fb">Draw.</div>';
      else status.innerHTML = `<p>${thinking ? 'Bot is thinking…' : game.turn() === userColor ? 'Your move.' : ''}${game.in_check() ? ' <b>Check!</b>' : ''}</p>`;
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
      if (thinking) return;
      game.undo(); if (game.turn() !== userColor) game.undo();
      syncBoard(board, game); fb.innerHTML = ''; update();
    };
    $('#hint').onclick = () => {
      if (thinking || game.turn() !== userColor || game.game_over()) return;
      const r = Engine.search(game.fen(), 2, 0);
      if (r) { board.setArrows([{ from: r.move.from, to: r.move.to, color: 'blue' }]); fb.innerHTML = `<div class="fb">💡 Consider <b>${esc(r.move.san)}</b>. Why might it be good?</div>`; }
    };
    $('#flip').onclick = () => board.flip();
    $('#new').onclick = newGame;
    $('#color').onchange = newGame;
    $('#level').onchange = () => { s.level = +$('#level').value; Store.save(); };
    $('#coach').onchange = () => { s.coach = $('#coach').checked; Store.save(); };
    newGame();
  }

  /* ---------------- Library ---------------- */
  function viewLibrary() {
    app.innerHTML = `<section class="page-head"><h1>Library</h1><p>Reference material: how to study, key terms, and further reading.</p></section>
      <div class="lib">${LIBRARY.map(sec => `<section class="note"><h2>${esc(sec.title)}</h2>${sec.html}</section>`).join('')}</div>
      <section class="note danger"><h3>Reset progress</h3><p>Clears XP, lessons and drill schedule stored in this browser.</p><button class="btn small" id="reset">Reset everything</button></section>`;
    $('#reset').onclick = () => { if (confirm('Erase all progress in this browser?')) { localStorage.removeItem(KEY); location.reload(); } };
  }

  renderHeader();
  route();
})();
