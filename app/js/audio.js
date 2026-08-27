// 効果音はぜんぶ合成。音源ファイルは0バイト。
// iOS/Android は最初のタップまで音を鳴らせないので unlock() を必ず通す。
let ctx = null;

export function unlock(){
  if (!ctx){
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
  }
  if (ctx.state === "suspended") ctx.resume();
}

function tone({freq=440, dur=.18, type="sine", gain=.18, at=0, slideTo=null}){
  if (!ctx) return;
  const t0 = ctx.currentTime + at;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t0); o.stop(t0 + dur + .02);
}

function noise({dur=.25, gain=.12, at=0, hp=800}){
  if (!ctx) return;
  const t0 = ctx.currentTime + at;
  const n = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i=0;i<n;i++) d[i] = (Math.random()*2-1) * (1 - i/n);
  const src = ctx.createBufferSource(); src.buffer = buf;
  const f = ctx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = hp;
  const g = ctx.createGain(); g.gain.value = gain;
  src.connect(f).connect(g).connect(ctx.destination);
  src.start(t0);
}

// なぞりが進むたびの粒。進捗 0..1 で音が上がる = 「進んでる」感
let lastTick = 0;
export function tick(p){
  if (!ctx) return;
  const now = ctx.currentTime;
  if (now - lastTick < 0.045) return;
  lastTick = now;
  tone({freq: 520 + p*620, dur:.07, type:"triangle", gain:.05});
}

export function strokeDone(i){
  const base = [523.25, 587.33, 659.25, 698.46, 783.99][i % 5];
  tone({freq: base, dur:.16, type:"triangle", gain:.16});
  tone({freq: base*2, dur:.12, type:"sine", gain:.06, at:.02});
}

export function charDone(){
  const notes = [523.25, 659.25, 783.99, 1046.5];
  notes.forEach((f,i)=> tone({freq:f, dur:.32, type:"triangle", gain:.16, at:i*.09}));
  noise({dur:.5, gain:.07, at:.05, hp:2200});
}

// 失敗音は「responsible な低音」ではなく、やわらかいためいき。責めない。
export function retry(){
  tone({freq:330, slideTo:220, dur:.22, type:"sine", gain:.10});
}

export function pop(){
  tone({freq:880, dur:.06, type:"square", gain:.05});
}
