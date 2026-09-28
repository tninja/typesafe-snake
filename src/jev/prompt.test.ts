import { describe, expect, it } from "vitest";
import { analyze } from "../game/analysis.ts";
import { createGame } from "../game/engine.ts";
import {
  buildEnsembleQuestions,
  buildRequest,
  buildSingleQuestion,
  resolveEnsembleChoice,
  turnToRelative,
} from "./prompt.ts";

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

  it("builds permutation questions with neutral keys and resolves ensemble choice", () => {
    const game = createGame({ cols: 10, rows: 10, seed: 1 });
    const facts = analyze(game);
    const req = buildRequest(game, facts, "Greedy");
    const { questions, mappings } = buildEnsembleQuestions(req, true);

    const qKeys = Object.keys(questions);
    const numMoves = Object.keys(req.criteria).length;
    // For 3 moves, there are 3! = 6 permutations
    const expectedPerms = numMoves === 3 ? 6 : 2;
    expect(qKeys).toHaveLength(expectedPerms);

    // Each permutation uses neutral option keys: option_1, option_2, ...
    for (const qid of qKeys) {
      const q = questions[qid];
      expect(Object.keys(q.criteria)).toEqual(numMoves === 3 ? ["option_1", "option_2", "option_3"] : ["option_1", "option_2"]);
      expect(Object.keys(mappings[qid])).toEqual(Object.keys(q.criteria));
    }

    // Simulate answers favoring straight
    const answers: Record<string, unknown> = {};
    for (const qid of qKeys) {
      const map = mappings[qid];
      const straightKey = Object.entries(map).find(([, rel]) => rel === "straight")?.[0] ?? "option_1";
      answers[qid] = {
        choice: straightKey,
        probabilities: { [straightKey]: 0.6 },
        confidence: 0.2,
      };
    }

    const resolution = resolveEnsembleChoice(answers, mappings, req.relativeToDir);
    expect(resolution.choiceRel).toBe("straight");
    expect(resolution.choiceDir).toBe(req.relativeToDir.straight);
    expect(resolution.probabilities[req.relativeToDir.straight]).toBe(0.6);
  });

  it("builds a single question with neutral keys and resolves choice cleanly", () => {
    const game = createGame({ cols: 10, rows: 10, seed: 1 });
    const facts = analyze(game);
    const req = buildRequest(game, facts, "Greedy");
    const { question, mapping } = buildSingleQuestion(req, true);

    const numMoves = Object.keys(req.criteria).length;
    expect(Object.keys(question.criteria)).toEqual(
      numMoves === 3 ? ["option_1", "option_2", "option_3"] : ["option_1", "option_2"],
    );
    expect(Object.keys(mapping)).toEqual(Object.keys(question.criteria));

    const straightKey = Object.entries(mapping).find(([, rel]) => rel === "straight")?.[0] ?? "option_1";
    const answers = {
      move: {
        choice: straightKey,
        probabilities: { [straightKey]: 0.7 },
        confidence: 0.4,
      },
    };

    const resolution = resolveEnsembleChoice(answers, { move: mapping }, req.relativeToDir);
    expect(resolution.choiceRel).toBe("straight");
    expect(resolution.choiceDir).toBe(req.relativeToDir.straight);
    expect(resolution.probabilities[req.relativeToDir.straight]).toBe(0.7);
    expect(resolution.confidence).toBe(0.4);
  });
});

