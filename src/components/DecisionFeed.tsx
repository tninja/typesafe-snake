import type { HistoryEntry, Source } from "../game/controller.ts";
import { Badge, Card, type Tone } from "./Card.tsx";
import { ARROW, pct } from "./StatusCard.tsx";

const BADGE: Record<Source, { label: string; tone: Tone }> = {
  jev: { label: "APPLIED", tone: "ok" },
  forced: { label: "FORCED", tone: "neutral" },
  late: { label: "LATE", tone: "warn" },
  error: { label: "ERROR", tone: "danger" },
};

const clock = (at: number) => new Date(at).toLocaleTimeString("en-GB", { hour12: false });

function describe(e: HistoryEntry) {
  switch (e.source) {
    case "jev":
      return `${pct(e.confidence)} confident · ${e.latencyMs} ms · ${e.model ?? "jev"}`;
    case "forced":
      return e.options.length === 0
        ? "No legal move left, the snake ran into something."
        : "Only one legal move, decided in code without an API call.";
    case "late":
      return "No answer before the deadline, kept going straight.";
    case "error":
      return e.error ?? "API call failed, used the fallback move.";
  }
}

export function DecisionFeed({ history }: { history: HistoryEntry[] }) {
  return (
    <Card
      eyebrow="DECISION FEED"
      title="Applied, forced, and late"
      badge={<Badge tone="accent">{history.length} EVENTS</Badge>}
      className="feed-card"
    >
      <div className="feed">
        {history.length === 0 && <p className="card-sub">Every step Jev plays is logged here.</p>}
        {history.map((e) => (
          <article key={e.step} className={`event ${e.source}`}>
            <div className="event-head">
              <span className="event-time">
                {clock(e.at)} · step {e.step}
              </span>
              <Badge tone={BADGE[e.source].tone}>{BADGE[e.source].label}</Badge>
            </div>
            <div className="event-title">
              {ARROW[e.dir]} {e.source === "jev" ? "applied" : e.source === "forced" ? "forced" : "fallback"} → {e.dir}
            </div>
            <div className="event-sub">{describe(e)}</div>
            {e.source === "jev" &&
              e.options.map((dir) => (
                <div key={dir} className={`bar-row small ${dir === e.dir ? "picked" : ""}`}>
                  <span className="bar-name">{dir}</span>
                  <span className="bar">
                    <i style={{ width: `${(e.probabilities[dir] ?? 0) * 100}%` }} />
                  </span>
                  <span className="bar-value">{pct(e.probabilities[dir] ?? 0)}</span>
                </div>
              ))}
          </article>
        ))}
      </div>
    </Card>
  );
}
