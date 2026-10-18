/** cal.diy PanelCard — MIT, see LICENSE. Locale/icons/Button ports; no animation hook so reduced motion stays respected. */
"use client";

import type { ReactNode } from "react";
import { useId, useState, useRef } from "react";

import classNames from "./classNames";

import { Button } from "@memlia/ui";
import { IconChevronUp } from "@tabler/icons-react";

export function PanelCard({
  title,
  subtitle,
  cta,
  headerContent,
  className,
  titleTooltip,
  children,
  collapsible = false,
  defaultCollapsed = false,
  ...dataAttributes
}: {
  title: string | ReactNode;
  subtitle?: string;
  cta?: { label: string; onClick: () => void };
  headerContent?: ReactNode;
  className?: string;
  titleTooltip?: string;
  children: ReactNode;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
} & Record<`data-${string}`, string | undefined>) {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);
  const contentId = useId();
  const titleId = useId();
  const animationParent = useRef<HTMLDivElement>(null);

  const toggleCollapse = () => {
    setIsCollapsed((prev) => !prev);
  };

  const isStringTitle = typeof title === "string";

  return (
    <div
      data-testid="panel-card"
      ref={animationParent}
      className={classNames(
        "bg-cal-muted group relative flex w-full flex-col items-center rounded-2xl px-1",
        !isCollapsed && "pb-1",
        className,
      )}
      {...dataAttributes}
    >
      <div className="flex h-11 w-full shrink-0 items-center justify-between gap-2 px-4">
        <div className="flex shrink-0 items-center gap-1">
          {collapsible && (
            <Button
              size="sm"
              variant="ghost"
              startIcon={
                <IconChevronUp
                  className={classNames(
                    "text-default h-4 w-4 transition-transform",
                    isCollapsed && "rotate-180",
                  )}
                />
              }
              onClick={toggleCollapse}
              className="text-muted -ml-2"
              aria-expanded={!isCollapsed}
              aria-controls={contentId}
              aria-label={`${isCollapsed ? "Déplier" : "Replier"} ${typeof title === "string" ? title : "la section"}`}
            />
          )}
          {isStringTitle ? (
            <div className="mr-4 flex shrink-0 items-center gap-1">
              <h2
                id={titleId}
                className="text-emphasis shrink-0 text-sm font-semibold"
              >
                {collapsible ? (
                  <button
                    type="button"
                    onClick={toggleCollapse}
                    className="text-left transition-opacity hover:opacity-80"
                    aria-expanded={!isCollapsed}
                    aria-controls={contentId}
                    aria-label={`${isCollapsed ? "Déplier" : "Replier"} ${typeof title === "string" ? title : "la section"}`}
                  >
                    {title as string}
                  </button>
                ) : (
                  (title as string)
                )}
              </h2>
              {titleTooltip && (
                <span title={titleTooltip} aria-label={titleTooltip}>
                  ⓘ
                </span>
              )}
            </div>
          ) : (
            title
          )}
        </div>
        <div className="no-scrollbar flex items-center gap-2 overflow-x-auto">
          {headerContent}
          {cta && (
            <Button
              className="shrink-0"
              variant="outline"
              onClick={cta.onClick}
            >
              {cta.label}
            </Button>
          )}
        </div>
      </div>
      {!(isCollapsed && collapsible) && (
        <div
          id={contentId}
          role="region"
          aria-labelledby={isStringTitle ? titleId : undefined}
          className="bg-default border-muted w-full grow gap-3 rounded-xl border"
        >
          {subtitle && (
            <h3 className="text-subtle border-muted border-b p-3 text-sm font-medium leading-none">
              {subtitle}
            </h3>
          )}
          {children}
        </div>
      )}
    </div>
  );
}
