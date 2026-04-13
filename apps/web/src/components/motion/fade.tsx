"use client";

import * as React from "react";
import { motion, useReducedMotion, type HTMLMotionProps } from "framer-motion";

import { baseTransition, fadeVariants } from "./variants";

type FadeInProps = HTMLMotionProps<"div"> & {
  delay?: number;
};

/**
 * Lightweight fade-in wrapper. Honors prefers-reduced-motion by snapping
 * to the visible state instantly.
 */
export function FadeIn({
  delay = 0,
  children,
  transition,
  ...props
}: FadeInProps) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : "hidden"}
      animate="visible"
      exit="exit"
      variants={fadeVariants}
      transition={
        reduce ? { duration: 0 } : { ...baseTransition, delay, ...transition }
      }
      {...props}
    >
      {children}
    </motion.div>
  );
}
