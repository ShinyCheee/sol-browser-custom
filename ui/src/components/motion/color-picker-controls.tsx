"use client";
// beUI source: Copyright (c) 2026 Saurabh Chauhan, MIT; see ui/licenses/beui-MIT.txt.

import { AnimatePresence, type MotionValue, motion, type Transition, useReducedMotion, useSpring, useTransform, useVelocity } from "motion/react";
import { type ComponentPropsWithRef, type RefObject, useContext } from "react";
import { EASE_OUT, SPRING_PRESS } from "@/lib/ease";
import { TOUCH_GESTURE_CLASS } from "@/lib/touch";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { AREA_RADIUS, CHECKERBOARD, keyStep, MORPH, MorphContext, useDrag, useGlide, usePickerContext } from "./color-picker-math";

const LOUPE_LIFT: Transition = { type: "spring", stiffness: 520, damping: 24, mass: 0.6 };
const LOUPE_DROP: Transition = { duration: 0.12, ease: EASE_OUT };
const LOUPE_TILT_INPUT = [-400, 400];
const LOUPE_TILT_DEGREES = [16, -16];

function Thumb({
  thumbRef, dragging, color, glide, x, y, className, ...props
}: ComponentPropsWithRef<"div"> & {
  thumbRef: RefObject<HTMLDivElement | null>;
  dragging: boolean;
  color: string;
  glide: MotionValue<number>;
  x: MotionValue<string>;
  y?: MotionValue<string>;
}) {
  const reduce = useReducedMotion();
  const velocity = useVelocity(glide);
  const tilt = useSpring(useTransform(velocity, LOUPE_TILT_INPUT, LOUPE_TILT_DEGREES, { clamp: true }), SPRING_PRESS);
  const lifted = dragging && !reduce;
  return (
    <motion.div className="pointer-events-none absolute inset-0" style={{ x, y }}>
      <div
        {...props}
        ref={thumbRef}
        className={cn(
          "absolute left-0 size-[18px] -translate-x-1/2 -translate-y-1/2 rounded-full outline-none",
          y ? "top-0" : "top-1/2",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground",
          className,
        )}
      >
        <motion.span
          aria-hidden="true"
          animate={{ scale: lifted ? 0.78 : 1 }}
          transition={SPRING_PRESS}
          className="block size-full rounded-full border-[3px] border-white shadow-[0_0_0_1px_rgb(0_0_0/0.12),0_2px_6px_rgb(0_0_0/0.25)]"
          style={{ backgroundColor: color }}
        />
        <AnimatePresence>
          {lifted && (
            <motion.span
              aria-hidden="true"
              className="pointer-events-none absolute bottom-[calc(100%+12px)] left-1/2 z-10 -ml-5 block size-10"
              style={{ rotate: tilt, originX: 0.5, originY: 1.3 }}
              initial={{ opacity: 0, scale: 0.3, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0, transition: LOUPE_LIFT }}
              exit={{ opacity: 0, scale: 0.3, y: 16, transition: LOUPE_DROP }}
            >
              <span
                className="absolute inset-0 -rotate-45 overflow-hidden rounded-[50%_50%_50%_0] border-[3px] border-white shadow-[0_0_0_1px_rgb(0_0_0/0.1),0_6px_16px_rgb(0_0_0/0.28)]"
                style={{ background: CHECKERBOARD }}
              >
                <span className="absolute inset-0" style={{ background: color }} />
              </span>
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

export interface ColorPickerAreaProps extends Omit<ComponentPropsWithRef<"div">, "children"> {
  label?: string;
}

export function ColorPickerArea({ label = t("Intensité et clarté", "Saturation and brightness"), className, style, ...props }: ColorPickerAreaProps) {
  const { id, hsva, rgba, hex, disabled, update, commit, open } = usePickerContext("ColorPickerArea");
  const morph = useContext(MorphContext);
  const reduce = useReducedMotion();
  const { railRef, thumbRef, dragging, handlers } = useDrag(
    (x, y) => update({ ...hsva, s: x * 100, v: (1 - y) * 100 }),
    commit,
    disabled,
  );
  const x = useGlide(hsva.s);
  const y = useGlide(100 - hsva.v);
  const s = Math.round(hsva.s);
  const v = Math.round(hsva.v);
  const morphing = morph && !reduce;
  const rgb = `rgb(${rgba.r} ${rgba.g} ${rgba.b})`;

  return (
    <motion.div
      {...(props as React.ComponentProps<typeof motion.div>)}
      {...handlers}
      ref={railRef}
      layoutId={morphing ? `${id}-chip` : undefined}
      layoutDependency={open}
      transition={MORPH}
      className={cn(
        "relative h-40 w-full touch-none",
        TOUCH_GESTURE_CLASS,
        disabled ? "cursor-not-allowed" : "cursor-crosshair",
        className,
      )}
      style={{
        ...style,
        borderRadius: AREA_RADIUS,
        background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsva.h} 100% 50%))`,
      }}
    >
      {morphing && (
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-[inherit]"
          style={{ backgroundColor: hex }}
          initial={{ opacity: 1 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 0.4, ease: EASE_OUT, delay: 0.06 }}
        />
      )}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-black/10 ring-inset" />
      <motion.div
        className="absolute inset-0"
        initial={morphing ? { opacity: 0 } : false}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2, delay: 0.22 }}
      >
        <Thumb
          thumbRef={thumbRef}
          dragging={dragging}
          color={rgb}
          glide={x.spring}
          x={x.offset}
          y={y.offset}
          role="slider"
          tabIndex={disabled ? -1 : 0}
          aria-label={label}
          aria-roledescription="2D slider"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={s}
          aria-valuetext={`Saturation ${s}%, brightness ${v}%`}
          aria-disabled={disabled || undefined}
          onKeyDown={(event) => {
            if (disabled) return;
            const step = keyStep(event, 10);
            if (!step) return;
            event.preventDefault();
            if (step === "min") update({ ...hsva, s: 0 });
            else if (step === "max") update({ ...hsva, s: 100 });
            else if (step.axis === "x") update({ ...hsva, s: hsva.s + step.delta });
            else update({ ...hsva, v: hsva.v + step.delta });
            commit();
          }}
        />
      </motion.div>
    </motion.div>
  );
}

function ChannelSlider({
  value,
  max,
  onValue,
  label,
  valueText,
  background,
  thumbColor,
  className,
  ...props
}: Omit<ComponentPropsWithRef<"div">, "children"> & {
  value: number;
  max: number;
  onValue: (next: number) => void;
  label: string;
  valueText: string;
  background: string;
  thumbColor: string;
}) {
  const { disabled, commit } = usePickerContext("ColorPicker slider");
  const { railRef, thumbRef, dragging, handlers } = useDrag((x) => onValue(x * max), commit, disabled);
  const x = useGlide((value / max) * 100);

  return (
    <div
      {...props}
      {...handlers}
      className={cn(
        "relative h-3.5 w-full touch-none rounded-full",
        TOUCH_GESTURE_CLASS,
        disabled ? "cursor-not-allowed" : "cursor-pointer",
        className,
      )}
      style={{ background }}
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-full ring-1 ring-black/10 ring-inset" />
      <div ref={railRef} className="absolute inset-y-0 right-[9px] left-[9px]">
        <Thumb
          thumbRef={thumbRef}
          dragging={dragging}
          color={thumbColor}
          glide={x.spring}
          x={x.offset}
          role="slider"
          tabIndex={disabled ? -1 : 0}
          aria-label={label}
          aria-orientation="horizontal"
          aria-valuemin={0}
          aria-valuemax={max}
          aria-valuenow={Math.round(value)}
          aria-valuetext={valueText}
          aria-disabled={disabled || undefined}
          onKeyDown={(event) => {
            if (disabled) return;
            const step = keyStep(event, 10);
            if (!step) return;
            event.preventDefault();
            if (step === "min") onValue(0);
            else if (step === "max") onValue(max);
            else onValue(Math.round(value) + step.delta);
            commit();
          }}
        />
      </div>
    </div>
  );
}

export interface ColorPickerHueProps extends Omit<ComponentPropsWithRef<"div">, "children"> {
  label?: string;
}

export function ColorPickerHue({ label = t("Teinte", "Hue"), ...props }: ColorPickerHueProps) {
  const { hsva, update } = usePickerContext("ColorPickerHue");
  const h = Math.round(hsva.h);
  return (
    <ChannelSlider
      {...props}
      value={hsva.h}
      max={360}
      onValue={(next) => update({ ...hsva, h: next })}
      label={label}
      valueText={t(`${h} degrés`, `${h} degrees`)}
      background="linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)"
      thumbColor={`hsl(${hsva.h} 100% 50%)`}
    />
  );
}

export interface ColorPickerAlphaProps extends Omit<ComponentPropsWithRef<"div">, "children"> {
  label?: string;
}

export function ColorPickerAlpha({ label = t("Opacité", "Opacity"), ...props }: ColorPickerAlphaProps) {
  const { hsva, rgba, alpha, update } = usePickerContext("ColorPickerAlpha");
  if (!alpha) return null;
  const rgb = `${rgba.r} ${rgba.g} ${rgba.b}`;
  const percent = Math.round(hsva.a * 100);
  return (
    <ChannelSlider
      {...props}
      value={hsva.a * 100}
      max={100}
      onValue={(next) => update({ ...hsva, a: Math.round(next) / 100 })}
      label={label}
      valueText={`${percent}%`}
      background={`linear-gradient(to right, rgb(${rgb} / 0), rgb(${rgb})), ${CHECKERBOARD}`}
      thumbColor={`rgb(${rgb} / ${hsva.a})`}
    />
  );
}

export type ColorPickerSwatchProps = Omit<ComponentPropsWithRef<"span">, "children">;

export function ColorPickerSwatch({ className, style, ...props }: ColorPickerSwatchProps) {
  const { hex } = usePickerContext("ColorPickerSwatch");
  return (
    <span
      {...props}
      aria-hidden="true"
      className={cn("relative block size-9 shrink-0 overflow-hidden rounded-lg", className)}
      style={{ ...style, background: CHECKERBOARD }}
    >
      <span
        className="absolute inset-0 rounded-[inherit] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.1)] transition-colors duration-150"
        style={{ backgroundColor: hex }}
      />
    </span>
  );
}
