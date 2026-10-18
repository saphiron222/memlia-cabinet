/** cal.diy Calendar — MIT, see LICENSE. DayPicker8→10 keys/icons port; canonical civil events are supplied by the caller. */
"use client";

import cn from "./classNames";
import {
  IconChevronLeft as ChevronLeftIcon,
  IconChevronRight as ChevronRightIcon,
} from "@tabler/icons-react";
import type * as React from "react";
import { DayPicker } from "react-day-picker";
import { buttonClasses } from "./buttonClasses";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3", className)}
      classNames={{
        months: "flex flex-col sm:flex-row stack-y-4 sm:space-x-4 sm:stack-y-0",
        month: "stack-y-4",
        month_caption: "flex pt-1 relative items-center justify-between",
        caption_label: "text-sm font-medium",
        nav: "flex items-center",
        weekdays: "flex w-full items-center justify-between",
        weekday: "w-8 md:w-11 h-8 text-sm font-medium text-default text-center",
        button_next: cn(buttonClasses({ color: "minimal", variant: "icon" })),
        month_grid: "w-full border-collapse stack-y-1",
        week: "flex w-full mt-0.5 gap-0.5",
        day: "w-8 h-8 md:h-11 md:w-11 text-center text-sm p-0 relative focus-within:relative focus-within:z-20",
        day_button: cn(
          buttonClasses({ color: "minimal" }),
          "w-8 h-8 md:h-11 md:w-11 p-0 text-sm font-medium aria-selected:opacity-100 inline-flex items-center justify-center",
        ),
        range_end: "hover:bg-inverted! text-inverted!",
        range_start: "hover:bg-inverted! text-inverted!",
        selected: "bg-inverted text-inverted",
        today: "",
        outside: "",
        disabled: "text-muted opacity-50",
        range_middle: "aria-selected:bg-emphasis aria-selected:text-emphasis",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation }) =>
          orientation === "left" ? (
            <ChevronLeftIcon className="h-4 w-4 stroke-2" />
          ) : (
            <ChevronRightIcon className="h-4 w-4 stroke-2" />
          ),
      }}
      {...props}
    />
  );
}
Calendar.displayName = "Calendar";

export { Calendar };
