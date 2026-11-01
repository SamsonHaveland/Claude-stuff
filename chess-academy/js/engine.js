/* A small, readable alpha-beta engine on top of chess.js.
 * Strength is deliberately modest: it is a sparring partner and a
 * "coach" that spots hanging pieces, not a grandmaster.
 */
(function () {
  const VAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
  // Piece-square tables from White's point of view (a8..h1 order).
  const PST = {
    p: [0,0,0,0,0,0,0,0, 50,50,50,50,50,50,50,50, 10,10,20,30,30,20,10,10, 5,5,10,25,25,10,5,5, 0,0,0,20,20,0,0,0, 5,-5,-10,0,0,-10,-5,5, 5,10,10,-20,-20,10,10,5, 0,0,0,0,0,0,0,0],
    n: [-50,-40,-30,-30,-30,-30,-40,-50, -40,-20,0,0,0,0,-20,-40, -30,0,10,15,15,10,0,-30, -30,5,15,20,20,15,5,-30, -30,0,15,20,20,15,0,-30, -30,5,10,15,15,10,5,-30, -40,-20,0,5,5,0,-20,-40, -50,-40,-30,-30,-30,-30,-40,-50],
    b: [-20,-10,-10,-10,-10,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,10,10,5,0,-10, -10,5,5,10,10,5,5,-10, -10,0,10,10,10,10,0,-10, -10,10,10,10,10,10,10,-10, -10,5,0,0,0,0,5,-10, -20,-10,-10,-10,-10,-10,-10,-20],
    r: [0,0,0,0,0,0,0,0, 5,10,10,10,10,10,10,5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, 0,0,0,5,5,0,0,0],
    q: [-20,-10,-10,-5,-5,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,5,5,5,0,-10, -5,0,5,5,5,5,0,-5, 0,0,5,5,5,5,0,-5, -10,5,5,5,5,5,0,-10, -10,0,5,0,0,0,0,-10, -20,-10,-10,-5,-5,-10,-10,-20],
    k: [-30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -20,-30,-30,-40,-40,-30,-30,-20, -10,-20,-20,-20,-20,-20,-20,-10, 20,20,0,0,0,0,20,20, 20,30,10,0,0,10,30,20],
    kEnd: [-50,-40,-30,-20,-20,-30,-40,-50, -30,-20,-10,0,0,-10,-20,-30, -30,-10,20,30,30,20,-10,-30, -30,-10,30,40,40,30,-10,-30, -30,-10,30,40,40,30,-10,-30, -30,-10,20,30,30,20,-10,-30, -30,-30,0,0,0,0,-30,-30, -50,-30,-30,-30,-30,-30,-30,-50]
  };
  const MATE = 100000;

  // Static evaluation from White's perspective (centipawns).
  function evaluate(game) {
    const board = game.board();
    let score = 0, nonPawn = 0;
    for (const row of board) for (const p of row) if (p && p.type !== 'p' && p.type !== 'k') nonPawn += VAL[p.type];
    const endgame = nonPawn <= 1300;
    for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
      const p = board[r][f];
      if (!p) continue;
      const idx = p.color === 'w' ? r * 8 + f : (7 - r) * 8 + f;
      const table = p.type === 'k' && endgame ? PST.kEnd : PST[p.type];
      const v = VAL[p.type] + table[idx];
      score += p.color === 'w' ? v : -v;
    }
    return score;
  }

  function orderMoves(moves) {
    return moves.sort((a, b) => score(b) - score(a));
    function score(m) {
      let s = 0;
      if (m.captured) s += 10 * VAL[m.captured] - VAL[m.piece];
      if (m.promotion) s += VAL[m.promotion];
      if (m.san.includes('+')) s += 50;
      return s;
    }
  }

  let nodes = 0;
  function negamax(game, depth, alpha, beta, ply) {
    nodes++;
    if (game.in_checkmate()) return -MATE + ply;
    if (game.in_draw() || game.in_stalemate() || game.in_threefold_repetition()) return 0;
    if (depth === 0) return quiesce(game, alpha, beta, 0);
    const moves = orderMoves(game.moves({ verbose: true }));
    let best = -Infinity;
    for (const m of moves) {
      game.move(m);
      const v = -negamax(game, depth - 1, -beta, -alpha, ply + 1);
      game.undo();
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    return best;
  }

  function quiesce(game, alpha, beta, qdepth) {
    nodes++;
    const stand = (game.turn() === 'w' ? 1 : -1) * evaluate(game);
    if (stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
    if (qdepth >= 4) return stand;
    const caps = orderMoves(game.moves({ verbose: true }).filter(m => m.captured || m.promotion));
    for (const m of caps) {
      game.move(m);
      const v = -quiesce(game, -beta, -alpha, qdepth + 1);
      game.undo();
      if (v >= beta) return v;
      if (v > alpha) alpha = v;
    }
    return alpha;
  }

  /* Search the position; returns { move (verbose), score (side-to-move cp) }.
   * randomness (cp) lets weaker levels choose among near-best moves. */
  function search(fen, depth, randomness = 0) {
    const game = new Chess(fen);
    nodes = 0;
    const moves = orderMoves(game.moves({ verbose: true }));
    if (!moves.length) return null;
    const scored = [];
    for (const m of moves) {
      game.move(m);
      const v = -negamax(game, depth - 1, -Infinity, Infinity, 1);
      game.undo();
      scored.push({ move: m, score: v });
    }
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0].score;
    const pool = scored.filter(s => s.score >= best - randomness && Math.abs(best) < MATE - 100 || s.score === best);
    const pick = pool[Math.floor(Math.random() * pool.length)];
    return { move: pick.move, score: pick.score, bestScore: best, nodes };
  }

  /* Score for the side to move, searched to `depth`. */
  function scoreFor(fen, depth) {
    const game = new Chess(fen);
    if (game.game_over()) return game.in_checkmate() ? -MATE : 0;
    return negamax(game, depth, -Infinity, Infinity, 0);
  }

  window.Engine = { search, evaluate, scoreFor, MATE };
})();
