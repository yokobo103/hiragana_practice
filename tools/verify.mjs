// ヘッドレス調整ハーネス。
// なぞり動作をマウスで再現して「何点つくか」を測り、画面の絵を work/qa/ に落とす。
// 使い方: node tools/verify.mjs   （事前に nazorin サーバ :8143 を起動しておく）
import puppeteer from "puppeteer";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const QA = path.join(HERE, "..", "work", "qa");
fs.mkdirSync(QA, { recursive: true });

const URL = process.env.NAZORIN_URL || "http://localhost:8143/";
const shot = (page, name) => page.screenshot({ path: path.join(QA, name) });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const results = [];
const check = (name, ok, note = "") => {
  results.push({ name, ok, note });
  console.log(`${ok ? "OK  " : "NG  "} ${name}${note ? "  — " + note : ""}`);
};
const info = (line) => console.log("     " + line);

/** 1画を、いろいろな下手さで書く。
 *  jitter = 手のふるえ幅 / shift = 線と平行にずらす量
 *  stopAt = 途中でやめる割合 / reverse = 逆向きに書く */
async function traceStroke(page, strokeIndex,
    { jitter = 0, stopAt = 1, startAt = 0, shift = 0, reverse = false } = {}) {
  const plan = await page.evaluate((i, jit, stop, from, sh, rev) => {
    const t = window.__nazorin.tracer;
    const r = t.cv.getBoundingClientRect();
    const s = t.strokes[i];
    if (!s) return null;
    const toPx = (p) => ({ x: r.left + p.x / 109 * r.width, y: r.top + p.y / 109 * r.height });
    const a = Math.floor(s.pts.length * from);
    const b = Math.max(a + 2, Math.floor(s.pts.length * stop));
    const span = s.pts.length - 1;
    const out = [];
    for (let k = a; k < b; k++) {
      const p = s.pts[k];
      // ふるえは「線に対して直角」に入れる。線に沿ってずらしても手本から離れないので、
      // ±16 と書いてあるのに実際は2しか離れていない、という測り方になってしまう
      const q0 = s.pts[Math.max(0, k-1)], q1 = s.pts[Math.min(span, k+1)];
      let tx = q1.x - q0.x, ty = q1.y - q0.y;
      const L = Math.hypot(tx, ty) || 1;
      const nx = -ty / L, ny = tx / L;
      // 子どもの手の模型：ゆっくりした流れ＋こまかいふるえ。
      // 両端は0にする（書きはじめの●は狙って置くので）
      const w = Math.sin(Math.PI * k / span);
      const off = jit * w * (0.75 * Math.sin(k * 0.28 + 1.1) + 0.25 * Math.sin(k * 1.3));
      out.push(toPx({ x: p.x + nx * off, y: p.y + ny * off + sh }));
    }
    if (rev) out.reverse();
    return out;
  }, strokeIndex, jitter, stopAt, startAt, shift, reverse);

  if (!plan || plan.length < 2) return false;
  await page.mouse.move(plan[0].x, plan[0].y);
  await page.mouse.down();
  for (const p of plan) await page.mouse.move(p.x, p.y);
  await page.mouse.up();
  await sleep(70);
  return true;
}

const state = (page) => page.evaluate(() => {
  const t = window.__nazorin.tracer;
  return {
    cur: t.cur, total: t.strokes.length, done: t.done,
    res: t.lastResult,
    inks: t.strokes.map(s => (s.ink ? s.ink.length : 0)),
    scores: t.strokes.map(s => s.score)
  };
});

/** ごほうびが出ていたら閉じる（画面全体をふさぐので、次の操作が届かなくなる） */
async function dismissReward(page) {
  if (await page.$eval("#reward", e => e.classList.contains("is-on"))) {
    await page.click("#reward-ok"); await sleep(200);
  }
}

/** 1字まるごと書ききる */
async function traceChar(page, ch, opts = {}) {
  await dismissReward(page);
  await page.evaluate(c => window.__nazorin.openChar(c, "table"), ch);
  await sleep(320);
  const s0 = await state(page);
  for (let i = 0; i < s0.total; i++) await traceStroke(page, i, opts);
  await sleep(240);
  return { strokes: s0.total, ...(await state(page)) };
}

/** 1画だけ書いて結果を返す（毎回まっさらから） */
async function tryStroke(page, ch, opts, strokeIndex = 0) {
  await dismissReward(page);
  await page.evaluate(c => window.__nazorin.openChar(c, "table"), ch);
  await sleep(300);
  await traceStroke(page, strokeIndex, opts);
  await sleep(180);
  return await state(page);
}

