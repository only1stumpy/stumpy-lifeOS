// Генерирует public/audio/sfx.wav: тихие клики набора, «тик» на тап, мягкий звук на «Записал».
// Никакой сторонней музыки. Тайминги повторяют src/scenes.tsx (секунды от начала ролика).
import { writeFileSync, mkdirSync } from "node:fs";

const SR = 44100;
let buf;

function typing(text, cps = 11) {
  const out = [];
  let acc = 0;
  for (let i = 0; i < text.length; i++) {
    const r = Math.abs(Math.sin((i + 1) * 12.9898) * 43758.5453) % 1;
    let d = (0.55 + r * 0.9) / cps;
    if (text[i] === " ") d *= 1.35;
    if (text[i] === ",") d *= 2.2;
    acc += d;
    out.push(acc);
  }
  return out;
}

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;

function click(t, gain = 0.16) {
  const s0 = Math.floor(t * SR);
  let lp = 0;
  for (let i = 0; i < SR * 0.018; i++) {
    const env = Math.exp(-i / (SR * 0.0035));
    lp += 0.35 * (rnd() - lp);
    if (s0 + i < buf.length) buf[s0 + i] += lp * env * gain;
  }
}
function tone(t, freq, len, gain) {
  const s0 = Math.floor(t * SR);
  for (let i = 0; i < SR * len; i++) {
    const x = i / SR;
    const env = Math.min(1, x / 0.004) * Math.exp(-x / (len / 4));
    if (s0 + i < buf.length) buf[s0 + i] += Math.sin(2 * Math.PI * freq * x) * env * gain;
  }
}
const tick = (t) => tone(t, 1750, 0.06, 0.4);
const done = (t) => { tone(t, 660, 0.24, 0.32); tone(t + 0.085, 990, 0.32, 0.28); };

function render(name, duration, typeRuns, taps, dones, softs = []) {
  buf = new Float32Array(SR * duration);
  for (const [start, text, cps] of typeRuns) for (const t of typing(text, cps)) click(start + t, cps > 20 ? 0.38 : 0.5);
  taps.forEach(tick);
  softs.forEach((t) => click(t, 0.3));
  dones.forEach(done);
  let peak = 0;
  for (const v of buf) peak = Math.max(peak, Math.abs(v));
  const norm = peak > 0 ? 0.95 / peak : 1; // пик -0.5 dBFS
  const pcm = Buffer.alloc(buf.length * 2);
  for (let i = 0; i < buf.length; i++) pcm.writeInt16LE(Math.max(-1, Math.min(1, buf[i] * norm)) * 32767, i * 2);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVE", 8);
  header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SR, 24); header.writeUInt32LE(SR * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
  mkdirSync(new URL("../public/audio/", import.meta.url), { recursive: true });
  writeFileSync(new URL(`../public/audio/${name}`, import.meta.url), Buffer.concat([header, pcm]));
  console.log(`public/audio/${name} written`);
}

// Ролик 1 (Promo), тайминги из src/scenes.tsx.
render("sfx.wav", 52,
  [[0.45, "съел гречку с курицей", 11], [10.25, "съел удон за 425", 11], [16.6, "утром два бутера, в обед солянка, сейчас удон", 26]],
  [4.9, 13.15, 13.75, 23.35, ...[5.85, 6.55, 7.35, 9.45, 12.5, 13.8, 14.9, 16.75, 17.9, 20.25].map((t) => 24 + t)],
  [5.12, 13.37, 13.97]);

// Ролик 2 (Day): формулы как stepTimes() в src/Day.tsx, шаги из config.day.steps.
{
  const steps = { weight: [2.4, "вес 72"], breakfast: [6.4, "омлет из двух яиц"], salary: [10.8, "получил зарплату 75000"], plan: [15.0, "запиши в планы кроссовки за 9000"], question: [23.0, "сколько я потратил сегодня?"] };
  const t = {};
  const runs = [];
  for (const [k, [start, text]] of Object.entries(steps)) {
    const typeStart = start + 0.25;
    const send = typeStart + typing(text, 26).at(-1) + 0.08;
    t[k] = { reply: send + 0.35, tap: send + 1.35, confirm: send + 1.57 };
    runs.push([typeStart, text, 26]);
  }
  const gym = 18.8;
  render("sfx-day.wav", 30, runs,
    [t.breakfast.tap, t.salary.tap, gym + 1.35],
    [t.weight.reply, t.breakfast.confirm, t.salary.confirm, t.plan.reply]);
}

