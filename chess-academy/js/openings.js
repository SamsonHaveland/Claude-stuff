/* Opening repertoire. Each line is a list of [SAN, why] pairs starting from the
 * initial position. `side` is the side the student plays in drills. */
var OPENINGS = [
  {
    id: 'italian', name: 'Italian Game', side: 'white', eco: 'C50–C54', level: 'Beginner → Master',
    first: '1.e4 e5 2.Nf3 Nc6 3.Bc4',
    tagline: 'Classical development aimed at the centre and Black’s weakest square, f7.',
    why: [
      'It follows the opening principles move by move: centre pawn, knight, bishop, castle.',
      'One of the oldest recorded openings — Greco published games with it in the 1600s — and still played at World Championship level.',
      'The slow modern main line (c3 + d3, “Giuoco Pianissimo”) teaches manoeuvring and pawn breaks rather than memorised tactics.',
      'Sharper options (Fried Liver, Evans Gambit) are available later when you want them.'
    ],
    plans: '<p><b>Typical plan:</b> castle, play <code>c3</code> and <code>d3</code> to prepare a later <code>d4</code>, put the rook on <code>e1</code>, re-route the queen’s knight via <code>Nbd2–f1–g3</code>, and keep the bishop on the <code>a2–g8</code> diagonal (retreating to b3/a2 when hit). Watch for <code>Ng5</code> ideas against f7.</p>',
    lines: [
      { name: 'Giuoco Pianissimo (main line)', moves: [
        ['e4', 'Occupies the centre and opens lines for the queen and the f1-bishop.'],
        ['e5', 'Black stakes an equal claim in the centre.'],
        ['Nf3', 'Develops with a threat: the e5-pawn is attacked.'],
        ['Nc6', 'Develops and defends e5 — the most natural reply.'],
        ['Bc4', 'The Italian bishop: aims at f7, the square only Black’s king defends.'],
        ['Bc5', 'The Giuoco Piano (“quiet game”): Black mirrors White and eyes f2.'],
        ['c3', 'Prepares d4 to build a big centre; also gives the bishop a retreat on b3/c2 later.'],
        ['Nf6', 'Develops and attacks e4, forcing White to decide about the centre.'],
        ['d3', 'The modern, solid choice: defends e4 and keeps all options. (d4 at once is sharper.)'],
        ['d6', 'Black solidifies e5 and opens the c8-bishop.'],
        ['O-O', 'King to safety before the middlegame starts.'],
        ['O-O', 'Black does the same.'],
        ['Re1', 'Supports e4 and prepares d4 in good conditions.'],
        ['a6', 'Makes a square on a7 for the bishop so it can’t be hit by d4 or Na4.'],
        ['Bb3', 'Pre-empts ...b5 and ...Na5 ideas; the bishop stays on its key diagonal.'],
        ['Ba7', 'Black’s bishop tucks away from d4 attacks.'],
        ['h3', 'Stops ...Bg4 pinning the f3-knight. Now Nbd2–f1–g3 is the typical plan.']
      ]},
      { name: 'Two Knights: the calm 4.d3', moves: [
        ['e4', 'Centre.'], ['e5', 'Centre.'], ['Nf3', 'Attack e5.'], ['Nc6', 'Defend e5.'], ['Bc4', 'Aim at f7.'],
        ['Nf6', 'The Two Knights Defence: Black counterattacks e4 immediately instead of developing the bishop.'],
        ['d3', 'Simply defends e4. Keeps a quiet, strategic game and avoids memorising sharp theory.'],
        ['Be7', 'A modest but solid square for the bishop (...Bc5 is also common).'],
        ['O-O', 'Castle first.'],
        ['O-O', 'Black castles too.'],
        ['Re1', 'The rook supports e4 and the coming d4 break.'],
        ['d6', 'Black secures e5.'],
        ['c3', 'Prepares d4 and gives the bishop a retreat. A typical Italian middlegame begins.']
      ]},
      { name: 'Fried Liver trap (if Black errs)', moves: [
        ['e4', ''], ['e5', ''], ['Nf3', ''], ['Nc6', ''], ['Bc4', ''], ['Nf6', 'Two Knights Defence.'],
        ['Ng5', 'The aggressive try: knight and bishop gang up on f7.'],
        ['d5', 'The only good defence: block the bishop’s diagonal.'],
        ['exd5', 'Opening the diagonal again.'],
        ['Nxd5', 'A natural-looking mistake! (5...Na5 is correct.)'],
        ['Nxf7', 'The Fried Liver sacrifice: knight takes on f7, forking queen and rook.'],
        ['Kxf7', 'Black takes, but the king is dragged into the open.'],
        ['Qf3+', 'Check, while also attacking the pinned knight on d5.'],
        ['Ke6', 'The king must defend d5 itself.'],
        ['Nc3', 'More attackers arrive. White has a fierce, lasting attack — practical chances are heavily in White’s favour.']
      ]}
    ]
  },
  {
    id: 'london', name: 'London System', side: 'white', eco: 'D02 / A46', level: 'Beginner → Master',
    first: '1.d4 d5 2.Bf4',
    tagline: 'A reliable setup you can play against almost anything.',
    why: [
      'You play the same setup — d4, Bf4, e3, Nf3, c3, Bd3, Nbd2 — against nearly every Black reply. Very little memorisation.',
      'It develops the dark-squared bishop <i>outside</i> the pawn chain before e3 locks it in — a lesson in good vs. bad bishops.',
      'Named after the London 1922 tournament; revived by elite players (including Magnus Carlsen) in the 2010s.',
      'Trade-off: it is less ambitious than 1.e4 lines; you win by out-planning, not by early tactics.'
    ],
    plans: '<p><b>Typical plan:</b> the “pyramid” of pawns on d4–e3–c3, bishop on f4 and d3, knights on f3 and d2, castle short. Then either attack with <code>Ne5</code>, <code>Qf3</code>/<code>Qh5</code> and sometimes <code>g4</code>, or play for the <code>e3–e4</code> break.</p>',
    lines: [
      { name: 'Main setup vs ...d5 and ...e6', moves: [
        ['d4', 'Claims the centre; the queen protects d4.'],
        ['d5', 'Black mirrors.'],
        ['Bf4', 'The London move: the bishop gets out before e3 shuts it in.'],
        ['Nf6', 'Natural development.'],
        ['e3', 'Supports d4 and opens the f1-bishop.'],
        ['e6', 'Black builds a solid pawn chain.'],
        ['Nf3', 'Develops, controls e5.'],
        ['c5', 'Black strikes at the centre — the standard counterplay.'],
        ['c3', 'Completes the pyramid: d4 is rock-solid.'],
        ['Nc6', 'Increases pressure on d4.'],
        ['Nbd2', 'Supports e4 later and keeps c3 for the pawn.'],
        ['Bd6', 'Black offers to trade off White’s good bishop.'],
        ['Bg3', 'Keep the bishop: if ...Bxg3, hxg3 opens the h-file for the rook.'],
        ['O-O', 'Black castles.'],
        ['Bd3', 'Bishop to its best diagonal, aiming at h7. Castle next and plan Ne5 or e4.']
      ]},
      { name: 'vs King’s Indian setup (...g6)', moves: [
        ['d4', ''], ['Nf6', 'Flexible: Black doesn’t commit the d-pawn.'],
        ['Bf4', 'Same setup regardless.'],
        ['g6', 'Black prepares to fianchetto — a hypermodern approach.'],
        ['e3', 'Solid support.'],
        ['Bg7', 'The bishop on the long diagonal.'],
        ['Nf3', 'Develops.'],
        ['O-O', 'Black castles quickly.'],
        ['Be2', 'Versus the fianchetto, the bishop is often more useful on e2 (d3 can be hit by ...e5–e4).'],
        ['d6', 'Preparing ...e5 or ...c5.'],
        ['h3', 'A retreat square on h2 for the f4-bishop and no ...Bg4 or ...Nh5 harassment. Castle next.']
      ]},
      { name: 'The ...Qb6 test', moves: [
        ['d4', ''], ['d5', ''], ['Bf4', ''],
        ['c5', 'An active try: hit d4 immediately.'],
        ['e3', 'Calmly supports d4.'],
        ['Nc6', 'More pressure on d4.'],
        ['c3', 'Pyramid complete.'],
        ['Qb6', 'Black attacks b2 — the bishop left f4 undefended on the queenside.'],
        ['Qb3', 'The standard answer: offer a queen trade and defend b2. Learn this so you never drop the b-pawn.']
      ]}
    ]
  },
  {
    id: 'caro', name: 'Caro-Kann Defence', side: 'black', eco: 'B12–B19', level: 'Beginner → Master',
    first: '1.e4 c6',
    tagline: 'Black’s solid, principled answer to 1.e4.',
    why: [
      '...c6 prepares ...d5 to challenge e4 with two pawns, so Black gets a fair share of the centre.',
      'Unlike the French Defence, Black’s light-squared bishop usually gets out (to f5 or g4) before ...e6.',
      'Named after Horatio Caro and Marcus Kann, who analysed it in 1886; a weapon of World Champions Capablanca, Botvinnik, Petrosian, Karpov and Anand.',
      'Leads to sound pawn structures and good endgames — a great choice while you improve your middlegame.'
    ],
    plans: '<p><b>Typical plan:</b> challenge with ...d5, develop the bishop to f5/g4, then ...e6, ...Nd7, ...Ngf6, castle, and later free your game with ...c5 or ...e5. Against the Advance (3.e5), attack the white chain’s base with ...c5.</p>',
    lines: [
      { name: 'Classical: 3.Nc3 dxe4 4.Nxe4 Bf5', moves: [
        ['e4', ''], ['c6', 'Prepares ...d5 with pawn support.'],
        ['d4', 'White builds the ideal centre.'],
        ['d5', 'Black challenges e4 at once.'],
        ['Nc3', 'Defends e4 with development.'],
        ['dxe4', 'Black releases the tension.'],
        ['Nxe4', 'White recaptures in the centre.'],
        ['Bf5', 'The Classical: the bishop develops outside the pawn chain, hitting the knight.'],
        ['Ng3', 'Gains a tempo on the bishop.'],
        ['Bg6', 'The bishop stays on its fine diagonal.'],
        ['h4', 'White threatens h5 to trap or embarrass the bishop.'],
        ['h6', 'Gives the bishop a retreat on h7.'],
        ['Nf3', 'Develops.'],
        ['Nd7', 'Prevents Ne5 and prepares ...Ngf6.'],
        ['h5', 'Gains space on the kingside.'],
        ['Bh7', 'The bishop retreats but stays on the b1–h7 diagonal.'],
        ['Bd3', 'Offers a trade of light-squared bishops.'],
        ['Bxd3', 'Black accepts; Black’s bishop was its potential problem piece.'],
        ['Qxd3', 'White recaptures.'],
        ['e6', 'Now ...e6 is perfect: the bishop is already gone. Black follows with ...Ngf6, ...Be7/...Bd6, ...Qc7 and castles.']
      ]},
      { name: 'Advance: 3.e5 Bf5', moves: [
        ['e4', ''], ['c6', ''], ['d4', ''], ['d5', ''],
        ['e5', 'White gains space and closes the centre.'],
        ['Bf5', 'The bishop develops before ...e6 — the Caro-Kann’s main idea.'],
        ['Nf3', 'Short System: quiet development.'],
        ['e6', 'Solid chain; prepares ...c5.'],
        ['Be2', 'White prepares to castle.'],
        ['c5', 'Strike the base of the chain (d4). This is Black’s key counterplay vs every Advance line.'],
        ['O-O', 'White castles.'],
        ['Nc6', 'Increasing pressure on d4.']
      ]},
      { name: 'Exchange: 3.exd5 cxd5 4.Bd3', moves: [
        ['e4', ''], ['c6', ''], ['d4', ''], ['d5', ''],
        ['exd5', 'White opens the position symmetrically.'],
        ['cxd5', 'Recapture toward the centre.'],
        ['Bd3', 'Prevents ...Bf5 and eyes h7.'],
        ['Nc6', 'Develops, pressures d4.'],
        ['c3', 'Supports d4.'],
        ['Nf6', 'Natural development.'],
        ['Bf4', 'A London-style bishop.'],
        ['Bg4', 'Black develops the bishop actively before playing ...e6, so it won’t be locked in.'],
        ['Qb3', 'Attacks b7 (and d5).'],
        ['Qd7', 'Defends b7 calmly. Black follows with ...e6 and ...Bd6, with a comfortable position.']
      ]}
    ]
  },
  {
    id: 'qgd', name: 'Queen’s Gambit Declined', side: 'black', eco: 'D30–D69', level: 'Beginner → Master',
    first: '1.d4 d5 2.c4 e6',
    tagline: 'Black’s classical, rock-solid answer to 1.d4.',
    why: [
      '...e6 holds the d5 point firmly: Black keeps a share of the centre instead of grabbing a pawn.',
      'Teaches the most important concepts of 1.d4 positions: the minority attack, hanging pawns, isolated pawns, and the battle for e4/c5.',
      'A mainstay at World Championship level for over a century, from Lasker and Capablanca to Carlsen.',
      'The main drawback is the light-squared bishop on c8; learn the plans that free it (...b6 + ...Bb7, or ...dxc4 and ...c5/...e5).'
    ],
    plans: '<p><b>Typical plan:</b> ...Nf6, ...Be7, ...O-O, then free the position with ...dxc4 + ...c5, or ...b6 + ...Bb7, or ...c6 + ...e5. Against the Exchange Variation, expect White’s queenside minority attack (b4–b5) and use your kingside space.</p>',
    lines: [
      { name: 'Orthodox with 4.Bg5 (Tartakower idea)', moves: [
        ['d4', ''], ['d5', 'Claim the centre.'],
        ['c4', 'The Queen’s Gambit: White offers a wing pawn to deflect d5.'],
        ['e6', 'Declined: d5 is supported and the f8-bishop is freed.'],
        ['Nc3', 'More pressure on d5.'],
        ['Nf6', 'Defends d5 a third time.'],
        ['Bg5', 'Pins the knight, increasing the pressure on d5.'],
        ['Be7', 'Breaks the pin and prepares to castle.'],
        ['e3', 'Opens the f1-bishop.'],
        ['O-O', 'Black king safe.'],
        ['Nf3', 'Development.'],
        ['h6', 'Asks the bishop a question.'],
        ['Bh4', 'Keeps the pin.'],
        ['b6', 'The Tartakower: ...Bb7 next solves the problem bishop on c8.']
      ]},
      { name: 'Exchange Variation', moves: [
        ['d4', ''], ['d5', ''], ['c4', ''], ['e6', ''], ['Nc3', ''], ['Nf6', ''],
        ['cxd5', 'White fixes the pawn structure.'],
        ['exd5', 'Recapture with the e-pawn: the c8-bishop is now free!'],
        ['Bg5', 'Pressure on f6/d5.'],
        ['c6', 'Supports d5 and gives the queen a path to a5 or c7.'],
        ['e3', 'Development.'],
        ['Be7', 'Breaks the pin.'],
        ['Bd3', 'Bishop to its best diagonal.'],
        ['Nbd7', 'Black completes development: castle next, then ...Re8, ...Nf8 and kingside play.']
      ]},
      { name: 'The Elephant Trap (if White gets greedy)', moves: [
        ['d4', ''], ['d5', ''], ['c4', ''], ['e6', ''], ['Nc3', ''], ['Nf6', ''], ['Bg5', ''],
        ['Nbd7', 'Looks like it leaves d5 loose — but it sets a trap.'],
        ['cxd5', ''],
        ['exd5', ''],
        ['Nxd5', 'Greedy! White thinks the f6-knight is pinned.'],
        ['Nxd5', 'Ignore the “pin”: the queen can be given up.'],
        ['Bxd8', 'White takes the queen…'],
        ['Bb4+', '…and runs into a check that wins White’s queen back.'],
        ['Qd2', 'The only block.'],
        ['Bxd2+', 'Black takes the queen with check.'],
        ['Kxd2', 'White recaptures.'],
        ['Kxd8', 'Black has won a piece. Remember this trap when you play the QGD!']
      ]},
      { name: 'Vs the London: the ...Qb6 idea', moves: [
        ['d4', ''], ['d5', ''],
        ['Bf4', 'White plays the London.'],
        ['c5', 'Hit d4 straight away — Black’s most active plan.'],
        ['e3', ''],
        ['Nc6', 'More pressure.'],
        ['c3', ''],
        ['Qb6', 'The b2-pawn is weak because White’s bishop left c1.'],
        ['Qb3', 'White’s best answer.'],
        ['c4', 'Gain space with tempo on the queen.'],
        ['Qc2', 'The queen retreats. Black follows with ...Nf6, ...Bf5 (hitting the queen again) and ...e6.']
      ]}
    ]
  },
  {
    id: 'traps', name: 'Opening Traps to Avoid', side: 'black', eco: '—', level: 'Beginner',
    first: 'Scholar’s Mate defence',
    tagline: 'Don’t lose in four moves: the attacks every new player meets online.',
    why: [
      'Early queen attacks on f7/f2 are the most common way beginners lose.',
      'Knowing the refutation turns a scary opening into a free development lead.',
      'Each line here shows the correct, calm defence.'
    ],
    plans: '<p><b>Principle:</b> defend the threat <i>with development</i>, then attack the queen with minor pieces to gain time.</p>',
    lines: [
      { name: 'Stopping Scholar’s Mate', moves: [
        ['e4', ''], ['e5', ''],
        ['Qh5', 'Attacks e5 and eyes f7.'],
        ['Nc6', 'Defends e5 with development.'],
        ['Bc4', 'Now Qxf7# is threatened!'],
        ['g6', 'Blocks the queen’s path to f7 and gains time.'],
        ['Qf3', 'The queen renews the threat on f7.'],
        ['Nf6', 'Blocks the f-file and develops. Black will follow with ...Bg7 and ...O-O, ahead in development.']
      ]},
      { name: 'Scholar’s attempt with Qf3', moves: [
        ['e4', ''], ['e5', ''],
        ['Bc4', ''],
        ['Nc6', ''],
        ['Qf3', 'Threatens Qxf7#.'],
        ['Nf6', 'The knight blocks the f-file and develops. If the queen lingers, ...Nd4 hits c2 and the queen.']
      ]}
    ]
  }
];
