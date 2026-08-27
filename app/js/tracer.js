// なぞり判定＋描画エンジン（v3：筆跡を残す・お手本との類似度で採点）。
//
// v2との違い:
//   - 指の生の軌跡をそのまま描いて残す。完成した字は「子どもが書いた線」でできている
//   - 判定はチェックポイントの通過ではなく、書き終わってから お手本との似ぐあいを測る
// 座標系は KanjiVG の 109x109。
const VB = 109;

const R_COVER = 13;   // 手本の点が「なぞられた」と認める距離
const R_STRAY = 16;   // 自分の線が「線の上」と認める距離
const R_END   = 17;   // 書きはじめ・書きおわりに「届いた」と認める距離
const D0      = 8;    // 点数の物差し。手本から平均でこれだけ離れたら その項目は0点
                      // （109の字の中で平均8ずれる＝画面で25pxくらい。かなりガタガタ）
const MIN_LEN = 6;    // これより短い線はタップとみなして黙って捨てる
const MIN_STEP = 0.8; // 記録する点の間引き（109基準）

// 合格ライン。どれか1つでも切ったら やりなおし（理由を返す）
const PASS  = { coverage: 0.70, onPath: 0.45, order: 0.50 };
// 点数の配合。かたち＝手本をなぞれているか / きれいさ＝はみ出していないか
const W     = { shape: 0.45, neat: 0.35, order: 0.20 };

const PALETTE = ["#ff8a5c","#4ecdc4","#ffc93c","#a78bfa","#5db2ff","#ff7eb6","#7bd88f","#ffa8a8"];

const dist2 = (ax,ay,bx,by)=> (ax-bx)*(ax-bx) + (ay-by)*(ay-by);
const dist  = (a,b)=> Math.hypot(a.x-b.x, a.y-b.y);

/** 点数から★の数。1〜3 */
export function starsOf(score){ return score >= 85 ? 3 : score >= 70 ? 2 : 1; }

export class Tracer {
  constructor(canvas, measurePath){
    this.cv = canvas;
    this.ctx = canvas.getContext("2d");
    this.mp = measurePath;
    this.on = {};
    this.strokes = [];
    this.nums = [];
    this.raf = null;
    this.pointer = null;
    this.demoStroke = -1;
    this.demoFill = 0;
    this.lastResult = null;
    this._bind();
  }

  /* ---------- 読み込み ---------- */
  load(data){
    this.strokes = data.s.map((d, i) => {
      this.mp.setAttribute("d", d);
      const total = this.mp.getTotalLength();
      const n = Math.max(6, Math.ceil(total / 3));
      const pts = [];
      for (let k = 0; k <= n; k++){
        const p = this.mp.getPointAtLength(total * k / n);
        pts.push({ x: p.x, y: p.y });
      }
      return { d, path: new Path2D(d), total, pts,
               color: PALETTE[i % PALETTE.length], ink: null, score: 0 };
    });
    this.nums = data.n || [];
    this.reset();
  }

  reset(){
    for (const s of this.strokes){ s.ink = null; s.score = 0; }
    this.cur = 0;         // いま何画目
    this.ink = null;      // いま書いている線
    this.ghost = null;    // 不合格になって消えていく線
    this.ghostAlpha = 0;
    this.ghostHold = 0;
    this.reach = 0;       // 手本のどこまで届いたか（音の高さ用）
    this.done = false;
    this.demoing = false;
    this.demoStroke = -1;
    this.lastResult = null;
    this.lastAdvance = performance.now();
    this.hint = 0;
    this.pointer = null;
    this.start();
  }

  /* ---------- サイズ ---------- */
  resize(cssSize){
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.cv.style.width = cssSize + "px";
    this.cv.style.height = cssSize + "px";
    this.cv.width = Math.round(cssSize * dpr);
    this.cv.height = Math.round(cssSize * dpr);
    this.scale = (cssSize * dpr) / VB;
  }

  toVB(ev){
    const r = this.cv.getBoundingClientRect();
    return {
      x: (ev.clientX - r.left) / r.width * VB,
      y: (ev.clientY - r.top) / r.height * VB
    };
  }

