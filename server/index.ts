import { serve } from "@hono/node-server";
import { TypeSafeClient, choice } from "@typesafe-ai/sdk";
import { Hono } from "hono";
import { analyze, heuristicMove } from "../src/game/analysis.ts";
import { DIRS, type GameState, type Point } from "../src/game/engine.ts";
import {
  buildEnsembleQuestions,
  buildRequest,
  buildSingleQuestion,
  resolveEnsembleChoice,
} from "../src/jev/prompt.ts";
import type { DecidePayload, DecideResult } from "../src/jev/types.ts";

const gatewayKey = process.env.AI_GATEWAY_API_KEY;
const typesafeKey = process.env.TYPESAFE_API_KEY;
if (!gatewayKey && !typesafeKey) {
  console.error("Set AI_GATEWAY_API_KEY (Vercel) or TYPESAFE_API_KEY (TypeSafe) in .env.");
  process.exit(1);
}

const client = new TypeSafeClient(
  gatewayKey
    ? { apiKey: gatewayKey, baseURL: "https://ai-gateway.vercel.sh/typesafe" }
    : { apiKey: typesafeKey, baseURL: process.env.TYPESAFE_BASE_URL },
);
const app = new Hono();

const isPoint = (p: unknown): p is Point =>
  typeof p === "object" && p !== null && Number.isInteger((p as Point).r) && Number.isInteger((p as Point).c);

function parseGame(body: unknown): GameState | null {
  const game = (body as DecidePayload | null)?.game;
  if (!game || !Number.isInteger(game.cols) || !Number.isInteger(game.rows)) return null;
  if (game.cols < 4 || game.cols > 40 || game.rows < 4 || game.rows > 40) return null;
  if (!Array.isArray(game.snake) || game.snake.length === 0 || !game.snake.every(isPoint)) return null;
  if (!DIRS.includes(game.heading)) return null;
  if (game.food !== null && !isPoint(game.food)) return null;
  return {
    cols: game.cols,
    rows: game.rows,
    snake: game.snake,
    heading: game.heading,
    food: game.food,
    score: 0,
    steps: 0,
    alive: true,
    won: false,
    deathReason: null,
    rngState: 0,
  };
}

app.get("/api/health", (c) => c.json({ ok: true }));

app.post("/api/decide", async (c) => {
  const body = await c.req.json().catch(() => null);
  const game = parseGame(body);
  if (!game) return c.json({ error: "invalid game state" }, 400);

  const facts = analyze(game);
  if (facts.length < 2) return c.json({ error: "fewer than two legal moves; decide in code" }, 400);

  const heuristic = heuristicMove(facts);
  if (heuristic) {
    const result: DecideResult = {
      choice: heuristic,
      probabilities: { [heuristic]: 1 },
      confidence: 1,
      model: "heuristic",
      upstreamMs: 0,
      inputTokens: 0,
    };
    return c.json(result);
  }

  const strategy = typeof body.strategy === "string" ? body.strategy.slice(0, 600) : "";
  const request = buildRequest(game, facts, strategy);
  const useEnsemble = Boolean((body as any)?.ensemble);

  const { questions, mappings } = useEnsemble
    ? buildEnsembleQuestions(request)
    : (() => {
        const single = buildSingleQuestion(request);
        return {
          questions: { move: single.question },
          mappings: { move: single.mapping },
        };
      })();

  const model = process.env.TYPESAFE_MODEL ?? (process.env.TYPESAFE_BASE_URL ? "english" : undefined);
  const started = performance.now();
  try {
    const res = await client.systemOne(
      {
        ...(model ? { model } : {}),
        state: request.state as never,
        questions: Object.fromEntries(
          Object.entries(questions).map(([qid, q]) => [qid, choice(q.instructions, q.criteria)]),
        ) as never,
      },
      // The browser aborts at the tick deadline; a retry could never land in time.
      { signal: c.req.raw.signal, timeout: 5000, retry: { maxRetries: 0 } },
    );
    const { choiceDir, probabilities, confidence } = resolveEnsembleChoice(
      res.answers as Record<string, unknown>,
      mappings,
      request.relativeToDir,
    );

    const result: DecideResult = {
      choice: choiceDir,
      probabilities,
      confidence,
      model: res.model,
      upstreamMs: Math.round(performance.now() - started),
      inputTokens: res.usage?.input_tokens ?? null,
    };
    return c.json(result);
  } catch (err) {
    if (c.req.raw.signal.aborted) return c.body(null, 499 as never);
    const message = err instanceof Error ? err.message : String(err);
    console.error("[decide]", message);
    return c.json({ error: message }, 502);
  }
});

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, () => {
  console.log(`jev-snake proxy listening on http://127.0.0.1:${port}`);
});
