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

## Layout

- `src/game/engine.ts` – pure snake engine (seeded RNG)
- `src/game/analysis.ts` – legal moves, flood fill, dead-end detection, fallback move
- `src/game/controller.ts` – fixed-clock loop: ask Jev at tick start, play what arrived at tick end
- `src/jev/prompt.ts` – state + choice question sent to Jev, strategy presets
- `server/index.ts` – `POST /api/decide` via `@typesafe-ai/sdk`
- `src/components/` – dark dashboard UI: `Board` (canvas, interpolates the snake between ticks), `StrategyBar`, `StatusCard`, `CurrentDecision`, `DecisionFeed`

`pnpm test` runs the engine and controller tests, `pnpm typecheck` runs tsc.
