/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 * Memlia: observer/store replaced by cabinet props; header Row/classes retained.
 */
import type { ReactNode } from "react";
import { Row } from "./row";
import { cn } from "./cn";
import { ExtendedAppHeader } from "./extended-app-header";
export function AppHeader({
  header,
  mobileHeader,
  className,
  rowClassName,
  sidebarCollapsed,
  toggleSidebar,
}: {
  header: ReactNode;
  mobileHeader?: ReactNode;
  className?: string;
  rowClassName?: string;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
}) {
  return (
    <div className={cn("z-[18]", className)}>
      <Row
        className={cn(
          "flex h-11 w-full items-center gap-2 border-b border-subtle bg-surface-1",
          rowClassName,
        )}
      >
        <ExtendedAppHeader
          header={header}
          sidebarCollapsed={sidebarCollapsed}
          toggleSidebar={toggleSidebar}
        />
      </Row>
      {mobileHeader && mobileHeader}
    </div>
  );
}
