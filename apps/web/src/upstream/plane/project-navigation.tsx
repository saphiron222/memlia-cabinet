/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See LICENSE. Port of workspace/sidebar/project-navigation.tsx rendering.
 * Cabinet route/rights props replace project, issue, permissions and Next stores.
 */
import { SidebarNavItem } from "./sidebar-navigation";
import type { CabinetNavigationItem } from "./workspace-sidebar-item";
export function ProjectNavigation({
  items,
  onNavigate,
}: {
  items: CabinetNavigationItem[];
  onNavigate?: () => void;
}) {
  return (
    <>
      {items
        .filter((item) => item.allowed !== false)
        .map((item) => (
          <a
            key={item.key}
            href={item.href}
            onClick={onNavigate}
            aria-current={item.isActive ? "page" : undefined}
          >
            <SidebarNavItem isActive={item.isActive}>
              <div className="flex w-full items-center justify-between gap-1.5 py-[1px]">
                <div className="flex items-center gap-1.5">
                  {item.icon}
                  <span className="text-11 font-medium">{item.label}</span>
                </div>
              </div>
            </SidebarNavItem>
          </a>
        ))}
    </>
  );
}
