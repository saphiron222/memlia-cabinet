/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See LICENSE. Adapted accordion rendering from workspace/sidebar/projects-list-item.tsx.
 * No project publication, foreign account/store, drag reorder or issue-drop command:
 * cabinet sections have fixed order; their canonical routes remain explicit links.
 */
import { useState } from "react";
import { IconButton } from "@makeplane/propel/components/icon-button";
import { ChevronRightOutline } from "@makeplane/propel/icons";
import { cn } from "./cn";
import { ProjectNavigation } from "./project-navigation";
import type { CabinetNavigationItem } from "./workspace-sidebar-item";
export function SidebarProjectsListItem({
  item,
  items,
  onNavigate,
}: {
  item: CabinetNavigationItem;
  items: CabinetNavigationItem[];
  onNavigate?: () => void;
}) {
  const [isProjectListOpen, setIsProjectListOpen] = useState(true);
  return (
    <div className="relative">
      <div
        className={cn(
          "group/project-item relative flex w-full items-center rounded-md px-2 py-1.5 text-primary hover:bg-layer-transparent-hover",
          { "bg-layer-transparent-active": item.isActive },
        )}
      >
        <a
          href={item.href}
          onClick={onNavigate}
          aria-current={item.isActive ? "page" : undefined}
          className="flex flex-grow truncate"
        >
          <div className="flex w-full flex-grow items-center gap-1.5 text-left select-none">
            <div className="grid size-4 flex-shrink-0 place-items-center">
              {item.icon}
            </div>
            <p className="truncate text-13 font-medium text-secondary">
              {item.label}
            </p>
          </div>
        </a>
        <span className="inline-flex text-placeholder">
          <IconButton
            variant="ghost"
            size="xs"
            icon={
              <ChevronRightOutline
                className={cn("size-3.5 transition-transform", {
                  "rotate-90": isProjectListOpen,
                })}
              />
            }
            onClick={() => setIsProjectListOpen(!isProjectListOpen)}
            aria-expanded={isProjectListOpen}
            aria-label={`${isProjectListOpen ? "Replier" : "Déplier"} ${item.label}`}
          />
        </span>
      </div>
      {isProjectListOpen && (
        <div className="relative mt-1 mb-1.5 flex flex-col gap-0.5 pl-6">
          <div className="absolute top-0 bottom-1 left-[15px] w-[1px] bg-layer-3" />
          <ProjectNavigation items={items} onNavigate={onNavigate} />
        </div>
      )}
    </div>
  );
}
