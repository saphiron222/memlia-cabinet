/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 * Memlia ports: title/footer/quickActions/toggle supplied by cabinet; no Projects customization/store.
 */
import type { ReactNode } from "react";
import { ScrollArea } from "@makeplane/propel/components/scroll-area";
import { AppSidebarToggleButton } from "./sidebar-toggle-button";
export function SidebarWrapper({
  title,
  children,
  quickActions,
  footer,
  toggleSidebar,
  sidebarCollapsed,
  disabled,
}: {
  title: string;
  children: ReactNode;
  quickActions?: ReactNode;
  footer?: ReactNode;
  toggleSidebar: () => void;
  sidebarCollapsed: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="flex h-full w-full animate-fade-in flex-col">
      <div className="flex flex-col gap-3 px-3">
        <div className="flex items-center justify-between gap-2 px-2">
          <span className="pt-1 text-16 font-medium text-primary">{title}</span>
          <div className="flex items-center gap-2">
            <AppSidebarToggleButton
              sidebarCollapsed={sidebarCollapsed}
              toggleSidebar={toggleSidebar}
              disabled={disabled}
            />
          </div>
        </div>
        {quickActions}
      </div>
      <ScrollArea orientation="vertical">
        <div className="flex flex-col gap-3 overflow-x-hidden px-3 pt-3 pb-0.5">
          {children}
        </div>
      </ScrollArea>
      <div className="flex min-h-12 items-center justify-between border-t border-subtle bg-surface-1 p-3">
        {footer}
      </div>
    </div>
  );
}
