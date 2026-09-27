import type { Decide } from "../jev/client.ts";
import { PRESETS } from "../jev/prompt.ts";
import { type MoveFacts, analyze, fallbackMove } from "./analysis.ts";
import { type Dir, type GameState, createGame, step } from "./engine.ts";

export type Status = "idle" | "running" | "paused" | "over";

/** How the move for one tick was chosen. */
export type Source = "jev" | "late" | "error" | "forced";

export interface CycleInfo {
  detected: boolean;
  length: number;
  repeatDir: Dir | null;
}

export interface Decision {
  phase: "deciding" | "selected" | Exclude<Source, "jev">;
  options: MoveFacts[];
  dir: Dir | null;
  probabilities: Partial<Record<Dir, number>>;
  confidence: number | null;
  model: string | null;
  latencyMs: number | null;
  upstreamMs: number | null;
  error: string | null;
  cycle?: CycleInfo | null;
}

export interface HistoryEntry {
  step: number;
  dir: Dir;
  source: Source;
  confidence: number | null;
  latencyMs: number | null;
  length: number;
  /** Wall-clock time the move was played (ms since epoch). */
  at: number;
  /** Directions Jev could pick from on this tick. */
  options: Dir[];
  probabilities: Partial<Record<Dir, number>>;
  model: string | null;
  error: string | null;
}

export interface Stats {
  calls: number;
  answered: number;
  late: number;
  errors: number;
  forced: number;
  cyclesBroken: number;
  totalLatencyMs: number;
}

export interface Snapshot {
  game: GameState;
  status: Status;
  tickMs: number;
  tickStartedAt: number;
  strategy: string;
  decision: Decision | null;
  history: HistoryEntry[];
  stats: Stats;
  best: number;
  lastModel: string | null;
  lastError: string | null;
}

export interface StateVisit {
  r: number;
  c: number;
  heading: Dir;
  step: number;
  dir?: Dir;
}

export function detectCycle(
  visits: StateVisit[],
  head: { r: number; c: number },
  heading: Dir,
  currentStep: number,
): CycleInfo | null {
  for (let i = visits.length - 1; i >= 0; i--) {
    const v = visits[i];
    if (v.r === head.r && v.c === head.c && v.heading === heading) {
      const length = currentStep - v.step;
      if (length >= 4) {
        return {
          detected: true,
          length,
          repeatDir: v.dir ?? null,
        };
      }
    }
  }
  return null;
}

const EMPTY_STATS: Stats = { calls: 0, answered: 0, late: 0, errors: 0, forced: 0, cyclesBroken: 0, totalLatencyMs: 0 };
const HISTORY_LIMIT = 60;

export interface ControllerOptions {
  decide: Decide;
  seed?: number;
  cols?: number;
  rows?: number;
  tickMs?: number;
  now?: () => number;
}

/**
 * Fixed-clock game loop. At the start of every tick Jev is asked for a move; whatever has
 * arrived when the tick ends is played, otherwise the snake keeps going straight.
 */
export class GameController {
  private snapshot: Snapshot;
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inflight: AbortController | null = null;
  private epoch = 0;
  private pending: { dir: Dir; source: Source } | null = null;
  private visits: StateVisit[] = [];
  private lastScore = 0;
  private seed: number;
  private readonly decide: Decide;
  private readonly now: () => number;
  private readonly size: { cols?: number; rows?: number };

