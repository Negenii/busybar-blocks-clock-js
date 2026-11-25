// Blocks Clock for the BUSY Bar.
//
// The clock logic is the native app's tetris_render.c, ported line by line: a digit is a 6x12
// bitmap covered exactly by tetrominoes, and a digit that changes slides out and is rebuilt,
// lowest piece first. Each digit column is drawn live as a 6x16 XPM bitmap, and only the columns
// that changed since the last frame are sent.
//
// Every draw is an HTTP request to the bar (about 40 ms), and the bar has one core: the next
// frame is worked out only once the previous request is done, and nothing polls in between.

import manifest from "./appmeta/manifest.json";

const APP = manifest.id;
const API = "http://localhost/api";

// ---- digits and their covers ----------------------------------------------------------------

const DIGIT_W = 6, DIGIT_H = 12, PANEL_W = 72, PANEL_H = 16;
const TOP = (PANEL_H - DIGIT_H) >> 1;

interface Piece { kind: number; x: number[]; y: number[]; bottom: number }

/** Each digit (a 6x12 bitmap, two cells thick everywhere) covered exactly by tetrominoes, lowest
 * piece first, ties left to right. Per piece: its kind (I O T S Z J L), then four cells as
 * x + 6 * y in base 36. Made by tools/covers.mjs with the native app's solver: on the bar the
 * search takes seconds in JavaScript. */
const COVER_TABLE = [
  "01c1i1o1u 61j1p1v1w 61t1x1y1z 61m1q1r1s 31a1g1h1n 211171d16 00t0z151b 00i0o0u10 00m0s0y14 00d0j0p0v 0050b0h0n 60607080c 2040a0g09 000010203",
  "11o1p1u1v 01w1x1y1z 0181e1k1q 51l1r1s1t 61213191f 50l0r0w0x 50e0f0k0q 500060708 501020309",
  "61i1o1u1v 11q1r1w1x 11s1t1y1z 61c1d1j1p 50u0v1016 40w111217 50x131415 50n0t0y0z 00a0g0m0s 604050b0h 500060708 501020309",
  "51o1u1v1w 51p1q1r1x 51n1t1y1z 01a1g1m1s 614151b1h 50u101112 50v0w0x13 50n0t0y0z 50g0h0m0s 600010206 00708090a 50304050b",
  "51n1t1y1z 51g1h1m1s 00s0y141a 00t0z151b 60o0p0q0u 60r0v0w0x 000060c0i 001070d0j 50b0h0m0n 504050a0g",
  "01u1v1w1x 51n1t1y1z 01o1p1q1r 51g1h1m1s 30x13141a 60y0z151b 00i0o0u10 10v0w1112 60c0d0j0p 500060708 501020309 104050a0b",
  "01c1i1o1u 01v1w1x1y 31m1s1t1z 51j1p1q1r 0151b1h1n 31016171d 518191a1g 011121314 00c0i0o0u 00d0j0p0v 500060708 605090a0b 001020304",
  "61m1s1y1z 61g1h1n1t 50z151a1b 50s0t0y14 0040a0g0m 0050b0h0n 006070809 000010203",
  "61i1o1u1v 11q1r1w1x 61m1s1y1z 61c1d1j1p 61g1h1n1t 60u101617 50z151a1b 00j0p0v11 10w0x1213 00m0s0y14 50c0d0i0o 60g0h0n0t 100010607 50208090a 50304050b",
  "11o1p1u1v 11q1r1w1x 61m1s1y1z 01b1h1n1t 514151a1g 00c0i0o0u 00v0w0x0y 30m0s0t0z 50j0p0q0r 0050b0h0n 30006070d 508090a0g 001020304",
];
const COVERS: Piece[][] = COVER_TABLE.map((digit) =>
  digit.split(" ").map((s) => {
    const cells = [0, 1, 2, 3].map((k) => parseInt(s.slice(1 + 2 * k, 3 + 2 * k), 36));
    const y = cells.map((c) => (c / DIGIT_W) | 0);
    return { kind: +s[0], x: cells.map((c) => c % DIGIT_W), y, bottom: Math.max(...y) };
  }),
);
/** The dark first column of 12-hour time before 10 o'clock: a digit with no pieces, so the 1 of
 * 12 o'clock slides out of it and the 1 of 10 o'clock falls into it like any other change. */
