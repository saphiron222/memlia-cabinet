/** cal.diy contributors — MIT, see LICENSE. Unmodified cva button variant definition. */
import { cva } from "class-variance-authority";
export const buttonClasses = cva(
  "group whitespace-nowrap inline-flex items-center text-sm font-medium relative rounded-[10px] transition cursor-pointer disabled:cursor-not-allowed gap-1",
  {
    variants: {
      variant: {
        button: "",
        icon: "flex justify-center",
        fab: "min-w-14 min-h-14 md:min-w-min md:min-h-min rounded-full justify-center md:rounded-[10px] radix-state-open:rotate-45 md:radix-state-open:rotate-0 radix-state-open:shadown-none radix-state-open:ring-0",
      },
      color: {
        primary: [
          // Base colors
          "bg-brand-default",
          "text-brand",
          // Hover state
          "not-disabled:hover:bg-brand-emphasis",
          // Focus state
          "focus-visible:outline-none",
          "focus-visible:ring-0",
          "focus-visible:shadow-button-solid-brand-focused",
          // Border
          "border border-brand-default",
          // Disabled
          "disabled:opacity-30",
          // Shadows and effects
          "shadow-button-solid-brand-default",
          "not-disabled:active:shadow-button-solid-brand-active",
          "not-disabled:hover:shadow-button-solid-brand-hover",
          "transition-shadow",
          "transition-transform",
          "duration-100",
        ],

        secondary: [
          // Base colors and border
          "bg-default",
          "text-default",
          "border",
          "border-default",
          // Hover state
          "not-disabled:hover:bg-cal-muted",
          "not-disabled:hover:text-emphasis",
          // Disabled
          "disabled:opacity-30",
          // Focus state
          "focus-visible:bg-subtle",
          "focus-visible:outline-none",
          "focus-visible:ring-0",
          "focus-visible:shadow-outline-gray-focused",
          // Shadows and effects
          "shadow-outline-gray-rested",
          "not-disabled:hover:shadow-outline-gray-hover",
          "not-disabled:active:shadow-outline-gray-active",
          "transition-shadow",
          "duration-200",
        ],

        minimal: [
          // Base color
          "text-subtle",
          "border border-transparent",
          // Hover
          "not-disabled:hover:bg-subtle",
          "not-disabled:hover:text-emphasis",
          "not-disabled:hover:border-subtle hover:border",
          // Disabled
          "disabled:opacity-30",
          // Focus
          "focus-visible:bg-subtle",
          "focus-visible:outline-none",
          "focus-visible:ring-0",
          "focus-visible:border-subtle",
          "focus-visible:shadow-button-outline-gray-focused",

          // Shadows and effects
          "not-disabled:active:shadow-outline-gray-active",
          "transition-shadow",
          "duration-200",
        ],

        destructive: [
          // Base colors and border
          "border",
          "border-default",
          "text-error",
          // Hover state
          "dark:hover:text-red-400",
          "hover:border-semantic-error",
          "hover:bg-error",
          // Focus state
          "focus-visible:text-red-700",
          "focus-visible:bg-error",
          "focus-visible:outline-none",
          "focus-visible:ring-0",
          "focus-visible:shadow-button-outline-red-focused",
          // Disabled state
          "disabled:bg-red-100",
          "disabled:border-red-200",
          "disabled:text-red-700",
          "disabled:hover:border-red-200",
          "disabled:opacity-30",
          // Shadows and effects
          "shadow-outline-red-rested",
          "not-disabled:hover:shadow-outline-red-hover",
          "not-disabled:active:shadow-outline-red-active",
          "transition-shadow",
          "duration-200",
        ],
      },
      size: {
        xs: "h-6 p-2 leading-none text-xs rounded-md",
        sm: "h-7 px-2 py-1.5 leading-none text-sm" /** For backwards compatibility */,
        base: "px-2.5 py-2 text-sm leading-none",
        lg: "px-3 py-2.5 ",
      },
      loading: {
        true: "cursor-wait",
      },
    },
    compoundVariants: [
      // Primary variants
      {
        loading: true,
        color: "primary",
        className: "opacity-30",
      },
      // Secondary variants
      {
        loading: true,
        color: "secondary",
        className: "bg-subtle text-emphasis/80",
      },
      // Minimal variants
      {
        loading: true,
        color: "minimal",
        className: "bg-subtle text-emphasis/30",
      },
      // Destructive variants
      {
        loading: true,
        color: "destructive",
        className:
          "text-red-700/30 dark:text-red-700/30 hover:text-red-700/30  border border-default text-emphasis",
      },
      {
        variant: "icon",
        size: "base",
        className: "min-h-[36px] min-w-[36px] p-2! hover:border-default",
      },
      {
        variant: "icon",
        size: "xs",
        className: "h-5 w-5 p-1! rounded-md",
      },
      {
        variant: "icon",
        size: "sm",
        className: "h-6 w-6 p-1! rounded-md",
      },
      {
        variant: "icon",
        size: "lg",
        className: "h-10 w-10 p-1!",
      },
      {
        variant: "fab",
        size: "base",
        className: "md:px-4 md:py-2.5",
      },
    ],
    defaultVariants: {
      variant: "button",
      color: "primary",
      size: "base",
    },
  },
);
