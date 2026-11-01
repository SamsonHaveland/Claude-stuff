/* Validates every position, solution and opening line with chess.js.
 * Run: node chess-academy/tests/validate.js */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..', 'js');
globalThis.window = globalThis;
for (const f of ['vendor/chess.js', 'engine.js', 'curriculum.js', 'openings.js', 'openings-more.js', 'whynot.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f });
}
let errors = 0, checks = 0;
const fail = (where, msg) => { errors++; console.error('FAIL', where, '-', msg); };
const strip = s => s.replace(/[+#]/g, '');

for (const unit of CURRICULUM) for (const lesson of unit.lessons) lesson.steps.forEach((st, i) => {
  const where = `${lesson.id}#${i} (${st.type})`;
  if (st.fen && st.type !== 'text' && st.type !== 'quiz') {
    const g = new Chess();
    if (!g.load(st.fen)) { fail(where, 'bad FEN ' + st.fen); return; }
    checks++;
    if (st.type === 'move') {
      if (st.goal === 'mate') {
        const mates = g.moves({ verbose: true }).filter(m => { g.move(m); const r = g.in_checkmate(); g.undo(); return r; });
        if (!mates.length) fail(where, 'no mate in one');
        else console.log(`  ${where}: mating moves = ${mates.map(m => m.san).join(', ')}`);
      } else {
        st.solution.forEach((m, k) => {
          const opts = Array.isArray(m) ? m : [m];
          const legal = g.moves().map(strip);
          for (const o of opts) if (!legal.includes(strip(o))) fail(where, `move ${k} "${o}" illegal; legal: ${legal.join(' ')}`);
          g.move(opts[0]);
        });
      }
    }
    if (st.type === 'play') {
      if (g.game_over()) fail(where, 'game already over');
    }
  } else if (st.fen) {
    const g = new Chess();
    // text/quiz diagrams may be illustrative (no kings); only validate if they contain both kings
    if (/k/.test(st.fen.split(' ')[0]) && /K/.test(st.fen.split(' ')[0])) {
      if (!g.load(st.fen)) fail(where, 'bad FEN ' + st.fen); else checks++;
    }
  }
  if (st.type === 'quiz' && !(st.answer >= 0 && st.answer < st.options.length)) fail(where, 'answer index out of range');
});

// Specific factual checks on quiz diagrams
(function () {
  const g = new Chess('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
  if (!g.in_stalemate()) fail('special stalemate quiz', 'not stalemate'); else checks++;
  const c = new Chess('r3k2r/8/8/8/2b5/8/8/R3K2R w KQkq - 0 1');
  const sans = c.moves();
  if (sans.includes('O-O') || !sans.includes('O-O-O')) fail('castling quiz', 'castling rights wrong: ' + sans.filter(s => s.startsWith('O')));
  else checks++;
})();

for (const op of OPENINGS) op.lines.forEach((line, i) => {
  const g = new Chess();
  line.moves.forEach(([san], k) => {
    const r = g.move(san);
    if (!r) fail(`${op.id} line ${i} (${line.name})`, `ply ${k + 1} "${san}" illegal after ${g.history().join(' ')}`);
    else checks++;
  });
  if (line.moves.length % 2 === (op.side === 'white' ? 0 : 1) && line.moves.length) {
    // fine either way; just report which side moves last
  }
});

// Opening metadata + soundness: every opening has a tier, and no line may end
// with the student's side clearly worse (engine eval, depth 2 + quiescence).
const TIERS = ['beginner', 'novice', 'pro', 'champ'];
const ids = new Set();
for (const op of OPENINGS) {
  if (!TIERS.includes(op.tier)) fail(op.id, 'missing/invalid tier: ' + op.tier);
  if (ids.has(op.id)) fail(op.id, 'duplicate id'); ids.add(op.id);
  op.lines.forEach((line, i) => {
    const g = new Chess(); line.moves.forEach(([m]) => g.move(m));
    const sideToMove = g.turn();
    const s = Engine.scoreFor(g.fen(), 2);                  // for side to move
    const forStudent = (op.side === 'white') === (sideToMove === 'w') ? s : -s;
    const tag = `${op.id} line ${i} (${line.name})`;
    if (forStudent < -150) fail(tag, `student side looks worse at the end: ${forStudent}cp`);
    else { checks++; console.log(`  ${tag}: ${forStudent >= 0 ? '+' : ''}${forStudent}cp for ${op.side}`); }
  });
}

// Every opening move has an explanation.
for (const op of OPENINGS) op.lines.forEach((line, i) => line.moves.forEach(([san, why], k) => {
  if (!why || !why.trim()) fail(`${op.id} line ${i}`, `ply ${k + 1} ${san} has no explanation`); else checks++;
}));

// "Why not" notes: position reachable, alternative legal, alternative is not itself a book move there.
const bookAt = {};
for (const op of OPENINGS) for (const l of op.lines) l.moves.forEach(([san], k) => {
  if ((k % 2 === 0) !== (op.side === 'white')) return;          // only the student's own book moves
  const key = l.moves.slice(0, k).map(m => m[0]).join(' ');
  (bookAt[key] = bookAt[key] || new Set()).add(strip(san));
});
for (const [key, alts] of Object.entries(WHY_NOT)) {
  const g = new Chess();
  const ok = !key || key.split(' ').every(m => g.move(m));
  if (!ok) { fail('whynot ' + key, 'unreachable position'); continue; }
  for (const [alt, reason] of Object.entries(alts)) {
    const where = `whynot [${key}] ${alt}`;
    if (!g.moves().map(strip).includes(strip(alt))) { fail(where, 'illegal alternative'); continue; }
    if (bookAt[key] && bookAt[key].has(strip(alt))) { fail(where, 'alternative is a student book move in some line'); continue; }
    if (!reason || reason.length < 20) { fail(where, 'reason missing'); continue; }
    // Engine view, for review: side-to-move score after the alternative vs after the book move.
    const mover = g.turn();
    g.move(alt); const sAlt = -Engine.scoreFor(g.fen(), 2); g.undo();
    let sBook = null;
    if (bookAt[key]) { const b = [...bookAt[key]][0]; g.move(b); sBook = -Engine.scoreFor(g.fen(), 2); g.undo(); }
    checks++;
    console.log(`  ${where}: alt ${sAlt}cp${sBook !== null ? ` vs book ${sBook}cp` : ''} (for ${mover})`);
  }
}

// Engine smoke test
const t0 = Date.now();
const res = Engine.search('r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4', 2, 0);
if (res.move.san !== 'Qxf7#') fail('engine', 'did not find Qxf7#, got ' + res.move.san); else checks++;
const res3 = Engine.search('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 3, 0);
console.log(`  engine depth-3 from start: ${res3.move.san} in ${Date.now() - t0} ms (${res3.nodes} nodes)`);

console.log(errors ? `\n${errors} error(s), ${checks} checks passed` : `\nAll ${checks} checks passed.`);
process.exit(errors ? 1 : 0);