const BLANK = 10;
COVERS[BLANK] = [];

/** The first-run hint: "TRY" and an arrow up to the wheel, as four parts that fall into place
 * like digits. Cells are x + 72 * y on the panel. Made by `node tools/covers.mjs hint`. */
const HINT_TABLE = [
  "5m7o7q6q7 5k6k7m6o6 5e7g7i6i7 5c6c7e6g6 18687a6a7 644454664 647656667 148496869",
  "1ocodqcqd 5mhohqgqh 5kgkhmgog 5idkdmcmd 5gcgdickc 1gfggifig 6cccdceec 6cfedeeef 1cgchegeh 66c8cacad 56h8hagah 64c4d6d8d 54g4h6g8g 14e4f6e6f",
  "5mnonqmqn 5kmknmmom 6elemgmim 0cnengnin 6ckclcmek 1cocpeoep 56l8lakal 56p8paoap 54k4l6k8k 54o4p6o8o",
  "5etgtgugv 5euevewgw 6exeyezgx 6f0gygzh0 0h1h2h3h4 5f5h5h6h7 5f6f7f8h8 5f9h9hahb 5fafbfchc 6fdfeffhd 0hehfhghh 0hihjhkhl 5fkflfmhm 1fnfohnho 0bpdpfphp 0bqdqfqhq 0f1f2f3f4 0fgfhfifj 65p7p9p9q 65q5r5s7q 33o3p5n5o 41p1q3q3r",
];
const HINT_PARTS: Piece[][] = HINT_TABLE.map((part) =>
  part.split(" ").map((s) => {
    const cells = [0, 1, 2, 3].map((k) => parseInt(s.slice(1 + 2 * k, 3 + 2 * k), 36));
    const y = cells.map((c) => (c / PANEL_W) | 0);
    return { kind: +s[0], x: cells.map((c) => c % PANEL_W), y, bottom: Math.max(...y) };
  }),
);

// ---- layout ---------------------------------------------------------------------------------

const DIGIT_GAP = 2, COLON_GAP = 4, COLON_W = 2;
const LEFT4 = (PANEL_W - (4 * DIGIT_W + 2 * DIGIT_GAP + 2 * COLON_GAP + COLON_W)) >> 1;
const LEFT6 = (PANEL_W - (6 * DIGIT_W + 3 * DIGIT_GAP + 2 * (2 * COLON_GAP + COLON_W))) >> 1;
const PAIR = 2 * DIGIT_W + DIGIT_GAP + 2 * COLON_GAP + COLON_W;
const LAYOUT: Record<4 | 6, { xs: number[]; colons: number[] }> = {
  4: {
    xs: [LEFT4, LEFT4 + DIGIT_W + DIGIT_GAP, LEFT4 + PAIR, LEFT4 + PAIR + DIGIT_W + DIGIT_GAP],
    colons: [LEFT4 + 2 * DIGIT_W + DIGIT_GAP + COLON_GAP],
  },
  6: {
    xs: [LEFT6, LEFT6 + DIGIT_W + DIGIT_GAP, LEFT6 + PAIR, LEFT6 + PAIR + DIGIT_W + DIGIT_GAP, LEFT6 + 2 * PAIR, LEFT6 + 2 * PAIR + DIGIT_W + DIGIT_GAP],
    colons: [LEFT6 + 2 * DIGIT_W + DIGIT_GAP + COLON_GAP, LEFT6 + PAIR + 2 * DIGIT_W + DIGIT_GAP + COLON_GAP],
  },
};
const ALL_IDS = ["c0", "c1", "c2", "c3", "c4", "c5", "k0", "k1"];

// ---- the look -------------------------------------------------------------------------------

const COLOURS = ["classic", "amber", "white", "green", "settle"] as const;
const SEC_STYLES = ["quick", "quicker", "snap"] as const;
const SPEEDS = ["slowest", "slow", "medium", "fast", "fastest"] as const;
const SPEED_BYTES = [0, 64, 128, 192, 255];
const COLONS = ["blink", "solid", "off"] as const;

interface Look {
  colour: number;
  hour24: boolean;
  seconds: boolean;
  secStyle: (typeof SEC_STYLES)[number];
  speed: number;
  colon: (typeof COLONS)[number];
  animated: boolean;
}

/** XPM palette: "." is transparent, then the seven pieces (dimmed for a panel at close range),
 * amber, white and green. */
