import { useEffect, useRef, useState } from "react";
import { PRESETS } from "../jev/prompt.ts";

interface Props {
  strategy: string;
  onChange: (strategy: string) => void;
}

/** One line of strategy text; click it to edit. */
export function StrategyBar({ strategy, onChange }: Props) {
  const [editing, setEditing] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing || !input.current) return;
    input.current.focus();
    input.current.setSelectionRange(input.current.value.length, input.current.value.length);
  }, [editing]);

  return (
    <section className={`strategy ${editing ? "editing" : ""}`}>
      <div className="strategy-main">
        <span className="eyebrow">CURRENT STRATEGY</span>
        {editing ? (
          <textarea
            ref={input}
            name="strategy"
            value={strategy}
            spellCheck={false}
            rows={3}
            onChange={(e) => onChange(e.target.value)}
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => {
              if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) setEditing(false);
            }}
          />
        ) : (
          <button className="strategy-text" title="Click to edit" onClick={() => setEditing(true)}>
            {strategy.trim() || "No strategy. Click to write one."}
            <span className="strategy-edit">edit</span>
          </button>
        )}
      </div>
      <div className="chips">
        {Object.entries(PRESETS).map(([name, text]) => (
          <button
            key={name}
            className={`chip ${strategy === text ? "active" : ""}`}
            // Keep the textarea from blurring (and collapsing) before the click lands.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onChange(text)}
          >
            {name}
          </button>
        ))}
      </div>
    </section>
  );
}
