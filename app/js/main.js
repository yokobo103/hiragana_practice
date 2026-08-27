import { KANA } from "../data/kana.js";
import { WORDS, SETS, pagesOf, kanaOf, readingOf } from "./words.js";
import { Tracer, starsOf } from "./tracer.js";
import * as sfx from "./audio.js";

const $ = (s)=>document.querySelector(s);
const KEY = "nazorin.stamps.v1";

const el = {
  table:  $("#screen-table"),
  trace:  $("#screen-trace"),
  bookScr:$("#screen-book"),
  grid:   $("#grid"),
  tabs:   $("#tabs"),
  prog:   $("#progress"),
  word:   $("#word"),
  praise: $("#praise"),
  canvas: $("#canvas"),
  stage:  document.querySelector(".stage"),
  conf:   $("#confetti"),
  book:   $("#book"),
  bookCount: $("#book-count"),
  bookTotal: $("#book-total"),
  reward: $("#reward")
};

const stamps = loadStamps();
let curKana  = "hira";     // 表で見ているかな
let bookKana = "hira";     // ずかんで見ているかな
let curSet   = "seion";
let curChar  = null;
let returnTo = "table";    // なぞり画面から どこへ戻るか

const tracer = new Tracer(el.canvas, $("#measure-path"));

/* ================= スタンプ帳 ================= */
// { "あ": { n: なぞった回数, best: いちばん良かった点数 } }
function loadStamps(){
  let raw = {};
  try { raw = JSON.parse(localStorage.getItem(KEY)) || {}; } catch {}
  const out = {};
  for (const [k, v] of Object.entries(raw)){
    out[k] = (typeof v === "number") ? { n: v, best: 0 } : v;   // v2からの引っ越し
  }
  return out;
}
function saveStamps(){
  try { localStorage.setItem(KEY, JSON.stringify(stamps)); } catch {}
}
const got     = (ch)=> !!stamps[ch];
const bestOf  = (ch)=> (stamps[ch] && stamps[ch].best) || 0;
const starStr = (ch)=> got(ch) ? "★".repeat(starsOf(bestOf(ch) || 1)) : "";
const countOf = (kana)=> Object.values(SETS[kana]).flat().filter(c=>c && got(c)).length;
const totalOf = (kana)=> Object.values(SETS[kana]).flat().filter(Boolean).length;

/* ================= 50音表 ================= */
function renderGrid(){
  el.grid.innerHTML = "";
  for (const ch of SETS[curKana][curSet]){
    if (!ch){
      const b = document.createElement("div");
      b.className = "cell blank";
      el.grid.appendChild(b);
      continue;
    }
    const b = document.createElement("button");
    b.className = "cell" + (got(ch) ? " done" : "");
    b.textContent = ch;
    if (got(ch)) b.dataset.stars = starStr(ch);
    b.setAttribute("aria-label", readingOf(ch));
    b.addEventListener("click", ()=>{ sfx.unlock(); sfx.pop(); openChar(ch, "table"); });
    el.grid.appendChild(b);
  }
  const list = SETS[curKana][curSet].filter(Boolean);
  el.prog.textContent = `⭐ ${list.filter(got).length} / ${list.length}`;
  refreshBookCount();
}
function refreshBookCount(){
  el.bookCount.textContent = String(countOf("hira") + countOf("kata"));
}

el.tabs.addEventListener("click", (e)=>{
  const t = e.target.closest(".tab");
  if (!t) return;
  sfx.unlock(); sfx.pop();
  [...el.tabs.children].forEach(x=>x.classList.toggle("is-on", x === t));
  curSet = t.dataset.set;
  renderGrid();
});

$("#kana-switch").addEventListener("click", (e)=>{
  const t = e.target.closest(".seg-btn");
  if (!t) return;
  sfx.unlock(); sfx.pop();
  [...t.parentNode.children].forEach(x=>x.classList.toggle("is-on", x === t));
  curKana = t.dataset.kana;
  renderGrid();
});

$("#btn-reset").addEventListener("click", ()=>{
  if (!confirm("あつめた ずかんと ⭐を ぜんぶ けしますか？")) return;
  for (const k of Object.keys(stamps)) delete stamps[k];
  saveStamps();
  renderGrid();
});

