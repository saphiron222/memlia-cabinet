import { useState } from "react";
import { IconHome, IconBuilding, IconUsers, IconCheckbox, IconCalendar, IconBell, IconFiles, IconDownload, IconSettings, IconChevronDown, IconChartBar, IconListDetails, IconReceiptTax, IconUserCircle, IconSearch } from "@tabler/icons-react";

const groups = [
  { name: "Mon travail", links: [["accueil", "Accueil", IconHome], ["tache", "Tâches", IconCheckbox], ["calendrier", "Calendrier", IconCalendar], ["notifications", "Notifications", IconBell]] },
  { name: "Cabinet", links: [["dossier", "Dossiers", IconBuilding], ["contact", "Contacts", IconUsers]] },
  { name: "Échéances", links: [["fiscal", "Fiscalité", IconReceiptTax], ["fiscal?nature=TVA", "TVA", IconCalendar], ["fiscal?nature=IS", "IS", IconCalendar], ["fiscal?nature=CFE_IFER", "CFE / IFER", IconCalendar], ["obligation", "Obligations", IconListDetails]] },
  { name: "Production", links: [["production", "Production", IconChartBar], ["production?kind=balance", "Bilans", IconChartBar], ["production?kind=custom", "Échéances personnalisées", IconCalendar], ["production?kind=process", "Process", IconListDetails], ["production?kind=followup", "Suivis périodiques", IconListDetails]] },
  { name: "Documents & sources", links: [["documents", "Documents", IconFiles], ["collectes", "Collectes", IconDownload]] },
  { name: "Configuration", links: [["imports", "Reprise", IconDownload], ["administration", "Administration", IconSettings], ["compte", "Mon compte", IconUserCircle]] },
] as const;
export function Navigation({ hash, collapsed }: { hash: string; collapsed: boolean }) {
  const [closed, setClosed] = useState<string[]>([]), [search, setSearch] = useState("");
  const path = hash.replace(/^#/, "") || "accueil", page = path.split("?")[0];
  return <>
    {!collapsed && <label className="navigation-search"><IconSearch size={15} aria-hidden /><input aria-label="Rechercher un espace" placeholder="Rechercher un espace" value={search} onChange={e => setSearch(e.target.value)} /></label>}
    <nav aria-label="Navigation principale">{groups.map(group => {
      const links = group.links.filter(([, label]) => label.toLocaleLowerCase("fr").includes(search.toLocaleLowerCase("fr")));
      if (!links.length) return null;
      const open = !!search || !closed.includes(group.name);
      return <div className="navigation-group" key={group.name}>
        {!collapsed && <button className="navigation-heading" aria-expanded={open} onClick={() => setClosed(open ? [...closed, group.name] : closed.filter(g => g !== group.name))}>{group.name}<IconChevronDown size={12} aria-hidden /></button>}
        {(collapsed || open) && links.filter(([href]) => !collapsed || !href.includes("?")).map(([href, label, Icon]) => <a key={href} href={"#" + href} className={href.includes("?") ? "navigation-child" : undefined} aria-label={label} aria-current={(href.includes("?") ? path === href : page === href && !path.includes("nature=") && !path.includes("kind=")) ? "page" : undefined} title={collapsed ? label : undefined}><Icon size={16} aria-hidden /><span className={collapsed ? "sr-only" : undefined}>{label}</span></a>)}
      </div>;
    })}</nav>
  </>;
}
export function pageContext(page: string) {
  return groups.find(g => g.links.some(([href]) => href === page))?.name ?? "Cabinet";
}
