/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 * Memlia: store/i18n ports are explicit props; original Propel control retained.
 */
import { LeftSidePaneOutline } from "@makeplane/propel/icons";
import { IconButton } from "@makeplane/propel/components/icon-button";
import { Icon } from "@makeplane/propel/components/icon";
export function AppSidebarToggleButton({
  sidebarCollapsed,
  toggleSidebar,
  disabled = false,
}: {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  disabled?: boolean;
}) {
  return (
    <IconButton
      size="sm"
      variant="ghost"
      icon={<Icon icon={LeftSidePaneOutline} />}
      aria-label={
        sidebarCollapsed ? "Déplier la navigation" : "Replier la navigation"
      }
      aria-expanded={!sidebarCollapsed}
      disabled={disabled}
      onClick={toggleSidebar}
    />
  );
}
