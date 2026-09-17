import { describe, expect, it } from "vitest";
import { analyze, analyzeMove, fallbackMove, floodFill, legalMoves } from "./analysis.ts";
import { type GameState, createGame, isFatal, step } from "./engine.ts";

/** Build a state from ASCII rows: H head, digits 1-9 body order, F food. */
function fromAscii(rows: string[], heading: GameState["heading"]): GameState {
  const cells: { order: number; r: number; c: number }[] = [];
  let food: GameState["food"] = null;
  rows.forEach((row, r) =>
    [...row].forEach((ch, c) => {
      if (ch === "H") cells.push({ order: 0, r, c });
      else if (/[1-9a-z]/.test(ch)) cells.push({ order: parseInt(ch, 36), r, c });
      else if (ch === "F") food = { r, c };
    }),
  );
  cells.sort((a, b) => a.order - b.order);
  return {
    ...createGame({ cols: rows[0].length, rows: rows.length }),
    snake: cells.map(({ r, c }) => ({ r, c })),
    heading,
    food,
  };
}

describe("engine", () => {
  it("creates a snake heading right with food off the body", () => {
    const g = createGame({ cols: 10, rows: 10, seed: 7 });
    expect(g.snake).toHaveLength(3);
    expect(g.snake[0]).toEqual({ r: 5, c: 5 });
    expect(g.food).not.toBeNull();
    expect(g.snake.some((p) => p.r === g.food!.r && p.c === g.food!.c)).toBe(false);
  });

  it("is deterministic for a given seed", () => {
    expect(createGame({ seed: 42 }).food).toEqual(createGame({ seed: 42 }).food);
  });

  it("moves without growing", () => {
    const g = fromAscii([".....", ".21H.", "....."], "right");
    const n = step(g, "up");
    expect(n.snake).toEqual([{ r: 0, c: 3 }, { r: 1, c: 3 }, { r: 1, c: 2 }]);
    expect(n.steps).toBe(1);
    expect(n.alive).toBe(true);
  });

  it("grows and respawns food when eating", () => {
    const g = fromAscii([".....", ".21HF", "....."], "right");
    const n = step(g, "right");
    expect(n.snake).toHaveLength(4);
    expect(n.score).toBe(1);
    expect(n.food).not.toBeNull();
    expect(n.snake.some((p) => p.r === n.food!.r && p.c === n.food!.c)).toBe(false);
  });

  it("ignores a 180° turn", () => {
    const g = fromAscii([".....", ".21H.", "....."], "right");
    const n = step(g, "left");
    expect(n.alive).toBe(true);
    expect(n.heading).toBe("right");
    expect(n.snake[0]).toEqual({ r: 1, c: 4 });
  });

  it("dies on walls", () => {
    const g = fromAscii(["..21H"], "right");
    const n = step(g, "right");
    expect(n.alive).toBe(false);
    expect(n.deathReason).toBe("wall");
  });

  it("dies on its body but may step into the vacating tail cell", () => {
    // Head at (1,1) heading left; the tail sits directly above it.
    const loop = fromAscii(["432", "H1."], "left");
    expect(isFatal(loop, "up")).toBe(null);
    expect(step(loop, "up").alive).toBe(true);

    const longer = fromAscii(["4325", "H1.."], "left");
    expect(isFatal(longer, "up")).toBe("body");
    expect(step(longer, "up").deathReason).toBe("body");
  });

  it("wins when the board is full", () => {
    const g = fromAscii(["21", "FH"], "down");
    const n = step(g, "left");
    expect(n.won).toBe(true);
    expect(n.food).toBeNull();
  });
});

describe("analysis", () => {
  it("lists only survivable, non-reversing moves", () => {
    const g = fromAscii(["..21H"], "right");
    expect(legalMoves(g)).toEqual([]);
    const corner = fromAscii(["21H", "..."], "right");
    expect(legalMoves(corner)).toEqual(["down"]);
  });

  it("counts reachable cells with flood fill", () => {
    // 3x2 grid, column 1 is a wall; the start cell (the head) is blocked too.
    expect(floodFill({ r: 0, c: 0 }, new Set([0, 1, 4]), 3, 2).size).toBe(1);
    expect(floodFill({ r: 0, c: 0 }, new Set([0, 4]), 3, 2).size).toBe(4);
  });

  it("flags a pocket smaller than the snake as a dead end", () => {
    const g = fromAscii(["..789.", "..6...", "..5...", "H.4...", "123..."], "up");
    // The body walls off the two left columns: 6 free cells for a length-10 snake, tail out of reach.
    const up = analyzeMove(g, "up");
    expect(up.reachable).toBe(6);
    expect(up.canReachTail).toBe(false);
    expect(up.deadEnd).toBe(true);

    // Same pocket, but the tail borders it: the snake can follow its tail out.
    const open = fromAscii(["..7...", "..6...", "..5...", "H.4...", "123..."], "up");
    expect(analyzeMove(open, "up").deadEnd).toBe(false);
  });

  it("reports food distance and eating", () => {
    const g = fromAscii([".....", ".21HF", "....."], "right");
    const facts = analyze(g);
    const right = facts.find((f) => f.dir === "right")!;
    expect(right.eats).toBe(true);
    expect(right.foodDistance).toBe(0);
    expect(facts.find((f) => f.dir === "up")!.foodDistance).toBe(2);
    expect(right.turn).toBe("straight");
    expect(facts.find((f) => f.dir === "up")!.turn).toBe("left turn");
  });

  it("falls back to straight, then to any legal move", () => {
    expect(fallbackMove(fromAscii([".....", ".21H.", "....."], "right"))).toBe("right");
    expect(fallbackMove(fromAscii(["21H", "..."], "right"))).toBe("down");
  });
});
