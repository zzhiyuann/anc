"use client";

import * as React from "react";
import { motion, useReducedMotion, type HTMLMotionProps } from "framer-motion";

import {
  baseTransition,
  slideDownVariants,
  slideUpVariants,
} from "./variants";

type SlideProps = HTMLMotionProps<"div"> & {
  delay?: number;
};

export function SlideUp({
  delay = 0,
  children,
  transition,
  ...props
}: SlideProps) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : "hidden"}
      animate="visible"
      exit="exit"
      variants={slideUpVariants}
      transition={
        reduce ? { duration: 0 } : { ...baseTransition, delay, ...transition }
      }
      {...props}
    >
      {children}
    </motion.div>
  );
}

export function SlideDown({
  delay = 0,
  children,
  transition,
  ...props
}: SlideProps) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : "hidden"}
      animate="visible"
      exit="exit"
      variants={slideDownVariants}
      transition={
        reduce ? { duration: 0 } : { ...baseTransition, delay, ...transition }
      }
      {...props}
    >
      {children}
    </motion.div>
  );
}
