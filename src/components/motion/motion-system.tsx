"use client";

import {
  MotionConfig,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useSpring,
} from "motion/react";
import type { Easing, Transition, Variants } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { PropsWithChildren } from "react";

export const motionSpring = {
  gentle: { type: "spring", stiffness: 260, damping: 29, mass: 1 },
  snappy: { type: "spring", stiffness: 500, damping: 38, mass: 1 },
  bouncy: { type: "spring", stiffness: 380, damping: 22, mass: 0.8 },
  smooth: { type: "spring", stiffness: 190, damping: 30, mass: 1 },
} satisfies Record<"gentle" | "snappy" | "bouncy" | "smooth", Transition>;

export const motionDuration = {
  press: 0.15,
  release: 0.11,
  micro: 0.14,
  state: 0.18,
  enter: 0.26,
  transition: 0.3,
  bottomSheet: 0.36,
} as const;

export const motionEase = {
  out: [0.23, 1, 0.32, 1] as const,
  inOut: [0.77, 0, 0.175, 1] as const,
  sheet: [0.32, 0.72, 0, 1] as const,
} satisfies Record<"out" | "inOut" | "sheet", Easing>;

const motionDefaultTransition = {
  type: "tween" as const,
  duration: motionDuration.micro,
  ease: motionEase.out,
} satisfies Transition;

export function MotionProvider({ children }: PropsWithChildren) {
  return (
    <MotionConfig reducedMotion="user" transition={motionDefaultTransition}>
      {children}
    </MotionConfig>
  );
}

export const motionVariants = {
  screen: {
    initial: {
      opacity: 0,
      transform: "translateY(6px)",
      transition: { type: "tween", duration: motionDuration.transition, ease: motionEase.out },
    },
    animate: {
      opacity: 1,
      transform: "translateY(0px)",
      transition: { type: "tween", duration: motionDuration.transition, ease: motionEase.out },
    },
    exit: {
      opacity: 0,
      transform: "translateY(6px)",
      transition: { type: "tween", duration: motionDuration.state, ease: motionEase.out },
    },
  },
  state: {
    initial: {
      opacity: 0,
      transform: "translateY(4px)",
      transition: { type: "tween", duration: motionDuration.enter, ease: motionEase.out },
    },
    animate: {
      opacity: 1,
      transform: "translateY(0px)",
      transition: { type: "tween", duration: motionDuration.enter, ease: motionEase.out },
    },
    exit: {
      opacity: 0,
      transform: "translateY(2px)",
      transition: { type: "tween", duration: motionDuration.micro, ease: motionEase.out },
    },
  },
  backdrop: {
    initial: {
      opacity: 0,
      transition: { type: "tween", duration: motionDuration.enter, ease: motionEase.out },
    },
    animate: {
      opacity: 1,
      transition: { type: "tween", duration: motionDuration.enter, ease: motionEase.out },
    },
    exit: {
      opacity: 0,
      transition: { type: "tween", duration: motionDuration.micro, ease: motionEase.out },
    },
  },
  bottomSheet: {
    initial: {
      opacity: 0,
      transform: "translateY(100%)",
      transition: { type: "tween", duration: motionDuration.bottomSheet, ease: motionEase.sheet },
    },
    animate: {
      opacity: 1,
      transform: "translateY(0%)",
      transition: { type: "tween", duration: motionDuration.bottomSheet, ease: motionEase.sheet },
    },
    exit: {
      opacity: 0,
      transform: "translateY(100%)",
      transition: { type: "tween", duration: motionDuration.state, ease: motionEase.sheet },
    },
  },
  dialog: {
    initial: {
      opacity: 0,
      transform: "scale(0.96)",
      transition: { type: "tween", duration: motionDuration.enter, ease: motionEase.out },
    },
    animate: {
      opacity: 1,
      transform: "scale(1)",
      transition: { type: "tween", duration: motionDuration.enter, ease: motionEase.out },
    },
    exit: {
      opacity: 0,
      transform: "scale(0.96)",
      transition: { type: "tween", duration: motionDuration.micro, ease: motionEase.out },
    },
  },
  listItem: {
    initial: {
      opacity: 0,
      transform: "translateY(4px)",
      transition: { type: "tween", duration: motionDuration.enter, ease: motionEase.out },
    },
    animate: {
      opacity: 1,
      transform: "translateY(0px)",
      transition: { type: "tween", duration: motionDuration.enter, ease: motionEase.out },
    },
    exit: {
      opacity: 0,
      transform: "translateY(4px)",
      transition: { type: "tween", duration: motionDuration.micro, ease: motionEase.out },
    },
  },
} satisfies Record<"screen" | "state" | "backdrop" | "bottomSheet" | "dialog" | "listItem", Variants>;

function opacityOnlyVariants(duration: number, exitDuration: number): Variants {
  return {
    initial: { opacity: 0, transition: { duration } },
    animate: { opacity: 1, transition: { duration } },
    exit: { opacity: 0, transition: { duration: exitDuration } },
  };
}

const reducedMotionVariants = {
  screen: opacityOnlyVariants(0.08, 0.06),
  state: opacityOnlyVariants(0.08, 0.06),
  backdrop: opacityOnlyVariants(0.08, 0.06),
  bottomSheet: opacityOnlyVariants(0.1, 0.06),
  dialog: opacityOnlyVariants(0.08, 0.06),
  listItem: opacityOnlyVariants(0.08, 0.06),
} satisfies Record<keyof typeof motionVariants, Variants>;

export function useMotionVariants() {
  return useReducedMotion() ? reducedMotionVariants : motionVariants;
}

type AnimatedNumberProps = {
  value: number;
  format: (value: number) => string;
  className?: string;
  ariaLabel?: string;
};

export function AnimatedNumber({
  value,
  format,
  className,
  ariaLabel,
}: AnimatedNumberProps) {
  const prefersReducedMotion = useReducedMotion() !== false;
  const target = useMotionValue(value);
  const animatedValue = useSpring(target, motionSpring.gentle);
  const textRef = useRef<HTMLSpanElement>(null);
  const [displayText, setDisplayText] = useState(() => format(value));
  const formatRef = useRef(format);
  const previousValue = useRef(value);

  useMotionValueEvent(animatedValue, "change", (latest) => {
    const nextText = formatRef.current(latest);
    if (textRef.current) textRef.current.textContent = nextText;
  });

  useEffect(() => {
    formatRef.current = format;
    if (prefersReducedMotion) {
      target.jump(value);
      animatedValue.jump(value);
      const nextText = formatRef.current(value);
      setDisplayText(nextText);
      if (textRef.current) textRef.current.textContent = nextText;
      previousValue.current = value;
      return;
    }

    if (Object.is(previousValue.current, value)) return;

    previousValue.current = value;
    target.set(value);
  }, [animatedValue, format, prefersReducedMotion, target, value]);

  useEffect(() => {
    if (prefersReducedMotion) return;
    const nextText = formatRef.current(animatedValue.get());
    if (textRef.current) textRef.current.textContent = nextText;
  }, [animatedValue, format, prefersReducedMotion]);

  return (
    <span className={className} role="group" aria-label={ariaLabel ?? format(value)}>
      <span ref={textRef} aria-hidden="true">
        {displayText}
      </span>
    </span>
  );
}
