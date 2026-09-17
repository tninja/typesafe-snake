import { useEffect, useRef } from "react";

interface Props {
  running: boolean;
  tickStartedAt: number;
  tickMs: number;
  /** The previous tick ended without an answer from Jev. */
  missed: boolean;
}

/** Counts down to the next step. Animated outside React so it stays smooth. */
export function DeadlineBar({ running, tickStartedAt, tickMs, missed }: Props) {
  const fill = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const paint = (left: number) => {
      const ratio = left / tickMs;
      if (fill.current) {
        fill.current.style.width = `${ratio * 100}%`;
        fill.current.dataset.level = ratio < 0.12 ? "danger" : ratio < 0.3 ? "warn" : "ok";
      }
      if (label.current) label.current.textContent = `${(left / 1000).toFixed(1)}s`;
    };
    if (!running) {
      paint(tickMs);
      return;
    }
    let frame = 0;
    const loop = () => {
      paint(Math.max(0, tickMs - (performance.now() - tickStartedAt)));
      frame = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(frame);
  }, [running, tickStartedAt, tickMs]);

  return (
    <div className={`deadline ${missed ? "missed" : ""}`}>
      <div className="deadline-row">
        <span className="eyebrow">DECISION DEADLINE</span>
        <span className="deadline-left">
          {missed && <em>missed · </em>}
          <span ref={label} />
        </span>
      </div>
      <div className="deadline-track">
        <div className="deadline-fill" ref={fill} />
      </div>
    </div>
  );
}
