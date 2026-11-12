// Bencho block "Eye tracker": Copyright (c) 2026 Lorenzo Cabra, MIT; see ui/licenses/bencho-MIT.txt.
// Adapté pour Sol : c'est la mascotte de Sol AI. Ses phrases parlent de Sol AI (français ou anglais), le cadre
// qu'elle surveille est le conteneur marqué data-eyt-frame, et la racine accepte une classe.
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { t } from "@/i18n";
import "./bencho.css";
import {
  clamp,
  drawSphereEyes,
  HOLD_MS,
  KEY_MS,
  lines,
  measure,
  outline,
  SHAPES,
  STYLES,
  stillness,
  TINTS,
} from "./eye-tracker-math";

export function EyeTracker({
  follow = 60,
  bounce = 30,
  size = 100,
  shape = "Cube",
  eyes: look = "Slant",
  eyeScale = 1,
  eyeWidth = 1,
  eyeRound = 1,
  eyeHeight = 1,
  idle = false,
  className = "",
}: {
  follow?: number;
  bounce?: number;
  size?: number;
  shape?: string;
  eyes?: string;
  eyeScale?: number;
  eyeWidth?: number;
  eyeRound?: number;
  eyeHeight?: number;
  idle?: boolean;
  className?: string;
} = {}) {
  const still = stillness();
  const box = useRef<HTMLDivElement>(null);
  const [typed, setTyped] = useState("");
  const [talking, setTalking] = useState(false);
  const [tint, setTint] = useState(TINTS[0]);
  const [side, setSide] = useState<"right" | "left">("right");
  const [room, setRoom] = useState(240);
  const turn = useRef(0);
  const lastLine = useRef(-1);
  useEffect(() => () => { turn.current++; }, []);

  const poke = async () => {
    if (idle) return;
    const mine = ++turn.current;
    const all = lines();
    const pool = all.map((_, i) => i).filter((i) => i !== lastLine.current);
    const i = pool[Math.floor(Math.random() * pool.length)];
    lastLine.current = i;
    const line = all[i];
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    setTint(TINTS[Math.floor(Math.random() * TINTS.length)]);
    setTyped("");
    setTalking(true);
    for (let k = 1; k <= line.length; k++) {
      await wait(KEY_MS + Math.random() * 30);
      if (mine !== turn.current) return;
      setTyped(line.slice(0, k));
    }
    await wait(HOLD_MS);
    if (mine !== turn.current) return;
    setTalking(false);
  };

  const eyes = useRef<(SVGGElement | null)[]>([]);
  const knobs = useRef({ follow, bounce, eyeScale });
  knobs.current = { follow, bounce, eyeScale };
  const base = STYLES[look] ?? STYLES.Slant;
  const eye = {
    w: base.w * eyeScale * eyeWidth,
    h: base.h * eyeScale * eyeHeight,
    r: base.r * eyeScale * eyeWidth * eyeRound,
  };
  const eyeNow = useRef(eye);
  eyeNow.current = eye;

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const state = { x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0 };
    let raf = 0;
    let prev = 0;
    let blink = 0;
    let nextBlink = performance.now() + 2200;

    const draw = (now: number) => {
      let lid = 1;
      if (now > nextBlink) {
        blink = now;
        nextBlink = now + (idle ? 6000 + Math.random() * 4000 : 2600 + Math.random() * 3200);
      }
      const since = now - blink;
      if (since < 160) lid = 1 - 0.9 * Math.sin((since / 160) * Math.PI);
      drawSphereEyes(eyes.current, state.x, state.y, lid, knobs.current.eyeScale, eyeNow.current);
    };

    const tick = (now: number) => {
      const dt = prev ? Math.min(2.5, (now - prev) / 16.67) : 1;
      prev = now;
      if (still) {
        state.x = state.tx;
        state.y = state.ty;
      } else {
        const k = 0.06;
        const d = 0.34 - (clamp(knobs.current.bounce, 0, 100) / 100) * 0.22;
        state.vx += ((state.tx - state.x) * k - state.vx * d) * dt;
        state.vy += ((state.ty - state.y) * k - state.vy * d) * dt;
        state.x += state.vx * dt;
        state.y += state.vy * dt;
      }
      draw(now);
      // Yeux au repos et paupières ouvertes : plus rien à dessiner. La boucle s'arrête jusqu'au prochain clignement ou
      // mouvement, au lieu d'occuper le processeur et la carte graphique 60 fois par seconde.
      const settled = Math.abs(state.tx - state.x) + Math.abs(state.ty - state.y) + Math.abs(state.vx) + Math.abs(state.vy) < 0.002;
      if (settled && now - blink >= 160) {
        raf = 0; prev = 0;
        sleep = window.setTimeout(wake, Math.max(0, nextBlink - now));
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    let sleep = 0;
    const wake = () => { window.clearTimeout(sleep); if (!raf) raf = requestAnimationFrame(tick); };
    const stop = () => { cancelAnimationFrame(raf); window.clearTimeout(sleep); };
    wake();

    const frame = el.closest<HTMLElement>("[data-eyt-frame]") ?? el;
    const aim = (e: PointerEvent) => {
      const f = frame.getBoundingClientRect();
      if (e.clientX < f.left || e.clientX > f.right || e.clientY < f.top || e.clientY > f.bottom) {
        state.tx = 0;
        state.ty = 0;
        return;
      }
      const r = el.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy) || 1;
      const reach = Math.max(60, Math.min(f.width, f.height) * 0.28);
      const far = Math.min(0.85, Math.tanh(d / reach) * (clamp(knobs.current.follow, 0, 100) / 100) * 1.5);
      state.tx = (dx / d) * far;
      state.ty = (dy / d) * far;
      wake();
    };
    const rest = () => { state.tx = 0; state.ty = 0; wake(); };

    if (idle) {
      const GLANCE_MS = 20000;
      let glance = 0;
      // Mascotte d'ambiance : un regard de temps en temps suffit, et aucun quand l'interface est masquée.
      const lookAround = () => {
        if (document.hidden) { glance = window.setTimeout(lookAround, GLANCE_MS); return; }
        const a = Math.random() * Math.PI * 2;
        const far = 0.45 + Math.random() * 0.25;
        state.tx = Math.cos(a) * far;
        state.ty = Math.sin(a) * far;
        wake();
        glance = window.setTimeout(() => {
          rest();
          glance = window.setTimeout(lookAround, GLANCE_MS - 900);
        }, 900);
      };
      glance = window.setTimeout(lookAround, GLANCE_MS);
      return () => {
        stop();
        window.clearTimeout(glance);
      };
    }

    window.addEventListener("pointermove", aim, { passive: true });
    document.documentElement.addEventListener("pointerleave", rest);
    return () => {
      stop();
      window.removeEventListener("pointermove", aim);
      document.documentElement.removeEventListener("pointerleave", rest);
    };
  }, [still, idle]);

  const s = clamp(size, 16, 180);
  useLayoutEffect(() => {
    const el = box.current;
    if (!talking || !el) return;
    const frame = (el.closest<HTMLElement>("[data-eyt-frame]") ?? document.documentElement).getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const right = frame.right - (cx + s * 0.36) - 8;
    const left = cx - s * 0.36 - frame.left - 8;
    const pick = right >= 200 || right >= left ? "right" : "left";
    setSide(pick);
    setRoom(Math.max(110, Math.min(260, pick === "right" ? right : left)));
  }, [talking, s]);

  const body = SHAPES[shape] ?? SHAPES.Ball;
  const clip = `eyt-clip-${useId().replace(/:/g, "")}`;
  const bodyEl = useRef<SVGPathElement>(null);
  const clipEl = useRef<SVGPathElement>(null);
  const shown = useRef<number[] | null>(null);
  const from = useRef(shape);

  useLayoutEffect(() => {
    if (from.current === shape) return;
    const start = shown.current ?? measure(from.current);
    const end = measure(shape);
    from.current = shape;
    if (still) {
      shown.current = end;
      const d = outline(end);
      bodyEl.current?.setAttribute("d", d);
      clipEl.current?.setAttribute("d", d);
      return;
    }
    const t0 = performance.now();
    const ms = 520;
    let raf = 0;
    const step = (now: number) => {
      const u = Math.min(1, (now - t0) / ms);
      const c = 1.3;
      const e = 1 + (c + 1) * Math.pow(u - 1, 3) + c * Math.pow(u - 1, 2);
      const r = start.map((a, i) => a + (end[i] - a) * e);
      shown.current = r;
      const d = outline(r);
      bodyEl.current?.setAttribute("d", d);
      clipEl.current?.setAttribute("d", d);
      if (u < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [shape, still]);

  return (
    <div
      className={`eyt ${className}`}
      ref={box}
      style={{ "--eyt-size": `${s}px` } as React.CSSProperties}
      role="img"
      aria-label={t("Sol AI, la mascotte qui suit votre curseur", "Sol AI, the mascot that follows your cursor")}
    >
      <svg
        className="eyt-ball"
        viewBox="0 0 100 100"
        data-poke={idle ? undefined : true}
        onClick={poke}
      >
        <defs>
          <clipPath id={clip}>
            <path ref={clipEl} d={shown.current ? outline(shown.current) : body} />
          </clipPath>
        </defs>
        <path ref={bodyEl} className="eyt-body" d={shown.current ? outline(shown.current) : body} />
        <g clipPath={`url(#${clip})`}>
          {[0, 1].map((i) => (
            <g key={i} ref={(n) => { eyes.current[i] = n; }}>
              <rect
                className="eyt-eye"
                x={-eye.w / 2}
                y={-eye.h / 2}
                width={eye.w}
                height={eye.h}
                rx={eye.r}
              />
            </g>
          ))}
        </g>
      </svg>
      {idle ? null : (
        <span
          className="eyt-say"
          data-on={talking || undefined}
          data-side={side}
          aria-live="polite"
          style={{ "--tint": tint, "--eyt-room": `${room}px` } as React.CSSProperties}
        >
          <span>{typed}</span>
          <span className="eyt-caret" />
        </span>
      )}
    </div>
  );
}