const PALETTE = ["none", "#00BEC8", "#E1B900", "#A546C8", "#3CC346", "#D73737", "#325FE1", "#E67D14", "#FF9628", "#EBEBE1", "#46DC5A"];
const SYMBOLS = ".abcdefghij";
const CODES = [...SYMBOLS].map((c) => c.charCodeAt(0));
const EMPTY = CODES[0];
const AMBER = 8, WHITE = 9, GREEN = 10;

function colourOf(look: Look, kind: number, falling: boolean): number {
  switch (COLOURS[look.colour]) {
    case "amber": return AMBER;
    case "white": return WHITE;
    case "green": return GREEN;
    case "settle": return falling ? kind + 1 : AMBER; // the piece's colour only while it falls
    default: return kind + 1;
  }
}

/** ms a piece takes to fall: 150 at the slow end, 40 at the fast. */
const pieceMs = (look: Look) => 150 - ((SPEED_BYTES[look.speed] * 110 / 255) | 0);
/** ms the old digit takes to slide out of the panel. */
const clearMs = (look: Look) => pieceMs(look) * 4;

// The seconds skip the slide out and land the pieces in waves, every piece whose bottom row is in
// the same band at once, so a digit is built well inside its second.
const waveBand = (style: Look["secStyle"]) => (style === "quick" ? 2 : style === "quicker" ? 3 : DIGIT_H);
const waveMs = (style: Look["secStyle"]) => (style === "quick" ? 70 : style === "quicker" ? 60 : 150);
const waveOf = (p: Piece, style: Look["secStyle"]) => ((DIGIT_H - 1 - p.bottom) / waveBand(style)) | 0;
const LAST_WAVE = {} as Record<Look["secStyle"], number[]>;
for (const style of SEC_STYLES) LAST_WAVE[style] = COVERS.map((c) => Math.max(...c.map((p) => waveOf(p, style))));

// ---- columns --------------------------------------------------------------------------------

const STILL = 0, CLEARING = 1, BUILDING = 2;

interface Column {
  value: number; // the digit shown, or being built
  next: number; // the digit being cleared towards, while value is still the one leaving
  phase: number;
  landed: number; // how many of the cover's pieces have landed
  at: number; // ms into the current piece's fall, wave, or clear
  wave: number;
}

const newColumn = (): Column => ({ value: 0, next: 0, phase: STILL, landed: COVERS[0].length, at: 0, wave: 0 });
function show(col: Column, v: number): void {
  col.value = v; col.next = v; col.landed = COVERS[v].length; col.phase = STILL; col.at = 0; col.wave = 0;
}
const fastColumn = (look: Look, i: number) => look.seconds && i >= 4;

/** Heading for `want`, compared with where the column is going, not where it is. */
function changeTo(col: Column, want: number, fast: boolean): void {
  if (col.value === want || col.next === want) return;
  col.next = want;
  col.at = 0;
  if (fast) { col.value = want; col.landed = 0; col.wave = 0; col.phase = BUILDING; }
  else col.phase = CLEARING;
}

function step(look: Look, col: Column, fast: boolean, delta: number): void {
  if (col.phase === STILL) return;
  col.at += delta;
  const cover = COVERS[col.value];
  if (fast) {
    const ms = waveMs(look.secStyle);
    while (col.at >= ms) {
      col.at -= ms;
      if (col.wave >= LAST_WAVE[look.secStyle][col.value]) { show(col, col.value); return; }
      col.wave++;
    }
  } else if (col.phase === CLEARING) {
    if (col.at >= clearMs(look)) { col.value = col.next; col.landed = 0; col.at = 0; col.phase = BUILDING; }
  } else {
    const pm = pieceMs(look);
    while (col.at >= pm && col.landed < cover.length) { col.at -= pm; col.landed++; }
    if (col.landed >= cover.length) show(col, col.value);
  }
}

/** A short key of what the column shows: equal keys, identical picture. */
function columnKey(look: Look, col: Column, fast: boolean): string {
  if (col.phase === STILL) return "s" + col.value;
  if (fast) return "w" + col.value + "/" + col.wave + "/" + (((col.at * (TOP + DIGIT_H)) / waveMs(look.secStyle)) | 0);
  if (col.phase === CLEARING) return "c" + col.value + "/" + (((col.at * (PANEL_H + DIGIT_H)) / clearMs(look)) | 0);
  const p = COVERS[col.value][col.landed];
  if (!p) return "s" + col.value;
  const travel = TOP + p.bottom + 1;
  return "b" + col.value + "/" + col.landed + "/" + (((col.at * travel) / pieceMs(look)) | 0);
}

