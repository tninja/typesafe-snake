# jev plays snake

TypeSafe's Jev (a System One decision model, not an LLM) plays Snake in real time.
Code generates the legal moves and exact facts about each one (food distance, reachable
cells via flood fill, dead ends); Jev picks one with a single `choice` question per step.
If the answer misses the tick deadline, the snake just keeps going straight.

## Run

```sh
cp .env.example .env   # set AI_GATEWAY_API_KEY to your Vercel AI Gateway key
pnpm install
pnpm dev               # web http://localhost:5188, proxy http://127.0.0.1:8787
```

Create an AI Gateway key in [Vercel](https://vercel.com/~/ai/api-keys), then put it
in `.env` as `AI_GATEWAY_API_KEY=...`. The proxy sends the existing TypeSafe SDK
requests to Vercel's TypeSafe-compatible endpoint. A Vercel key cannot be used
as `TYPESAFE_API_KEY`. If you have a direct TypeSafe key instead, set
`TYPESAFE_API_KEY=...` in `.env`; the Vercel key takes precedence when both are set.

Keep `.env` private. The API key lives only in the Hono proxy (`server/index.ts`);
the browser calls `/api/decide`. Live Jev requests can incur charges on your
Vercel account while the game is running.

### Local Laya

With a TypeSafe-compatible Laya server running at `http://127.0.0.1:8000`,
set these values in `.env` and restart `pnpm dev`:

```dotenv
AI_GATEWAY_API_KEY=
TYPESAFE_API_KEY=local
TYPESAFE_BASE_URL=http://127.0.0.1:8000
```

The prompt puts the player strategy first and uses compact move facts so the
built-in strategies fit Laya's shared 192-token instruction/option budget.
Keep custom strategies short: long instructions can still be truncated by Laya.
The dashboard retains the full move explanations. Fitting the prompt prevents
lost instructions; it does not guarantee that the model chooses the best move.

## Local Laya integration tests

Run `pnpm test:laya --dry-run` to inspect 20 hand-labelled boards, then
`pnpm test:laya` with your local Laya server running. This integration suite calls the real Laya server directly
for all option permutations (104 requests), recording accuracy, order sensitivity,
latency, and errors in `eval-results/`. See the [evaluation guide](docs/laya-evaluation.md)
for setup, report interpretation, and limitations. Wrong answers or request errors
produce exit code 1. This does not change gameplay. `pnpm test` runs offline unit tests only.

## Layout

- `src/game/engine.ts` – pure snake engine (seeded RNG)
- `src/game/analysis.ts` – legal moves, flood fill, dead-end detection, fallback move
- `src/game/controller.ts` – fixed-clock loop: ask Jev at tick start, play what arrived at tick end
- `src/jev/prompt.ts` – state + choice question sent to Jev, strategy presets
- `server/index.ts` – `POST /api/decide` via `@typesafe-ai/sdk`
- `src/components/` – dark dashboard UI: `Board` (canvas, interpolates the snake between ticks), `StrategyBar`, `StatusCard`, `CurrentDecision`, `DecisionFeed`

`pnpm test` runs the engine and controller tests, `pnpm typecheck` runs tsc.
