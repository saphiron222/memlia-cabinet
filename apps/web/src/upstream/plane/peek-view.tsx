/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only — see LICENSE.
 * Port of issues/peek-overview/view.tsx, side-peek presentation branch.
 * Canonical content/commands are supplied as children. Native modal dialog supplies
 * focus isolation/Escape instead of Plane's portal/issue-store/keypress lifecycle.
 */
import type { ComponentProps } from "react";
import { cn } from "./cn";
export function PeekView({
  className,
  style,
  children,
  ...props
}: ComponentProps<"dialog">) {
  const peekOverviewIssueClassName = cn(
    "absolute z-[25] flex flex-col overflow-hidden rounded-sm border border-subtle bg-surface-1 transition-all duration-300",
    "top-0 right-0 bottom-0 w-full border-0 border-l md:w-[50%]",
    className,
  );
  return (
    <dialog
      {...props}
      className={peekOverviewIssueClassName}
      style={{
        boxShadow:
          "0px 4px 8px 0px rgba(0, 0, 0, 0.12), 0px 6px 12px 0px rgba(16, 24, 40, 0.12), 0px 1px 16px 0px rgba(16, 24, 40, 0.12)",
        ...style,
      }}
    >
      <div className="vertical-scrollbar relative scrollbar-md h-full w-full overflow-hidden overflow-y-auto">
        {children}
      </div>
    </dialog>
  );
}
