/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 * Memlia: project navigation mode/store replaced by explicit cabinet props.
 */
import type { ReactNode } from "react";
import { AppSidebarToggleButton } from "./sidebar-toggle-button";
export function ExtendedAppHeader({
  header,
  sidebarCollapsed,
  toggleSidebar,
}: {
  header: ReactNode;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
}) {
  return (
    <>
      {sidebarCollapsed && (
        <AppSidebarToggleButton
          sidebarCollapsed={sidebarCollapsed}
          toggleSidebar={toggleSidebar}
        />
      )}
      <div className="w-full">{header}</div>
    </>
  );
}
