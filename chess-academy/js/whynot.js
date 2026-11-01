/* "Why not ...?" — tempting moves that are mistakes, and what is wrong with them.
 * Keyed by the moves played so far (space-separated SAN; "" = starting position).
 * Each entry maps an alternative move to the reason it is worse than the book move.
 * Every key and alternative is checked for legality by tests/validate.js. */
var WHY_NOT = {
  '': {
    'f3': 'It weakens the king’s e1–h4 diagonal and takes f3 from the knight. 1.f3 e5 2.g4?? Qh4# is the fastest possible checkmate (Fool’s Mate).',
    'Nh3': 'A knight on the rim is dim: from h3 it controls only a few squares and none in the centre. Nf3 does the same job far better.',
    'a4': 'An edge pawn move that does nothing for the centre or for development. You have spent a tempo on nothing.'
  },
  'e4': {
    'f6': 'It weakens Black’s king (the e8–h5 diagonal) and takes the best square from the g8-knight, and it does nothing for development.',
    'Nh6': 'The knight goes to the edge, where it controls little and blocks nothing. ...Nf6 or a centre pawn is far stronger.'
  },
  'e4 e5': {
    'Qh5': 'It brings the queen out too early. Black defends with ...Nc6 and then gains time by attacking the queen with ...g6 and ...Nf6. Practise the refutation in Opening Traps to Avoid.',
    'Ke2': 'It blocks your own bishop and queen and gives up the right to castle, for no reason at all.'
  },
  'e4 e5 Nf3': {
    'f6': 'It defends e5 but weakens the king badly: 3.Nxe5! fxe5? 4.Qh5+ and White’s attack wins (the Damiano Defence). Never weaken the e8–h5 diagonal this early.',
    'Qe7': 'It defends e5, but the queen blocks the f8-bishop and is exposed. ...Nc6 defends e5 and develops a piece at the same time.',
    'd6': 'Playable (the Philidor Defence), but passive: it shuts in the f8-bishop. ...Nc6 defends e5 while keeping the bishop free.'
  },
  'e4 e5 Nf3 Nc6': {
    'Ng5': 'It moves the same piece twice and walks into 3...Qxg5: the queen takes the knight along the d8–g5 diagonal, and the d2-pawn blocks your c1-bishop from recapturing.',
    'Nxe5': 'e5 is defended by the c6-knight: 3.Nxe5? Nxe5 gives away a knight for a pawn.'
  },
  'e4 e5 Nf3 Nc6 Bc4': {
    'Nd4': 'A known trap (4.Nxe5? Qg5! is dangerous for White), but against correct play like 4.Nxd4 or 4.c3, Black has just moved the knight twice and lost time.',
    'h6': 'It stops Ng5 ideas, but costs a whole tempo and develops nothing. ...Bc5 or ...Nf6 are much more useful.'
  },
  'e4 e5 Nf3 Nc6 d4 exd4': {
    'Qxd4': 'The queen recaptures on a square the c6-knight attacks: 4.Qxd4?? Nxd4 loses the queen. Recapture with the knight (Nxd4) instead.'
  },
  'e4 e5 Nf3 Nc6 d4': {
    'Nxd4': 'After 3...Nxd4 4.Nxd4 exd4 5.Qxd4, White’s queen dominates the centre and cannot easily be chased. Black has traded off a developed piece and lost time.',
    'd6': 'It holds e5 but is passive. White keeps more space, and Black’s f8-bishop is shut in.'
  },
  'e4 e5 Nf3 Nc6 Nc3 Nf6': {
    'Nxe5': 'This is the Halloween Gambit: 4.Nxe5? Nxe5 5.d4 gives up a knight for a pawn and some activity. It can catch people out, but against accurate defence White is simply a piece down.'
  },
  'e4 e5 Qh5': {
    'g6': 'It blocks the queen, but leaves e5 undefended: 3.Qxe5+ forks the king and the h8-rook along the diagonal, because the g7-pawn has moved.',
    'Nf6': 'It develops with a threat, but e5 hangs: 3.Qxe5+ wins a pawn with check.'
  },
  'e4 e5 Qh5 Nc6 Bc4': {
    'Nf6': 'The classic blunder: 4.Qxf7# is Scholar’s Mate. f7 is attacked twice (queen and bishop) and defended only by the king.'
  },
  'e4 e5 Qh5 Nc6 Bc4 g6 Qf3': {
    'Bg7': 'It develops, but ignores the threat: 5.Qxf7# is still checkmate. Block the f-file with ...Nf6 first.'
  },
  'e4 e5 Bc4 Nc6 Qf3': {
    'Bc5': 'It ignores the threat on f7: 4.Qxf7# is checkmate. Always ask what your opponent’s last move threatens.'
  },
  'e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng3': {
    'Bxc2': 'c2 is defended by the queen: 5...Bxc2?? Qxc2 gives away a bishop for a pawn.'
  },
  'd4 d5 Bf4 c5 e3 Nc6 c3 Qb6': {
    'Nf3': 'It leaves b2 undefended: 5...Qxb2 wins a pawn and attacks the a1-rook. With the bishop on f4, nothing guards b2, which is why 5.Qb3 is the standard answer.'
  },
  'd4 d5 Bf4 Nf6 e3 e6 Nf3 c5 c3 Nc6 Nbd2 Bd6': {
    'Bxd6': 'It allows ...Qxd6 and trades off the London bishop, your best minor piece. Bg3 keeps it, and if Black takes, hxg3 opens the h-file for your rook.'
  },
  'd4 d5 c4 c6 Nf3 Nf6 Nc3 dxc4': {
    'e3': 'Black can keep the pawn for a while with 5...b5!, which is why 5.a4 comes first to stop it.'
  },
  'e4 d5 exd5 Qxd5 Nc3': {
    'Qe5+': 'It gives check, but after 4.Be2 the queen is still exposed and will be hit again by Nf3 or d4. Black just loses more time.'
  },
  'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7': {
    'Nxe5': 'e5 is defended by the c6-knight: 6.Nxe5? Nxe5 just gives away a knight for a pawn. That’s why White plays Re1 first, to make the threat real.'
  },
  'e4 e6 d4 d5 e5 c5 c3 Nc6 Nf3 Qb6 a3': {
    'Qxb2': 'b2 is defended by the c1-bishop: 6...Qxb2?? Bxb2 loses the queen. Always check what defends a pawn before you grab it.'
  },
  'd4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5': {
    'dxe5': 'After 7.dxe5 dxe5 8.Qxd8 Rxd8, the queens are off and White’s space advantage disappears. Grabbing a pawn with 9.Nxe5? runs into 9...Nxe4!, which wins it back.'
  },
  'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6': {
    'e5': 'After 5.e5? dxe5, the pawn is simply lost: nothing defends e5, and the d4-knight doesn’t cover it.'
  },
  'd4 Nf6 c4 e6 Nc3 Bb4 Qc2 O-O a3': {
    'Ba5': 'Retreating keeps the bishop but costs time, and b4 can chase it again. Taking on c3 is the consistent follow-up to the pin.'
  },
  'd4 Nf6 c4 g6 Nc3 d5 cxd5': {
    'Qxd5': 'The queen recaptures where the c3-knight attacks it: 4...Qxd5?? Nxd5 Nxd5 gives the queen for a knight. Recapture with the knight.'
  },
  'd4 Nf6 c4 e6 g3 d5 Bg2 Be7 Nf3 O-O O-O dxc4 Qc2 a6 a4': {
    'b5': 'After 8...b5? 9.axb5 axb5?? 10.Rxa8 the a-file opens onto Black’s undefended rook (the c8-bishop blocks the queen). That’s why Black plays ...Bd7 first.'
  }
};