const browser = await puppeteer.launch({
  headless: "new",
  args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"]
});
const page = await browser.newPage();
await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

const errors = [];
page.on("pageerror", e => errors.push(String(e)));
page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
page.on("response", r => { if (r.status() >= 400) errors.push(r.status() + " " + r.url()); });

await page.goto(URL, { waitUntil: "networkidle0" });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "networkidle0" });
await sleep(400);

/* ================= 1. 50音表 ================= */
check("ひらがな表に46字ならぶ", await page.$$eval(".cell:not(.blank)", e => e.length) === 46);
await shot(page, "01_table.png");

const bar = await page.evaluate(() => {
  const w = (s)=> +document.querySelector(s).getBoundingClientRect().width.toFixed(1);
  return { book: w("#btn-book"), reset: w("#btn-reset") };
});
check("ヘッダのボタンが横に伸びていない", bar.book < 90 && bar.reset < 90,
  `ずかん${bar.book}px / ごみばこ${bar.reset}px`);

await page.click('.tab[data-set="dakuon"]'); await sleep(150);
check("だくおんタブに25字", await page.$$eval(".cell:not(.blank)", e => e.length) === 25);
await page.click('.tab[data-set="seion"]'); await sleep(150);

/* ================= 2. カタカナ ================= */
await page.click('#kana-switch .seg-btn[data-kana="kata"]');
await sleep(200);
const kataCells = await page.$$eval(".cell:not(.blank)", els => els.map(e => e.textContent));
check("カタカナ表に46字ならぶ", kataCells.length === 46, kataCells.slice(0, 5).join(""));
check("カタカナ表の中身がカタカナ",
  kataCells.every(c => c.codePointAt(0) >= 0x30a1 && c.codePointAt(0) <= 0x30fc));
await shot(page, "02_katakana_table.png");

await page.click('.tab[data-set="small"]'); await sleep(150);
const kataSmall = await page.$$eval(".cell:not(.blank)", els => els.map(e => e.textContent).join(""));
check("カタカナのちいさいじに「ー」がある", kataSmall.includes("ー"), kataSmall);
await page.click('.tab[data-set="seion"]'); await sleep(150);

for (const ch of ["ア", "ソ", "ヲ", "ー", "ポ"]) {
  const r = await traceChar(page, ch, { jitter: 4 });
  check(`カタカナ「${ch}」(${r.strokes}画) を最後まで書ける`, r.done === true,
    `${r.cur}/${r.total}画 平均${Math.round(r.scores.reduce((a,b)=>a+b,0)/r.total)}点`);
}
await shot(page, "03_katakana_trace.png");

/* ================= 3. 筆跡が残るか ================= */
await page.evaluate(() => window.__nazorin.setKana("hira"));
const neat = await traceChar(page, "あ", { jitter: 0 });
check("ていねいに書くと完成する", neat.done === true, `${neat.cur}/${neat.total}画`);
check("自分の筆跡が残っている", neat.inks.every(n => n > 5), `画ごとの点数の数 ${neat.inks.join(",")}`);

// 保存されているのが「手本の形」ではなく「指が通った道」であること
await traceChar(page, "あ", { jitter: 9 });
const own = await page.evaluate(() => {
  const t = window.__nazorin.tracer;
  const near = (q, pts) => Math.sqrt(Math.min(...pts.map(p => (p.x-q.x)**2 + (p.y-q.y)**2)));
  const out = t.strokes.map(s => {
    const d = s.ink.map(p => near(p, s.pts));
    return { mean: +(d.reduce((a,b)=>a+b,0)/d.length).toFixed(2), max: +Math.max(...d).toFixed(2) };
  });
  return out;
});
check("残っているのは指の道（手本の形ではない）",
  own.every(o => o.mean > 1.5 && o.max > 3),
  own.map(o => `平均${o.mean} 最大${o.max}`).join(" / "));
await shot(page, "04_own_handwriting.png");

