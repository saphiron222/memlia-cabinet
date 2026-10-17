/** cal.diy contributors — MIT; see LICENSE. Adapted for Memlia canonical forms. */
import { cva } from "class-variance-authority";
import { forwardRef, type InputHTMLAttributes } from "react";
import classNames from "./classNames";
type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & {
  size?: "sm" | "md";
  isFullWidth?: boolean;
};
export const inputStyles = cva(
  [
    // Base styles
    "rounded-[10px] border",
    "leading-none font-normal",

    // Colors
    "bg-default",
    "border-default",
    "text-default",
    "placeholder:text-muted",

    // States
    "hover:border-emphasis",
    "focus:border-emphasis",
    "focus:ring-0",
    "focus:shadow-outline-gray-focused",

    // Disabled state
    "disabled:bg-subtle",
    "disabled:hover:border-default",
    "disabled:cursor-not-allowed",

    // Shadow
    "shadow-outline-gray-rested",

    // Transitions
    "transition-all",
  ],
  {
    variants: {
      size: {
        sm: "h-7 px-2 py-1 text-xs",
        md: "h-8 px-3 py-2 text-sm",
      },
    },
    defaultVariants: {
      size: "md",
    },
  },
);

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { isFullWidth = true, size = "md", className, ...props },
  ref,
) {
  return (
    <input
      {...props}
      ref={ref}
      className={classNames(
        inputStyles({ size }),
        isFullWidth && "w-full",
        className,
      )}
    />
  );
});
