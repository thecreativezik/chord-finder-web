import { clsx, type ClassValue } from "clsx";

/** Conditional className joiner (drop-in for @glaze/core's cn). */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
