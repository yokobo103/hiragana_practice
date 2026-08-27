// スマホ検査。verify.mjs はマウスで動かしているので、こちらは「本物の指」で確かめる。
//   - CDPのタッチイベントで実際になぞる（pointerType が touch になる）
//   - 画面サイズを変えて、はみ出し・押せない・小さすぎ を測る
// 使い方: node tools/verify_mobile.mjs
import puppeteer from "puppeteer";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const QA = path.join(HERE, "..", "work", "qa-mobile");
fs.mkdirSync(QA, { recursive: true });

const URL = process.env.NAZORIN_URL || "http://localhost:8143/";
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const results = [];
const check = (dev, name, ok, note = "") => {
  results.push({ dev, name, ok, note });
  console.log(`  ${ok ? "OK  " : "NG  "} ${name}${note ? "  — " + note : ""}`);
};

// 指1本で なぞる。CDPのタッチイベントを直接投げる（Puppeteerの版差を避ける）
async function touchTrace(page, pts) {
  const cdp = await page.target().createCDPSession();
  const touch = (type, list) => cdp.send("Input.dispatchTouchEvent", {
    type, touchPoints: list.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i, radiusX: 12, radiusY: 12, force: 1 }))
  });
  await touch("touchStart", [pts[0]]);
  for (const p of pts.slice(1)) await touch("touchMove", [p]);
  await touch("touchEnd", []);
  await cdp.detach();
}

// 2本指：1本目でなぞっている途中に、手のひら（2本目）が触れて、先に離れる。
// CDPの touchPoints は「いま触れている点ぜんぶ」。減らすと touchEnd 相当になる。
async function touchTraceWithSecondFinger(page, pts, palm) {
  const cdp = await page.target().createCDPSession();
  const send = (type, list) => cdp.send("Input.dispatchTouchEvent", {
    type, touchPoints: list.map(p => ({ x: p.x, y: p.y, id: p.id, radiusX: 12, radiusY: 12, force: 1 }))
  });
  const P = (p) => ({ ...p, id: 1 });
  const H = { ...palm, id: 2 };
  const half = Math.max(2, Math.floor(pts.length / 2));

  await send("touchStart", [P(pts[0])]);
  for (const p of pts.slice(1, half)) await send("touchMove", [P(p)]);
  await send("touchStart", [P(pts[half-1]), H]);              // 手のひらが乗る
  for (const p of pts.slice(half)) await send("touchMove", [P(p), H]);
  await send("touchEnd",   [P(pts[pts.length-1])]);           // 手のひらだけ離れる
  await send("touchEnd",   []);                               // 指も離れる
  await cdp.detach();
}

const strokePts = (page, i, jitter = 3) => page.evaluate((idx, jit) => {
  const t = window.__nazorin.tracer;
  const r = t.cv.getBoundingClientRect();
  const s = t.strokes[idx];
  if (!s) return [];
  const span = s.pts.length - 1;
  return s.pts.map((p, k) => {
    const q0 = s.pts[Math.max(0, k-1)], q1 = s.pts[Math.min(span, k+1)];
    const tx = q1.x - q0.x, ty = q1.y - q0.y;
    const L = Math.hypot(tx, ty) || 1;
    const w = Math.sin(Math.PI * k / span);
    const off = jit * w * Math.sin(k * 0.3 + 1.1);
    return {
      x: r.left + (p.x + (-ty/L)*off) / 109 * r.width,
      y: r.top  + (p.y + ( tx/L)*off) / 109 * r.height
    };
  });
}, i, jitter);

const DEVICES = [
  { name: "iPhone SE  375x667", w: 375,  h: 667,  dpr: 2 },
  { name: "iPhone 14  390x844", w: 390,  h: 844,  dpr: 3 },
  { name: "Android    412x915", w: 412,  h: 915,  dpr: 2.6 },
  { name: "iPad     820x1180",  w: 820,  h: 1180, dpr: 2 },
  { name: "よこむき   844x390",  w: 844,  h: 390,  dpr: 3 }
];

const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox"] });
const errors = [];