/** The column as XPM symbol codes, 6 x 16, row-major. */
function drawColumn(buf: number[], look: Look, col: Column, fast: boolean): void {
  buf.fill(EMPTY);
  const put = (p: Piece, oy: number, falling: boolean) => {
    const c = CODES[colourOf(look, p.kind, falling)];
    for (let k = 0; k < 4; k++) {
      const y = oy + p.y[k];
      if (y >= 0 && y < PANEL_H) buf[y * DIGIT_W + p.x[k]] = c;
    }
  };
  // from above the panel down to where it belongs, linearly, as falling blocks always have
  const fall = (p: Piece, ms: number) => {
    const travel = TOP + p.bottom + 1;
    put(p, TOP - travel + Math.min(travel, ((col.at * travel) / ms) | 0), true);
  };
  const cover = COVERS[col.value];
  if (col.phase === STILL) for (const p of cover) put(p, TOP, false);
  else if (fast) {
    for (const p of cover) {
      const w = waveOf(p, look.secStyle);
      if (w < col.wave) put(p, TOP, false);
      else if (w === col.wave) fall(p, waveMs(look.secStyle));
    }
  } else if (col.phase === CLEARING) {
    const span = PANEL_H + DIGIT_H;
    const drop = Math.min(span, ((col.at * span) / clearMs(look)) | 0);
    for (const p of cover) put(p, TOP + drop, false);
  } else {
    for (let i = 0; i < col.landed; i++) put(cover[i], TOP, false);
    if (col.landed < cover.length) fall(cover[col.landed], pieceMs(look));
  }
}

// ---- the first-run hint --------------------------------------------------------------------

/** HINT_AFTER ms after the start the clock gives way to the hint for HINT_FOR ms, or until the
 * wheel turns. Shown on every start until the wheel has been turned once. */
const HINT_AFTER = 3000, HINT_FOR = 10000;
const TRIED_KEY = "wheel_tried";
/** ms between the parts starting to fall, so they do not fall in step. */
const HINT_STAGGER = 150;
const hintDone = (look: Look) => Math.max(...HINT_PARTS.map((part, i) => i * HINT_STAGGER + part.length * pieceMs(look)));

/** Each part as far as it has fallen `t` ms into the hint: its landed pieces, and the one falling. */
function hintState(look: Look, t: number): number[][] {
  const pm = pieceMs(look);
  return HINT_PARTS.map((part, i) => {
    const e = Math.max(0, t - i * HINT_STAGGER), landed = Math.min(part.length, Math.floor(e / pm));
    if (landed >= part.length) return [landed, 0];
    const p = part[landed], travel = p.bottom + 1;
    return [landed, Math.min(travel, ((e - landed * pm) * travel / pm) | 0)];
  });
}
function drawHint(buf: number[], look: Look, state: number[][]): void {
  buf.fill(EMPTY);
  HINT_PARTS.forEach((part, i) => {
    const [landed, gone] = state[i];
    for (let n = 0; n <= landed && n < part.length; n++) {
      const p = part[n], falling = n === landed, oy = falling ? gone - p.bottom - 1 : 0;
      const c = CODES[colourOf(look, p.kind, falling)];
      for (let k = 0; k < 4; k++) {
        const y = p.y[k] + oy;
        if (y >= 0) buf[y * PANEL_W + p.x[k]] = c;
      }
    }
  });
}

// ---- XPM, straight into JSON ----------------------------------------------------------------

