/* Board: a dependency-free, interactive chessboard view.
 * It knows nothing about chess rules. A controller supplies:
 *   - a position map  { e4: 'wP', ... }
 *   - destsFn(square) -> [squares]  (where the piece on `square` may go)
 *   - onMove(from, to, promotion)  (called after a user move)
 */
(function () {
  const FILES = 'abcdefgh';
  const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟︎' };
  const NAMES = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };

  function fenToMap(fen) {
    const map = {};
    const rows = fen.split(' ')[0].split('/');
    rows.forEach((row, r) => {
      let f = 0;
      for (const ch of row) {
        if (/\d/.test(ch)) { f += +ch; continue; }
        const color = ch === ch.toUpperCase() ? 'w' : 'b';
        map[FILES[f] + (8 - r)] = color + ch.toUpperCase();
        f++;
      }
    });
    return map;
  }

  class Board {
    constructor(el, opts = {}) {
      this.el = el;
      this.orientation = opts.orientation || 'white';
      this.position = {};
      this.destsFn = () => [];
      this.onMove = null;
      this.onSquareClick = null;
      this.selected = null;
      this.lastMove = null;
      this.arrows = [];
      this.highlights = {};
      this.stars = [];
      this.checkSquare = null;
      this.showCoords = opts.coords !== false;
      this.interactive = true;
      this.el.classList.add('board-wrap');
      this.el.innerHTML = '<div class="board" role="grid" aria-label="Chessboard"></div><svg class="arrows" viewBox="0 0 8 8" aria-hidden="true"></svg><div class="promo hidden"></div>';
      this.boardEl = this.el.querySelector('.board');
      this.svg = this.el.querySelector('.arrows');
      this.promoEl = this.el.querySelector('.promo');
      this._bindPointer();
      this.render();
    }

    static fenToMap(fen) { return fenToMap(fen); }

    setFen(fen) { this.setPosition(fenToMap(fen)); }
    setPosition(map) { this.position = Object.assign({}, map); this.selected = null; this.render(); }
    setOrientation(o) { this.orientation = o; this.render(); }
    flip() { this.setOrientation(this.orientation === 'white' ? 'black' : 'white'); }
    setLastMove(from, to) { this.lastMove = from ? [from, to] : null; this.render(); }
    setArrows(a) { this.arrows = a || []; this._drawArrows(); }
    setHighlights(h) { this.highlights = h || {}; this.render(); }
    setStars(s) { this.stars = s || []; this.render(); }
    setCheck(sq) { this.checkSquare = sq || null; this.render(); }
    setInteractive(v) { this.interactive = v; this.selected = null; this.render(); }

    flash(square, kind) {
      const el = this.boardEl.querySelector(`[data-sq="${square}"]`);
      if (!el) return;
      el.classList.remove('flash-good', 'flash-bad');
      void el.offsetWidth;
      el.classList.add(kind === 'good' ? 'flash-good' : 'flash-bad');
    }
    shake() {
      this.el.classList.remove('shake'); void this.el.offsetWidth; this.el.classList.add('shake');
    }

    _squares() {
      const out = [];
      for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
        const file = this.orientation === 'white' ? f : 7 - f;
        const rank = this.orientation === 'white' ? 8 - r : r + 1;
        out.push(FILES[file] + rank);
      }
      return out;
    }

    render() {
      const dests = this.selected ? this.destsFn(this.selected) : [];
      const html = this._squares().map((sq, i) => {
        const f = FILES.indexOf(sq[0]), rank = +sq[1];
        const light = (f + rank) % 2 === 0; // a1 (f=0, rank=1) is dark; h1 is light
        const cls = ['sq', light ? 'light' : 'dark'];
        if (this.lastMove && this.lastMove.includes(sq)) cls.push('last');
        if (this.selected === sq) cls.push('sel');
        if (this.checkSquare === sq) cls.push('check');
        if (this.highlights[sq]) cls.push('hl-' + this.highlights[sq]);
        const piece = this.position[sq];
        if (dests.includes(sq)) cls.push(piece ? 'dest-cap' : 'dest');
        let inner = '';
        if (piece) {
          const c = piece[0], t = piece[1].toLowerCase();
          inner += `<span class="pc ${c === 'w' ? 'pw' : 'pb'}" aria-label="${c === 'w' ? 'white' : 'black'} ${NAMES[t]}">${GLYPH[t]}</span>`;
        }
        if (this.stars.includes(sq)) inner += '<span class="star">★</span>';
        if (this.showCoords) {
          const col = i % 8, row = Math.floor(i / 8);
          if (col === 0) inner += `<span class="coord rank">${rank}</span>`;
          if (row === 7) inner += `<span class="coord file">${sq[0]}</span>`;
        }
        return `<div class="${cls.join(' ')}" data-sq="${sq}" role="gridcell" aria-label="${sq}${piece ? ' ' + (piece[0] === 'w' ? 'white ' : 'black ') + NAMES[piece[1].toLowerCase()] : ''}">${inner}</div>`;
      }).join('');
      this.boardEl.innerHTML = html;
      this._drawArrows();
    }

    _xy(sq) {
      const f = FILES.indexOf(sq[0]), r = +sq[1] - 1;
      return this.orientation === 'white' ? [f + 0.5, 7 - r + 0.5] : [7 - f + 0.5, r + 0.5];
    }

    _drawArrows() {
      const colors = { green: '#15781b', red: '#b33430', blue: '#1f5fa8', yellow: '#c99a06' };
      let s = '<defs>' + Object.entries(colors).map(([k, c]) =>
        `<marker id="ah-${k}" markerWidth="4" markerHeight="4" refX="2.05" refY="2" orient="auto"><path d="M0,0 L4,2 L0,4 Z" fill="${c}"/></marker>`).join('') + '</defs>';
      for (const a of this.arrows) {
        const [x1, y1] = this._xy(a.from), [x2, y2] = this._xy(a.to);
        const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
        const ex = x2 - (dx / len) * 0.38, ey = y2 - (dy / len) * 0.38;
        const col = a.color || 'green';
        s += `<line x1="${x1}" y1="${y1}" x2="${ex}" y2="${ey}" stroke="${colors[col]}" stroke-width="0.16" stroke-linecap="round" opacity="0.8" marker-end="url(#ah-${col})"/>`;
      }
      this.svg.innerHTML = s;
    }

    _sqFromPoint(x, y) {
      const el = document.elementFromPoint(x, y);
      const sqEl = el && el.closest && el.closest('[data-sq]');
      return sqEl && this.boardEl.contains(sqEl) ? sqEl.dataset.sq : null;
    }

    _tryMove(from, to) {
      const dests = this.destsFn(from);
      if (!dests.includes(to)) return false;
      const piece = this.position[from];
      const isPromo = piece && piece[1] === 'P' && ((piece[0] === 'w' && to[1] === '8') || (piece[0] === 'b' && to[1] === '1'));
      this.selected = null;
      if (isPromo && !this.noPromotion) { this._askPromotion(piece[0], from, to); return true; }
      if (this.onMove) this.onMove(from, to);
      return true;
    }

    _askPromotion(color, from, to) {
      this.promoEl.innerHTML = '<div class="promo-box"><p>Promote to:</p>' + ['q', 'r', 'b', 'n'].map(p =>
        `<button data-p="${p}" class="pc ${color === 'w' ? 'pw' : 'pb'}" aria-label="${NAMES[p]}">${GLYPH[p]}</button>`).join('') + '</div>';
      this.promoEl.classList.remove('hidden');
      this.promoEl.onclick = (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        this.promoEl.classList.add('hidden');
        if (this.onMove) this.onMove(from, to, b.dataset.p);
      };
    }

    _bindPointer() {
      let drag = null;
      this.boardEl.addEventListener('pointerdown', (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        const sq = this._sqFromPoint(e.clientX, e.clientY);
        if (!sq) return;
        if (this.onSquareClick) { this.onSquareClick(sq); return; }
        if (!this.interactive) return;
        if (this.selected && this.selected !== sq && this._tryMove(this.selected, sq)) return;
        const dests = this.destsFn(sq);
        if (this.position[sq] && dests.length) {
          e.preventDefault();
          this.selected = sq;
          this.render();
          const pcEl = this.boardEl.querySelector(`[data-sq="${sq}"] .pc`);
          if (pcEl) {
            const rect = pcEl.getBoundingClientRect();
            const ghost = pcEl.cloneNode(true);
            ghost.classList.add('ghost');
            ghost.style.width = rect.width + 'px';
            ghost.style.height = rect.height + 'px';
            ghost.style.fontSize = getComputedStyle(pcEl).fontSize;
            document.body.appendChild(ghost);
            drag = { from: sq, ghost, pcEl, moved: false, w: rect.width };
            this._moveGhost(drag, e.clientX, e.clientY);
          }
        } else if (this.selected) {
          this.selected = null; this.render();
        }
      });
      window.addEventListener('pointermove', (e) => {
        if (!drag) return;
        drag.moved = true;
        drag.pcEl.style.opacity = '0.25';
        this._moveGhost(drag, e.clientX, e.clientY);
      });
      window.addEventListener('pointerup', (e) => {
        if (!drag) return;
        const d = drag; drag = null;
        d.ghost.remove();
        d.pcEl.style.opacity = '';
        const to = this._sqFromPoint(e.clientX, e.clientY);
        if (d.moved && to && to !== d.from) {
          if (!this._tryMove(d.from, to)) { this.selected = null; this.render(); }
        }
      });
    }

    _moveGhost(d, x, y) {
      d.ghost.style.left = (x - d.w / 2) + 'px';
      d.ghost.style.top = (y - d.w / 2) + 'px';
    }
  }

  window.Board = Board;
})();
