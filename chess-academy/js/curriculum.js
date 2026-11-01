/* The Academy curriculum.
 * Step types:
 *  text   {title, body, fen?, arrows?, highlights?}
 *  quiz   {q, options[], answer, explain, fen?}
 *  square {prompt, count}                        — name-the-square drill
 *  stars  {piece, start, stars[], blockers?}     — collect every star
 *  move   {fen, prompt, solution?|goal:'mate', hint, explain}
 *         solution = [userMove(s), reply, userMove(s), ...]  (SAN; arrays = any accepted)
 *  play   {fen, prompt, goal:'mate', maxMoves, depth} — finish the job vs. the engine
 */
var CURRICULUM = [
  {
    id: 'u1', title: 'The Board & the Army', icon: '♜',
    blurb: 'Coordinates, and how each piece moves. The alphabet of chess.',
    lessons: [
      {
        id: 'board', title: 'The Battlefield', xp: 20,
        steps: [
          { type: 'text', title: 'Sixty-four squares', fen: '8/8/8/8/8/8/8/8 w - - 0 1',
            body: '<p>Chess is played on an 8×8 board. The vertical columns are <b>files</b>, lettered <b>a–h</b>. The horizontal rows are <b>ranks</b>, numbered <b>1–8</b> from White’s side.</p><p>Every square has a name: its file then its rank. The highlighted square is <b>e4</b>.</p><p class="tip">Orientation rule: there is always a <b>light square in each player’s bottom-right corner</b> (h1 for White). “Light on the right.”</p>',
            highlights: { e4: 'blue', h1: 'yellow' } },
          { type: 'text', title: 'Why notation matters', fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
            body: '<p>Coordinates let us <b>write games down</b> and study them, the way a musician reads a score. Every lesson, book and engine uses this <i>algebraic notation</i>.</p><p>Pieces have letters: <b>K</b> king, <b>Q</b> queen, <b>R</b> rook, <b>B</b> bishop, <b>N</b> knight. Pawns have no letter. So <code>Nf3</code> means “a knight moves to f3”, and <code>e4</code> means “a pawn moves to e4”. An <code>x</code> means a capture: <code>Bxc6</code>.</p>' },
          { type: 'square', prompt: 'Coordinate drill: click the square named below.', count: 8 },
          { type: 'quiz', q: 'Which square is in White’s bottom-right corner?', options: ['a1', 'h1', 'h8', 'a8'], answer: 1,
            explain: 'h1 — and it is always a light square. If it is dark, the board is turned the wrong way.' }
        ]
      },
      {
        id: 'rook', title: 'The Rook', xp: 15,
        steps: [
          { type: 'text', title: 'Straight lines', fen: '8/8/8/8/3R4/8/8/8 w - - 0 1',
            arrows: [{ from: 'd4', to: 'd8' }, { from: 'd4', to: 'd1' }, { from: 'd4', to: 'a4' }, { from: 'd4', to: 'h4' }],
            body: '<p>The rook moves any number of squares along a <b>file or rank</b>. It cannot jump over pieces.</p><p>Value: about <b>5 pawns</b>. Rooks love <b>open files</b> (files with no pawns) and the 7th rank.</p>' },
          { type: 'stars', piece: 'wR', start: 'a1', stars: ['a5', 'e5', 'e8', 'h8'], prompt: 'Collect every star with the rook.' },
          { type: 'stars', piece: 'wR', start: 'h1', stars: ['h4', 'c4', 'c7', 'a7', 'a2'], prompt: 'More stars! Plan the route before you move.' }
        ]
      },
      {
        id: 'bishop', title: 'The Bishop', xp: 15,
        steps: [
          { type: 'text', title: 'Diagonals', fen: '8/8/8/8/3B4/8/8/8 w - - 0 1',
            arrows: [{ from: 'd4', to: 'h8' }, { from: 'd4', to: 'a7' }, { from: 'd4', to: 'a1' }, { from: 'd4', to: 'g1' }],
            body: '<p>The bishop moves any distance <b>diagonally</b>. A bishop stays on its starting colour for the whole game — you have one “light-squared” and one “dark-squared” bishop.</p><p>Value: about <b>3 pawns</b>. Two bishops together (the <i>bishop pair</i>) are a real asset in open positions.</p>' },
          { type: 'stars', piece: 'wB', start: 'c1', stars: ['e3', 'b6', 'd8', 'h4'], prompt: 'Collect the stars with the bishop.' },
          { type: 'quiz', q: 'A bishop starts on c1 (a dark square). Can it ever reach e4?', options: ['Yes, in two moves', 'No — e4 is a light square'], answer: 1,
            explain: 'e4 is light. A bishop never changes colour, so the c1-bishop can only ever visit the 32 dark squares.' }
        ]
      },
      {
        id: 'queen', title: 'The Queen', xp: 15,
        steps: [
          { type: 'text', title: 'Rook + bishop', fen: '8/8/8/8/3Q4/8/8/8 w - - 0 1',
            arrows: [{ from: 'd4', to: 'd8' }, { from: 'd4', to: 'h8' }, { from: 'd4', to: 'h4' }, { from: 'd4', to: 'g1' }, { from: 'd4', to: 'd1' }, { from: 'd4', to: 'a1' }, { from: 'd4', to: 'a4' }, { from: 'd4', to: 'a7' }],
            body: '<p>The queen combines the rook and the bishop: any distance in any straight line. She is the most powerful piece — about <b>9 pawns</b>.</p><p class="tip">Because she is so valuable, an early queen is easily chased by cheaper pieces, losing you time. We will return to this in the opening lessons.</p>' },
          { type: 'stars', piece: 'wQ', start: 'd1', stars: ['d6', 'g3', 'b8', 'h8', 'a1'], prompt: 'Collect the stars with the queen.' }
        ]
      },
      {
        id: 'king', title: 'The King', xp: 15,
        steps: [
          { type: 'text', title: 'The most important piece', fen: '8/8/8/8/3K4/8/8/8 w - - 0 1',
            highlights: { c3: 'green', c4: 'green', c5: 'green', d3: 'green', d5: 'green', e3: 'green', e4: 'green', e5: 'green' },
            body: '<p>The king moves <b>one square</b> in any direction. Lose the king and you lose the game — so it is priceless, yet weak in a fight.</p><p>In the opening and middlegame, hide it (castle!). In the endgame, when queens are gone, the king becomes a strong attacking piece.</p>' },
          { type: 'stars', piece: 'wK', start: 'e1', stars: ['e3', 'g4', 'f6', 'd7'], prompt: 'March the king to every star.' }
        ]
      },
      {
        id: 'knight', title: 'The Knight', xp: 20,
        steps: [
          { type: 'text', title: 'The jumper', fen: '8/8/8/8/3N4/8/8/8 w - - 0 1',
            highlights: { b3: 'green', b5: 'green', c2: 'green', c6: 'green', e2: 'green', e6: 'green', f3: 'green', f5: 'green' },
            body: '<p>The knight moves in an <b>L</b>: two squares in one direction, then one to the side. It is the only piece that can <b>jump</b> over others.</p><p>Notice: a knight always lands on the <i>opposite colour</i> to where it started. Value: about <b>3 pawns</b>. “A knight on the rim is dim” — from the edge it controls far fewer squares.</p>' },
          { type: 'stars', piece: 'wN', start: 'b1', stars: ['c3', 'd5', 'f6', 'h7'], prompt: 'Hop to every star.' },
          { type: 'stars', piece: 'wN', start: 'g1', stars: ['g3', 'e4', 'c5', 'a4'], prompt: 'Trickier: some stars need two jumps.' }
        ]
      },
      {
        id: 'pawn', title: 'The Pawn', xp: 20,
        steps: [
          { type: 'text', title: 'The soul of chess', fen: '8/8/8/3p4/4P3/8/2P5/8 w - - 0 1',
            arrows: [{ from: 'c2', to: 'c4' }, { from: 'e4', to: 'd5', color: 'red' }],
            body: '<p>Pawns move <b>straight forward</b> one square (or two from their starting square) but <b>capture diagonally</b>. They never move backwards.</p><p>The 18th-century master Philidor called pawns “the soul of chess”: their structure decides where your pieces belong and what your plans are.</p><p>Reach the last rank and a pawn <b>promotes</b> — usually to a queen.</p>' },
          { type: 'stars', piece: 'wP', start: 'e2', stars: ['e4', 'e6', 'e8'], prompt: 'Push the pawn all the way — remember the double step from its start.' },
          { type: 'quiz', q: 'Approximate values: which trade gains material?', options: ['Give a rook, get a knight', 'Give a bishop, get a rook', 'Give a queen, get a rook + pawn'], answer: 1,
            explain: 'Rook (5) for bishop (3) wins about two pawns of value — the “exchange”. Values: pawn 1, knight 3, bishop 3, rook 5, queen 9.' }
        ]
      }
    ]
  },
  {
    id: 'u2', title: 'Rules That Decide Games', icon: '♔',
    blurb: 'Capturing, check, castling, en passant, promotion and draws.',
    lessons: [
      {
        id: 'capture', title: 'Capture & Check', xp: 20,
        steps: [
          { type: 'text', title: 'Taking pieces', body: '<p>You capture by moving onto an enemy piece’s square; it leaves the board. A piece is <b>hanging</b> if it can be taken for free. The single most common beginner loss is a hanging piece.</p>' },
          { type: 'move', fen: 'k7/8/8/3n4/8/8/8/K2R4 w - - 0 1', prompt: 'Black’s knight is undefended. Capture it.', solution: ['Rxd5'], hint: 'Rooks move along files.', explain: 'Free material. Always ask: “Is anything hanging — mine or theirs?”' },
          { type: 'text', title: 'Check', body: '<p>A king under attack is in <b>check</b>. You <i>must</i> escape immediately, in one of three ways:</p><ol><li><b>Move</b> the king,</li><li><b>Block</b> the attack,</li><li><b>Capture</b> the attacker.</li></ol><p>If none works, it is <b>checkmate</b> and the game is over.</p>' },
          { type: 'move', fen: '4r1k1/8/8/8/8/8/3B4/4K3 w - - 0 1', prompt: 'You are in check from the rook. Block it with your bishop.', solution: ['Be3'], hint: 'Put the bishop on the e-file.', explain: 'Blocking keeps your king safe and develops the bishop.' },
          { type: 'move', fen: 'k7/8/8/8/8/8/3q4/4K3 w - - 0 1', prompt: 'The queen came too close and is undefended. Capture the attacker!', solution: ['Kxd2'], hint: 'Your king can capture too.', explain: 'Kings can capture any undefended piece next to them.' }
        ]
      },
      {
        id: 'castling', title: 'Castling', xp: 20,
        steps: [
          { type: 'text', title: 'The only double move', fen: 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1',
            arrows: [{ from: 'e1', to: 'g1' }, { from: 'h1', to: 'f1', color: 'blue' }, { from: 'e1', to: 'c1' }, { from: 'a1', to: 'd1', color: 'blue' }],
            body: '<p>Castling moves the king two squares toward a rook, and the rook jumps to the other side. <code>O-O</code> is kingside, <code>O-O-O</code> queenside.</p><p>It does two jobs at once: <b>tucks the king to safety</b> and <b>brings a rook toward the centre</b>.</p><p>Conditions: neither piece has moved; no pieces between them; the king is not in check, and does not pass through or land on an attacked square.</p>' },
          { type: 'move', fen: '4k3/8/8/8/8/8/PPPPPPPP/RNBQK2R w K - 0 1', prompt: 'Castle kingside. (Move your king two squares to the right.)', solution: ['O-O'], hint: 'Drag the king from e1 to g1.', explain: 'Kingside castling is the most common way to secure the king.' },
          { type: 'move', fen: '4k3/8/8/8/8/8/PPP2PPP/R3KBNR w Q - 0 1', prompt: 'Now castle queenside.', solution: ['O-O-O'], hint: 'King from e1 to c1.', explain: 'Queenside castling puts the rook on d1 — often an open file — but the king takes a little longer to be safe.' },
          { type: 'quiz', fen: 'r3k2r/8/8/8/2b5/8/8/R3K2R w KQkq - 0 1', q: 'Black’s bishop on c4 eyes f1. Can White castle kingside?', options: ['Yes', 'No — the king would pass through an attacked square'], answer: 1,
            explain: 'The king may not cross f1 while it is attacked. Queenside castling is still legal here.' }
        ]
      },
      {
        id: 'special', title: 'En Passant & Promotion', xp: 20,
        steps: [
          { type: 'text', title: 'En passant: “in passing”', fen: '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1', arrows: [{ from: 'e5', to: 'd6' }],
            body: '<p>Black just played <code>d7–d5</code>, jumping past your e5-pawn. Only on the <b>very next move</b>, your pawn may capture it as if it had moved one square: <code>exd6</code>.</p><p>The rule was added (as pawns gained the double step, centuries ago) so a pawn cannot sneak past an enemy pawn.</p>' },
          { type: 'move', fen: '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1', prompt: 'Capture en passant.', solution: ['exd6'], hint: 'Pawn from e5 to d6.', explain: 'The d5 pawn disappears even though you landed on d6.' },
          { type: 'move', fen: '4k3/1P6/8/8/8/8/8/4K3 w - - 0 1', prompt: 'Promote your pawn to a queen.', solution: ['b8=Q'], hint: 'Push to b8 and choose the queen.', explain: 'A new queen — and it even gives check along the 8th rank.' },
          { type: 'text', title: 'Draws', fen: '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1',
            body: '<p>Not every game has a winner. A game is drawn by:</p><ul><li><b>Stalemate</b> — the side to move has no legal move but is <i>not</i> in check.</li><li><b>Threefold repetition</b> of the same position.</li><li><b>The 50-move rule</b> — 50 moves each with no capture or pawn move.</li><li><b>Insufficient material</b> (e.g., king vs king) or agreement.</li></ul>' },
          { type: 'quiz', fen: '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1', q: 'Black to move. What is the result?', options: ['Black is checkmated', 'Stalemate — a draw', 'Black plays Kg8'], answer: 1,
            explain: 'Black is not in check, but every king move is covered. Stalemate! White threw away a win. Always check your opponent has a move before you play.' }
        ]
      }
    ]
  },
  {
    id: 'u3', title: 'Checkmate Patterns', icon: '♚',
    blurb: 'Recognise the classic mating nets so you can spot them in a flash.',
    lessons: [
      {
        id: 'mates1', title: 'Back Rank & Ladder', xp: 25,
        steps: [
          { type: 'text', title: 'Pattern recognition', body: '<p>Strong players do not calculate everything — they <b>recognise patterns</b>. Psychology research on chess masters (de Groot, then Chase & Simon in the 1970s) found that experts remember meaningful positions far better than novices because they see familiar “chunks”. Mating patterns are the first chunks worth learning.</p>' },
          { type: 'text', title: 'The back-rank mate', fen: '6k1/5ppp/8/8/8/8/8/3R2K1 w - - 0 1', arrows: [{ from: 'd1', to: 'd8' }],
            body: '<p>The king is trapped behind its own pawns. A rook or queen on the back rank delivers mate. Defence: make <i>luft</i> (“air”) with a pawn move like h3/h6 when you have time.</p>' },
          { type: 'move', fen: '6k1/5ppp/8/8/8/8/8/3R2K1 w - - 0 1', prompt: 'Mate in one.', goal: 'mate', hint: 'The 8th rank is undefended.', explain: 'Rd8# — the pawns that “protect” the king are its prison.' },
          { type: 'text', title: 'The ladder (lawn-mower)', fen: '4k3/R7/8/8/8/8/8/1R4K1 w - - 0 1',
            body: '<p>Two heavy pieces take turns: one cuts off a rank, the other gives check on the next. The king is pushed to the edge and mated.</p>' },
          { type: 'move', fen: '4k3/R7/8/8/8/8/8/1R4K1 w - - 0 1', prompt: 'Finish the ladder: mate in one.', goal: 'mate', hint: 'The a7-rook guards the 7th rank.', explain: 'Rb8# — the 7th and 8th ranks are both controlled.' }
        ]
      },
      {
        id: 'mates2', title: 'Smothered & Scholar’s Mate', xp: 25,
        steps: [
          { type: 'text', title: 'Smothered mate', fen: '6rk/6pp/8/6N1/8/8/8/6K1 w - - 0 1',
            body: '<p>A king surrounded by its own pieces can be mated by a lone knight — the knight jumps, nothing can block. It is one of the most beautiful patterns in chess.</p>' },
          { type: 'move', fen: '6rk/6pp/8/6N1/8/8/8/6K1 w - - 0 1', prompt: 'Smother the king. Mate in one.', goal: 'mate', hint: 'Which square does a knight attack h8 from?', explain: 'Nf7# — the rook, g7 and h7 pawns block every escape.' },
          { type: 'text', title: 'Scholar’s mate — and why to respect it', fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4',
            arrows: [{ from: 'h5', to: 'f7', color: 'red' }, { from: 'c4', to: 'f7', color: 'red' }],
            body: '<p>f7 (f2 for White) is the weakest square at the start: only the king defends it. Queen + bishop attacking it can mate in four moves. Here Black blundered with <code>3...Nf6??</code>.</p>' },
          { type: 'move', fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4', prompt: 'Punish it: mate in one.', goal: 'mate', hint: 'Attack the weakest square.', explain: 'Qxf7#. As Black, the antidote is 3...g6 (or 2...Nc6 and 3...Qe7) — covered in the Opening Traps lesson.' },
          { type: 'move', fen: 'k7/8/1K6/8/8/8/7Q/8 w - - 0 1', prompt: 'King + queen working together: mate in one.', goal: 'mate', hint: 'Your king covers a7 and b7.', explain: 'Qh8# — the king takes away the escape squares, the queen delivers the blow.' }
        ]
      }
    ]
  },
  {
    id: 'u4', title: 'Tactics: Winning Material', icon: '⚔',
    blurb: 'Forks, pins, skewers and discoveries — the engine room of chess.',
    lessons: [
      {
        id: 'cct', title: 'Checks, Captures, Threats', xp: 20,
        steps: [
          { type: 'text', title: 'A thinking routine', body: '<p>Before every move, scan in this order:</p><ol><li><b>Checks</b> — every check you can give.</li><li><b>Captures</b> — every capture.</li><li><b>Threats</b> — moves that attack something.</li></ol><p>Then ask the same questions <i>from your opponent’s side</i>: “What does their last move threaten?” This blunder-check habit is taught by coaches at every level, and it is the fastest way to stop losing pieces.</p><p class="tip">The Practice board has a <b>Coach</b> that warns you when a move hangs material — use it to build this habit.</p>' },
          { type: 'quiz', q: 'Your opponent just moved. What should you ask first?', options: ['What is my plan?', 'What does their move threaten?', 'Which piece looks nicest?'], answer: 1,
            explain: 'Threats first. Plans are worthless if you lose a piece next move.' }
        ]
      },
      {
        id: 'fork', title: 'The Fork', xp: 25,
        steps: [
          { type: 'text', title: 'Two targets, one move', fen: '2r3k1/5ppp/8/3N4/8/8/5PPP/6K1 w - - 0 1',
            body: '<p>A <b>fork</b> attacks two things at once. The opponent can save only one. Knights are the champion forkers, because their attack cannot be blocked.</p>' },
          { type: 'move', fen: '2r3k1/5ppp/8/3N4/8/8/5PPP/6K1 w - - 0 1', prompt: 'Find the knight fork, then collect the prize.', solution: ['Ne7+', 'Kf8', 'Nxc8'], hint: 'A check that also hits the rook.', explain: 'Ne7+ forks king and rook. The king must move, and the rook falls.' }
        ]
      },
      {
        id: 'pin', title: 'Pins & Skewers', xp: 25,
        steps: [
          { type: 'text', title: 'The pin', body: '<p>A <b>pin</b> attacks a piece that cannot move without exposing something more valuable behind it. If the piece behind is the king, the pin is <i>absolute</i> — the pinned piece legally cannot move.</p>' },
          { type: 'move', fen: '6k1/6p1/4q3/8/8/1P6/5PPP/5BK1 w - - 0 1', prompt: 'Pin Black’s queen to the king.', solution: ['Bc4'], hint: 'Line up the bishop with the queen and the king on g8.', explain: 'Bc4 pins the queen. It cannot step aside; the best Black can do is Qxc4 bxc4, giving the queen (9) for a bishop (3).' },
          { type: 'text', title: 'The skewer', body: '<p>A <b>skewer</b> is a pin in reverse: the <i>more</i> valuable piece is in front. When it moves away, you capture what was behind it.</p>' },
          { type: 'move', fen: 'R7/8/8/4k3/8/8/4q3/7K w - - 0 1', prompt: 'Skewer the king and queen.', solution: ['Re8+', 'Kd4', 'Rxe2'], hint: 'Check the king along the e-file.', explain: 'Re8+! The king must step off the file and the queen behind it is lost.' }
        ]
      },
      {
        id: 'discovery', title: 'Discovered Attacks', xp: 25,
        steps: [
          { type: 'text', title: 'Unmasking a battery', fen: '3q3k/8/8/8/3N4/8/1B6/6K1 w - - 0 1', arrows: [{ from: 'b2', to: 'h8', color: 'red' }],
            body: '<p>When one piece moves out of another’s line, it <b>discovers</b> an attack. If the hidden attack is a check, the moving piece is free to grab almost anything — the opponent must deal with the check first.</p>' },
          { type: 'move', fen: '3q3k/8/8/8/3N4/8/1B6/6K1 w - - 0 1', prompt: 'Move the knight with discovered check — and attack the queen.', solution: [['Nc6+', 'Ne6+'], 'Kg8', ['Nxd8']], hint: 'From which squares does a knight hit d8?', explain: 'The bishop gives check, the knight attacks the queen. Black can’t answer both.' }
        ]
      }
    ]
  },
  {
    id: 'u5', title: 'Opening Principles', icon: '♞',
    blurb: 'The theory behind every good opening — and a short history of how it was discovered.',
    lessons: [
      {
        id: 'principles', title: 'The Three Goals', xp: 25,
        steps: [
          { type: 'text', title: 'Why openings matter', fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
            body: '<p>The opening is a race. Both sides start with the same army; the side that mobilises faster and controls more space usually gets the better middlegame. Every sound opening pursues three goals:</p><ol><li><b>Control the centre</b> (d4, e4, d5, e5).</li><li><b>Develop</b> knights and bishops quickly.</li><li><b>Castle</b> to make the king safe and connect the rooks.</li></ol><p class="tip">Learn the <i>why</i> before memorising lines. If you understand the goals, you can find good moves even after your opponent leaves the book.</p>' },
          { type: 'text', title: 'Why the centre?', fen: '8/8/8/8/3N4/8/8/7N w - - 0 1',
            highlights: { b3: 'green', b5: 'green', c2: 'green', c6: 'green', e2: 'green', e6: 'green', f3: 'green', f5: 'green', f2: 'yellow', g3: 'yellow' },
            body: '<p>A knight on d4 controls <b>8</b> squares; the knight in the corner controls just <b>2</b>. Pieces in the centre reach both wings quickly. Pawns on e4/d4 also take squares away from enemy pieces.</p>' },
          { type: 'move', fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', prompt: 'Play a first move that fights for the centre.', solution: [['e4', 'd4', 'c4', 'Nf3']], hint: 'A central pawn, or a knight toward the centre.', explain: '1.e4 and 1.d4 are the classical choices; 1.c4 and 1.Nf3 fight for the centre from a distance. All are top-level moves.' },
          { type: 'move', fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2', prompt: 'After 1.e4 e5: develop a piece with a threat.', solution: [['Nf3']], hint: 'A knight move that attacks the e5 pawn.', explain: '2.Nf3 develops, eyes the centre and attacks e5 — a move that does three jobs.' },
          { type: 'quiz', q: 'Rule of thumb: which pieces should you usually develop first?', options: ['Queen and rooks', 'Knights, then bishops', 'Edge pawns (a- and h-pawns)'], answer: 1,
            explain: 'Knights have fewer good squares, so committing them early is low-risk; bishops often wait to see the pawn structure. The queen comes out later.' }
        ]
      },
      {
        id: 'mistakes', title: 'Opening Sins', xp: 25,
        steps: [
          { type: 'text', title: 'The early queen', fen: 'rnbqkbnr/pppp1ppp/8/4p2Q/4P3/8/PPPP1PPP/RNB1KBNR b KQkq - 1 2',
            body: '<p><code>2.Qh5</code> attacks e5 and eyes f7. It looks scary, but Black can develop <i>with tempo</i> — bringing out pieces while attacking the queen, so White wastes moves running away.</p>' },
          { type: 'move', fen: 'rnbqkbnr/pppp1ppp/8/4p2Q/4P3/8/PPPP1PPP/RNB1KBNR b KQkq - 1 2', prompt: 'As Black: defend e5 with a developing move.', solution: [['Nc6']], hint: 'A knight can protect e5.', explain: '2...Nc6 develops and defends. Next, ...g6 or ...Nf6 will hit the queen and gain time.' },
          { type: 'text', title: 'Other sins', body: '<ul><li><b>Moving the same piece twice</b> without a reason — each move is a tempo you didn’t spend developing.</li><li><b>Pawn-grabbing</b> while undeveloped — “a pawn is worth three tempi” is an old (rough) rule.</li><li><b>Leaving the king in the centre</b> once the position opens.</li><li><b>Too many pawn moves</b> — pawns can’t go back, and every move leaves holes.</li></ul><p>These are guidelines, not laws. Grandmasters break them when concrete calculation justifies it — that is the difference between a rule and a principle.</p>' },
          { type: 'quiz', q: 'You have moved a knight three times, everything else is at home. Your opponent has 3 pieces out and has castled. Who is better?', options: ['You — your knight is active', 'Your opponent — they are far ahead in development'], answer: 1,
            explain: 'Development is measured across your whole army. One active knight can’t fight three pieces and a safe king.' }
        ]
      },
      {
        id: 'history', title: 'A Brief History of Opening Theory', xp: 20,
        steps: [
          { type: 'text', title: 'The Romantic era (c. 1800–1880)', body: '<p>Players such as Adolf Anderssen and Paul Morphy favoured gambits: sacrifice a pawn or more for rapid development and a direct attack. Morphy, the American prodigy of the 1850s, showed the power of fast development and open lines better than anyone of his time.</p>' },
          { type: 'text', title: 'The Classical school', body: '<p>Wilhelm Steinitz, the first official World Champion (1886), argued that attacks succeed only when the position justifies them. He introduced ideas we still use: accumulating small advantages, pawn structure, and the value of a solid defence. Siegbert Tarrasch then turned these into dogmatic rules: occupy the centre with pawns.</p>' },
          { type: 'text', title: 'Hypermodernism (1920s)', body: '<p>Aron Nimzowitsch and Richard Réti showed you can <b>control</b> the centre from a distance — with fianchettoed bishops and knights — and attack an opponent’s pawn centre later. Nimzowitsch’s <i>My System</i> (1925) is still read today. Openings like the King’s Indian and Grünfeld grew from these ideas.</p>' },
          { type: 'text', title: 'The engine age', body: '<p>Since Deep Blue beat Garry Kasparov in 1997, and neural-network engines such as AlphaZero (2017) and modern Stockfish, opening theory has been rechecked by computers. Some old “refuted” lines were rehabilitated; others died. For a learner the lesson is simple: <b>principles first, memory second</b>.</p>' },
          { type: 'quiz', q: 'Which idea is “hypermodern”?', options: ['Occupy the centre with as many pawns as possible', 'Control the centre with pieces from the flanks, then strike at it', 'Sacrifice material for an immediate king attack'], answer: 1,
            explain: 'Hypermodern players let the opponent build a centre, then undermine it.' }
        ]
      }
    ]
  },
  {
    id: 'u6', title: 'Your First Repertoire', icon: '♝',
    blurb: 'Openings chosen for learners — each with plans, history and drills. Open the Openings tab to study and train them.',
    lessons: [
      { id: 'rep-intro', title: 'Choosing a Repertoire', xp: 20,
        steps: [
          { type: 'text', title: 'What is a repertoire?', body: '<p>A <b>repertoire</b> is the small set of openings you play every game: one system as White, one answer to <code>1.e4</code> and one to <code>1.d4</code> as Black. Sticking to it means every game teaches you more about the same middlegames.</p><p>This Academy recommends:</p><table class="rep"><tr><th>As White</th><td><b>Italian Game</b> (main) — or the <b>London System</b> if you prefer a fixed setup</td></tr><tr><th>Black vs 1.e4</th><td><b>Caro-Kann Defence</b></td></tr><tr><th>Black vs 1.d4</th><td><b>Queen’s Gambit Declined</b></td></tr></table><p>Why these? They follow the opening principles directly, lead to sound structures, are played at every level from club to World Championship, and don’t require memorising razor-sharp lines to survive.</p>' },
          { type: 'quiz', q: 'Why do coaches recommend principled openings over tricky traps for improving players?', options: ['Traps never work', 'Principled openings teach plans you reuse in every game; traps only work if the opponent errs', 'Principled openings are shorter to memorise'], answer: 1,
            explain: 'A trap that fails often leaves you worse. A principled opening gives a good position even against the best reply.' },
          { type: 'text', title: 'How to study an opening', body: '<ol><li><b>Explore</b> the main line move by move and read the reason for each move.</li><li><b>Drill</b> it. The trainer uses spaced repetition: lines you get right come back after longer intervals; mistakes come back soon.</li><li><b>Play</b> from the final position against the bot to practise the middlegame plan.</li><li>After real games, check where you or your opponent left the line — that is where learning happens.</li></ol><p>Head to the <b>Openings</b> tab to begin.</p>' }
        ]
      }
    ]
  },
  {
    id: 'u7', title: 'Endgame Essentials', icon: '♕',
    blurb: 'Convert your advantages: basic mates and pawn endings.',
    lessons: [
      {
        id: 'kqk', title: 'King & Queen vs King', xp: 30,
        steps: [
          { type: 'text', title: 'The box method', fen: '8/8/8/4k3/8/8/8/3QK3 w - - 0 1',
            body: '<p>Use the queen to build a shrinking <b>box</b> around the enemy king (stay a knight’s move away from it), push it to the edge, then bring your own king up to help deliver mate.</p><p class="tip">Danger: stalemate! Once the king is on the edge, always make sure it still has a legal move until you give mate.</p>' },
          { type: 'play', fen: '8/8/8/4k3/8/8/8/3QK3 w - - 0 1', prompt: 'Checkmate the lone king within 15 moves. The engine defends.', goal: 'mate', maxMoves: 15, depth: 2 }
        ]
      },
      {
        id: 'pawnend', title: 'Pawn Endings', xp: 25,
        steps: [
          { type: 'text', title: 'The rule of the square', fen: '8/8/8/3k4/P7/8/8/7K b - - 0 1',
            highlights: { a4: 'yellow', b4: 'yellow', c4: 'yellow', d4: 'yellow', e4: 'yellow', a5: 'yellow', b5: 'yellow', c5: 'yellow', d5: 'yellow', e5: 'yellow', a6: 'yellow', b6: 'yellow', c6: 'yellow', d6: 'yellow', e6: 'yellow', a7: 'yellow', b7: 'yellow', c7: 'yellow', d7: 'yellow', e7: 'yellow', a8: 'yellow', b8: 'yellow', c8: 'yellow', d8: 'yellow', e8: 'yellow' },
            body: '<p>Draw a square from the pawn to its promotion rank. If the defending king can step <b>into</b> the square on its move, it catches the pawn. No counting needed.</p>' },
          { type: 'quiz', fen: '8/8/8/3k4/P7/8/8/7K b - - 0 1', q: 'Black to move. Can the king catch the a-pawn?', options: ['Yes — it is already inside the square', 'No — the pawn queens'], answer: 0,
            explain: '...Kc5 (or ...Kc6) and the king reaches the pawn in time.' },
          { type: 'text', title: 'Opposition', fen: '4k3/8/4K3/4P3/8/8/8/8 w - - 0 1',
            body: '<p>When two kings face each other with one square between them, the side <b>not</b> to move “has the opposition” — the other must give way. In king-and-pawn endings, winning the opposition often decides whether the pawn promotes.</p><p>Key lesson: in front of your pawn, your <b>king leads</b> and the pawn follows.</p>' },
          { type: 'move', fen: '4k3/8/8/8/8/8/1P6/K7 w - - 0 1', prompt: 'Push the pawn two squares — then picture its new square. Is Black’s king inside it?', solution: ['b4'], hint: 'From its start the pawn can move two squares.', explain: 'After b4 the square is b4–f4–f8–b8. Black’s king on e8 is inside it, so it will catch the pawn — you would need your king’s help to win.' }
        ]
      }
    ]
  }
];
