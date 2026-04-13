"use client";

import * as React from "react";
import { motion, useReducedMotion, type HTMLMotionProps } from "framer-motion";

import { scaleVariants, springTransition } from "./variants";

type ScaleInProps = HTMLMotionProps<"div"> & {
  delay?: number;
};

/**
 * Spring-driven scale-in for surfaces that should "land" — dialogs, popovers
 * mounted via portal, command palette results, etc.
 */
export function ScaleIn({
  delay = 0,
  children,
  transition,
  ...props
}: ScaleInProps) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : "hidden"}
      animate="visible"
      exit="exit"
      variants={scaleVariants}
      transition={
        reduce ? { duration: 0 } : { ...springTransition, delay, ...transition }
      }
      {...props}
    >
      {children}
    </motion.div>
  );
}
