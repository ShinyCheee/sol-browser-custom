// Bencho block "Eye tracker": Copyright (c) 2026 Lorenzo Cabra, MIT; see ui/licenses/bencho-MIT.txt.
import { t } from "@/i18n";

export const stillness = () =>
  typeof window !== "undefined" &&
  !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export const R = 50;

export type Eye = { w: number; h: number; r: number };

export const STYLES: Record<string, Eye> = {
  Slant: { w: 9, h: 15, r: 4.5 },
  Dots: { w: 11, h: 11, r: 5.5 },
  Squares: { w: 12, h: 12, r: 3.5 },
};

export const GAP = 0.19;
export const TILT = 64;

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export const lines = () => [
  t("Coucou, c’est Sol AI.", "Hi, I’m Sol AI."),
  "Boop.",
  t("Ça chatouille.", "That tickles."),
  t("Pose-moi une question !", "Ask me anything!"),
  t("Je peux lire la page pour toi.", "I can read the page for you."),
  t("Je te vois.", "I see you."),
  t("Encore ? D’accord.", "Again? Okay."),
  t("Une note à écrire ?", "Need a note written?"),
];

export const TINTS = ["#3b5bff", "#179c52", "#e0307f"];
export const KEY_MS = 38;
export const HOLD_MS = 1500;

export const SHAPES: Record<string, string> = {
  Ball: "M50 0 A50 50 0 1 1 49.99 0 Z",
  Circle: "M50 7 A43 43 0 1 1 49.99 7 Z",
  Cube: "M30 6 H70 A24 24 0 0 1 94 30 V70 A24 24 0 0 1 70 94 H30 A24 24 0 0 1 6 70 V30 A24 24 0 0 1 30 6 Z",
  Pill: "M34 17 H66 A33 33 0 0 1 66 83 H34 A33 33 0 0 1 34 17 Z",
  Hexagon: "M59.53 8.50 L81.18 21.00 Q90.70 26.50 90.70 37.50 L90.70 62.50 Q90.70 73.50 81.18 79.00 L59.53 91.50 Q50.00 97.00 40.47 91.50 L18.82 79.00 Q9.30 73.50 9.30 62.50 L9.30 37.50 Q9.30 26.50 18.82 21.00 L40.47 8.50 Q50.00 3.00 59.53 8.50 Z",
  "Hex flat": "M91.50 59.53 L79.00 81.18 Q73.50 90.70 62.50 90.70 L37.50 90.70 Q26.50 90.70 21.00 81.18 L8.50 59.53 Q3.00 50.00 8.50 40.47 L21.00 18.82 Q26.50 9.30 37.50 9.30 L62.50 9.30 Q73.50 9.30 79.00 18.82 L91.50 40.47 Q97.00 50.00 91.50 59.53 Z",
};

const RAYS = 120;
const radii = new Map<string, number[]>();

export function measure(shape: string): number[] {
  const hit = radii.get(shape);
  if (hit) return hit;
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", SHAPES[shape] ?? SHAPES.Ball);
  svg.appendChild(path);
  document.body.appendChild(svg);
  const pt = svg.createSVGPoint();
  const out: number[] = [];
  for (let i = 0; i < RAYS; i++) {
    const a = (i / RAYS) * Math.PI * 2 - Math.PI / 2;
    let lo = 0, hi = 60;
    for (let k = 0; k < 16; k++) {
      const mid = (lo + hi) / 2;
      pt.x = 50 + Math.cos(a) * mid;
      pt.y = 50 + Math.sin(a) * mid;
      if (path.isPointInFill(pt)) lo = mid; else hi = mid;
    }
    out.push(lo);
  }
  svg.remove();
  radii.set(shape, out);
  return out;
}

export function outline(r: number[]): string {
  let d = "";
  r.forEach((v, i) => {
    const a = (i / r.length) * Math.PI * 2 - Math.PI / 2;
    d += `${i ? "L" : "M"}${(50 + Math.cos(a) * v).toFixed(2)} ${(50 + Math.sin(a) * v).toFixed(2)}`;
  });
  return d + "Z";
}

export function drawSphereEyes(
  eyes: (SVGGElement | null)[],
  tx: number,
  ty: number,
  lid: number,
  eyeScale: number,
  e0: Eye,
) {
  const as = (v: number) => Math.asin(clamp(v, -0.92, 0.92));
  const yaw = as(tx);
  const pitch = -as(ty);
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const tilt = TILT * tx * ty;
  const g0 = GAP * Math.max(1, eyeScale * 0.8);

  [-g0, g0].forEach((x0, i) => {
    const g = eyes[i];
    if (!g) return;
    const z0 = Math.sqrt(1 - x0 * x0);
    const x1 = x0 * cy + z0 * sy;
    const z1 = -x0 * sy + z0 * cy;
    const y2 = -z1 * sp;
    const z2 = z1 * cp;
    const near = clamp(z2, 0, 1);
    const k = 0.45 + 0.55 * near;
    const sx = k * (0.7 + 0.3 * near);
    const w = e0.w * sx;
    const h = Math.max(0.6, e0.h * k * lid);
    const rect = g.firstElementChild as SVGRectElement | null;
    if (rect) {
      rect.setAttribute("x", (-w / 2).toFixed(2));
      rect.setAttribute("y", (-h / 2).toFixed(2));
      rect.setAttribute("width", w.toFixed(2));
      rect.setAttribute("height", h.toFixed(2));
      rect.setAttribute("rx", Math.min(e0.r, w / 2, h / 2).toFixed(2));
    }
    g.setAttribute(
      "transform",
      `translate(${(50 + x1 * R).toFixed(2)} ${(50 + y2 * R).toFixed(2)}) rotate(${tilt.toFixed(2)})`,
    );
    g.style.opacity = z2 < 0.05 ? "0" : "1";
  });
}
