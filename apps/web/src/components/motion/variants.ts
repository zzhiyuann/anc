/**
 * Shared framer-motion variants tuned to our Apple-native motion language.
 * Durations and easings mirror the CSS tokens in globals.css (--ease-out,
 * --ease-spring, --dur-fast/base/slow) so JS-driven and CSS-driven
 * animations stay in lockstep.
 */
import type { Transition, Variants } from "framer-motion";

export const easeOut = [0.25, 0.8, 0.5, 1] as const;
export const easeSpring = [0.34, 1.56, 0.64, 1] as const;

export const durations = {
  fast: 0.12,
  base: 0.18,
  slow: 0.26,
} as const;

export const fadeVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
  exit: { opacity: 0 },
};

export const slideUpVariants: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 6 },
};

export const slideDownVariants: Variants = {
  hidden: { opacity: 0, y: -6 },
  visible: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
};

export const scaleVariants: Variants = {
  hidden: { opacity: 0, scale: 0.98 },
  visible: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.98 },
};

export const baseTransition: Transition = {
  duration: durations.base,
  ease: easeOut,
};

export const springTransition: Transition = {
  type: "spring",
  stiffness: 380,
  damping: 30,
  mass: 0.8,
};
