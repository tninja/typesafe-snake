import { Board } from "./components/Board.tsx";
import { Badge, Card, type Tone } from "./components/Card.tsx";
import { CurrentDecision } from "./components/CurrentDecision.tsx";
import { DeadlineBar } from "./components/DeadlineBar.tsx";
import { DecisionFeed } from "./components/DecisionFeed.tsx";
import { StatusCard } from "./components/StatusCard.tsx";
import { StrategyBar } from "./components/StrategyBar.tsx";
import type { Status } from "./game/controller.ts";
import { useGame } from "./hooks/useGame.ts";

const pad = (n: number, width: number) => String(n).padStart(width, "0");

const SPEEDS = [
  { label: "0.5 steps/s", tickMs: 2000 },
  { label: "0.7 steps/s", tickMs: 1500 },
  { label: "0.8 steps/s", tickMs: 1200 },
  { label: "1 step/s", tickMs: 1000 },
  { label: "1.5 steps/s", tickMs: 660 },
  { label: "2 steps/s", tickMs: 500 },
  { label: "3 steps/s", tickMs: 330 },
];

const STATE_BADGE: Record<Status, { label: string; tone: Tone }> = {
  idle: { label: "READY", tone: "neutral" },
  running: { label: "AUTO", tone: "accent" },
  paused: { label: "PAUSED", tone: "warn" },
  over: { label: "GAME OVER", tone: "danger" },
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="eyebrow">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}

export function App() {
  const { controller, snapshot } = useGame();
  const { game, status, tickMs, tickStartedAt, strategy, decision, history, best } = snapshot;
  const running = status === "running";
  const highlight = running && decision && decision.phase !== "deciding" ? decision.dir : null;
  const missed = running && history[0]?.source === "late";
  const state = STATE_BADGE[status];

  return (
    <main>
      <header className="topbar">
        <div className="brand">
          <div className="eyebrow">TYPESAFE · SYSTEM ONE</div>
          <h1>jev plays snake</h1>
        </div>
        <div className="stats">
          <Stat label="SCORE" value={pad(game.score * 100, 4)} />
          <Stat label="LENGTH" value={pad(game.snake.length, 2)} />
          <Stat label="STEPS" value={pad(game.steps, 3)} />
          <Stat label="BEST" value={pad(best * 100, 4)} />
        </div>
      </header>

      <StrategyBar strategy={strategy} onChange={(text) => controller.setStrategy(text)} />

      <div className="layout">
        <Card
          eyebrow="CONTINUOUS RENDERER"
          title="Board state"
          badge={<Badge tone={state.tone} live={running}>{state.label}</Badge>}
          className="board-card"
        >
          <div className="toolbar">
            <button className="primary" disabled={running} onClick={() => controller.start()}>
              {status === "paused" ? "Resume" : status === "over" ? "Play again" : "Start"}
            </button>
            <button disabled={!running} onClick={() => controller.pause()}>
              Pause
            </button>
            <button onClick={() => controller.reset()}>Reset</button>
            <label className="speed">
              <span className="eyebrow">SPEED</span>
              <select name="speed" value={tickMs} onChange={(e) => controller.setTickMs(Number(e.target.value))}>
                {SPEEDS.map((s) => (
                  <option key={s.tickMs} value={s.tickMs}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <DeadlineBar running={running} tickStartedAt={tickStartedAt} tickMs={tickMs} missed={missed} />

          <div className="board-stage">
            <Board game={game} highlight={highlight} tickMs={tickMs} />
            {status === "over" && (
              <div className="overlay">
                <div className="eyebrow">{game.won ? "BOARD FULL" : "GAME OVER"}</div>
                <div className="overlay-title">
                  {game.won ? "jev won" : game.deathReason === "wall" ? "hit the wall" : "bit itself"}
                </div>
                <div className="overlay-sub">
                  length {game.snake.length} · {game.steps} steps · score {game.score * 100}
                </div>
                <button className="primary" onClick={() => controller.start()}>
                  Play again
                </button>
              </div>
            )}
          </div>

          <p className="footnote">
            <span>LIVE TYPESAFE API</span>
            <span>LEGAL MOVES AND FACTS ARE GENERATED IN CODE</span>
          </p>
        </Card>

        <div className="side">
          <StatusCard snapshot={snapshot} />
          <CurrentDecision decision={decision} />
          <DecisionFeed history={history} />
        </div>
      </div>
    </main>
  );
}
