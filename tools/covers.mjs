// covers.mjs: tiles each digit, and the first-run hint, with tetrominoes as the native app's solver
// does (same shape table, same turning order, lowest piece first, ties left to right), and prints
// the tables src/main.ts embeds. On the bar the search takes seconds in JavaScript, so it runs here.
//
// node tools/covers.mjs          the digit table
// node tools/covers.mjs hint     the hint table: "TRY" and an arrow up to the wheel
// node tools/covers.mjs show     the hint drawn as text, to check the shapes

/** Every orientation of every tetromino: kind (I O T S Z J L), x offsets, y offsets. */
const SHAPES = [
  [0, [0, 1, 2, 3], [0, 0, 0, 0]], [0, [0, 0, 0, 0], [0, 1, 2, 3]],
  [1, [0, 1, 0, 1], [0, 0, 1, 1]],
  [2, [0, 1, 2, 1], [0, 0, 0, 1]], [2, [0, 0, 0, 1], [0, 1, 2, 1]], [2, [0, 1, 2, 1], [1, 1, 1, 0]], [2, [1, 1, 1, 0], [0, 1, 2, 1]],
  [3, [1, 2, 0, 1], [0, 0, 1, 1]], [3, [0, 0, 1, 1], [0, 1, 1, 2]],
  [4, [0, 1, 1, 2], [0, 0, 1, 1]], [4, [1, 0, 1, 0], [0, 1, 1, 2]],
  [5, [0, 0, 1, 2], [0, 1, 1, 1]], [5, [0, 1, 0, 0], [0, 0, 1, 2]], [5, [0, 1, 2, 2], [0, 0, 0, 1]], [5, [1, 1, 0, 1], [0, 1, 2, 2]],
  [6, [0, 1, 2, 0], [0, 0, 0, 1]], [6, [0, 0, 0, 1], [0, 1, 2, 2]], [6, [2, 0, 1, 2], [0, 1, 1, 1]], [6, [0, 1, 1, 1], [0, 0, 1, 2]],
];

/** The ten digits, two cells thick everywhere so a tetromino has somewhere to sit. */
const DIGITS = [
  ["######", "######", "##..##", "##..##", "##..##", "##..##", "##..##", "##..##", "##..##", "##..##", "######", "######"],
  ["####..", "####..", "..##..", "..##..", "..##..", "..##..", "..##..", "..##..", "..##..", "..##..", "######", "######"],
  ["######", "######", "....##", "....##", "....##", "######", "######", "##....", "##....", "##....", "######", "######"],
  ["######", "######", "....##", "....##", "....##", "######", "######", "....##", "....##", "....##", "######", "######"],
  ["##..##", "##..##", "##..##", "##..##", "######", "######", "....##", "....##", "....##", "....##", "....##", "....##"],
  ["######", "######", "##....", "##....", "##....", "######", "######", "....##", "....##", "....##", "######", "######"],
  ["######", "######", "##....", "##....", "##....", "##....", "######", "######", "##..##", "##..##", "######", "######"],
  ["######", "######", "....##", "....##", "....##", "....##", "....##", "....##", "....##", "....##", "....##", "....##"],
  ["######", "######", "##..##", "##..##", "##..##", "######", "######", "##..##", "##..##", "##..##", "######", "######"],
  ["######", "######", "##..##", "##..##", "######", "######", "....##", "....##", "....##", "....##", "######", "######"],
];

// The hint on the 72x16 panel: "TRY" in the digits' style, and an arrow two cells thick along the
// middle that turns up at a right angle under the wheel (around column 61, from the device's
// photo) into a stepped head at the top edge. Each part is tiled and falls on its own.
const T = ["######", "######", "..##..", "..##..", "..##..", "..##..", "..##..", "..##..", "..##..", "..##..", "..##..", "..##.."];
const R = ["######", "######", "##..##", "##..##", "######", "######", "##.##.", "##.##.", "##..##", "##..##", "##..##", "##..##"];
const Y = ["##..##", "##..##", "##..##", "##..##", "######", "######", "..##..", "..##..", "..##..", "..##..", "..##..", "..##.."];
const ARROW = [
  // columns 29..64; the head is 6 wide around the shaft at 61-62
  "................................##..",
  "...............................####.",
  "..............................######",
  "................................##..",
  "................................##..",
  "................................##..",
  "................................##..",
  "##################################..",
  "##################################..",
];
const HINT = [
  { rows: T, x: 4, y: 2 },
  { rows: R, x: 12, y: 2 },
  { rows: Y, x: 20, y: 2 },
  { rows: ARROW, x: 29, y: 0 },
];

