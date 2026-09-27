import { describe, expect, it } from "vitest";
import { analyze } from "../game/analysis.ts";
import { createGame } from "../game/engine.ts";
import { buildRequest, turnToRelative } from "./prompt.ts";

describe("prompt", () => {
  it("maps turns to relative moves", () => {
    expect(turnToRelative("straight")).toBe("straight");
    expect(turnToRelative("left turn")).toBe("turn_left");
    expect(turnToRelative("right turn")).toBe("turn_right");
  });

  it("builds request with relative criteria and without heading in state", () => {
    const game = createGame({ cols: 10, rows: 10, seed: 1 });
    const facts = analyze(game);
    const req = buildRequest(game, facts, "Stay alive");

    // state must not contain heading to avoid lexical overlap bias in BERT
    expect(req.state).not.toHaveProperty("heading");

    // criteria must use relative move names
    const relKeys = Object.keys(req.criteria);
    for (const key of relKeys) {
      expect(["straight", "turn_left", "turn_right"]).toContain(key);
    }

    // relativeToDir maps each relative move back to the corresponding legal dir
    for (const [rel, dir] of Object.entries(req.relativeToDir)) {
      const fact = facts.find((f) => f.dir === dir);
      expect(fact).toBeDefined();
      expect(turnToRelative(fact!.turn)).toBe(rel);
    }
  });

  it("includes semantic distance descriptions in criteria", () => {
    const game = createGame({ cols: 10, rows: 10, seed: 1 });
    const facts = analyze(game);
    const req = buildRequest(game, facts, "Stay alive");
    const criteriaTexts = Object.values(req.criteria);
    expect(criteriaTexts.some((c) => c?.includes("closer to food") || c?.includes("away from food") || c?.includes("eats food now"))).toBe(true);
  });
});
