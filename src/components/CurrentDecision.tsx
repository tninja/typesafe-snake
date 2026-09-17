import type { Decision } from "../game/controller.ts";
import { describeMove } from "../jev/prompt.ts";
import { Badge, Card } from "./Card.tsx";
import { ARROW, pct } from "./StatusCard.tsx";

export function CurrentDecision({ decision }: { decision: Decision | null }) {
  const settled = decision !== null && decision.phase !== "deciding";
  const sub =
    decision?.phase === "selected"
      ? `${pct(decision.confidence)} confident · ${decision.latencyMs} ms round trip · api ${decision.upstreamMs} ms`
      : decision?.phase === "forced"
        ? decision.options.length === 0
          ? "No legal move left"
          : "Only one legal move, decided in code without an API call"
        : decision?.phase === "late"
          ? "Jev answered after the deadline"
          : decision?.phase === "error"
            ? (decision.error ?? "")
            : decision
              ? "Waiting for Jev"
              : "Facts for each legal move show up here";

  return (
    <Card
      eyebrow="CURRENT DECISION"
      title={
        decision?.phase === "forced" && decision.options.length === 0
          ? "No way out"
          : settled && decision.dir
            ? `${ARROW[decision.dir]} ${decision.dir}`
            : decision
              ? "Asking Jev"
              : "No open decision"
      }
      badge={<Badge>{decision ? `${decision.options.length} LEGAL` : "—"}</Badge>}
    >
      <p className="card-sub">{sub}</p>
      <div className="options">
        {decision?.options.map((o) => {
          const p = decision.probabilities[o.dir];
          const picked = settled && decision.dir === o.dir;
          return (
            <div key={o.dir} className={`option ${picked ? "picked" : ""} ${o.deadEnd ? "danger" : ""}`}>
              <div className="bar-row">
                <span className="bar-name">
                  {ARROW[o.dir]} {o.dir}
                </span>
                <span className="bar">
                  <i style={{ width: `${(p ?? 0) * 100}%` }} />
                </span>
                <span className="bar-value">{pct(p)}</span>
              </div>
              <div className="option-facts">{describeMove(o)}</div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
