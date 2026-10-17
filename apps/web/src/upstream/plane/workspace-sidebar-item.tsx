/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 * Memlia ports: authorized route props replace Next, MobX, i18n, pin preferences and workspace slug.
 */
import type { ReactNode } from "react";
import { SidebarNavItem } from "./sidebar-navigation";
export type CabinetNavigationItem = {
  key: string;
  href: string;
  label: string;
  icon: ReactNode;
  isActive: boolean;
  allowed?: boolean;
  child?: boolean;
};
export function SidebarItemBase({
  item,
  onNavigate,
}: {
  item: CabinetNavigationItem;
  onNavigate?: () => void;
}) {
  if (item.allowed === false) return null;
  return (
    <a
      href={item.href}
      onClick={onNavigate}
      aria-label={item.label}
      aria-current={item.isActive ? "page" : undefined}
      className={item.child ? "pl-4" : undefined}
    >
      <SidebarNavItem isActive={item.isActive}>
        <div className="flex items-center gap-1.5 py-[1px]">
          {item.icon}
          <p className="text-13 leading-5 font-medium">{item.label}</p>
        </div>
      </SidebarNavItem>
    </a>
  );
}
