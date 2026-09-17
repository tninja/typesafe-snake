import type { ReactNode } from "react";

export type Tone = "neutral" | "accent" | "ok" | "warn" | "danger";

export function Badge({ tone = "neutral", live = false, children }: { tone?: Tone; live?: boolean; children: ReactNode }) {
  return <span className={`badge ${tone} ${live ? "live" : ""}`}>{children}</span>;
}

interface Props {
  eyebrow: string;
  title: ReactNode;
  badge?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function Card({ eyebrow, title, badge, className = "", children }: Props) {
  return (
    <section className={`card ${className}`}>
      <header className="card-head">
        <div>
          <div className="eyebrow">{eyebrow}</div>
          <h2>{title}</h2>
        </div>
        {badge}
      </header>
      {children}
    </section>
  );
}
