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

/* More notes: at least one per opening, aimed at positions the drills actually reach. */
(function () {
  const MORE = {
    // Italian Game
    'e4 e5 Nf3 Nc6 Bc4 Bc5': {
      'Ng5': 'Going after f7 too early: 4.Ng5? Qxg5 just takes the knight along the d8–g5 diagonal, and the d2-pawn stops your c1-bishop from recapturing.'
    },
    'e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5': {
      'Bxd5': 'Wrong recapture: 5.Bxd5? Nxd5 6.exd5 Qxd5 gives up your attacking bishop for a pawn. Take with the pawn (exd5), keeping the bishop aimed at f7.'
    },
    // Four Knights
    'e4 e5 Nf3 Nc6 Nc3 Nf6': {
      'Bc4': 'It allows the “fork trick”: 4.Bc4? Nxe4! 5.Nxe4 d5 forks bishop and knight, Black regains the piece and gets the centre. That’s why 4.Bb5 or 4.d4 are played.'
    },
    // London System
    'd4 Nf6 Bf4 g6 e3 Bg7 Nf3 O-O Be2 d6': {
      'O-O': 'Not a mistake, but ...Nh5 can then hunt the f4-bishop. Playing h3 first gives the bishop a safe retreat on h2, so Black can’t trade it off.'
    },
    // Caro-Kann
    'e4 c6 d4 d5 e5': {
      'e6': 'It locks your c8-bishop behind its own pawns, so you get a French Defence where ...c6 has used up a tempo. Develop the bishop first with ...Bf5, then play ...e6.'
    },
    'e4 c6 d4 d5 exd5': {
      'Qxd5': 'The queen comes out early and 4.Nc3 chases it with tempo. Recapturing with the pawn (...cxd5) keeps a pawn in the centre.'
    },
    'e4 c6 d4 d5 exd5 cxd5 Bd3 Nc6 c3 Nf6 Bf4 Bg4 Qb3': {
      'e6': 'It ignores the threat to b7: 7.Qxb7 wins a pawn and attacks the c6-knight and the a8-rook. Defend b7 first with ...Qd7 or ...Qc8.'
    },
    'e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng3 Bg6 h4 h6 Nf3 Nd7 h5': {
      'Bxh5': 'h5 is defended by the h1-rook along the open h-file: 8...Bxh5?? Rxh5 loses the bishop for a pawn. Retreat with ...Bh7.'
    },
    // Queen's Gambit Declined
    'd4 d5 c4': {
      'Nf6': 'The Marshall Defence: after 3.cxd5 Nxd5 4.e4 White builds a big centre while chasing the knight. ...e6 keeps the d5-pawn solidly supported.'
    },
    'd4 d5 c4 e6 Nc3 Nf6 cxd5': {
      'Nxd5': 'After 4...Nxd5 5.e4 Nxc3 6.bxc3, White gets a big pawn centre for free. Recapturing with the e-pawn keeps your share of the centre and frees the c8-bishop.'
    },
    'd4 d5 Bf4 c5 e3 Nc6 c3 Qb6 Qb3': {
      'Qxb3': 'Trading helps White: after axb3 the a1-rook gets the open a-file and the b3-pawn guards c4. ...c4 gains space with tempo instead.'
    },
    // Queen's Gambit
    'd4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O Nf3 Nbd7': {
      'Bxf6': 'It gives up the bishop pair for no reason. Black recaptures comfortably and the pressure on d5 disappears. Keep the pin and develop with Rc1 or Bd3.'
    },
    // Ruy Lopez
    'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5': {
      'Bxb5': 'The b5-pawn is protected by the a6-pawn: 7.Bxb5? axb5 gives a bishop for a pawn. Retreat to b3, where the bishop still eyes f7.'
    },
    'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O h3 Na5': {
      'Nxe5': 'e5 is defended by the d6-pawn: 10.Nxe5? dxe5 loses a knight for a pawn. Keep the bishop with Bc2 and prepare d4.'
    },
    // French Defence
    'e4 e6 d4 d5 Nd2 Nf6 e5 Nfd7 Bd3 c5 c3 Nc6 Ne2 cxd4 cxd4': {
      'Nxd4': 'The d4-pawn is defended by the e2-knight: 9...Nxd4? 10.Nxd4 gives up a knight for a pawn, and tricks like ...Qb6 don\u2019t win it back. Keep up the pressure on d4 and challenge the head of the chain with ...f6.'
    },
    'e4 e6 d4 d5 Nc3 Nf6 Bg5 Be7 e5': {
      'Ng4': 'The knight goes offside: once the bishops come off (6.Bxe7 Qxe7), White’s queen can take on g4. ...Nfd7 keeps it safe and ready to hit e5 with ...c5 and ...f6.'
    },
    // King's Indian
    'd4 Nf6 c4 g6 Nc3 Bg7 e4': {
      'Nxe4': 'e4 is defended by the c3-knight: 4...Nxe4? 5.Nxe4 loses a knight for a pawn. The KID lets White have the centre now and attacks it later with ...e5.'
    },
    'd4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2': {
      'Nxe4': 'Still defended by the c3-knight: 6...Nxe4? 7.Nxe4 just loses a piece. Strike with ...e5 instead.'
    },
    // English
    'c4 e5 Nc3 Nf6 Nf3 Nc6 g3 d5 cxd5 Nxd5 Bg2 Nb6 O-O Be7': {
      'Nxe5': 'e5 is defended by the c6-knight: 8.Nxe5? Nxe5 gives a knight for a pawn. Play d3 and prepare a3/b4 on the queenside.'
    },
    'c4 c5 Nc3 Nc6 g3 g6 Bg2 Bg7 Nf3 Nf6 O-O O-O d4 cxd4': {
      'Qxd4': 'The queen recaptures where the c6-knight attacks it: 8.Qxd4?? Nxd4 loses the queen. Recapture with the knight.'
    },
    // Sicilian Najdorf
    'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3': {
      'Nxe4': 'e4 is defended by the c3-knight: 5...Nxe4? 6.Nxe4 loses a piece for a pawn. 5...a6 is the Najdorf move.'
    },
    'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3 e5 Nb3 Be6 f3 Be7 Qd2 O-O O-O-O': {
      'Nxe4': 'e4 is defended twice (f3-pawn and c3-knight): 10...Nxe4? loses a knight for a pawn. Prepare ...b5–b4 to attack the c3-knight first.'
    },
    'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Bg5 e6 f4 Qb6 Qd2 Qxb2 Rb1': {
      'Qxc3': 'The c3-knight is defended by the queen on d2: 9...Qxc3?? 10.Qxc3 loses the queen. Retreat with ...Qa3.'
    },
    // Nimzo-Indian
    'd4 Nf6 c4 e6 Nc3 Bb4 e3': {
      'Bxc3+': 'Not losing, but premature: in the Rubinstein Black usually keeps the pin until White spends a move on a3, so the doubling costs White a tempo. Castle first.'
    },
    'd4 Nf6 c4 e6 Nc3 Bb4 e3 O-O Bd3 d5 Nf3 c5 O-O Nc6 a3 Bxc3 bxc3 dxc4 Bxc4': {
      'Qxd4': 'The d4-pawn is defended three times (e3, c3 and the f3-knight): 10...Qxd4?? loses the queen. ...Qc7 prepares ...e5 instead.'
    },
    // Grünfeld
    'd4 Nf6 c4 g6 Nc3 d5 cxd5 Nxd5 e4': {
      'Nf6': 'Retreating lets 6.e5 hit the knight again, so Black loses time while White gains space. 5...Nxc3 trades first and then attacks the centre.'
    },
    'd4 Nf6 c4 g6 Nc3 d5 cxd5 Nxd5 e4 Nxc3 bxc3 Bg7 Nf3 c5 Rb1 O-O Be2 cxd4 cxd4 Qa5+ Bd2': {
      'Qxd2+': 'The d2-bishop is defended by the queen and the f3-knight: 11...Qxd2+?? 12.Qxd2 gives the queen for a bishop. Take the a2-pawn instead.'
    },
    'd4 Nf6 c4 g6 Nc3 d5 cxd5 Nxd5 e4 Nxc3 bxc3 Bg7 Bc4 c5 Ne2 Nc6 Be3': {
      'Bxd4': 'd4 is defended three times (c3-pawn, e2-knight, e3-bishop): after 9...Bxd4? 10.cxd4 cxd4, Black has only two pawns for the bishop and has lost the key defender of the king. Castle and keep building pressure.'
    },
    // Scandinavian
    'e4 d5 exd5 Qxd5 Nc3 Qa5 d4 Nf6 Nf3 c6 Bc4 Bf5 Bd2': {
      'Bxc2': 'c2 is defended by the queen: 7...Bxc2?? Qxc2 loses the bishop for a pawn. ...e6 completes the solid setup.'
    }
  };
  for (const k of Object.keys(MORE)) WHY_NOT[k] = Object.assign(WHY_NOT[k] || {}, MORE[k]);
})();