/* ================= 4. 類似度で点がつくか ================= */
console.log("\n--- 下手さと点数の関係（「あ」1画目） ---");
const table = [];
for (const jitter of [0, 4, 8, 12, 16]) {
  const st = await tryStroke(page, "あ", { jitter });
  const r = st.res || {};
  table.push({ jitter, value: r.value ?? 0, ok: !!r.ok, reason: r.reason || "-" });
  const stars = r.value >= 85 ? 3 : r.value >= 70 ? 2 : 1;
  info(`ふるえ±${String(jitter).padStart(2)} → ${String(r.value ?? 0).padStart(3)}点 ` +
       `${"★".repeat(stars)}${"☆".repeat(3-stars)}  ${r.ok ? "合格      " : "やりなおし(" + r.reason + ")"}  ` +
       `手本からの平均ズレ ${(r.meanErr ?? 0).toFixed(1)}  はみ出し ${(r.meanStray ?? 0).toFixed(1)}`);
}
console.log("");
check("ていねいに書くと高得点になる", table[0].value >= 85, `${table[0].value}点`);
check("下手になるほど点が下がる",
  table.every((t, i) => i === 0 || t.value <= table[i-1].value + 1),
  table.map(t => `±${t.jitter}:${t.value}`).join(" "));
check("すこしふるえても合格する（ゆるい判定）", table.every(t => t.ok),
  table.map(t => `±${t.jitter}:${t.value}点`).join(" "));
const stars = (v)=> v >= 85 ? 3 : v >= 70 ? 2 : 1;
check("★3は ていねいに書いたときだけ",
  stars(table[1].value) === 3 && stars(table[3].value) <= 2 && stars(table[4].value) <= 2,
  table.map(t => `±${t.jitter}:${"★".repeat(stars(t.value))}`).join(" "));
check("上手・下手で30点以上ひらく", table[0].value - table[4].value >= 30,
  `${table[0].value} → ${table[4].value}`);

/* ================= 5. やりなおしと、その理由 ================= */
const off = await tryStroke(page, "あ", { shift: 18 });
check("線と平行に18ずれたら やりなおし", off.res && !off.res.ok && off.res.reason === "off",
  `${off.res?.value}点 理由=${off.res?.reason}`);

await shot(page, "11_reject.png");   // 書いた線が残ったまま理由が出ている状態
check("やりなおしのとき 書いた線がしばらく残る",
  await page.evaluate(() => window.__nazorin.tracer.ghostAlpha > 0.9));

const rev = await tryStroke(page, "あ", { reverse: true });
check("逆向きに書いたら「はんたいむき」", rev.res && !rev.res.ok && rev.res.reason === "reverse",
  `${rev.res?.value}点 理由=${rev.res?.reason}`);

const late = await tryStroke(page, "あ", { startAt: 0.5 });
check("途中から書きはじめたら「はじめから」", late.res && !late.res.ok && late.res.reason === "start",
  `${late.res?.value}点 理由=${late.res?.reason}`);

const half = await tryStroke(page, "あ", { stopAt: 0.5 });
check("半分でやめたら「さいごまで」", half.res && !half.res.ok && half.res.reason === "short",
  `${half.res?.value}点 理由=${half.res?.reason}`);

// 書き順ちがい：1画目のところで2画目を書いても通らない
const wrong = await tryStroke(page, "あ", {}, 1);
check("2画目から書こうとしても通らない", wrong.cur === 0 && wrong.res && !wrong.res.ok,
  `cur=${wrong.cur} 理由=${wrong.res?.reason}`);

// ただのタップは何も起きない（怒られない）
await page.evaluate(() => window.__nazorin.openChar("あ", "table"));
await sleep(300);
await page.evaluate(() => {
  const t = window.__nazorin.tracer;
  const r = t.cv.getBoundingClientRect();
  const cx = r.left + r.width/2, cy = r.top + r.height/2;
  for (const type of ["pointerdown","pointerup"])
    t.cv.dispatchEvent(new PointerEvent(type, {pointerId:1, clientX:cx, clientY:cy, bubbles:true}));
});
await sleep(200);
const tapped = await state(page);
check("ただのタップは無視される", tapped.res === null && tapped.cur === 0, `cur=${tapped.cur}`);

// やりなおしのあと、書き直せば通る
await tryStroke(page, "あ", { reverse: true });
await traceStroke(page, 0, { jitter: 3 });
await sleep(200);
check("やりなおしのあと 書き直せば進む", (await state(page)).cur === 1);

await page.click("#btn-again"); await sleep(200);
await page.click("#btn-demo"); await sleep(500);
check("おてほんが再生される", await page.evaluate(() => window.__nazorin.tracer.demoing) === true);
await shot(page, "05_demo.png");
await sleep(2600);

/* ================= 6. ずかん ================= */
await dismissReward(page);
await page.evaluate(() => window.__nazorin.openBook());
await sleep(300);
check("ずかんのページが17（ひらがな）",
  await page.$$eval(".page", e => e.length) === 17);