// Ролик 3 (Fix) и 4 (Money): формулы как fixTimes() / moneyTimes() в src/Fix.tsx и src/Money.tsx.
{
  const dur = (text, cps) => typing(text, cps).at(-1);
  const first = "съел гречку с курицей", fixText = "гречки две тарелки, мяса вдвое меньше";
  const typeA = 2.3, sendA = typeA + dur(first, 26) + 0.1, draftA = sendA + 0.35, tapEdit = draftA + 1.4, editSwap = tapEdit + 0.22;
  const typeB = editSwap + 0.9, sendB = typeB + dur(fixText, 26) + 0.1, draftB = sendB + 0.35, tapRec = draftB + 1.4, recSwap = tapRec + 0.22;
  const link = recSwap + 0.9, camMove = link + 0.75 + 1.0, final = camMove + 2.6;
  render("sfx-fix.wav", Math.ceil(final + 3.6), [[typeA, first, 26], [typeB, fixText, 26]], [tapEdit, tapRec], [recSwap]);

  const q = "сколько я потратил за месяц?";
  const send = 2.3 + dur(q, 26) + 0.1;
  render("sfx-money.wav", 22, [[2.3, q, 26]], [11.2, 13.4, 15.4], [send + 0.35]);
}

// Ролик 5 (Quit): формулы как quitTimes() и fieldAt() в src/Quit.tsx.
{
  const dur = (text, cps) => typing(text, cps).at(-1);
  const text = "съел гречку с курицей";
  const typeA = 9.2, sendA = typeA + dur(text, 26) + 0.1, draftA = sendA + 0.35, tapRec = draftA + 1.4, recSwap = tapRec + 0.22;
  const final = recSwap + 2.4;
  const fieldAt = (i) => 2.9 + i * 0.42;
  render("sfx-quit.wav", Math.ceil(final + 3.6), [[typeA, text, 26], [fieldAt(3), "гречка", 14]], [...Array.from({ length: 10 }, (_, i) => fieldAt(i) + 0.2), tapRec], [recSwap]);
}

// Ролик 6 (Duel): формулы как duelTimes() и cellAt() в src/Duel.tsx.
{
  const dur = (text, cps) => typing(text, cps).at(-1);
  const START = 3.4, lunch = "съел удон";
  const typeA = START + 0.15, sendA = typeA + dur(lunch, 26) + 0.1, draftA = sendA + 0.3, tapA = draftA + 0.8, swapA = tapA + 0.22;
  const photo = swapA + 0.15, draftB = photo + 0.4, tapB = draftB + 0.8, swapB = tapB + 0.22;
  const final = START + 8 + 0.4 + 0.5 + 3.4;
  const n = 8 + 18 + 2;
  const cells = Array.from({ length: n }, (_, i) => START + 0.3 + (i * 7.3) / n);
  render("sfx-duel.wav", Math.ceil(final + 3.6), [[typeA, lunch, 26]], [tapA, tapB], [swapA, swapB], cells);
}

// Ролик 7 (Apps): формулы как appsTimes() / cardField() / cardSaved() в src/Apps.tsx.
{
  const dur = (text, cps) => typing(text, cps).at(-1);
  const text = "съел удон за 425";
  const CARD_T = [2.4, 4.6, 6.8];
  const oldEnd = 10.3, typeA = oldEnd + 0.8, sendA = typeA + dur(text, 26) + 0.1, draftM = sendA + 0.7;
  const tapF = draftM + 1.1, tapM = tapF + 0.55, link = tapM + 0.7;
  const resFade = link + 3.6, final = resFade + 0.5 + 3.2;
  const softs = CARD_T.flatMap((c) => [0, 1, 2].map((j) => c + 0.3 + j * 0.35));
  const dones = CARD_T.map((c) => c + 1.6);
  render("sfx-apps.wav", Math.ceil(final + 3.6), [[typeA, text, 26]], [tapF, tapM], [...dones, tapF + 0.22, tapM + 0.22], softs);
}

// Ролик 8 (Debt): формулы как debtTimes() в src/Debt.tsx.
{
  const dur = (text, cps) => typing(text, cps).at(-1);
  const a = "Али должен мне 3000", b = "Али вернул 1000";
  const typeA = 2.3, sendA = typeA + dur(a, 26) + 0.1, draftA = sendA + 0.35, tapA = draftA + 1.4, swapA = tapA + 0.22;
  const typeB = swapA + 1.0, sendB = typeB + dur(b, 26) + 0.1, draftB = sendB + 0.35, tapB = draftB + 1.4, swapB = tapB + 0.22;
  const final = swapB + 0.9 + 3.4;
  render("sfx-debt.wav", Math.ceil(final + 3.6), [[typeA, a, 26], [typeB, b, 26]], [tapA, tapB], [swapA, swapB]);
}
