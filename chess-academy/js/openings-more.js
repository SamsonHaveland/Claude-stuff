/* Additional openings, grouped by tier. Same format as openings.js:
 * each line is a list of [SAN, why] pairs from the starting position. */
(function () {
  // Tiers for the original five openings
  const TIERS = { italian: 'beginner', london: 'beginner', traps: 'beginner', caro: 'novice', qgd: 'novice' };
  OPENINGS.forEach(o => { if (TIERS[o.id]) o.tier = TIERS[o.id]; });

  OPENINGS.push(
  /* ------------------------------ BEGINNER ------------------------------ */
  {
    id: 'scotch', tier: 'beginner', name: 'Scotch Game', side: 'white', eco: 'C44–C45',
    first: '1.e4 e5 2.Nf3 Nc6 3.d4',
    tagline: 'Open the centre straight away: direct, clear and easy to understand.',
    why: [
      'White strikes in the centre on move 3, so you get open lines and free piece play quickly.',
      'There are fewer subtle move orders than in the Italian or the Ruy Lopez: the plans are concrete.',
      'Named after a correspondence match between Edinburgh and London (1824). Garry Kasparov brought it back to elite level in the 1990s, including in World Championship play.',
      'Trade-off: the early pawn exchange gives Black easy development too, so play actively.'
    ],
    plans: '<p><b>Typical plan:</b> after <code>3...exd4 4.Nxd4</code> your knight dominates the centre. Develop quickly (Nc3, Be2/Bd3, castle), keep the e4 pawn, and use the half-open d-file and the outpost on d5.</p>',
    lines: [
      { name: 'Main line: 4...Bc5 5.Be3', moves: [
        ['e4', 'Centre pawn.'], ['e5', 'Black matches it.'], ['Nf3', 'Attack e5.'], ['Nc6', 'Defend e5.'],
        ['d4', 'The Scotch: challenge e5 immediately and open the centre.'],
        ['exd4', 'Black takes; holding e5 with ...d6 is passive.'],
        ['Nxd4', 'Recapture with a piece in the centre.'],
        ['Bc5', 'Develops with pressure on the d4-knight.'],
        ['Be3', 'Defends d4 a second time and develops.'],
        ['Qf6', 'Adds a third attacker on d4.'],
        ['c3', 'Solid: the pawn supports the knight. White will follow with Bc4 or Nc2 and castle.'],
        ['Nge7', 'Black develops, keeping f6 for the queen.'],
        ['Bc4', 'The bishop takes its active diagonal; castling comes next.']
      ]},
      { name: 'Scotch Four Knights (4...Nf6)', moves: [
        ['e4', ''], ['e5', ''], ['Nf3', ''], ['Nc6', ''], ['d4', ''], ['exd4', ''], ['Nxd4', ''],
        ['Nf6', 'Counterattacks e4 instead.'],
        ['Nc3', 'Defends e4 with development.'],
        ['Bb4', 'Pins the knight, renewing pressure on e4.'],
        ['Nxc6', 'Trade first so Black recaptures away from the centre.'],
        ['bxc6', 'Black recaptures toward the centre.'],
        ['Bd3', 'Defends e4 and develops.'],
        ['d5', 'Black challenges the centre.'],
        ['exd5', 'Release the tension.'],
        ['cxd5', 'Black gets a pawn centre.'],
        ['O-O', 'King safe.'],
        ['O-O', 'Black castles too.'],
        ['Bg5', 'Pins the f6-knight. A balanced, healthy position for both sides.']
      ]}
    ]
  },
  {
    id: 'fourknights', tier: 'beginner', name: 'Four Knights Game', side: 'white', eco: 'C46–C49',
    first: '1.e4 e5 2.Nf3 Nc6 3.Nc3 Nf6',
    tagline: 'Pure development: knights out, castle, then play.',
    why: [
      'It is the opening principles in their simplest form: every move develops a piece.',
      'It is very hard to go wrong early, which makes it ideal for practising middlegame plans.',
      'The Spanish Four Knights (4.Bb5) adds a little pressure on Black with no risk.',
      'Trade-off: it is symmetrical and calm. White’s edge is small, so you win by playing better later.'
    ],
    plans: '<p><b>Typical plan:</b> Bb5, castle, d3, then Bg5 to pin the f6-knight. Look for Nd5 jumps and the d3–d4 break.</p>',
    lines: [
      { name: 'Spanish Four Knights (4.Bb5)', moves: [
        ['e4', ''], ['e5', ''], ['Nf3', ''], ['Nc6', ''],
        ['Nc3', 'Develop the second knight before committing the bishop.'],
        ['Nf6', 'Black mirrors: four knights on the board.'],
        ['Bb5', 'Pins the c6-knight, adding indirect pressure on e5.'],
        ['Bb4', 'Black mirrors again.'],
        ['O-O', 'Castle first.'],
        ['O-O', 'Black castles.'],
        ['d3', 'Solid: defends e4 and opens the c1-bishop.'],
        ['d6', 'Same idea for Black.'],
        ['Bg5', 'Pins the f6-knight; Nd5 ideas follow.']
      ]},
      { name: 'Scotch Four Knights (4.d4)', moves: [
        ['e4', ''], ['e5', ''], ['Nf3', ''], ['Nc6', ''], ['Nc3', ''], ['Nf6', ''],
        ['d4', 'Open the centre immediately.'],
        ['exd4', 'Black takes.'],
        ['Nxd4', 'Centralised knight.'],
        ['Bb4', 'Pin and pressure on e4.'],
        ['Nxc6', 'Exchange to damage Black’s pawn structure.'],
        ['bxc6', 'Recapture toward the centre.'],
        ['Bd3', 'Defends e4 and prepares to castle.'],
        ['d5', 'Black hits back in the centre.'],
        ['exd5', 'Trade.'],
        ['cxd5', 'Black recaptures.'],
        ['O-O', 'White castles; Bg5 is next.']
      ]}
    ]
  },

  /* ------------------------------- NOVICE ------------------------------- */
  {
    id: 'qg', tier: 'novice', name: 'Queen’s Gambit', side: 'white', eco: 'D06–D69',
    first: '1.d4 d5 2.c4',
    tagline: 'The classical 1.d4 opening: trade a wing pawn for central control.',
    why: [
      'It is not a true gambit: if Black takes on c4, White usually wins the pawn back or gets a big centre.',
      'It teaches the key 1.d4 ideas: pressure on d5, the minority attack and space.',
      'A mainstay of World Championship matches for over a century.',
      'You must know three replies: Declined (2...e6), Accepted (2...dxc4) and the Slav (2...c6).'
    ],
    plans: '<p><b>Typical plan:</b> Nc3 and Nf3 pile up on d5. Bg5 pins, e3 and Bd3 develop, and the rooks come to c1/d1. Look for the cxd5 exchange followed by a queenside minority attack (b4–b5).</p>',
    lines: [
      { name: 'vs Declined (2...e6)', moves: [
        ['d4', ''], ['d5', ''],
        ['c4', 'The gambit: attack d5 from the side.'],
        ['e6', 'Declined: Black supports d5.'],
        ['Nc3', 'More pressure on d5.'],
        ['Nf6', 'Black defends.'],
        ['Bg5', 'Pins the defender of d5.'],
        ['Be7', 'Unpins.'],
        ['e3', 'Opens the f1-bishop.'],
        ['O-O', 'Black castles.'],
        ['Nf3', 'Develop.'],
        ['Nbd7', 'Black prepares ...c6 and ...dxc4 to free the position.'],
        ['Rc1', 'The rook goes to the c-file, where the action will be.'],
        ['c6', 'Solidifies d5.'],
        ['Bd3', 'Develops; castling follows.']
      ]},
      { name: 'vs Accepted (2...dxc4)', moves: [
        ['d4', ''], ['d5', ''], ['c4', ''],
        ['dxc4', 'Accepted: Black takes but can’t hold the pawn for long.'],
        ['e4', 'Grab the whole centre while Black’s pawn is offside.'],
        ['e5', 'Black strikes back immediately, the principled answer.'],
        ['Nf3', 'Attacks e5 and develops.'],
        ['exd4', 'Black takes.'],
        ['Bxc4', 'White regains the pawn with an active bishop.'],
        ['Nc6', 'Defends d4.'],
        ['O-O', 'Castle; White has an easy lead in development.']
      ]},
      { name: 'vs Slav (2...c6)', moves: [
        ['d4', ''], ['d5', ''], ['c4', ''],
        ['c6', 'The Slav: supports d5 while keeping the c8-bishop free.'],
        ['Nf3', 'Flexible development.'],
        ['Nf6', 'Black develops.'],
        ['Nc3', 'Pressure on d5.'],
        ['dxc4', 'Now Black takes, planning ...b5 to hold the pawn.'],
        ['a4', 'Stops ...b5 so White regains the pawn.'],
        ['Bf5', 'Develops the bishop outside the pawn chain.'],
        ['e3', 'Prepares Bxc4.'],
        ['e6', 'Solid.'],
        ['Bxc4', 'Pawn regained; a balanced, classical position.']
      ]}
    ]
  },
  {
    id: 'scandi', tier: 'novice', name: 'Scandinavian Defence', side: 'black', eco: 'B01',
    first: '1.e4 d5',
    tagline: 'Challenge e4 on move one: a short, practical answer to 1.e4.',
    why: [
      'White’s main options are limited, so there is less theory to learn than for other defences.',
      'Black gets a sound structure (pawns on c6/e6) and easy development of the c8-bishop.',
      'One of the oldest recorded openings. Viswanathan Anand used it in his 1995 World Championship match against Garry Kasparov.',
      'Trade-off: the queen comes out early and White gains a tempo with Nc3. The lines below show how to put the queen safely on a5 or d6.'
    ],
    plans: '<p><b>Typical plan:</b> recapture with the queen, put it on a5 or d6, then play ...Nf6, ...c6, ...Bf5 (or ...Bg4) and ...e6, and castle. It is a solid Caro-Kann-like structure.</p>',
    lines: [
      { name: 'Main line: 3...Qa5', moves: [
        ['e4', ''],
        ['d5', 'Challenge e4 immediately.'],
        ['exd5', 'White accepts.'],
        ['Qxd5', 'Recapture. The queen is exposed, but White has no quick way to exploit it.'],
        ['Nc3', 'Develops with tempo on the queen.'],
        ['Qa5', 'A safe square that also pins the c3-knight.'],
        ['d4', 'White takes the centre.'],
        ['Nf6', 'Develop.'],
        ['Nf3', 'Develop.'],
        ['c6', 'Gives the queen a retreat on c7 and controls d5.'],
        ['Bc4', 'Active bishop.'],
        ['Bf5', 'The c8-bishop gets out before ...e6, a big plus of this opening.'],
        ['Bd2', 'Unpins the knight and eyes the queen.'],
        ['e6', 'Solid; ...Bb4 and castling follow.']
      ]},
      { name: 'Modern: 3...Qd6', moves: [
        ['e4', ''], ['d5', ''], ['exd5', ''], ['Qxd5', ''], ['Nc3', ''],
        ['Qd6', 'The queen sits safely in the centre, ready for ...a6 and ...Nf6.'],
        ['d4', 'Centre.'],
        ['Nf6', 'Develop.'],
        ['Nf3', 'Develop.'],
        ['a6', 'Takes b5 away from White’s knight and bishop.'],
        ['Be2', 'Calm development.'],
        ['Bf5', 'Bishop out before ...e6.'],
        ['O-O', 'White castles.'],
        ['e6', 'Solid. Black plays ...Nbd7, ...Be7 and castles.']
      ]}
    ]
  },

  /* -------------------------------- PRO -------------------------------- */
  {
    id: 'ruy', tier: 'pro', name: 'Ruy Lopez (Spanish)', side: 'white', eco: 'C60–C99',
    first: '1.e4 e5 2.Nf3 Nc6 3.Bb5',
    tagline: 'The most deeply studied 1.e4 e5 opening: long-term pressure on e5.',
    why: [
      'White attacks the defender of e5 and keeps a small but lasting initiative.',
      'Named after the Spanish priest Ruy López de Segura, who wrote about it in 1561. It has been a top-level main line ever since.',
      'It teaches deep strategic ideas: manoeuvring (Nbd2–f1–g3), the d4 break and queenside play.',
      'Trade-off: there is a lot of theory (Closed, Open, Marshall, Berlin), so learn the ideas first.'
    ],
    plans: '<p><b>Typical plan (Closed):</b> castle, Re1, c3, h3 and d4. Re-route the b1-knight to g3 and keep the light-squared bishop on the b1–h7 or a2–g8 diagonal. Black aims for ...c5 and queenside space.</p>',
    lines: [
      { name: 'Closed Ruy Lopez (Chigorin)', moves: [
        ['e4', ''], ['e5', ''], ['Nf3', ''], ['Nc6', ''],
        ['Bb5', 'Pressure on the defender of e5.'],
        ['a6', 'The Morphy Defence: ask the bishop immediately.'],
        ['Ba4', 'Keep the pin-like pressure; Bxc6 can wait.'],
        ['Nf6', 'Develop with an attack on e4.'],
        ['O-O', 'White ignores it: e4 is indirectly protected.'],
        ['Be7', 'Solid development (the Closed system).'],
        ['Re1', 'Now e4 is directly defended and Bxc6 + Nxe5 becomes a threat.'],
        ['b5', 'Black gains queenside space and kicks the bishop.'],
        ['Bb3', 'The bishop eyes f7 from a safe square.'],
        ['d6', 'Supports e5 and opens the c8-bishop.'],
        ['c3', 'Prepares d4 and keeps a retreat for the bishop on c2.'],
        ['O-O', 'Black castles.'],
        ['h3', 'Prevents ...Bg4 before White plays d4.'],
        ['Na5', 'Chigorin: chase the strong bishop.'],
        ['Bc2', 'Retreat, keeping the b1–h7 diagonal.'],
        ['c5', 'Queenside space.'],
        ['d4', 'The key central break.'],
        ['Qc7', 'Black keeps e5 well defended. A rich, classical middlegame.']
      ]},
      { name: 'Berlin Defence', moves: [
        ['e4', ''], ['e5', ''], ['Nf3', ''], ['Nc6', ''], ['Bb5', ''],
        ['Nf6', 'The Berlin: counterattack e4 right away.'],
        ['O-O', 'Castle, inviting ...Nxe4.'],
        ['Nxe4', 'Black takes the pawn.'],
        ['d4', 'White opens lines toward Black’s uncastled king.'],
        ['Nd6', 'The knight retreats and hits the b5-bishop.'],
        ['Bxc6', 'Trade.'],
        ['dxc6', 'Recapture toward the centre, opening the d-file.'],
        ['dxe5', 'White regains the pawn.'],
        ['Nf5', 'The knight finds a good square.'],
        ['Qxd8+', 'The famous Berlin endgame: queens off early.'],
        ['Kxd8', 'Black has the bishop pair; White has a kingside pawn majority. Vladimir Kramnik used this to beat Kasparov in 2000.']
      ]}
    ]
  },
  {
    id: 'french', tier: 'pro', name: 'French Defence', side: 'black', eco: 'C00–C19',
    first: '1.e4 e6',
    tagline: 'A resilient counter-punching defence built on the d5/e6 chain.',
    why: [
      'Black accepts a slightly cramped position in return for a rock-solid centre and clear counterplay: ...c5 and ...f6.',
      'The plans are very consistent: attack White’s pawn chain at its base.',
      'Played by World Champions Mikhail Botvinnik and Tigran Petrosian, and by many of today’s top players.',
      'Trade-off: the c8-bishop can be passive. Learn the plans that solve it.'
    ],
    plans: '<p><b>Typical plan:</b> after White plays e5, hit the chain with <code>...c5</code> (and later <code>...f6</code>). Pile up on d4 with ...Nc6, ...Qb6 and ...Nf5/...Ne7. Avoid playing passively.</p>',
    lines: [
      { name: 'Advance (3.e5)', moves: [
        ['e4', ''], ['e6', 'Prepares ...d5 with pawn support.'],
        ['d4', 'Centre.'], ['d5', 'The French challenge.'],
        ['e5', 'Advance: White gains space and closes the centre.'],
        ['c5', 'Immediately attack the base of the chain.'],
        ['c3', 'Supports d4.'],
        ['Nc6', 'More pressure on d4.'],
        ['Nf3', 'Defends d4.'],
        ['Qb6', 'A third attacker on d4, and it also hits b2.'],
        ['a3', 'Prepares b4 to gain queenside space.'],
        ['c4', 'Black closes the queenside and takes b3 away from White.'],
        ['Nbd2', 'Develops, keeping b3 covered.'],
        ['Na5', 'The knight heads for b3, a strong outpost.']
      ]},
      { name: 'Classical (3.Nc3 Nf6 4.Bg5)', moves: [
        ['e4', ''], ['e6', ''], ['d4', ''], ['d5', ''],
        ['Nc3', 'Defends e4 with development.'],
        ['Nf6', 'Classical: attack e4 again.'],
        ['Bg5', 'Pins the attacker.'],
        ['Be7', 'Breaks the pin.'],
        ['e5', 'Gains space and kicks the knight.'],
        ['Nfd7', 'The knight retreats, ready to hit e5 with ...c5 and ...f6.'],
        ['Bxe7', 'Trade.'],
        ['Qxe7', 'Recapture.'],
        ['f4', 'Supports e5: a big centre.'],
        ['a6', 'Prevents Nb5 and prepares ...c5.'],
        ['Nf3', 'Develop.'],
        ['c5', 'The thematic strike at d4.']
      ]},
      { name: 'Tarrasch (3.Nd2)', moves: [
        ['e4', ''], ['e6', ''], ['d4', ''], ['d5', ''],
        ['Nd2', 'Tarrasch: avoids the ...Bb4 pin.'],
        ['Nf6', 'Attack e4.'],
        ['e5', 'Advance with tempo.'],
        ['Nfd7', 'Retreat.'],
        ['Bd3', 'Develops toward Black’s kingside.'],
        ['c5', 'Hit the base again.'],
        ['c3', 'Supports d4.'],
        ['Nc6', 'Pressure.'],
        ['Ne2', 'Defends d4 a third time, keeping f3 for the other knight.'],
        ['cxd4', 'Open the c-file.'],
        ['cxd4', 'Recapture.'],
        ['f6', 'Now attack the head of the chain as well.']
      ]}
    ]
  },
  {
    id: 'kid', tier: 'pro', name: 'King’s Indian Defence', side: 'black', eco: 'E60–E99',
    first: '1.d4 Nf6 2.c4 g6',
    tagline: 'Let White build a big centre, then attack it and the king.',
    why: [
      'A fighting, hypermodern defence: Black fianchettoes, castles, then strikes with ...e5 and ...f5.',
      'It creates unbalanced positions where the better-prepared player wins, not draws.',
      'Bobby Fischer and Garry Kasparov played it on the way to their World Championship titles.',
      'Trade-off: Black gives White space, and some lines are very sharp. Know the main plans well.'
    ],
    plans: '<p><b>Typical plan (Classical):</b> after <code>...e5</code> and <code>d5</code>, the centre is locked. Black attacks on the kingside with ...Ne8/...Nd7, ...f5, ...f4 and ...g5, while White pushes on the queenside with c5. It is a race.</p>',
    lines: [
      { name: 'Classical: Mar del Plata', moves: [
        ['d4', ''], ['Nf6', 'Flexible.'],
        ['c4', ''], ['g6', 'Prepare the fianchetto.'],
        ['Nc3', ''], ['Bg7', 'The bishop eyes the long diagonal.'],
        ['e4', 'White takes the full centre.'],
        ['d6', 'Black stays compact, preparing ...e5.'],
        ['Nf3', ''],
        ['O-O', 'King safe first.'],
        ['Be2', 'Classical development.'],
        ['e5', 'The key strike in the centre.'],
        ['O-O', ''],
        ['Nc6', 'Increase pressure on d4.'],
        ['d5', 'White locks the centre and gains space.'],
        ['Ne7', 'The knight heads toward the kingside attack.'],
        ['Ne1', 'White prepares f3 and the queenside push.'],
        ['Nd7', 'Clears the f-pawn’s path.'],
        ['Be3', ''],
        ['f5', 'The thematic kingside lever.'],
        ['f3', 'Holds e4.'],
        ['f4', 'Gain space with tempo on the bishop.'],
        ['Bf2', ''],
        ['g5', 'The pawn storm begins. A famous race of attacks.']
      ]},
      { name: 'Sämisch (5.f3)', moves: [
        ['d4', ''], ['Nf6', ''], ['c4', ''], ['g6', ''], ['Nc3', ''], ['Bg7', ''], ['e4', ''], ['d6', ''],
        ['f3', 'Sämisch: White fortifies e4 and may attack with g4/h4.'],
        ['O-O', 'Castle.'],
        ['Be3', 'Develop, preparing Qd2.'],
        ['e5', 'Strike the centre anyway.'],
        ['Nge2', 'Supports d4.'],
        ['c6', 'Prepares ...cxd5 or ...b5 counterplay.'],
        ['Qd2', 'White connects pieces and may castle long.'],
        ['Nbd7', 'Black completes development, keeping options flexible.']
      ]}
    ]
  },
  {
    id: 'english', tier: 'pro', name: 'English Opening', side: 'white', eco: 'A10–A39',
    first: '1.c4',
    tagline: 'A flexible flank opening: control d5 from the side and outplay.',
    why: [
      'White fights for the centre from the wing (hypermodern style) and keeps many setups available.',
      'Against 1...e5 it is like a Sicilian with an extra tempo for White.',
      'A regular weapon of World Champions Botvinnik, Kasparov and Carlsen.',
      'Trade-off: it is less forcing than 1.e4/1.d4, so you need to understand structures rather than lines.'
    ],
    plans: '<p><b>Typical plan:</b> g3, Bg2, Nc3 and Nf3, then castle. Play on the queenside with a3, b4 and Rb1, with the g2-bishop raking the long diagonal.</p>',
    lines: [
      { name: 'vs 1...e5 (Reversed Sicilian)', moves: [
        ['c4', 'Control d5 from the side.'],
        ['e5', 'Black takes the centre.'],
        ['Nc3', 'More control of d5.'],
        ['Nf6', ''],
        ['Nf3', 'Pressure on e5.'],
        ['Nc6', 'Defend.'],
        ['g3', 'Prepare the fianchetto.'],
        ['d5', 'Black grabs space.'],
        ['cxd5', 'Trade off Black’s centre pawn.'],
        ['Nxd5', ''],
        ['Bg2', 'The bishop pressures d5 and the long diagonal.'],
        ['Nb6', 'The knight steps away from the g2-bishop’s attack.'],
        ['O-O', ''],
        ['Be7', ''],
        ['d3', 'Solid; next comes a3 and b4 to attack on the queenside.']
      ]},
      { name: 'Symmetrical (1...c5)', moves: [
        ['c4', ''], ['c5', 'Black mirrors.'],
        ['Nc3', ''], ['Nc6', ''],
        ['g3', ''], ['g6', ''],
        ['Bg2', ''], ['Bg7', ''],
        ['Nf3', ''], ['Nf6', ''],
        ['O-O', ''], ['O-O', ''],
        ['d4', 'White breaks the symmetry first.'],
        ['cxd4', ''],
        ['Nxd4', 'An open position where the side with better piece play is better.']
      ]}
    ]
  },

  /* ------------------------------- CHAMP ------------------------------- */
  {
    id: 'najdorf', tier: 'champ', name: 'Sicilian Najdorf', side: 'black', eco: 'B90–B99',
    first: '1.e4 c5 2.Nf3 d6 3.d4 cxd4 4.Nxd4 Nf6 5.Nc3 a6',
    tagline: 'The sharpest, richest answer to 1.e4, played at elite level for decades.',
    why: [
      'Imbalanced from move one: Black trades a wing pawn for a centre pawn and plays to win.',
      '5...a6 keeps every option open: ...e5 or ...e6, ...b5, and it stops Nb5 and Bb5.',
      'Named after Miguel Najdorf. It was the main weapon of Bobby Fischer and Garry Kasparov.',
      'Trade-off: it has enormous theory and a mistake can lose quickly. Learn it once your tactics are strong.'
    ],
    plans: '<p><b>Typical plan:</b> ...e5 or ...e6, ...Be7, ...O-O and ...b5. Black attacks on the queenside and down the c-file while White often castles long and storms the kingside.</p>',
    lines: [
      { name: 'English Attack (6.Be3)', moves: [
        ['e4', ''], ['c5', 'The Sicilian.'],
        ['Nf3', ''], ['d6', 'Controls e5 and prepares ...Nf6.'],
        ['d4', 'Open Sicilian.'], ['cxd4', 'Trade the c-pawn for White’s d-pawn.'],
        ['Nxd4', ''], ['Nf6', 'Attack e4.'],
        ['Nc3', 'Defend.'],
        ['a6', 'The Najdorf: a flexible, useful waiting move.'],
        ['Be3', 'The English Attack: f3, Qd2, O-O-O and g4 are coming.'],
        ['e5', 'Gain central space with tempo.'],
        ['Nb3', 'The knight retreats.'],
        ['Be6', 'Controls d5.'],
        ['f3', 'Supports e4 and prepares g4.'],
        ['Be7', ''],
        ['Qd2', ''],
        ['O-O', ''],
        ['O-O-O', 'Opposite-side castling: both sides attack.'],
        ['Nbd7', 'Black prepares ...b5–b4.']
      ]},
      { name: 'Classical (6.Be2)', moves: [
        ['e4', ''], ['c5', ''], ['Nf3', ''], ['d6', ''], ['d4', ''], ['cxd4', ''], ['Nxd4', ''], ['Nf6', ''], ['Nc3', ''], ['a6', ''],
        ['Be2', 'A calmer, positional approach.'],
        ['e5', 'Space with tempo.'],
        ['Nb3', ''],
        ['Be7', ''],
        ['O-O', ''],
        ['O-O', ''],
        ['Be3', ''],
        ['Be6', 'Black fights for d5, the key square in this structure.']
      ]},
      { name: 'Poisoned Pawn (6.Bg5)', moves: [
        ['e4', ''], ['c5', ''], ['Nf3', ''], ['d6', ''], ['d4', ''], ['cxd4', ''], ['Nxd4', ''], ['Nf6', ''], ['Nc3', ''], ['a6', ''],
        ['Bg5', 'The most aggressive try.'],
        ['e6', ''],
        ['f4', 'Threatens e5.'],
        ['Qb6', 'Hit d4 and b2.'],
        ['Qd2', 'White offers the b2-pawn.'],
        ['Qxb2', 'The famous Poisoned Pawn. Fischer took it and held.'],
        ['Rb1', 'Gain time on the queen.'],
        ['Qa3', 'The queen survives. A very sharp position where both sides need deep preparation.']
      ]}
    ]
  },
  {
    id: 'nimzo', tier: 'champ', name: 'Nimzo-Indian Defence', side: 'black', eco: 'E20–E59',
    first: '1.d4 Nf6 2.c4 e6 3.Nc3 Bb4',
    tagline: 'Pin, damage, and fight for e4: deep positional chess.',
    why: [
      '3...Bb4 stops e4 indirectly and is often willing to give the bishop to double White’s c-pawns.',
      'It is considered one of Black’s most reliable answers to 1.d4 at the highest level.',
      'Named after Aron Nimzowitsch, the hypermodern pioneer.',
      'Trade-off: it requires understanding bishop-vs-knight battles and pawn structures, not just moves.'
    ],
    plans: '<p><b>Typical plan:</b> ...Bxc3 when it doubles White’s pawns, then blockade them with ...c5, ...d6 and ...e5, or play ...b6 and ...Bb7 to control e4. Knights love closed positions.</p>',
    lines: [
      { name: 'Rubinstein (4.e3)', moves: [
        ['d4', ''], ['Nf6', ''], ['c4', ''], ['e6', ''],
        ['Nc3', 'Prepares e4.'],
        ['Bb4', 'The Nimzo pin: e4 is now hard to achieve.'],
        ['e3', 'Rubinstein: solid development.'],
        ['O-O', 'Castle; keep options open.'],
        ['Bd3', ''],
        ['d5', 'Claim the centre.'],
        ['Nf3', ''],
        ['c5', 'Pressure on d4.'],
        ['O-O', ''],
        ['Nc6', ''],
        ['a3', 'Ask the bishop.'],
        ['Bxc3', 'Give the bishop for the knight, doubling pawns.'],
        ['bxc3', ''],
        ['dxc4', 'Trade to open lines.'],
        ['Bxc4', ''],
        ['Qc7', 'Prepares ...e5. A classic main line.']
      ]},
      { name: 'Classical (4.Qc2)', moves: [
        ['d4', ''], ['Nf6', ''], ['c4', ''], ['e6', ''], ['Nc3', ''], ['Bb4', ''],
        ['Qc2', 'Avoids doubled pawns: White recaptures with the queen.'],
        ['O-O', ''],
        ['a3', 'Force the decision.'],
        ['Bxc3+', ''],
        ['Qxc3', 'White has the bishop pair; Black is ahead in development.'],
        ['b6', 'Prepare ...Bb7 to control e4.'],
        ['Bg5', ''],
        ['Bb7', 'Black fights for the light squares.']
      ]}
    ]
  },
  {
    id: 'grunfeld', tier: 'champ', name: 'Grünfeld Defence', side: 'black', eco: 'D70–D99',
    first: '1.d4 Nf6 2.c4 g6 3.Nc3 d5',
    tagline: 'Give White the centre, then blow it apart.',
    why: [
      'A hypermodern counterattack: Black invites a big pawn centre, then attacks it with ...c5, ...Bg7 and ...Nc6.',
      'Very concrete and dynamic, and a favourite of Kasparov and many elite players.',
      'Named after Ernst Grünfeld, who introduced it in 1922.',
      'Trade-off: it is extremely theory-heavy. If you mis-time the counterattack, White’s centre crushes you.'
    ],
    plans: '<p><b>Typical plan:</b> after the exchange on c3, pressure d4 with ...Bg7, ...c5, ...Nc6, ...Bg4 and ...Qa5. Trade pieces when White over-extends; the endgames often favour Black.</p>',
    lines: [
      { name: 'Exchange: modern 8.Rb1', moves: [
        ['d4', ''], ['Nf6', ''], ['c4', ''], ['g6', ''], ['Nc3', ''],
        ['d5', 'The Grünfeld: challenge the centre with a pawn.'],
        ['cxd5', 'Exchange variation.'],
        ['Nxd5', ''],
        ['e4', 'Gain time and build a big centre.'],
        ['Nxc3', ''],
        ['bxc3', 'White has the classical pawn centre.'],
        ['Bg7', 'The bishop pressures c3 and d4.'],
        ['Nf3', ''],
        ['c5', 'Strike at d4.'],
        ['Rb1', 'Takes the rook off the long diagonal and eyes b7.'],
        ['O-O', ''],
        ['Be2', ''],
        ['cxd4', ''],
        ['cxd4', ''],
        ['Qa5+', 'The point: a check that wins the a2-pawn.'],
        ['Bd2', ''],
        ['Qxa2', 'Black grabs the pawn; White gets development and play against b7.'],
        ['O-O', 'A well-known, dynamically balanced position.']
      ]},
      { name: 'Exchange: classical 7.Bc4', moves: [
        ['d4', ''], ['Nf6', ''], ['c4', ''], ['g6', ''], ['Nc3', ''], ['d5', ''], ['cxd5', ''], ['Nxd5', ''], ['e4', ''], ['Nxc3', ''], ['bxc3', ''], ['Bg7', ''],
        ['Bc4', 'The classical set-up, eyeing f7.'],
        ['c5', 'Pressure on d4.'],
        ['Ne2', 'The knight on e2 supports d4 and avoids a ...Bg4 pin.'],
        ['Nc6', 'More pressure.'],
        ['Be3', 'Defends d4.'],
        ['O-O', ''],
        ['O-O', 'Black continues with ...Bg4 or ...Na5, hitting the centre.']
      ]}
    ]
  },
  {
    id: 'catalan', tier: 'champ', name: 'Catalan Opening', side: 'white', eco: 'E01–E09',
    first: '1.d4 Nf6 2.c4 e6 3.g3',
    tagline: 'Queen’s Gambit meets fianchetto: long, grinding pressure.',
    why: [
      'The g2-bishop pins Black’s queenside down along the long diagonal for the whole game.',
      'It is often a pawn sacrifice (on c4) for lasting positional pressure, and White usually wins it back.',
      'A favourite of Vladimir Kramnik and Magnus Carlsen. Introduced by Savielly Tartakower at the 1929 Barcelona tournament, and named after the region.',
      'Trade-off: the edge is subtle. You need patience and good technique.'
    ],
    plans: '<p><b>Typical plan:</b> g3, Bg2, castle, Qc2 or Qa4, and regain c4. Then press on the long diagonal and the c-file, and fight against Black’s ...c5 or ...e5 freeing breaks.</p>',
    lines: [
      { name: 'Open Catalan (6...dxc4)', moves: [
        ['d4', ''], ['Nf6', ''], ['c4', ''], ['e6', ''],
        ['g3', 'The Catalan: fianchetto the light-squared bishop.'],
        ['d5', ''],
        ['Bg2', 'The bishop eyes d5, c6 and b7.'],
        ['Be7', ''],
        ['Nf3', ''],
        ['O-O', ''],
        ['O-O', ''],
        ['dxc4', 'Black takes the pawn.'],
        ['Qc2', 'White will regain it.'],
        ['a6', 'Prepares ...b5 to keep the pawn.'],
        ['a4', 'Stops ...b5.'],
        ['Bd7', 'Heads for c6 to oppose the g2-bishop.'],
        ['Qxc4', 'Pawn regained.'],
        ['Bc6', 'Black blunts the long diagonal.'],
        ['Bf4', 'Active development; White keeps a small, lasting edge.']
      ]},
      { name: 'Closed Catalan (6...Nbd7)', moves: [
        ['d4', ''], ['Nf6', ''], ['c4', ''], ['e6', ''], ['g3', ''], ['d5', ''], ['Bg2', ''], ['Be7', ''], ['Nf3', ''], ['O-O', ''], ['O-O', ''],
        ['Nbd7', 'Black keeps the centre closed.'],
        ['Qc2', 'Supports e4.'],
        ['c6', 'Solid.'],
        ['Nbd2', 'Prepares e4.'],
        ['b6', 'Prepares ...Bb7.'],
        ['e4', 'White gains central space.'],
        ['Bb7', 'A slow, strategic battle.']
      ]}
    ]
  }
  );
})();