/* ================= ずかん ================= */
function renderBook(){
  el.book.innerHTML = "";
  for (const page of pagesOf(bookKana)){
    const done = page.chars.filter(got).length;
    const full = done === page.chars.length;

    const sec = document.createElement("section");
    sec.className = "page" + (full ? " full" : "");

    const head = document.createElement("div");
    head.className = "page-head";
    head.innerHTML = `<h3 class="page-title">${page.title}</h3>` +
      (full ? `<span class="ribbon">かんせい 🎉</span>`
            : `<span class="dots"><b>${"●".repeat(done)}</b>${"○".repeat(page.chars.length - done)}</span>`);
    sec.appendChild(head);

    const g = document.createElement("div");
    g.className = "page-grid";
    for (const ch of page.chars){
      const w = WORDS[ch] || { w:"", e:"❓" };
      const b = document.createElement("button");
      b.className = "item" + (got(ch) ? "" : " locked");
      // まだの字は絵を見せない。ここを開けたい、が次をなぞる動機になる
      b.innerHTML = `<span class="emoji">${got(ch) ? w.e : "？"}</span>` +
                    `<span class="name">${w.w}</span>` +
                    `<span class="kana">${ch}</span>` +
                    `<span class="stars">${starStr(ch)}</span>`;
      b.setAttribute("aria-label", got(ch) ? `${ch} ${w.w}` : `${ch} まだ`);
      b.addEventListener("click", ()=>{
        sfx.unlock(); sfx.pop();
        openChar(ch, "book");
      });
      g.appendChild(b);
    }
    sec.appendChild(g);
    el.book.appendChild(sec);
  }
  el.bookTotal.textContent = `${countOf(bookKana)} / ${totalOf(bookKana)}`;
}

function openBook(){
  bookKana = curKana;
  [...$("#book-switch").children].forEach(x=>x.classList.toggle("is-on", x.dataset.kana === bookKana));
  show(el.bookScr);
  renderBook();
}

$("#btn-book").addEventListener("click", ()=>{ sfx.unlock(); sfx.pop(); openBook(); });
$("#btn-book-back").addEventListener("click", ()=>{ sfx.pop(); show(el.table); renderGrid(); });
$("#book-switch").addEventListener("click", (e)=>{
  const t = e.target.closest(".seg-btn");
  if (!t) return;
  sfx.pop();
  [...t.parentNode.children].forEach(x=>x.classList.toggle("is-on", x === t));
  bookKana = t.dataset.kana;
  renderBook();
});

/* ================= 画面きりかえ ================= */
function show(screen){
  for (const s of [el.table, el.trace, el.bookScr]) s.classList.toggle("is-on", s === screen);
}

/* ================= なぞり画面 ================= */
function openChar(ch, from){
  const data = KANA[ch];
  if (!data) return;
  curChar = ch;
  if (from) returnTo = from;
  const w = WORDS[ch] || { w:"", e:"" };
  el.word.textContent = `${w.e} ${w.w}`;
  show(el.trace);
  $("#btn-next").classList.remove("is-ready");
  fit();
  tracer.load(data);
  say(ch);
}

function goBack(){
  hidePraise();
  if (returnTo === "book"){ show(el.bookScr); renderBook(); }
  else { show(el.table); renderGrid(); }
}

function fit(){
  const pad = 8;
  const w = el.stage.clientWidth  - pad;
  const h = el.stage.clientHeight - pad;
  tracer.resize(Math.floor(Math.max(200, Math.min(w, h, 460))));
}
window.addEventListener("resize", ()=>{ if (el.trace.classList.contains("is-on")) fit(); });
window.addEventListener("orientationchange", ()=> setTimeout(fit, 250));

/* ---- ボタン ---- */
$("#btn-back").addEventListener("click", ()=>{ sfx.pop(); goBack(); });
$("#btn-say").addEventListener("click", ()=>{ sfx.unlock(); say(curChar); });
$("#btn-demo").addEventListener("click", ()=>{ sfx.unlock(); hidePraise(); tracer.demo(); });
$("#btn-again").addEventListener("click", ()=>{
  sfx.unlock(); sfx.pop(); hidePraise();
  $("#btn-next").classList.remove("is-ready");
  tracer.reset();
});
$("#btn-next").addEventListener("click", ()=>{
  sfx.unlock(); sfx.pop();
  const list = Object.values(SETS[kanaOf(curChar)]).flat().filter(Boolean);
  const i = list.indexOf(curChar);
  hidePraise();
  openChar(list[(i + 1) % list.length]);
});

/* ---- 判定からのコールバック ---- */
const PRAISE = { 3: "かんぺき！", 2: "じょうず！", 1: "いいね！" };
// やりなおしの理由。責めない言い方にする
const WHY = {
  reverse: "はんたいから かいてるよ",
  start:   "はじめの ●から なぞろう",
  short:   "さいごまで なぞろう",
  off:     "せんの うえを なぞろう"
};

tracer.on.tick = (p)=> sfx.tick(p);

tracer.on.strokeDone = (i, res)=>{
  sfx.strokeDone(i);
  const st = starsOf(res.value);
  flash(`${"★".repeat(st)}${"☆".repeat(3-st)} ${PRAISE[st]}`, 700, "top");
};

