"use client";
// beUI source: Copyright (c) 2026 Saurabh Chauhan, MIT; see ui/licenses/beui-MIT.txt.

import { type Transition, useReducedMotion, useSpring, useTransform } from "motion/react";
import {
  createContext,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { SPRING_GLIDE } from "@/lib/ease";
import { capturePointer, releasePointer } from "@/lib/touch";

export type Hsva = { h: number; s: number; v: number; a: number };
export type Rgba = { r: number; g: number; b: number; a: number };

export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round = (n: number, places = 0) => {
  const f = 10 ** places;
  return Math.round(n * f) / f;
};

export function hsvaToRgba({ h, s, v, a }: Hsva): Rgba {
  const sat = s / 100;
  const val = v / 100;
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return val - val * sat * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return { r: Math.round(f(5) * 255), g: Math.round(f(3) * 255), b: Math.round(f(1) * 255), a };
}

export function rgbaToHsva({ r, g, b, a }: Rgba, previous?: Hsva): Hsva {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const d = max - Math.min(rn, gn, bn);
  let h = previous?.h ?? 0;
  if (d) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  const v = max * 100;
  const s = max ? (d / max) * 100 : (previous?.s ?? 0);
  return { h, s, v, a };
}

const HEX_PATTERN = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export function parseHex(input: string): Rgba | null {
  const match = HEX_PATTERN.exec(input.trim());
  if (!match) return null;
  let hex = match[1];
  if (hex.length <= 4) hex = [...hex].map((c) => c + c).join("");
  const n = (i: number) => Number.parseInt(hex.slice(i, i + 2), 16);
  return { r: n(0), g: n(2), b: n(4), a: hex.length === 8 ? round(n(6) / 255, 2) : 1 };
}

export function formatHex({ r, g, b, a }: Rgba): string {
  const pair = (n: number) => Math.round(n).toString(16).padStart(2, "0");
  return `#${pair(r)}${pair(g)}${pair(b)}${a < 1 ? pair(a * 255) : ""}`;
}

export function hsvToHsl({ h, s, v }: Hsva) {
  const sv = s / 100;
  const vv = v / 100;
  const l = vv * (1 - sv / 2);
  const sl = l === 0 || l === 1 ? 0 : (vv - l) / Math.min(l, 1 - l);
  return { h, s: sl * 100, l: l * 100 };
}

export function hslToHsv(h: number, s: number, l: number, previous: Hsva, a: number): Hsva {
  const sl = s / 100;
  const ll = l / 100;
  const v = ll + sl * Math.min(ll, 1 - ll);
  return { h, s: v ? 2 * (1 - ll / v) * 100 : previous.s, v: v * 100, a };
}

export const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 };

export type ColorPickerContextValue = {
  id: string;
  hsva: Hsva;
  rgba: Rgba;
  hex: string;
  alpha: boolean;
  disabled: boolean;
  update: (next: Hsva) => void;
  commit: () => void;
  open: boolean;
  setOpen: (open: boolean) => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
};

export const ColorPickerContext = createContext<ColorPickerContextValue | null>(null);

export function usePickerContext(component: string) {
  const context = useContext(ColorPickerContext);
  if (!context) throw new Error(`${component} must be used within ColorPicker`);
  return context;
}

export function useColorPicker() {
  const { hex, rgba, hsva, alpha, disabled, update, commit } = usePickerContext("useColorPicker");
  return {
    hex,
    rgba,
    hsva,
    alpha,
    disabled,
    setColor: (value: string) => {
      const parsed = parseHex(value);
      if (!parsed) return;
      update(rgbaToHsva(parsed, hsva));
      commit();
    },
  };
}

export const CHECKERBOARD =
  "repeating-conic-gradient(#d4d4d8 0% 25%, #fafafa 0% 50%) 0 0 / 8px 8px";
export const MORPH: Transition = { type: "spring", duration: 0.5, bounce: 0.2 };
export const AREA_RADIUS = 12;
export const CHIP_RADIUS = 6;
export const MorphContext = createContext(false);

export function useGlide(target: number) {
  const reduce = useReducedMotion();
  const spring = useSpring(target, SPRING_GLIDE);
  useEffect(() => {
    if (reduce) spring.jump(target);
    else spring.set(target);
  }, [reduce, spring, target]);
  return { spring, offset: useTransform(spring, (n) => `${n}%`) };
}

export function useDrag(
  onPoint: (x: number, y: number) => void,
  onEnd: () => void,
  disabled: boolean,
) {
  const railRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [dragging, setDragging] = useState(false);

  const point = (event: PointerEvent<HTMLDivElement>) => {
    const rect = railRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;
    onPoint(
      clamp((event.clientX - rect.left) / rect.width, 0, 1),
      clamp((event.clientY - rect.top) / rect.height, 0, 1),
    );
  };

  const end = (event: PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    releasePointer(event.currentTarget, event.pointerId);
    draggingRef.current = false;
    setDragging(false);
    onEnd();
  };

  return {
    railRef,
    thumbRef,
    dragging,
    handlers: {
      onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
        if (disabled || event.button !== 0) return;
        draggingRef.current = true;
        setDragging(true);
        capturePointer(event.currentTarget, event.pointerId);
        thumbRef.current?.focus({ preventScroll: true });
        point(event);
      },
      onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
        if (draggingRef.current) point(event);
      },
      onPointerUp: end,
      onPointerCancel: end,
    },
  };
}

export function keyStep(event: KeyboardEvent, big: number): { axis: "x" | "y"; delta: number } | "min" | "max" | null {
  const step = event.shiftKey ? big : 1;
  switch (event.key) {
    case "ArrowRight":
      return { axis: "x", delta: step };
    case "ArrowLeft":
      return { axis: "x", delta: -step };
    case "ArrowUp":
      return { axis: "y", delta: step };
    case "ArrowDown":
      return { axis: "y", delta: -step };
    case "PageUp":
      return { axis: "y", delta: big };
    case "PageDown":
      return { axis: "y", delta: -big };
    case "Home":
      return "min";
    case "End":
      return "max";
    default:
      return null;
  }
}