const PALETTE_LINES = PALETTE.map((c, i) => SYMBOLS[i] + " c " + c);
/** The header, already escaped for a JSON string: XPM here is only [a-z.#0-9 !] and newlines. */
const xpmHead = (w: number) => ["! XPM2", w + " " + PANEL_H + " " + PALETTE.length + " 1", ...PALETTE_LINES, ""].join("\\n");
const HEAD: Record<number, string> = { [DIGIT_W]: xpmHead(DIGIT_W), [COLON_W]: xpmHead(COLON_W), [PANEL_W]: xpmHead(PANEL_W) };
// one fromCharCode over a reused array: no string per row for the garbage collector to chase
const OUT: Record<number, number[]> = {
  [DIGIT_W]: new Array(DIGIT_W * PANEL_H + (PANEL_H - 1) * 2).fill(0),
  [COLON_W]: new Array(COLON_W * PANEL_H + (PANEL_H - 1) * 2).fill(0),
  [PANEL_W]: new Array(PANEL_W * PANEL_H + (PANEL_H - 1) * 2).fill(0),
};
function xpm(buf: number[], w: number): string {
  const out = OUT[w];
  let o = 0;
  for (let y = 0; y < PANEL_H; y++) {
    if (y) { out[o++] = 92; out[o++] = 110; } // "\n", escaped
    for (let x = 0; x < w; x++) out[o++] = buf[y * w + x];
  }
  return HEAD[w] + String.fromCharCode.apply(null, out);
}
const element = (id: string, x: number, data: string) =>
  '{"id":"' + id + '","type":"xpmbitmap","x":' + x + ',"y":0,"align":"top_left","data":"' + data + '"}';

// ---- the bar --------------------------------------------------------------------------------

