/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 * Adapted sidebar-menu-items.tsx: a cabinet group replaces workspace store/pin lists; genuine Propel Collapsible and Plane row rendering retained.
 */
import { Collapsible } from "@makeplane/propel/components/collapsible";
import {
  SidebarItemBase,
  type CabinetNavigationItem,
} from "./workspace-sidebar-item";
import { SidebarProjectsListItem } from "./projects-list-item";
export function SidebarMenuItems({
  title,
  items,
  open,
  onOpenChange,
  onNavigate,
}: {
  title: string;
  items: CabinetNavigationItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate?: () => void;
}) {
  return (
    <Collapsible
      placement="sidebar"
      open={open}
      onOpenChange={onOpenChange}
      trigger={
        <span className="text-13 font-semibold whitespace-nowrap text-placeholder">
          {title}
        </span>
      }
    >
      <div className="flex flex-col gap-0.5">
        {items
          .filter((item) => !item.child)
          .map((item) => {
            const children = items.filter(
              (child) => child.child && child.href.split("?")[0] === item.href,
            );
            return children.length ? (
              <SidebarProjectsListItem
                key={item.key}
                item={item}
                items={children}
                onNavigate={onNavigate}
              />
            ) : (
              <SidebarItemBase
                key={item.key}
                item={item}
                onNavigate={onNavigate}
              />
            );
          })}
        {items
          .filter(
            (item) =>
              item.child &&
              !items.some(
                (parent) =>
                  !parent.child && item.href.split("?")[0] === parent.href,
              ),
          )
          .map((item) => (
            <SidebarItemBase
              key={item.key}
              item={item}
              onNavigate={onNavigate}
            />
          ))}
      </div>
    </Collapsible>
  );
}