tracer.on.reject = (res)=>{
  sfx.retry();
  flash(WHY[res.reason] || "もういちど", 1100, "top");
};

tracer.on.charDone = (avg)=>{
  sfx.charDone();
  const isNew = !got(curChar);
  const rec = stamps[curChar] || { n: 0, best: 0 };
  rec.n += 1;
  rec.best = Math.max(rec.best, avg);
  stamps[curChar] = rec;
  saveStamps();
  refreshBookCount();
  $("#btn-next").classList.add("is-ready");

  const st = starsOf(avg);
  setTimeout(()=>{
    flash(`${"★".repeat(st)}${"☆".repeat(3-st)}  ${isNew ? "ずかんに はいった！" : PRAISE[st]}`, 1900, "top", true);
    confetti();
    say(curChar);
  }, 160);

  if (isNew){
    const page = pagesOf(kanaOf(curChar)).find(p => p.chars.includes(curChar));
    if (page && page.chars.every(got)) setTimeout(()=> showReward(page), 1600);
  }
};

/* ---- 行がそろったときのごほうび ---- */
function showReward(page){
  $("#reward-title").textContent = `${page.title} かんせい！`;
  $("#reward-emojis").textContent = page.chars.map(c => (WORDS[c] || {}).e || "⭐").join(" ");
  el.reward.classList.add("is-on");
  sfx.charDone();
  confetti();
  say(`${page.title} かんせい`);
}
$("#reward-ok").addEventListener("click", ()=>{
  sfx.pop();
  el.reward.classList.remove("is-on");
});

/* ---- ほめ表示 ---- */
let praiseTimer = null;
function flash(text, ms = 620, spot = "top", big = false){
  el.praise.innerHTML = "<span></span>";
  el.praise.firstChild.textContent = text;
  el.praise.classList.toggle("top", spot === "top");
  el.praise.classList.toggle("big", big);
  el.praise.classList.add("is-on");
  clearTimeout(praiseTimer);
  praiseTimer = setTimeout(hidePraise, ms);
}
function hidePraise(){ el.praise.classList.remove("is-on"); }

/* ---- よみあげ ---- */
function say(text){
  if (!text || !("speechSynthesis" in window)) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(WORDS[text] ? readingOf(text) : text);
    u.lang = "ja-JP"; u.rate = 0.85; u.pitch = 1.15;
    speechSynthesis.speak(u);
  } catch {}
}

/* ---- 紙ふぶき ---- */
function confetti(){
  const cv = el.conf, c = cv.getContext("2d");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
  c.setTransform(dpr,0,0,dpr,0,0);
  cv.classList.add("is-on");
  const cols = ["#ff8a5c","#4ecdc4","#ffc93c","#a78bfa","#5db2ff","#ff7eb6"];
  const ps = Array.from({length:70}, ()=>({
    x: innerWidth/2 + (Math.random()-.5)*140,
    y: innerHeight*0.42,
    vx: (Math.random()-.5)*9,
    vy: -Math.random()*11 - 4,
    r: 4 + Math.random()*6,
    a: Math.random()*7,
    va: (Math.random()-.5)*.35,
    col: cols[(Math.random()*cols.length)|0]
  }));
  const t0 = performance.now();
  const step = ()=>{
    const t = performance.now() - t0;
    c.clearRect(0,0,innerWidth,innerHeight);
    for (const p of ps){
      p.vy += 0.32; p.x += p.vx; p.y += p.vy; p.a += p.va;
      c.save(); c.translate(p.x,p.y); c.rotate(p.a);
      c.fillStyle = p.col; c.fillRect(-p.r/2, -p.r/2, p.r, p.r*.65);
      c.restore();
    }
    if (t < 1900) requestAnimationFrame(step);
    else { c.clearRect(0,0,innerWidth,innerHeight); cv.classList.remove("is-on"); }
  };
  step();
}

/* ---- 起動 ---- */
document.addEventListener("pointerdown", ()=>sfx.unlock(), { once:true });
document.addEventListener("gesturestart", e=>e.preventDefault());
renderGrid();

// 開発用: ?c=ア で直接ひらく
const q = new URLSearchParams(location.search).get("c");
if (q && KANA[q]) openChar(q, "table");

// 開発用フック（ヘッドレス調整ハーネスから触る）
window.__nazorin = {
  tracer, stamps, openChar, openBook, renderGrid, renderBook, pagesOf, starsOf,
  get char(){ return curChar; },
  setKana(k){
    curKana = k;
    [...$("#kana-switch").children].forEach(x=>x.classList.toggle("is-on", x.dataset.kana === k));
    renderGrid();
  }
};
