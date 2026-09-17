import type { Dir, Point } from "../game/engine.ts";

/** Body of POST /api/decide. The server rebuilds legal moves and facts itself. */
export interface DecidePayload {
  game: {
    cols: number;
    rows: number;
    snake: Point[];
    heading: Dir;
    food: Point | null;
  };
  strategy: string;
}

export interface DecideResult {
  choice: Dir;
  probabilities: Partial<Record<Dir, number>>;
  confidence: number;
  model: string;
  /** Round trip to the TypeSafe API as measured on the server. */
  upstreamMs: number;
  inputTokens: number | null;
}

export interface DecideError {
  error: string;
}