const lockedBefore = await page.$$eval(".item.locked", els => els.length);
const itemsTotal   = await page.$$eval(".item", els => els.length);
const openBefore   = await page.$eval("#book-total", e => Number(e.textContent.split("/")[0]));
check("なぞってない字はふせてある", lockedBefore === itemsTotal - openBefore,
  `ふせ${lockedBefore} / ぜんぶ${itemsTotal} / あけた${openBefore}`);
check("★が ずかんに出る",
  await page.$$eval(".item:not(.locked) .stars", els => els.some(e => e.textContent.includes("★"))));
await shot(page, "06_book_start.png");

/* あ行を全部書く → ページが かんせい してごほうびが出る */
for (const ch of ["い", "う", "え"]) {
  const rr = await traceChar(page, ch, { jitter: 3 });
  if (!rr.done) check(`「${ch}」が書ききれない`, false, `${rr.cur}/${rr.total}画`);
}
check("4字ではまだ ごほうびが出ない",
  await page.$eval("#reward", e => e.classList.contains("is-on")) === false);

await traceChar(page, "お", { jitter: 3 });
await sleep(2000);
check("あ行がそろうと ごほうびが出る",
  await page.$eval("#reward", e => e.classList.contains("is-on")) === true,
  await page.$eval("#reward-title", e => e.textContent));
check("ごほうびに5つの絵が出る",
  (await page.$eval("#reward-emojis", e => e.textContent.trim().split(/\s+/).length)) === 5);
await shot(page, "07_reward.png");
await page.click("#reward-ok"); await sleep(300);

await page.evaluate(() => window.__nazorin.openBook());
await sleep(300);
check("ずかんの あ行ページが かんせいになる",
  await page.$eval(".page", e => e.classList.contains("full")) === true);
check("ずかんの数がふえる",
  /^\s*5\s*\/\s*81\s*$/.test(await page.$eval("#book-total", e => e.textContent)));
await shot(page, "08_book_filled.png");

await page.evaluate(() => document.querySelectorAll(".item")[1].click());
await sleep(400);
check("ずかんの絵をおすと なぞり画面へ行く",
  await page.$eval("#screen-trace", e => e.classList.contains("is-on")));
await page.click("#btn-back"); await sleep(300);
check("そこから もどると ずかんへ帰る",
  await page.$eval("#screen-book", e => e.classList.contains("is-on")));

await page.click('#book-switch .seg-btn[data-kana="kata"]'); await sleep(300);
check("カタカナのずかんも17ページ",
  await page.$$eval(".page", e => e.length) === 17);
await shot(page, "09_book_katakana.png");

/* 表にも★が出る */
await page.click("#btn-book-back"); await sleep(300);
check("表のマスに★が出る",
  await page.$$eval(".cell.done", els => els.some(e => (e.dataset.stars || "").includes("★"))));
await shot(page, "10_table_stars.png");

/* ================= 7. データ ================= */
const dataOk = await page.evaluate(async () => {
  const m = await import("/data/kana.js");
  const w = await import("/js/words.js");
  const t = window.__nazorin.tracer;
  const bad = [];
  for (const [ch, d] of Object.entries(m.KANA)) {
    if (!d.s.length || d.s.length !== d.n.length) { bad.push(ch + ":番号"); continue; }
    for (const p of d.s) {
      t.mp.setAttribute("d", p);
      if (!(t.mp.getTotalLength() > 3)) { bad.push(ch + ":短すぎ"); break; }
    }
  }
  const listed = [...Object.values(w.SETS.hira).flat(), ...Object.values(w.SETS.kata).flat()].filter(Boolean);
  return { count: Object.keys(m.KANA).length, bad,
           noWord: listed.filter(c => !w.WORDS[c]), noShape: listed.filter(c => !m.KANA[c]) };
});
check("178字ぶんのストロークが健全", dataOk.count === 178 && dataOk.bad.length === 0,
  `${dataOk.count}字 / 異常:${dataOk.bad.join(",") || "なし"}`);
check("表にならぶ字は ことばも形もそろっている",
  dataOk.noWord.length === 0 && dataOk.noShape.length === 0,
  `ことば欠け:${dataOk.noWord.join("") || "なし"} 形欠け:${dataOk.noShape.join("") || "なし"}`);

check("JSエラー・404なし", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();

const ng = results.filter(r => !r.ok);
console.log(`\n=== ${results.length - ng.length}/${results.length} OK ===`);
console.log(`絵は ${path.relative(process.cwd(), QA)} に出しました`);
process.exit(ng.length ? 1 : 0);