  constructor(options: ControllerOptions) {
    this.decide = options.decide;
    this.now = options.now ?? (() => performance.now());
    this.seed = options.seed ?? Math.floor(Math.random() * 2 ** 31);
    this.size = { cols: options.cols, rows: options.rows };
    this.snapshot = {
      game: createGame({ ...this.size, seed: this.seed }),
      status: "idle",
      tickMs: options.tickMs ?? 1200,
      tickStartedAt: 0,
      strategy: PRESETS.safe,
      decision: null,
      history: [],
      stats: EMPTY_STATS,
      best: 0,
      lastModel: null,
      lastError: null,
    };
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  private set(patch: Partial<Snapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  setStrategy(strategy: string) {
    this.set({ strategy });
  }

  setTickMs(tickMs: number) {
    this.set({ tickMs });
  }

  start() {
    if (this.snapshot.status === "running") return;
    if (this.snapshot.status === "over") this.reset();
    this.set({ status: "running" });
    this.beginTick();
  }

  pause() {
    if (this.snapshot.status !== "running") return;
    this.cancelTick();
    this.set({ status: "paused", decision: null });
  }

  toggle() {
    if (this.snapshot.status === "running") this.pause();
    else this.start();
  }

  reset() {
    this.cancelTick();
    this.seed = (this.seed + 1) | 0;
    this.visits = [];
    this.lastScore = 0;
    this.set({
      game: createGame({ ...this.size, seed: this.seed }),
      status: "idle",
      decision: null,
      history: [],
      stats: EMPTY_STATS,
      lastError: null,
    });
  }

  dispose() {
    this.cancelTick();
    this.listeners.clear();
  }

  private cancelTick() {
    this.epoch++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.inflight?.abort();
    this.inflight = null;
    this.pending = null;
  }

  private beginTick() {
    const epoch = ++this.epoch;
    const { game, tickMs, strategy } = this.snapshot;
    if (game.score !== this.lastScore) {
      this.visits = [];
      this.lastScore = game.score;
    }

    const cycle = detectCycle(this.visits, game.snake[0], game.heading, game.steps);
    const cycleCells = cycle
      ? new Set(this.visits.slice(-cycle.length).map((v) => `${v.r},${v.c}`))
      : null;
    const baseOptions = analyze(game);
    const options: MoveFacts[] = baseOptions.map((o) => {
      const isRepeat = cycle ? o.dir === cycle.repeatDir : false;
      const hitsCycleCell = cycleCells ? cycleCells.has(`${o.target.r},${o.target.c}`) : false;
      return {
        ...o,
        cycleRisk: isRepeat || hitsCycleCell,
      };
    });

    const startedAt = this.now();
    const blank: Decision = {
      phase: "deciding",
      options,
      dir: null,
      probabilities: {},
      confidence: null,
      model: null,
      latencyMs: null,
      upstreamMs: null,
      error: null,
      cycle,
    };
    this.pending = null;

    if (options.length < 2) {
      // Nothing to decide: one way out, or none at all.
      const dir = options[0]?.dir ?? game.heading;
      this.pending = { dir, source: "forced" };
      this.set({ tickStartedAt: startedAt, decision: { ...blank, phase: "forced", dir } });
    } else {
      this.set({
        tickStartedAt: startedAt,
        decision: blank,
        stats: { ...this.snapshot.stats, calls: this.snapshot.stats.calls + 1 },
      });
      const controller = new AbortController();
      this.inflight = controller;
      const activeStrategy = cycle?.detected
        ? `${strategy} [CRITICAL: Snake is trapped in a repeating cycle of ${cycle.length} steps. Avoid ${cycle.repeatDir ? `move "${cycle.repeatDir}" and ` : ""}repeating the loop. Pick an alternative safe move.]`
        : strategy;
      this.decide(game, activeStrategy, controller.signal).then(
        (result) => {
          if (epoch !== this.epoch || this.pending) return;
          const legal = options.some((o) => o.dir === result.choice);
          if (!legal) return this.fail(epoch, blank, `illegal choice "${result.choice}"`);

          let choiceDir = result.choice;
          let brokenCycle = false;
          const chosenOpt = options.find((o) => o.dir === result.choice);
          const continuesCycle = cycle?.detected && (result.choice === cycle.repeatDir || chosenOpt?.cycleRisk);
          if (continuesCycle) {
            let safeAlts = options.filter((o) => !o.deadEnd && !o.cycleRisk);
            if (safeAlts.length === 0) {
              safeAlts = options.filter((o) => !o.deadEnd && o.dir !== cycle.repeatDir);
            }
            if (safeAlts.length > 0) {
              safeAlts.sort((a, b) => {
                const aFood = a.foodDelta === "closer" ? 2 : a.foodDelta === "same" ? 1 : 0;
                const bFood = b.foodDelta === "closer" ? 2 : b.foodDelta === "same" ? 1 : 0;
                if (aFood !== bFood) return bFood - aFood;
                return b.reachable - a.reachable;
              });
              choiceDir = safeAlts[0].dir;
              brokenCycle = true;
            }
          }

          const latencyMs = Math.round(this.now() - startedAt);
          this.pending = { dir: choiceDir, source: "jev" };
          this.set({
            lastModel: result.model,
            stats: brokenCycle
              ? { ...this.snapshot.stats, cyclesBroken: this.snapshot.stats.cyclesBroken + 1 }
              : this.snapshot.stats,
            decision: {
              ...blank,
              phase: "selected",
              dir: choiceDir,
              probabilities: result.probabilities,
              confidence: result.confidence,
              model: result.model,
              latencyMs,
              upstreamMs: result.upstreamMs,
            },
          });
        },
        (err: unknown) => {
          if (controller.signal.aborted) return;
          this.fail(epoch, blank, err instanceof Error ? err.message : String(err));
        },
      );
    }

    this.timer = setTimeout(() => this.endTick(epoch), tickMs);
  }

  private fail(epoch: number, blank: Decision, error: string) {
    if (epoch !== this.epoch || this.pending) return;
    const dir = fallbackMove(this.snapshot.game);
    this.pending = { dir, source: "error" };
    this.set({ lastError: error, decision: { ...blank, phase: "error", dir, error } });
  }

  private endTick(epoch: number) {
    if (epoch !== this.epoch) return;
    const { game, decision, stats, history } = this.snapshot;
    this.inflight?.abort();
    this.inflight = null;

    let played = this.pending;
    let lateBrokeCycle = false;
    if (!played) {
      let dir = fallbackMove(game);
      const cycle = decision?.cycle;
      if (cycle?.detected && dir === cycle.repeatDir) {
        const safeAlts = (decision?.options ?? []).filter((o) => !o.deadEnd && o.dir !== cycle.repeatDir);
        if (safeAlts.length > 0) {
          dir = safeAlts[0].dir;
          lateBrokeCycle = true;
        }
      }
      played = { dir, source: "late" as const };
    }

    this.visits.push({
      r: game.snake[0].r,
      c: game.snake[0].c,
      heading: game.heading,
      step: game.steps,
      dir: played.dir,
    });
    if (this.visits.length > 100) this.visits.shift();

    const latencyMs = played.source === "jev" ? (decision?.latencyMs ?? null) : null;
    const next = step(game, played.dir);
    const entry: HistoryEntry = {
      step: next.steps,
      dir: played.dir,
      source: played.source,
      confidence: played.source === "jev" ? (decision?.confidence ?? null) : null,
      latencyMs,
      length: next.snake.length,
      at: Date.now(),
      options: decision?.options.map((o) => o.dir) ?? [],
      probabilities: played.source === "jev" ? (decision?.probabilities ?? {}) : {},
      model: played.source === "jev" ? (decision?.model ?? null) : null,
      error: played.source === "error" ? (decision?.error ?? null) : null,
    };
    const over = !next.alive || next.won;
    this.set({
      game: next,
      status: over ? "over" : "running",
      best: Math.max(this.snapshot.best, next.score),
      history: [entry, ...history].slice(0, HISTORY_LIMIT),
      stats: {
        ...stats,
        answered: stats.answered + (played.source === "jev" ? 1 : 0),
        late: stats.late + (played.source === "late" ? 1 : 0),
        errors: stats.errors + (played.source === "error" ? 1 : 0),
        forced: stats.forced + (played.source === "forced" ? 1 : 0),
        cyclesBroken: stats.cyclesBroken + (lateBrokeCycle ? 1 : 0),
        totalLatencyMs: stats.totalLatencyMs + (latencyMs ?? 0),
      },
      decision:
        played.source === "late" && decision ? { ...decision, phase: "late", dir: played.dir } : decision,
    });
    if (over) {
      this.cancelTick();
      return;
    }
    this.beginTick();
  }
}
