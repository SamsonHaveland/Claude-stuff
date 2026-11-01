var LIBRARY = [
  { title: 'How to study chess', html: `
    <ol>
      <li><b>Play slower games.</b> Rapid (15+10 or longer) gives time to apply what you learn. Blitz trains speed, not understanding.</li>
      <li><b>Solve tactics daily.</b> Short, regular sessions build pattern recognition better than occasional marathons.</li>
      <li><b>Review every loss.</b> Find the move where things went wrong before you check an engine. Ask “what did I miss?”, not just “what was best?”</li>
      <li><b>Learn openings by ideas, then lines.</b> Use the Explore view for the why, then let spaced repetition keep the moves fresh.</li>
      <li><b>Study endgames early.</b> They teach how each piece really works, and the knowledge never goes out of date.</li>
    </ol>
    <p class="muted">Why spaced repetition? Reviewing just before you would forget strengthens memory more than cramming. The drill trainer uses Leitner boxes: a line you play perfectly moves up a box (next review in 1, 3, 7, 14, 30, then 60 days); a slip sends it back to box 1.</p>` },
  { title: 'About your estimated rating', html: `
    <p>The Academy guesses your playing strength with an Elo-style calculation, the same family of maths used by FIDE, Chess.com and Lichess.</p>
    <ul>
      <li><b>Exercises:</b> each lesson has a difficulty level (shown on the path, e.g. ~850). Getting an exercise right on your <i>first attempt</i> counts as a win against that level; a mistake counts as a loss. Repeats never count, so replaying a lesson can’t inflate the number.</li>
      <li><b>Bot games</b> count three times as much, because real games are the best evidence. A game is rated only if you finish it (or resign) without using Hint, Take back, the Coach’s blunder warning, or changing the bot level mid-game.</li>
      <li>Early results move the estimate a lot; it settles down as evidence builds up, and the “likely between” range narrows.</li>
    </ul>
    <p><b>Limits — please read:</b> lesson difficulty levels and the bots’ ratings (Novice ~600, Casual ~900, Club ~1250) are informed guesses. They have not been measured against rated human players, so treat the number as a rough indication of progress, not a real rating. Exercises top out around 1000, so the bot games matter most beyond that. Ratings also differ between sites; for a real rating, play rated rapid games on Lichess or Chess.com.</p>` },
  { title: 'Glossary', html: `<dl class="glossary">
    <dt>Algebraic notation</dt><dd>The standard way to write moves: piece letter + destination square (Nf3, Bxc6, O-O).</dd>
    <dt>Development</dt><dd>Moving pieces off their starting squares to useful posts.</dd>
    <dt>Tempo</dt><dd>A unit of time — one move. “Gaining a tempo” means making a useful move that also forces a reply.</dd>
    <dt>Fianchetto</dt><dd>Developing a bishop to b2/g2 (or b7/g7) after moving the knight’s pawn one square.</dd>
    <dt>Gambit</dt><dd>An opening that sacrifices material, usually a pawn, for time or initiative.</dd>
    <dt>Pawn chain</dt><dd>Diagonally linked pawns. Attack the base of the chain (the pawn that isn’t protected by another pawn).</dd>
    <dt>Open file</dt><dd>A file with no pawns. Rooks belong there.</dd>
    <dt>Outpost</dt><dd>A square that enemy pawns can no longer attack — ideal for a knight.</dd>
    <dt>Isolated pawn</dt><dd>A pawn with no friendly pawns on the neighbouring files.</dd>
    <dt>Minority attack</dt><dd>Advancing fewer pawns against a larger group (e.g. b4–b5 in the QGD Exchange) to create a weakness.</dd>
    <dt>Opposition</dt><dd>In king endings, kings facing each other with one square between; the side not to move holds it.</dd>
    <dt>Zugzwang</dt><dd>A position where any move worsens your position — you would rather pass.</dd>
    <dt>Book move / theory</dt><dd>Known, analysed opening moves. “Out of book” means into new territory.</dd>
    <dt>ECO code</dt><dd>Encyclopaedia of Chess Openings classification (A00–E99).</dd>
  </dl>` },
  { title: 'Further reading & where to play', html: `<ul>
    <li><b>Lichess.org</b> — free, open-source, ad-free play, puzzles and analysis. Its “Learn” and “Practice” sections inspired the star exercises here.</li>
    <li><b>Chessable</b> — courses built on spaced repetition (“MoveTrainer”), the model for the drill trainer here.</li>
    <li><b>Chess.com Lessons</b> — structured video and interactive lessons.</li>
    <li><i>Logical Chess: Move by Move</i> — Irving Chernev. Every move of 33 games explained.</li>
    <li><i>My System</i> — Aron Nimzowitsch (1925). Classic strategic theory.</li>
    <li><i>Silman’s Complete Endgame Course</i> — Jeremy Silman. Endgames organised by rating level.</li>
  </ul>` }
];