for (const d of DEVICES) {
  console.log(`\n=== ${d.name} ===`);
  const page = await browser.newPage();
  page.on("pageerror", e => errors.push(`${d.name}: ${e}`));
  await page.setViewport({ width: d.w, height: d.h, deviceScaleFactor: d.dpr, isMobile: true, hasTouch: true });
  await page.setUserAgent("Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36");
  await page.goto(URL, { waitUntil: "networkidle0" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle0" });
  await sleep(350);

  const slug = `${d.w}x${d.h}`;   // 名前の先頭語だと iPhone SE と iPhone 14 が衝突する

  /* --- 横スクロールが出ていないか --- */
  const overflow = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    win: window.innerWidth,
    bodyScroll: document.body.scrollHeight - window.innerHeight
  }));
  check(d.name, "横にはみ出していない", overflow.doc <= overflow.win + 1,
    `中身${overflow.doc}px / 画面${overflow.win}px`);
  check(d.name, "ページ自体がスクロールしない", overflow.bodyScroll <= 1, `${overflow.bodyScroll}px`);

  /* --- 表のマスが指で押せる大きさか --- */
  const cell = await page.$eval(".cell:not(.blank)", e => {
    const r = e.getBoundingClientRect(); return { w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
  });
  check(d.name, "表のマスが44px以上", cell.w >= 44 && cell.h >= 44, `${cell.w}x${cell.h}`);

  const barOk = await page.evaluate(() => {
    const els = [...document.querySelectorAll("#screen-table .mini, #screen-table .tab, #screen-table .seg-btn")];
    return els.map(e => { const r = e.getBoundingClientRect(); return +Math.min(r.width, r.height).toFixed(1); });
  });
  check(d.name, "ヘッダ・タブが36px以上", Math.min(...barOk) >= 36, `いちばん小さい辺 ${Math.min(...barOk)}px`);

  await page.screenshot({ path: path.join(QA, `${slug}_1_table.png`) });

  /* --- ホーム画面に置けるか（マニフェストとアイコン） --- */
  const home = await page.evaluate(async () => {
    const link = document.querySelector('link[rel="manifest"]');
    if (!link) return { ok: false, why: "manifestのlinkが無い" };
    const res = await fetch(link.href);
    if (!res.ok) return { ok: false, why: `manifestが${res.status}` };
    const m = await res.json();
    const bad = [];
    for (const ic of m.icons || []) {
      const r = await fetch(new URL(ic.src, link.href));
      if (!r.ok) bad.push(`${ic.src}=${r.status}`);
    }
    const apple = document.querySelector('link[rel="apple-touch-icon"]');
    if (apple) { const r = await fetch(apple.href); if (!r.ok) bad.push(`apple=${r.status}`); }
    return { ok: bad.length === 0 && !!m.name && m.display === "standalone",
             why: bad.join(",") || `${m.short_name} / ${m.display} / アイコン${(m.icons||[]).length}枚`,
             hasApple: !!apple };
  });
  check(d.name, "ホーム画面に置ける（マニフェスト＋アイコン）", home.ok && home.hasApple, home.why);

  /* --- なぞり画面のおさまり --- */
  await page.evaluate(() => window.__nazorin.openChar("あ", "table"));
  await sleep(350);
  const layout = await page.evaluate(() => {
    const r = (s)=> { const b = document.querySelector(s).getBoundingClientRect();
      return { top:+b.top.toFixed(1), bottom:+b.bottom.toFixed(1), w:+b.width.toFixed(1), h:+b.height.toFixed(1) }; };
    return { canvas: r("#canvas"), controls: r(".controls"), header: r("#screen-trace .topbar"),
             vh: window.innerHeight, vw: window.innerWidth };
  });
  check(d.name, "ボタンが画面の中に収まっている",
    layout.controls.bottom <= layout.vh + 1, `下端${layout.controls.bottom} / 画面${layout.vh}`);
  // よこ向きではボタンが右の列に来る。たて積み前提で比べると意味がないので、
  // 「四角として重なっていないか・画面の中にいるか」で見る
  const clash = await page.evaluate(() => {
    const R = (s)=> document.querySelector(s).getBoundingClientRect();
    const hit = (a,b)=> !(a.right <= b.left+1 || b.right <= a.left+1 || a.bottom <= b.top+1 || b.bottom <= a.top+1);
    const cv = R("#canvas"), ct = R(".controls"), hd = R("#screen-trace .topbar");
    return {
      onControls: hit(cv, ct), onHeader: hit(cv, hd),
      inside: cv.top >= -1 && cv.left >= -1 &&
              cv.bottom <= window.innerHeight + 1 && cv.right <= window.innerWidth + 1,
      box: `${cv.top.toFixed(0)},${cv.left.toFixed(0)}〜${cv.bottom.toFixed(0)},${cv.right.toFixed(0)}`
    };
  });
  check(d.name, "書くマスがボタン・ヘッダと重なっていない",
    !clash.onControls && !clash.onHeader,
    `${clash.onControls ? "ボタンと重なる " : ""}${clash.onHeader ? "ヘッダと重なる" : ""}${clash.box}`);
  check(d.name, "書くマスが画面の中に収まっている", clash.inside, clash.box);
  check(d.name, "書くマスが十分大きい", layout.canvas.w >= 240,
    `${layout.canvas.w}px（画面幅の${Math.round(layout.canvas.w/layout.vw*100)}%）`);

  /* --- 本物の指でなぞれるか --- */
  const total = await page.evaluate(() => window.__nazorin.tracer.strokes.length);
  for (let i = 0; i < total; i++) await touchTrace(page, await strokePts(page, i, 3));
  await sleep(300);
  const st = await page.evaluate(() => {
    const t = window.__nazorin.tracer;
    return { done: t.done, cur: t.cur, total: t.strokes.length,
             pointerType: t.lastPointerType, scores: t.strokes.map(s=>s.score) };
  });
  check(d.name, "指でなぞって字が書ける", st.done === true,
    `${st.cur}/${st.total}画 平均${Math.round(st.scores.reduce((a,b)=>a+b,0)/st.total)}点`);
  check(d.name, "指の入力として扱われている", st.pointerType === "touch", `pointerType=${st.pointerType}`);
  await page.screenshot({ path: path.join(QA, `${slug}_2_trace.png`) });

  /* --- 手のひらが触れても壊れないか --- */
  await page.evaluate(() => window.__nazorin.openChar("い", "table"));
  await sleep(300);
  const pts = await strokePts(page, 0, 3);
  const corner = await page.evaluate(() => {
    const r = window.__nazorin.tracer.cv.getBoundingClientRect();
    return { x: r.left + 14, y: r.bottom - 14 };   // マスのすみに手のひら
  });
  await touchTraceWithSecondFinger(page, pts, corner);
  await sleep(300);
  const palm = await page.evaluate(() => {
    const t = window.__nazorin.tracer;
    return { cur: t.cur, reason: t.lastResult && t.lastResult.reason, ok: t.lastResult && t.lastResult.ok };
  });
  check(d.name, "手のひらが触れても1画目が通る", palm.cur === 1,
    `cur=${palm.cur} 理由=${palm.reason || "なし"}`);

  /* --- 画面回転で作り直されるか --- */
  await page.setViewport({ width: d.h, height: d.w, deviceScaleFactor: d.dpr, isMobile: true, hasTouch: true });
  await sleep(500);
  const rot = await page.evaluate(() => {
    const b = document.querySelector("#canvas").getBoundingClientRect();
    const c = document.querySelector(".controls").getBoundingClientRect();
    return { w: +b.width.toFixed(1), bottom: +c.bottom.toFixed(1), vh: window.innerHeight };
  });
  check(d.name, "回しても崩れない", rot.w >= 200 && rot.bottom <= rot.vh + 1,
    `マス${rot.w}px / ボタン下端${rot.bottom} / 画面${rot.vh}`);
  await page.screenshot({ path: path.join(QA, `${slug}_3_rotated.png`) });

  await page.close();
}

await browser.close();

console.log("");
const ng = results.filter(r => !r.ok);
if (errors.length) console.log("JSエラー:", errors.slice(0,5).join(" | "));
console.log(`=== ${results.length - ng.length}/${results.length} OK ===`);
if (ng.length) {
  console.log("\nこけたもの:");
  for (const r of ng) console.log(`  ${r.dev}  ${r.name}  ${r.note}`);
}
console.log(`絵は ${path.relative(process.cwd(), QA)} に出しました`);
process.exit(ng.length || errors.length ? 1 : 0);
