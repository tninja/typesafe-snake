import { useEffect, useRef, useState } from "react";
import { DELTA, type Dir, type GameState, type Point, samePoint } from "../game/engine.ts";

const MAX_CELL = 44;
const MIN_CELL = 14;

type Rgb = [number, number, number];

const COLORS = {
  bg: "#060c18",
  grid: "rgba(125, 165, 225, 0.07)",
  head: [165, 243, 252] as Rgb,
  neck: [45, 212, 191] as Rgb,
  tail: [13, 116, 144] as Rgb,
  deadHead: [148, 163, 184] as Rgb,
  deadNeck: [100, 116, 139] as Rgb,
  deadTail: [51, 65, 85] as Rgb,
  food: "#fb7185",
  pick: "#67e8f9",
  eye: "#04121c",
};

const rgb = (c: Rgb) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;

const mix = (a: Rgb, b: Rgb, t: number) =>
  `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)}, ${Math.round(a[1] + (b[1] - a[1]) * t)}, ${Math.round(a[2] + (b[2] - a[2]) * t)})`;

const lerp = (a: Point, b: Point, t: number): Point => ({ r: a.r + (b.r - a.r) * t, c: a.c + (b.c - a.c) * t });

interface Motion {
  /** Snake before the step that produced the current state. */
  from: Point[];
  startedAt: number;
}

/**
 * Centre line of the snake, head first, `t` of the way through the last step:
 * the head slides into its new cell while the tail slides out of its old one.
 */
function bodyPath(snake: Point[], motion: Motion | null, t: number): Point[] {
  if (!motion || t >= 1 || snake.length < 2) return snake;
  const path = [lerp(snake[1], snake[0], t), ...snake.slice(1)];
  const grew = snake.length > motion.from.length;
  if (!grew) path.push(lerp(motion.from[motion.from.length - 1], snake[snake.length - 1], t));
  return path;
}

interface Props {
  game: GameState;
  highlight: Dir | null;
  tickMs: number;
}

export function Board({ game, highlight, tickMs }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [cell, setCell] = useState(28);

  // Latest props for the animation loop, which outlives individual renders.
  const live = useRef({ game, highlight, tickMs, cell });
  const motion = useRef<Motion | null>(null);

  const previous = live.current.game;
  if (previous !== game) {
    const stepped =
      game.alive &&
      game.steps === previous.steps + 1 &&
      game.snake.length > 1 &&
      samePoint(game.snake[1], previous.snake[0]);
    motion.current = stepped ? { from: previous.snake, startedAt: performance.now() } : null;
  }
  live.current = { game, highlight, tickMs, cell };

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const fit = () => setCell(Math.max(MIN_CELL, Math.min(MAX_CELL, Math.floor(el.clientWidth / game.cols))));
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [game.cols]);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    let frame = 0;

    const draw = (now: number) => {
      const { game, highlight, tickMs, cell } = live.current;
      const width = game.cols * cell;
      const height = game.rows * cell;
      const dpr = window.devicePixelRatio || 1;
      if (el.width !== width * dpr || el.height !== height * dpr) {
        el.width = width * dpr;
        el.height = height * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const centre = (p: Point): [number, number] => [(p.c + 0.5) * cell, (p.r + 0.5) * cell];

      ctx.fillStyle = COLORS.bg;
      ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = COLORS.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let c = 1; c < game.cols; c++) {
        ctx.moveTo(c * cell + 0.5, 0);
        ctx.lineTo(c * cell + 0.5, height);
      }
      for (let r = 1; r < game.rows; r++) {
        ctx.moveTo(0, r * cell + 0.5);
        ctx.lineTo(width, r * cell + 0.5);
      }
      ctx.stroke();

      if (game.food) {
        const [x, y] = centre(game.food);
        const pulse = 1 + 0.1 * Math.sin(now / 260);
        ctx.save();
        ctx.shadowColor = COLORS.food;
        ctx.shadowBlur = cell * 0.7;
        ctx.fillStyle = COLORS.food;
        ctx.beginPath();
        ctx.arc(x, y, cell * 0.24 * pulse, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Outline the cell Jev just picked.
      if (highlight && game.alive) {
        const d = DELTA[highlight];
        const head = game.snake[0];
        ctx.save();
        ctx.strokeStyle = COLORS.pick;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.lineDashOffset = -now / 60;
        ctx.beginPath();
        ctx.roundRect((head.c + d.c) * cell + 3, (head.r + d.r) * cell + 3, cell - 6, cell - 6, 6);
        ctx.stroke();
        ctx.restore();
      }

      const dead = !game.alive;
      const t = motion.current ? (now - motion.current.startedAt) / Math.max(1, tickMs) : 1;
      const path = bodyPath(game.snake, motion.current, Math.max(0, t));
      const [headColor, neckColor, tailColor] = dead
        ? [COLORS.deadHead, COLORS.deadNeck, COLORS.deadTail]
        : [COLORS.head, COLORS.neck, COLORS.tail];

      // Butt-capped segments shaded end to end read as one continuous gradient; discs round off
      // the corners and the tail, where a butt cap would leave a notch.
      const span = Math.max(1, path.length - 1);
      const shadeAt = (i: number) => mix(neckColor, tailColor, i / span);
      const thickness = cell * 0.66;
      ctx.lineCap = "butt";
      ctx.lineWidth = thickness;
      for (let i = path.length - 1; i >= 1; i--) {
        const [x1, y1] = centre(path[i]);
        const [x0, y0] = centre(path[i - 1]);
        if (x1 === x0 && y1 === y0) continue;
        const shade = ctx.createLinearGradient(x1, y1, x0, y0);
        shade.addColorStop(0, shadeAt(i));
        shade.addColorStop(1, shadeAt(i - 1));
        ctx.strokeStyle = shade;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x0, y0);
        ctx.stroke();
      }
      for (let i = path.length - 1; i >= 1; i--) {
        const a = path[i - 1];
        const b = path[i];
        const c = path[i + 1];
        const corner = c !== undefined && (a.r - b.r) * (b.c - c.c) !== (a.c - b.c) * (b.r - c.r);
        if (c !== undefined && !corner) continue;
        const [x, y] = centre(b);
        ctx.fillStyle = shadeAt(i);
        ctx.beginPath();
        ctx.arc(x, y, thickness / 2, 0, Math.PI * 2);
        ctx.fill();
      }

      const [hx, hy] = centre(path[0]);
      ctx.save();
      if (!dead) {
        ctx.shadowColor = rgb(headColor);
        ctx.shadowBlur = cell * 0.5;
      }
      ctx.fillStyle = rgb(headColor);
      ctx.beginPath();
      ctx.arc(hx, hy, cell * 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      const f = DELTA[game.heading];
      ctx.fillStyle = COLORS.eye;
      for (const side of [-1, 1]) {
        const ex = hx + f.c * cell * 0.12 - f.r * side * cell * 0.17;
        const ey = hy + f.r * cell * 0.12 + f.c * side * cell * 0.17;
        ctx.beginPath();
        ctx.arc(ex, ey, Math.max(1.5, cell * 0.07), 0, Math.PI * 2);
        ctx.fill();
      }

      frame = requestAnimationFrame(draw);
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="board-wrap" ref={wrap}>
      <canvas ref={canvas} className="board" style={{ width: game.cols * cell, height: game.rows * cell }} />
    </div>
  );
}