/** Backtracking over the first uncovered cell, the shape table turned per seed and depth. */
function cover(rows, seed) {
  const w = rows[0].length, h = rows.length;
  const lit = (x, y) => x >= 0 && x < w && y >= 0 && y < h && rows[y][x] === "#";
  const filled = new Array(w * h).fill(false), out = [];
  const patchesFit = () => {
    const seen = new Array(w * h).fill(false);
    for (let i = 0; i < w * h; i++) {
      if (seen[i] || filled[i] || !lit(i % w, (i / w) | 0)) continue;
      let size = 0;
      const stack = [i];
      seen[i] = true;
      while (stack.length) {
        const j = stack.pop(), x = j % w, y = (j / w) | 0;
        size++;
        for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
          const k = ny * w + nx;
          if (lit(nx, ny) && !filled[k] && !seen[k]) { seen[k] = true; stack.push(k); }
        }
      }
      if (size % 4) return false;
    }
    return true;
  };
  const solve = () => {
    let start = -1;
    for (let i = 0; i < w * h; i++) if (lit(i % w, (i / w) | 0) && !filled[i]) { start = i; break; }
    if (start < 0) return true;
    const sx = start % w, sy = (start / w) | 0;
    const spin = (seed * 5 + out.length * 3) % SHAPES.length;
    for (let n = 0; n < SHAPES.length; n++) {
      const [kind, dx, dy] = SHAPES[(n + spin) % SHAPES.length];
      const cells = [];
      for (let k = 0; k < 4; k++) {
        const x = sx + dx[k] - dx[0], y = sy + dy[k] - dy[0];
        if (!lit(x, y) || filled[y * w + x]) break;
        cells.push([x, y]);
      }
      if (cells.length < 4) continue;
      for (const [x, y] of cells) filled[y * w + x] = true;
      out.push({ kind, cells });
      // a dead end shows early: every uncovered patch has to split into fours
      if (patchesFit() && solve()) return true;
      out.pop();
      for (const [x, y] of cells) filled[y * w + x] = false;
    }
    return false;
  };
  if (!solve()) throw new Error("cannot tile:\n" + rows.join("\n"));
  const bottom = (p) => Math.max(...p.cells.map(([, y]) => y));
  const before = (a, b) => (bottom(a) !== bottom(b) ? bottom(a) > bottom(b) : a.cells[0][0] < b.cells[0][0]);
  for (let i = 1; i < out.length; i++) {
    const p = out[i];
    let j = i - 1;
    while (j >= 0 && before(p, out[j])) { out[j + 1] = out[j]; j--; }
    out[j + 1] = p;
  }
  return out;
}

/** One string per shape: per piece its kind and four cells, each as x + stride * y in base 36. */
const encode = (pieces, stride, ox = 0, oy = 0) =>
  pieces.map((p) => p.kind + p.cells.map(([x, y]) => (x + ox + stride * (y + oy)).toString(36).padStart(2, "0")).join("")).join(" ");

const mode = process.argv[2];
if (mode === "hint" || mode === "show") {
  const parts = HINT.map((part, i) => ({ ...part, pieces: cover(part.rows, 10 + i) }));
  if (mode === "show") {
    const grid = Array.from({ length: 16 }, () => new Array(72).fill("."));
    for (const part of parts) part.pieces.forEach((p) => p.cells.forEach(([x, y]) => (grid[y + part.y][x + part.x] = "ITOSZJL"[p.kind])));
    console.log(grid.map((r) => r.join("")).join("\n"));
    console.log(parts.map((p) => p.pieces.length + " pieces").join(", "));
  } else console.log(JSON.stringify(parts.map((part) => encode(part.pieces, 72, part.x, part.y))));
} else {
  console.log(JSON.stringify(DIGITS.map((rows, d) => encode(cover(rows, d), 6))));
}
