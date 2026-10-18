/** Copyright (c) 2023-present Plane Software, Inc. and contributors.
 * AGPL-3.0-only, see LICENSE. Port of kanban/block.tsx presentation branch.
 * Canonical children/drag events replace issue-store links, virtualizer and mutation hooks.
 * Card is an article so its explicit move selector and open link remain separate controls.
 */
import type { ComponentProps } from "react";
import { cn } from "./cn";
export function KanbanCard({
  children,
  className,
  ...props
}: ComponentProps<"article">) {
  return (
    <article {...props} className="group/kanban-block relative mb-2">
      <div
        className={cn(
          "block w-full rounded-lg border border-subtle bg-layer-2 p-3 text-13 shadow-raised-100 outline-[0.5px] outline-transparent transition-all hover:border-strong hover:shadow-raised-200",
          className,
        )}
      >
        <div className="space-y-2">{children}</div>
      </div>
    </article>
  );
}
