import { describe, expect, it, vi } from "vitest";
import { analyze } from "../src/game/analysis.ts";
import { DIRS, inBounds, samePoint } from "../src/game/engine.ts";
import { buildTrials, evaluateTrial, makeCases, summarize } from "./laya-eval.ts";

describe("hand-labelled Snake fixtures", () => {
  it("provides 20 valid, non-forced boards with a unique safe food-seeking answer", () => {
    const cases = makeCases();
    expect(cases).toHaveLength(20);
    expect(new Set(cases.map((c) => c.id)).size).toBe(20);
    for (const { game, expectedDir } of cases) {
      expect(game.snake.every((p) => inBounds(p, game.cols, game.rows))).toBe(true);
      expect(game.snake.some((p) => samePoint(p, game.food!))).toBe(false);
      expect(new Set(game.snake.map((p) => `${p.r},${p.c}`)).size).toBe(game.snake.length);
      const facts = analyze(game);
      expect(facts.length).toBeGreaterThanOrEqual(2);
      expect(facts.every((f) => !f.deadEnd && f.canReachTail)).toBe(true);
      const best = facts.find((f) => f.dir === expectedDir)!;
      expect(best).toBeDefined();
      expect(facts.filter((f) => f !== best).every((f) => f.foodDistance! > best.foodDistance!)).toBe(true);
      if (!best.eats) expect(new Set(facts.map((f) => f.reachable)).size).toBe(1);
    }
    for (const dir of DIRS) expect(cases.filter((c) => c.expectedDir === dir)).toHaveLength(5);
  });

  it("balances the correct option across positions and keeps the answer out of the wire payload", () => {
    const trials = buildTrials();
    expect(trials).toHaveLength(104);
    for (const c of makeCases()) {
      const variants = trials.filter((t) => t.caseId === c.id);
      const first = variants[0];
      const counts = first.order.map((_, i) => variants.filter((t) => t.order[i] === t.expectedChoice).length);
      expect(new Set(counts).size).toBe(1);
      for (const t of variants) {
        expect(Object.keys(t.payload).sort()).toEqual(["model", "questions", "state"]);
        expect(Object.keys(t.payload.questions.move.criteria)).toEqual(t.order);
        expect(t.relativeToDir[t.expectedChoice]).toBe(c.expectedDir);
        expect(t.payload.state).toEqual(first.payload.state);
        expect(t.payload.questions.move.instructions).toEqual(first.payload.questions.move.instructions);
      }
    }
    expect(buildTrials(2)).toHaveLength(208);
    expect(() => buildTrials(0)).toThrow();
  });
});

describe("direct inference and scoring", () => {
  const trial = buildTrials()[0];
  const response = (choice: string) => new Response(JSON.stringify({
    model: "laya-rl-agent", answers: { move: { type: "choice", choice, confidence: 0.01 } },
  }));

  it("sends a real model request even for adjacent food, and scores the returned choice", async () => {
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(response(trial.expectedChoice));
    const result = await evaluateTrial(trial, "http://localhost:8000/v1/systemone", "secret", mockFetch);
    expect(mockFetch).toHaveBeenCalledOnce();
    expect(JSON.parse(mockFetch.mock.calls[0][1]!.body as string)).toEqual(trial.payload);
    expect(result.status).toBe("correct");
    expect(result.choice).toBe(trial.expectedChoice);
    expect(JSON.stringify(result)).not.toContain("secret");
    const wrong = trial.order.find((key) => key !== trial.expectedChoice)!;
    expect((await evaluateTrial(trial, "http://localhost", "", async () => response(wrong))).status).toBe("wrong");
  });

  it.each([
    ["http", async () => new Response("upstream failed", { status: 500 })],
    ["invalid-response", async () => new Response("not json")],
    ["invalid-response", async () => response("not-an-option")],
    ["invalid-response", async () => new Response(JSON.stringify({ answers: {} }))],
    ["network", async () => { throw new Error("connection refused"); }],
  ] as const)("records %s failures separately from model mistakes", async (kind, mockFetch) => {
    const result = await evaluateTrial(trial, "http://localhost", "", mockFetch);
    expect(result.status).toBe("error");
    expect(result.errorKind).toBe(kind);
    expect(result.choice).toBeUndefined();
  });

  it("detects order sensitivity and reports errors without inflating accuracy", async () => {
    const variants = buildTrials().filter((t) => t.caseId === trial.caseId);
    // Deliberately biased model: always pick the first option.
    const results = await Promise.all(variants.map((t) => evaluateTrial(t, "http://localhost", "",
      async () => response(t.order[0]))));
    const summary = summarize(results);
    expect(summary.correct).toBe(2);
    expect(summary.valid).toBe(6);
    expect(summary.orderSensitivity).toEqual({ comparableGroups: 1, changedGroups: 1 });
    expect(summary.accuracyAmongValid).toBeCloseTo(1 / 3);
    const error = await evaluateTrial(trial, "http://localhost", "", async () => new Response("bad", { status: 500 }));
    const partial = summarize([...results.slice(0, 5), error]);
    expect(partial.errors).toBe(1);
    expect(partial.orderSensitivity.comparableGroups).toBe(0);
    expect(summarize([error]).accuracyAmongValid).toBeNull();
    expect(summarize([]).endToEndAccuracy).toBeNull();
  });

  it("supports neutralKeys to map criteria to opaque labels and decode response", async () => {
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({
        model: "laya-rl-agent",
        answers: {
          move: {
            type: "choice",
            choice: "option_2",
            probabilities: { option_1: 0.2, option_2: 0.6, option_3: 0.2 },
          },
        },
      })),
    );
    const result = await evaluateTrial(trial, "http://localhost", "", mockFetch, { neutralKeys: true });
    expect(mockFetch).toHaveBeenCalledOnce();
    const sentBody = JSON.parse(mockFetch.mock.calls[0][1]!.body as string);
    expect(Object.keys(sentBody.questions.move.criteria)).toEqual(["option_1", "option_2", "option_3"]);
    expect(result.choice).toBe(trial.order[1]);
    expect(result.probabilities?.[trial.order[1]]).toBe(0.6);
  });

  it("calculates ensemble accuracy by averaging probabilities across permutations", async () => {
    const variants = buildTrials().filter((t) => t.caseId === trial.caseId);
    // Across 6 permutations, return probabilities that favor the expected choice
    const results = await Promise.all(variants.map((t) => evaluateTrial(t, "http://localhost", "",
      async () => new Response(JSON.stringify({
        model: "laya-rl-agent",
        answers: {
          move: {
            type: "choice",
            choice: t.expectedChoice,
            probabilities: { [t.expectedChoice]: 0.5, [t.order.find((o) => o !== t.expectedChoice)!]: 0.25 },
          },
        },
      })))));
    const summary = summarize(results);
    expect(summary.ensemble.total).toBe(1);
    expect(summary.ensemble.correct).toBe(1);
    expect(summary.ensemble.accuracy).toBe(1);
    expect(summary.ensemble.cases[0].choice).toBe(trial.expectedChoice);
  });
});

