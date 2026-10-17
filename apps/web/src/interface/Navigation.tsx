import { useState, type ReactNode } from "react";
import { SidebarWrapper } from "../upstream/plane/sidebar-wrapper";
import { SidebarMenuItems } from "../upstream/plane/sidebar-menu-items";
import { ResizableSidebar } from "../upstream/plane/resizable-sidebar";
import { SIDEBAR_WIDTH } from "../upstream/plane/constants";
import { InputField } from "@makeplane/propel/components/input-field";
import {
  IconHome,
  IconBuilding,
  IconUsers,
  IconCheckbox,
  IconCalendar,
  IconBell,
  IconFiles,
  IconDownload,
  IconSettings,
  IconChevronDown,
  IconChartBar,
  IconListDetails,
  IconReceiptTax,
  IconUserCircle,
  IconSearch,
} from "@tabler/icons-react";

const groups = [
  {
    name: "Mon travail",
    links: [
      ["accueil", "Accueil", IconHome],
      ["tache", "Tâches", IconCheckbox],
      ["calendrier", "Calendrier", IconCalendar],
      ["notifications", "Notifications", IconBell],
    ],
  },
  {
    name: "Cabinet",
    links: [
      ["dossier", "Dossiers", IconBuilding],
      ["contact", "Contacts", IconUsers],
    ],
  },
  {
    name: "Échéances",
    links: [
      ["fiscal", "Fiscalité", IconReceiptTax],
      ["fiscal?nature=TVA", "TVA", IconCalendar],
      ["fiscal?nature=IS", "IS", IconCalendar],
      ["fiscal?nature=CFE_IFER", "CFE / IFER", IconCalendar],
      ["obligation", "Obligations", IconListDetails],
    ],
  },
  {
    name: "Production",
    links: [
      ["production", "Production", IconChartBar],
      ["production?kind=balance", "Bilans", IconChartBar],
      ["production?kind=custom", "Échéances personnalisées", IconCalendar],
      ["production?kind=process", "Process", IconListDetails],
      ["production?kind=followup", "Suivis périodiques", IconListDetails],
    ],
  },
  {
    name: "Documents & sources",
    links: [
      ["documents", "Documents", IconFiles],
      ["collectes", "Collectes", IconDownload],
    ],
  },
  {
    name: "Configuration",
    links: [
      ["imports", "Reprise", IconDownload],
      ["administration", "Administration", IconSettings],
      ["compte", "Mon compte", IconUserCircle],
    ],
  },
] as const;
export function Navigation({
  hash,
  collapsed,
  toggle,
  disabled,
  footer,
  onWidthChange,
}: {
  hash: string;
  collapsed: boolean;
  toggle: () => void;
  disabled: boolean;
  footer: ReactNode;
  onWidthChange: (width: number) => void;
}) {
  const [closed, setClosed] = useState<string[]>([]),
    [search, setSearch] = useState(""),
    [width, setWidth] = useState(SIDEBAR_WIDTH),
    [peek, setPeek] = useState(false);
  const path = hash.replace(/^#/, "") || "accueil",
    page = path.split("?")[0],
    params = new URLSearchParams(path.split("?")[1]);
  const active = (href: string) => {
    const [target, search] = href.split("?");
    return (
      page === target &&
      (search
        ? [...new URLSearchParams(search)].every(
            ([key, value]) => params.get(key) === value,
          )
        : !params.has("nature") && !params.has("kind"))
    );
  };
  const navigation = (
    <SidebarWrapper
      title="Memlia Cabinet"
      sidebarCollapsed={collapsed}
      toggleSidebar={toggle}
      disabled={disabled}
      footer={footer}
      quickActions={
        <InputField
          size="lg"
          orientation="vertical"
          aria-label="Rechercher un espace"
          placeholder="Rechercher un espace"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      }
    >
      <nav aria-label="Navigation principale" className="flex flex-col gap-3">
        {groups.map((group) => {
          const links = group.links.filter(([, label]) =>
            label
              .toLocaleLowerCase("fr")
              .includes(search.toLocaleLowerCase("fr")),
          );
          if (!links.length) return null;
          return (
            <SidebarMenuItems
              key={group.name}
              title={group.name}
              open={!!search || !closed.includes(group.name)}
              onOpenChange={(open) =>
                setClosed(
                  open
                    ? closed.filter((g) => g !== group.name)
                    : [...closed, group.name],
                )
              }
              onNavigate={() => {
                setPeek(false);
                if (innerWidth < 768 && !collapsed) toggle();
              }}
              items={links.map(([href, label, Icon]) => ({
                key: href,
                href: "#" + href,
                label,
                icon: <Icon size={16} aria-hidden />,
                isActive: active(href),
                child: href.includes("?"),
              }))}
            />
          );
        })}
      </nav>
    </SidebarWrapper>
  );
  return (
    <div className="plane-sidebar-host">
      <ResizableSidebar
        width={width}
        setWidth={setWidth}
        onWidthChange={onWidthChange}
        isCollapsed={collapsed}
        toggleCollapsed={toggle}
        showPeek={peek}
        togglePeek={(value) => setPeek(value ?? !peek)}
      >
        {navigation}
      </ResizableSidebar>
    </div>
  );
}
export function pageContext(page: string) {
  return (
    groups.find((g) => g.links.some(([href]) => href === page))?.name ??
    "Cabinet"
  );
}
