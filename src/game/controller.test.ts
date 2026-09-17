import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Decide } from "../jev/client.ts";
import type { DecideResult } from "../jev/types.ts";
import { GameController } from "./controller.ts";
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
});