  /* ---------- 入力 ---------- */
  _bind(){
    const down = (e)=>{
      if (this.done || this.demoing) return;
      if (!this.strokes[this.cur]) return;
      // 2本目の指や手のひらは無視する。書きかけの線が乗っ取られると
      // 「書いたのに消えた」になって、子どもには理由が分からない
      if (this.pointer !== null) return;
      this.lastPointerType = e.pointerType;   // 検査用（指かマウスか）
      this.cv.setPointerCapture(e.pointerId);
      this.pointer = e.pointerId;
      this.ink = [this.toVB(e)];
      this.ghost = null;
      this.reach = 0;
      this.lastAdvance = performance.now();
      this.hint = 0;
      e.preventDefault();
    };
    const move = (e)=>{
      if (this.pointer !== e.pointerId || !this.ink) return;
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of evs) this._record(this.toVB(ev));
      e.preventDefault();
    };
    const up = (e)=>{
      if (this.pointer !== e.pointerId) return;
      this.pointer = null;
      this._judge();
    };
    // 電話の着信やシステムのジェスチャで取り上げられただけ。
    // 書き終わったわけではないので、採点も注意もしない
    const cancel = (e)=>{
      if (this.pointer !== e.pointerId) return;
      this.pointer = null;
      this.ink = null;
    };
    this.cv.addEventListener("pointerdown", down);
    this.cv.addEventListener("pointermove", move);
    this.cv.addEventListener("pointerup", up);
    this.cv.addEventListener("pointercancel", cancel);
    this.cv.addEventListener("touchstart", e=>e.preventDefault(), {passive:false});
  }

  _record(p){
    const last = this.ink[this.ink.length - 1];
    if (dist2(p.x, p.y, last.x, last.y) < MIN_STEP * MIN_STEP) return;
    this.ink.push(p);
    this.lastAdvance = performance.now();

    // 音の高さ用に「手本のどこまで届いたか」を更新する
    const s = this.strokes[this.cur];
    if (!s) return;
    let best = -1, bestD = R_COVER * R_COVER;
    for (let k = 0; k < s.pts.length; k++){
      const d = dist2(p.x, p.y, s.pts[k].x, s.pts[k].y);
      if (d <= bestD){ bestD = d; best = k; }
    }
    if (best > this.reach){
      this.reach = best;
      if (this.on.tick) this.on.tick(best / (s.pts.length - 1));
    }
  }

  /* ---------- 採点 ---------- */

  /** 自分の線とお手本の似ぐあいを測る。ink は109座標系の点列。
   *  当たり判定の通過数ではなく「平均でどれだけ離れているか」で点をつける。
   *  太い当たり判定だけで測ると、下手に書いても点が下がらない。 */
  score(ink, s){
    if (!ink || ink.length < 2) return null;
    let len = 0;
    for (let i = 1; i < ink.length; i++) len += dist(ink[i-1], ink[i]);
    if (len < MIN_LEN) return null;          // ただのタップ

    const nearestTo = (q, pts)=>{
      let m = Infinity;
      for (const p of pts){
        const d = dist2(p.x, p.y, q.x, q.y);
        if (d < m) m = d;
      }
      return Math.sqrt(m);
    };

    // ① かたち：手本の点から自分の線までの距離。平均が点数、遠すぎる点の数がゲート
    let sumErr = 0, covered = 0;
    for (const q of s.pts){
      const d = nearestTo(q, ink);
      sumErr += d;
      if (d <= R_COVER) covered++;
    }
    const meanErr  = sumErr / s.pts.length;
    const coverage = covered / s.pts.length;

    // ② きれいさ：自分の点から手本までの距離。はみ出した分だけ下がる
    let sumStray = 0, on = 0;
    for (const p of ink){
      const d = nearestTo(p, s.pts);
      sumStray += d;
      if (d <= R_STRAY) on++;
    }
    const meanStray = sumStray / ink.length;
    const onPath    = on / ink.length;

    // ③ 書きはじめ・書きおわりに届いたか
    const dStart = nearestTo(s.pts[0], ink);
    const dEnd   = nearestTo(s.pts[s.pts.length - 1], ink);

    // ④ 向き：はじめと終わりが手本と合っているか（逆向きを弾く）
    const m0 = s.pts[0], mN = s.pts[s.pts.length - 1];
    const u0 = ink[0],   uN = ink[ink.length - 1];
    const fwd = dist(u0, m0) + dist(uN, mN);
    const bwd = dist(u0, mN) + dist(uN, m0);
    const order = (fwd + bwd) < 0.001 ? 1 : bwd / (fwd + bwd);

    const shape = 1 - Math.min(1, meanErr   / D0);
    const neat  = 1 - Math.min(1, meanStray / D0);
    const value = Math.round(100 * (W.shape*shape + W.neat*neat + W.order*order));

    // 理由の順番が大事。「線と平行にずれた線」は coverage も onPath も落ちるが、
    // 言うべきは「さいごまで」ではなく「せんの うえを」なので onPath を先に見る
    let reason = null;
    if (order         < PASS.order)    reason = "reverse";  // はんたいむき
    else if (onPath   < PASS.onPath)   reason = "off";      // 線から外れている
    else if (dStart   > R_END)         reason = "start";    // 書きはじめに来ていない
    else if (dEnd     > R_END)         reason = "short";    // 書きおわりに届いていない
    else if (coverage < PASS.coverage) reason = "short";    // 途中がごっそり抜けている

    return { value, shape, neat, order, coverage, onPath,
             meanErr, meanStray, dStart, dEnd, ok: !reason, reason };
  }

  _judge(){
    const s = this.strokes[this.cur];
    const ink = this.ink;
    this.ink = null;
    if (!s || !ink) return;

    const res = this.score(ink, s);
    if (!res){ return; }            // タップ。何も言わない
    this.lastResult = res;

    if (res.ok){
      s.ink = ink;
      s.score = res.value;
      const i = this.cur;
      this.cur++;
      this.reach = 0;
      this.lastAdvance = performance.now();
      if (this.on.strokeDone) this.on.strokeDone(i, res);
      if (this.cur >= this.strokes.length){
        this.done = true;
        const avg = Math.round(this.strokes.reduce((a,x)=>a+x.score, 0) / this.strokes.length);
        if (this.on.charDone) this.on.charDone(avg);
      }
    } else {
      this.ghost = ink;             // 書いた線を「これを書いたね」と見せてから消す
      this.ghostAlpha = 1;
      this.ghostHold = performance.now() + 550;
      this.hint = 1;
      if (this.on.reject) this.on.reject(res);
    }
  }

  /** いまの字の平均点 */
  average(){
    if (!this.strokes.length) return 0;
    return Math.round(this.strokes.reduce((a,x)=>a+x.score, 0) / this.strokes.length);
  }

  /* ---------- おてほん ---------- */
  async demo(){
    if (this.demoing) return;
    this.demoing = true;
    for (let i = this.cur; i < this.strokes.length; i++){
      this.demoStroke = i;
      await this._sweep(700);
      await new Promise(r=>setTimeout(r, 160));
    }
    this.demoStroke = -1;
    this.demoing = false;
    this.lastAdvance = performance.now();
  }

  _sweep(ms){
    return new Promise(res=>{
      const t0 = performance.now();
      const step = ()=>{
        const t = Math.min(1, (performance.now()-t0)/ms);
        this.demoFill = t;
        if (t < 1) requestAnimationFrame(step); else res();
      };
      step();
    });
  }

  /* ---------- 描画 ---------- */
  start(){ if (!this.raf) this.raf = requestAnimationFrame(()=>this._loop()); }
  stop(){ if (this.raf){ cancelAnimationFrame(this.raf); this.raf = null; } }

  _loop(){
    this.raf = requestAnimationFrame(()=>this._loop());
    if (this.ghost && performance.now() > this.ghostHold){
      this.ghostAlpha -= 0.013;
      if (this.ghostAlpha <= 0){ this.ghost = null; this.ghostAlpha = 0; }
    }
    if (!this.done && !this.demoing && !this.ink &&
        performance.now() - this.lastAdvance > 3500) this.hint = 1;
    this._draw();
  }

  _draw(){
    const c = this.ctx, S = this.scale;
    if (!S) return;
    c.setTransform(1,0,0,1,0,0);
    c.clearRect(0,0,this.cv.width,this.cv.height);
    c.setTransform(S,0,0,S,0,0);
    c.lineCap = "round"; c.lineJoin = "round";

    this._grid(c);

    // お手本（うすいグレー）。自分の線の下にずっといる
    c.setLineDash([]);
    c.strokeStyle = "#efe8dc"; c.lineWidth = 8.5;
    for (const s of this.strokes) c.stroke(s.path);

    // 書けた画は「自分の筆跡」で描く
    for (const s of this.strokes) if (s.ink) this._pen(c, s.ink, s.color, 1);

    if (this.demoing && this.demoStroke >= 0){
      const s = this.strokes[this.demoStroke];
      if (s){
        c.strokeStyle = "#c9bda9"; c.lineWidth = 8.5; c.stroke(s.path);
        this._partial(c, s, this.demoFill, s.color, 8);
        const p = this._at(s, this.demoFill);
        c.fillStyle = "#fff"; c.beginPath(); c.arc(p.x,p.y,4.6,0,7); c.fill();
        c.fillStyle = s.color; c.beginPath(); c.arc(p.x,p.y,3.2,0,7); c.fill();
      }
      return;
    }

    // 不合格だった線が消えていくところ
    // 合格した線とは別の色にする。同じ色だと「通った」と勘違いする
    if (this.ghost) this._pen(c, this.ghost, "#e8a9a9", this.ghostAlpha);

    if (this.done) return;   // 完成したら番号を消して、書いた字だけ見せる

    const s = this.strokes[this.cur];
    if (!s) return;

    // これから書く画だけ濃いめの手本
    c.setLineDash([]);
    c.strokeStyle = "#ddd2be"; c.lineWidth = 8.5; c.stroke(s.path);

    // いま書いている線
    if (this.ink) this._pen(c, this.ink, s.color, 1);

    // 書きはじめの丸と番号（書き始める前だけ）
    if (!this.ink){
      const head = s.pts[0];
      const pulse = this.hint ? 1 + Math.sin(performance.now()/160)*0.22 : 1;
      if (this.hint){
        c.fillStyle = "rgba(255,159,67,.22)";
        c.beginPath(); c.arc(head.x, head.y, 11*pulse, 0, 7); c.fill();
      }
      c.fillStyle = s.color;
      c.beginPath(); c.arc(head.x, head.y, 5.4*pulse, 0, 7); c.fill();
      c.fillStyle = "#fff";
      c.font = "600 6px system-ui, sans-serif";
      c.textAlign = "center"; c.textBaseline = "middle";
      c.fillText(String(this.cur+1), head.x, head.y+0.3);
    }

    this._numbers(c, this.cur);
  }

  /** 筆跡を1本描く。角を丸めて、クレヨンっぽく芯と外側の2枚 */
  _pen(c, pts, color, alpha){
    if (!pts || pts.length < 2){
      if (pts && pts.length === 1){
        c.save(); c.globalAlpha = alpha; c.fillStyle = color;
        c.beginPath(); c.arc(pts[0].x, pts[0].y, 3.6, 0, 7); c.fill(); c.restore();
      }
      return;
    }
    const path = new Path2D();
    path.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++){
      const mx = (pts[i].x + pts[i+1].x) / 2;
      const my = (pts[i].y + pts[i+1].y) / 2;
      path.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
    path.lineTo(pts[pts.length-1].x, pts[pts.length-1].y);

    c.save();
    c.strokeStyle = color;
    c.globalAlpha = alpha * 0.16;   // ふちのにじみ。強くすると字がぼやける
    c.lineWidth = 8.6; c.stroke(path);
    c.globalAlpha = alpha;
    c.lineWidth = 6.6; c.stroke(path);
    c.restore();
  }

  _partial(c, s, r, color, w){
    if (r <= 0.001) return;
    c.save();
    c.strokeStyle = color; c.lineWidth = w;
    c.setLineDash([s.total * Math.min(r,1), 99999]);
    c.stroke(s.path);
    c.restore();
    c.setLineDash([]);
  }

  _at(s, r){
    this.mp.setAttribute("d", s.d);
    return this.mp.getPointAtLength(s.total * Math.max(0, Math.min(1, r)));
  }

  _numbers(c, cur){
    c.setLineDash([]);
    c.textAlign = "left"; c.textBaseline = "top";
    c.font = "600 7px system-ui, sans-serif";
    this.nums.forEach((xy, i)=>{
      if (i === cur) return;
      c.fillStyle = (this.strokes[i] && this.strokes[i].ink) ? "rgba(74,59,42,.25)" : "rgba(163,147,124,.5)";
      c.fillText(String(i+1), xy[0], xy[1]-7.5);
    });
  }

  _grid(c){
    c.save();
    c.strokeStyle = "#f2e8d8"; c.lineWidth = 1; c.setLineDash([3,4]);
    c.beginPath();
    c.moveTo(VB/2, 5); c.lineTo(VB/2, VB-5);
    c.moveTo(5, VB/2); c.lineTo(VB-5, VB/2);
    c.stroke();
    c.setLineDash([]);
    c.restore();
  }
}
