# Chess Academy

A step-by-step chess course in the browser: rules, tactics, opening theory and a starter opening repertoire with spaced-repetition drills. It needs no install, no build step and no internet connection.

**Run it:** open `index.html` in any modern browser.

**Install it on a phone:** host the `chess-academy/` folder on any HTTPS site (e.g. GitHub Pages), open it on the phone, then *Share → Add to Home Screen* (iPhone, Safari) or *⋮ → Install app* (Android, Chrome). It is a Progressive Web App: it gets its own icon, opens full-screen, and works offline after the first visit (`sw.js` caches every file). When you change any file, bump `VERSION` in `sw.js` so installed copies update.

**Saving progress:** lessons save after every step, bot games after every move, drills after every line. Progress is kept in the browser's `localStorage`. When the app runs as a Claude artifact it is also saved to the signed-in viewer's private area of the artifact database (`data/users/<id>/progress`), so it survives cleared storage and follows them across devices. The Library has a backup code to copy progress between devices anywhere, and the header warns ("Not saving") if the browser blocks storage.

## What's inside

| Area | What it does | Modelled on |
|---|---|---|
| **Learn** | A path of 7 units and 22 short lessons. Each lesson mixes explanation cards, quizzes and hands-on board exercises. | Duolingo's lesson path; Chess.com Lessons |
| **Board exercises** | Star-collecting games for each piece, a coordinate drill, puzzles with scripted replies, mate-in-one with any mating move accepted, and K+Q vs K played against the engine. | Lichess *Learn* and *Practice* |
| **Openings** | 17 sound, established openings in four levels: **Beginner** (Italian, London, Scotch, Four Knights, Traps to Avoid), **Novice** (Queen's Gambit, Caro-Kann, QGD, Scandinavian), **Pro** (Ruy Lopez, English, French, King's Indian) and **Champ** (Najdorf, Nimzo-Indian, Grünfeld, Catalan). You can filter by colour, and the level matching your estimated rating is highlighted. Each one covers why to play it, the typical plans, the history, and its lines, with a reason for every move. Tempting mistakes have **Why not …?** notes. | Chessable course layout |
| **Drill** | Play your side of each line from memory. If you play a different move, the app explains why it is wrong: a written note if there is one, otherwise the engine's punishing reply, or it tells you your move is book in another opening. Uses Leitner-box spaced repetition with reviews after 1, 3, 7, 14, 30 and 60 days; a mistake resets the line. | Chessable MoveTrainer |
| **Practice** | Play a bot at three levels, from the starting position or from the end of any opening line. An optional **Coach** warns you when a move gives away material, and there are Hint and Take-back buttons. | Chess.com / Lichess analysis aids |
| **Rating estimate** | An Elo-style guess at your playing strength. It uses first attempts at lesson exercises (each lesson has a difficulty level) and unassisted bot games, which count 3×. It is shown with a likely range. Lesson difficulties and bot ratings (~600 / ~900 / ~1250) are uncalibrated estimates. | Chess.com / Lichess puzzle ratings |
| **Library** | Study method, how the rating estimate works, a glossary and further reading. | — |

Unit outline: (1) Board & pieces → (2) Rules: check, castling, en passant, promotion, draws → (3) Checkmate patterns → (4) Tactics: checks/captures/threats, fork, pin, skewer, discovery → (5) Opening principles, opening sins and the history of opening theory → (6) Choosing a repertoire → (7) Endgames: K+Q vs K, rule of the square, opposition.

## Repertoire choice

| Role | Opening | Why |
|---|---|---|
| White (main) | Italian Game | It is the opening principles in action. The quiet c3/d3 main line teaches plans rather than traps. |
| White (alt.) | London System | One setup against almost everything, so there is little to memorise. |
| Black vs 1.e4 | Caro-Kann | Solid; the light-squared bishop gets out before …e6. |
| Black vs 1.d4 | Queen's Gambit Declined | Classical. It teaches the core ideas of 1.d4 positions. |

These are among the most commonly recommended choices for developing players. There is no single "best" opening.

## Files

```
index.html            app shell
manifest.webmanifest  install metadata (name, icons, colours)
sw.js                 service worker: offline caching
icons/                app icons (home screen, maskable, favicon)
css/style.css         styling (responsive)
js/vendor/chess.js    chess.js 0.13.4 (BSD-2-Clause), move legality
js/board.js           interactive board (drag or click, arrows, promotion picker)
js/engine.js          small alpha-beta engine (bot, hints, blunder coach)
js/curriculum.js      all lesson content
js/openings.js        original five openings
js/openings-more.js   twelve more openings + level (tier) for every opening
js/whynot.js          "Why not …?" notes on tempting mistakes, keyed by position
js/library.js         reference pages
js/app.js             router, views, progress / spaced repetition
tests/validate.js     checks every FEN, solution, mate and opening move for legality, and that no
                      opening line ends with the student's side materially worse (engine check),
                      that every move is explained, and that every "why not" move is legal
```

To add a lesson or an opening line, edit `curriculum.js` or `openings.js`, then run `node tests/validate.js`.
