import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Decide } from "../jev/client.ts";
import type { DecideResult } from "../jev/types.ts";
import { GameController, detectCycle } from "./controller.ts";
import type { Dir } from "./engine.ts";

const answer = (choice: Dir): DecideResult => ({
  choice,
  probabilities: { [choice]: 0.9 },
  confidence: 0.8,
  model: "jev-test",
  upstreamMs: 1,
  inputTokens: 1,
});

/** Resolves with `choice` after `delayMs`, rejects if aborted first. */
const delayed =
  (choice: Dir, delayMs: number): Decide =>
  (_game, _strategy, signal) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(answer(choice)), delayMs);
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new DOMException("aborted", "AbortError"));
      });
    });

describe("GameController", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("plays Jev's answer when it beats the deadline", async () => {
    const c = new GameController({ decide: delayed("up", 300), tickMs: 1000, seed: 1, now: Date.now });
    c.start();
    await vi.advanceTimersByTimeAsync(400);
    expect(c.getSnapshot().decision?.phase).toBe("selected");
    expect(c.getSnapshot().game.steps).toBe(0);
    await vi.advanceTimersByTimeAsync(600);
    const s = c.getSnapshot();
    expect(s.game.steps).toBe(1);
    expect(s.game.heading).toBe("up");
    expect(s.history[0]).toMatchObject({
      dir: "up",
      source: "jev",
      confidence: 0.8,
      probabilities: { up: 0.9 },
      model: "jev-test",
      error: null,
    });
    expect(s.history[0].options).toContain("up");
    expect(s.history[0].at).toBeGreaterThan(0);
    expect(s.lastModel).toBe("jev-test");
    expect(s.stats).toMatchObject({ calls: 2, answered: 1, late: 0 });
    c.dispose();
  });

  it("keeps going straight and counts a miss when Jev is late", async () => {
    const c = new GameController({ decide: delayed("up", 5000), tickMs: 1000, seed: 1, now: Date.now });
    c.start();
    await vi.advanceTimersByTimeAsync(1000);
    const s = c.getSnapshot();
    expect(s.game.heading).toBe("right");
    expect(s.history[0]).toMatchObject({ dir: "right", source: "late", probabilities: {}, model: null });
    expect(s.stats.late).toBe(1);
    c.dispose();
  });

  it("falls back on API errors and ignores answers after pause", async () => {
    const failing: Decide = () => Promise.reject(new Error("boom"));
    const c = new GameController({ decide: failing, tickMs: 1000, seed: 1, now: Date.now });
    c.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(c.getSnapshot().history[0]).toMatchObject({ source: "error", error: "boom" });
    expect(c.getSnapshot().lastError).toBe("boom");
    expect(c.getSnapshot().stats.errors).toBe(1);
    c.pause();
    const steps = c.getSnapshot().game.steps;
    await vi.advanceTimersByTimeAsync(3000);
    expect(c.getSnapshot().game.steps).toBe(steps);
    expect(c.getSnapshot().status).toBe("paused");
    c.dispose();
  });

  it("turns away from walls on its own when Jev never answers", async () => {
    const c = new GameController({ decide: delayed("right", 5000), tickMs: 100, cols: 6, rows: 6, seed: 1, now: Date.now });
    c.start();
    await vi.advanceTimersByTimeAsync(800);
    const s = c.getSnapshot();
    expect(s.game.steps).toBe(8);
    expect(s.game.alive).toBe(true);
    // Corners leave a single legal move, which is played without asking Jev.
    expect(s.stats.late + s.stats.forced).toBe(8);
    expect(s.stats.forced).toBeGreaterThan(0);
    c.dispose();
  });

  it("detects a 4-step cycle in state visits", () => {
    const visits = [
      { r: 5, c: 5, heading: "right" as const, step: 0, dir: "down" as const },
      { r: 6, c: 5, heading: "down" as const, step: 1, dir: "left" as const },
      { r: 6, c: 4, heading: "left" as const, step: 2, dir: "up" as const },
      { r: 5, c: 4, heading: "up" as const, step: 3, dir: "right" as const },
    ];
    // Now at step 4, the snake is back at (5, 5) heading "right"
    const cycle = detectCycle(visits, { r: 5, c: 5 }, "right", 4);
    expect(cycle).toEqual({
      detected: true,
      length: 4,
      repeatDir: "down",
    });
  });

  it("returns null when no repeating cycle exists", () => {
    const visits = [
      { r: 5, c: 5, heading: "right" as const, step: 0, dir: "right" as const },
      { r: 5, c: 6, heading: "right" as const, step: 1, dir: "right" as const },
    ];
    const cycle = detectCycle(visits, { r: 5, c: 7 }, "right", 2);
    expect(cycle).toBeNull();
  });

  it("breaks a repeating loop when Jev keeps picking the cycle move", async () => {
    // Sequence of moves that would form a 4-step loop if repeated:
    // Starting facing right: down -> left -> up -> right -> down (loop!)
    const loopMoves: Dir[] = ["down", "left", "up", "right", "down", "left", "up"];
    let stepCount = 0;
    const loopingDecide: Decide = () => {
      const choice = loopMoves[stepCount] ?? "down";
      stepCount++;
      return Promise.resolve(answer(choice));
    };

    const c = new GameController({
      decide: loopingDecide,
      tickMs: 100,
      cols: 16,
      rows: 16,
      seed: 1,
      now: Date.now,
    });
    c.start();

    // Advance by 5 ticks (steps 0 to 4):
    // step 0: plays down
    // step 1: plays left
    // step 2: plays up
    // step 3: plays right -> back to original cell facing right!
    // step 4: decider wants to play "down", but controller detects the 4-step cycle and breaks it!
    await vi.advanceTimersByTimeAsync(500);

    const s = c.getSnapshot();
    expect(s.stats.cyclesBroken).toBeGreaterThanOrEqual(1);
    expect(s.game.alive).toBe(true);
    c.dispose();
  });
});

