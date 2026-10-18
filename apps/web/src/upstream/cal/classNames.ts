/** cal.diy contributors — MIT; see LICENSE. Adapted for Memlia canonical forms. */
import { twMerge } from "tailwind-merge";

export default function classNames(...classes: unknown[]) {
  return twMerge(classes.filter(Boolean).join(" "));
}
