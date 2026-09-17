import type { Decision, Snapshot } from "../game/controller.ts";
import type { GameState } from "../game/engine.ts";
import { Badge, Card, type Tone } from "./Card.tsx";

export const ARROW = { up: "↑", down: "↓", left: "←", right: "→" } as const;

export const pct = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(n * 100)}%`);

function headline(decision: Decision | null, status: Snapshot["status"], game: GameState): { title: string; badge: string; tone: Tone; live?: boolean } {
  if (status === "over") {
    if (game.won) return { title: "Board full, Jev won", badge: "WON", tone: "ok" };
    return { title: game.deathReason === "wall" ? "Hit the wall" : "Bit itself", badge: "GAME OVER", tone: "danger" };
  }
  if (status === "paused") return { title: "Paused", badge: "PAUSED", tone: "neutral" };
  if (!decision) return { title: "Waiting for start", badge: "IDLE", tone: "neutral" };
  switch (decision.phase) {
    case "deciding":
      return { title: `Choosing from ${decision.options.length} legal moves`, badge: "DECIDING", tone: "accent", live: true };
    case "selected":
      return { title: `Move selected ${ARROW[decision.dir!]} ${decision.dir}`, badge: "SELECTED", tone: "ok" };
    case "forced":
      return { title: decision.options.length === 0 ? "No way out" : `Only legal move ${ARROW[decision.dir!]}`, badge: "FORCED", tone: "neutral" };
    case "late":
      return { title: "Deadline missed, kept going", badge: "LATE", tone: "warn" };
    case "error":
      return { title: "API error, fell back", badge: "ERROR", tone: "danger" };
  }
}

function Row({ label, value, tone }: { label: string; value: string; tone?: Tone }) {
  return (
    <div className="kv">
      <span>{label}</span>
      <strong className={tone ?? ""} title={value}>
        {value}
      </strong>
    </div>
  );
}

export function StatusCard({ snapshot }: { snapshot: Snapshot }) {
  const { game, status, tickMs, decision, stats, lastModel, lastError } = snapshot;
  const h = headline(decision, status, game);
  const avg = stats.answered > 0 ? `${Math.round(stats.totalLatencyMs / stats.answered)} ms` : "—";
  const cadence = 1000 / tickMs;

  return (
    <Card
      eyebrow="LIVE CHOICE STATUS"
      title={h.title}
      badge={
        <Badge tone={h.tone} live={h.live}>
          {h.badge}
        </Badge>
      }
    >
      <div className="kv-list">
        <Row label="Request cadence" value={`≤ ${cadence >= 1 ? cadence.toFixed(1) : cadence.toFixed(2)} / sec`} />
        <Row label="Calls" value={String(stats.calls)} />
        <Row label="Avg round trip" value={avg} />
        <Row label="Late decisions" value={String(stats.late)} tone={stats.late > 0 ? "warn" : undefined} />
        <Row label="Forced moves" value={String(stats.forced)} />
        <Row label="API errors" value={String(stats.errors)} tone={stats.errors > 0 ? "danger" : undefined} />
        <Row label="Last model" value={lastModel ?? "—"} />
        <Row label="Last API error" value={lastError ?? "none"} tone={lastError ? "danger" : undefined} />
      </div>
    </Card>
  );
}