async function draw(body: string): Promise<void> {
  const r = await fetch(`${API}/display/draw`, { method: "POST", headers: { "Content-Type": "application/json" }, body });
  if (!r.ok) throw new Error(`draw: HTTP ${r.status}`);
}
function clear(ids?: string[]): Promise<unknown> {
  const body = ids ? { application_name: APP, element_ids: ids } : { application_name: APP };
  return fetch(`${API}/display/draw`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

async function readSettings(): Promise<Record<string, unknown> | null> {
  try {
    const r = await fetch(`${API}/apps/settings?app_id=${encodeURIComponent(APP)}`);
    if (r.ok) return ((await r.json()) as { values?: Record<string, unknown> }).values ?? null;
  } catch (e) {}
  return null;
}

/** The runtime fixes Date's time zone when the app starts; the bar's own zone is read instead,
 * so a zone change or a DST switch shows without a restart. */
let zoneS = -new Date().getTimezoneOffset() * 60;
async function readZone(): Promise<void> {
  try {
    const r = await fetch(`${API}/time/timezone`);
    const m = r.ok ? /^([+-])(\d\d):(\d\d)$/.exec(((await r.json()) as { offset?: string }).offset ?? "") : null;
    if (m) zoneS = (m[1] === "-" ? -1 : 1) * (+m[2] * 3600 + +m[3] * 60);
  } catch (e) {}
}

declare const busy: { display?: { clear?: (display: string) => void } } | undefined;
/** Some firmware keeps its "Loading..." screen under the app's elements until the app shows
 * text of its own; clearing the text hides it. */
function hideLoading(): void {
  try {
    if (typeof busy !== "undefined") busy?.display?.clear?.("both");
  } catch (e) {}
}

// ---- the clock ------------------------------------------------------------------------------

/** Settings poll, s. */
const POLL_EVERY = 10;
const STORE_KEY = "override";

/** The wheel and OK change colour and animation until the settings themselves are edited. */
interface Override { colour: number; animated: boolean; seenColour: number; seenAnimated: boolean }

function fromSettings(v: Record<string, unknown>): Look {
  const pick = <T extends readonly string[]>(list: T, value: unknown, fallback: T[number]): T[number] =>
    list.includes(value as string) ? (value as T[number]) : fallback;
  return {
    colour: Math.max(0, COLOURS.indexOf(pick(COLOURS, v.colour, "classic"))),
    hour24: v.time !== "12h",
    seconds: v.seconds !== false,
    secStyle: pick(SEC_STYLES, v.sec_anim, "quick"),
    speed: Math.max(0, SPEEDS.indexOf(pick(SPEEDS, v.speed, "medium"))),
    colon: pick(COLONS, v.colon, "blink"),
    animated: v.animation !== false,
  };
}

function main(): void {
  hideLoading();

  const look: Look = fromSettings({});
  let seen = { colour: look.colour, animated: look.animated };
  let override: Override | null = null;
  try { override = JSON.parse(localStorage.getItem(STORE_KEY) ?? "null") as Override | null; } catch (e) {}

  const applySettings = (v: Record<string, unknown>): void => {
    const s = fromSettings(v);
    if (override && override.seenColour === s.colour && override.seenAnimated === s.animated) {
      s.colour = override.colour;
      s.animated = override.animated;
    } else override = null;
    seen = { colour: fromSettings(v).colour, animated: fromSettings(v).animated };
    Object.assign(look, s);
  };

  const cols: Column[] = [];
  for (let i = 0; i < 6; i++) cols.push(newColumn());
  const bufs: number[][] = [];
  for (let i = 0; i < 6; i++) bufs.push(new Array(DIGIT_W * PANEL_H).fill(EMPTY));
  const colonBuf: number[] = new Array(COLON_W * PANEL_H).fill(EMPTY);

  let started = false, last = 0, slept = false, count = 0;
  let tried = false;
  try { tried = localStorage.getItem(TRIED_KEY) === "1"; } catch (e) {}
  let hint: "waiting" | "shown" | "ending" | "done" = tried ? "done" : "waiting";
  let hintAt = 0;
  // ids to clear once the frame being sent is on screen: with no element at all the firmware
  // brings back its "Loading..." screen, so something new is drawn before the old goes
  let clearAfter: string[] = [];
  const hintBuf: number[] = new Array(PANEL_W * PANEL_H).fill(EMPTY);
  const sent: Record<string, string> = {}; // what each element shows, by key
  let stopped = false, busy = false, timer: ReturnType<typeof setTimeout> | undefined;
  const moving = () =>
    (hint === "shown" && Date.now() - hintAt < hintDone(look)) || cols.some((c, i) => i < count && c.phase !== STILL);

  /** Advance to now and return the request body for whatever changed, or null. */
  const compute = (now: number): string | null => {
    const localS = Math.floor(now / 1000) + zoneS, ms = now % 1000;
    const day = ((localS % 86400) + 86400) % 86400;
    const h24 = (day / 3600) | 0, minute = ((day % 3600) / 60) | 0, second = day % 60;
    const hour = look.hour24 ? h24 : h24 % 12 || 12;
    // 12-hour time leaves the first column dark below 10, like a clock on a wall
    const tens = !look.hour24 && hour < 10 ? BLANK : (hour / 10) | 0;
    const want = [tens, hour % 10, (minute / 10) | 0, minute % 10, (second / 10) | 0, second % 10];
    const n = look.seconds ? 6 : 4;
    const L = LAYOUT[n];
    const els: string[] = [];

    if (n !== count) {
      // a new layout: everything is drawn again, and the elements it lacks go
      for (const k in sent) delete sent[k];
      const gone = ALL_IDS.filter((id) => (id[0] === "c" ? +id[1] >= n : +id[1] >= L.colons.length));
      if (count) clear(gone).catch(() => {});
      count = n;
    }
    // after a sleep the animation clock restarts now, or the sleep would count as fall time
    if (!started || slept) last = now;
    if (!started) {
      // the first frame assembles rather than appears, staggered so the digits do not fall in step
      started = true;
      hintAt = now + HINT_AFTER;
      for (let i = 0; i < 6; i++) {
        show(cols[i], want[i]);
        if (look.animated) { cols[i].landed = 0; cols[i].phase = BUILDING; cols[i].at = (i * pieceMs(look)) >> 1; }
      }
    }
    const delta = Math.max(0, Math.min(500, now - last));
    last = now;
    for (let i = 0; i < n; i++) {
      const col = cols[i], fast = fastColumn(look, i);
      if (!look.animated) { if (col.value !== want[i] || col.phase !== STILL) show(col, want[i]); }
      else changeTo(col, want[i], fast);
      step(look, col, fast && col.phase !== CLEARING, delta);
    }

    // the hint takes the whole panel; the clock keeps counting underneath
    if (hint === "waiting" && now >= hintAt) {
      hint = "shown";
      hintAt = now;
      clearAfter = ALL_IDS.slice(0, n).concat(L.colons.map((_, c) => "k" + c));
    }
    if (hint === "shown" && now - hintAt >= HINT_FOR) hint = "ending";
    if (hint === "shown") {
      const state = hintState(look, now - hintAt);
      const key = look.colour + JSON.stringify(state);
      if (sent.hint === key) return null;
      sent.hint = key;
      drawHint(hintBuf, look, state);
      return '{"application_name":"' + APP + '","priority":50,"elements":[' + element("hint", 0, xpm(hintBuf, PANEL_W)) + "]}";
    }
    if (hint === "ending") {
      // the whole clock goes back first, and the hint is cleared once it is there
      hint = "done";
      clearAfter = ["hint"];
      for (const k in sent) delete sent[k];
    }

    for (let i = 0; i < n; i++) {
      const col = cols[i], fast = fastColumn(look, i) && col.phase !== CLEARING;
      const key = look.colour + columnKey(look, col, fast);
      if (sent["c" + i] === key) continue;
      sent["c" + i] = key;
      drawColumn(bufs[i], look, col, fast);
      els.push(element("c" + i, L.xs[i], xpm(bufs[i], DIGIT_W)));
    }

    // with seconds ticking, a blinking colon would count the same second twice, so it holds
    const on = look.colon === "solid" || (look.colon === "blink" && (look.seconds || ms < 500));
    const colonKey = look.colour + (on ? "on" : "off");
    if (sent.k !== colonKey) {
      sent.k = colonKey;
      colonBuf.fill(EMPTY);
      if (on) {
        const c = CODES[colourOf(look, 1, false)];
        // two squares, a third of the way down and a third up, so they sit with the digits
        for (const y of [TOP + 3, TOP + 4, TOP + DIGIT_H - 5, TOP + DIGIT_H - 4]) colonBuf[y * COLON_W] = colonBuf[y * COLON_W + 1] = c;
      }
      const data = xpm(colonBuf, COLON_W);
      L.colons.forEach((x, c) => els.push(element("k" + c, x, data)));
    }
    return els.length ? '{"application_name":"' + APP + '","priority":50,"elements":[' + els.join(",") + "]}" : null;
  };

  const frame = (): void => {
    if (stopped || busy) return;
    let body: string | null = null;
    try { body = compute(Date.now()); } catch (e) {}
    slept = false;
    if (body) {
      busy = true;
      draw(body).catch(() => {}).then(() => {
        if (clearAfter.length) { clear(clearAfter).catch(() => {}); clearAfter = []; }
        busy = false;
        timer = setTimeout(frame, 0);
      });
    } else if (moving()) timer = setTimeout(frame, 15);
    else {
      // nothing moves: sleep to the next half second, when the colon or the time can change
      slept = true;
      timer = setTimeout(frame, 502 - (Date.now() % 500));
    }
  };

  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  const poll = (): void => {
    if (stopped) return;
    Promise.all([readSettings(), readZone()]).then(([v]) => {
      if (v) applySettings(v);
      if (!stopped) pollTimer = setTimeout(poll, POLL_EVERY * 1000);
    });
  };

  // localStorage rewrites the app's whole store on flash: saved once the wheel has settled
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const save = (): void => {
    clearTimeout(saveTimer);
    saveTimer = undefined;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(override)); } catch (e) {}
  };
  const remember = (): void => {
    override = { colour: look.colour, animated: look.animated, seenColour: seen.colour, seenAnimated: seen.animated };
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 3000);
  };

  // show a change at once rather than at the next half second
  const wake = (): void => {
    if (busy || stopped) return;
    clearTimeout(timer);
    timer = setTimeout(frame, 0);
  };
  const unbind = listen("input", (ev) => {
    if (stopped) return;
    if (ev.key === "encoder") {
      look.colour = (look.colour + COLOURS.length + ev.delta) % COLOURS.length;
      remember();
      if (!tried) {
        tried = true;
        try { localStorage.setItem(TRIED_KEY, "1"); } catch (e) {}
        hint = hint === "shown" ? "ending" : "done";
      }
      wake();
    } else if (ev.key === "ok" && ev.action === "short") {
      // switching the animation off lands a falling piece where it belongs
      look.animated = !look.animated;
      remember();
      wake();
    } else if (ev.key === "back" && ev.action === "short") {
      // every timer goes, or the app would stay alive behind an empty screen
      stopped = true;
      clearTimeout(timer);
      clearTimeout(pollTimer);
      if (saveTimer !== undefined) save();
      // elements outlive the app unless they are cleared
      clear().catch(() => {}).then(() => unbind());
    }
  });

  Promise.all([readSettings(), readZone()]).then(([v]) => {
    if (stopped) return;
    if (v) applySettings(v);
    frame();
    pollTimer = setTimeout(poll, POLL_EVERY * 1000);
  });
}

main();
