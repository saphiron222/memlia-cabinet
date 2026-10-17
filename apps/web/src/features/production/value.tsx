import {
  IconCircle,
  IconCheck,
  IconClock,
  IconAlertCircle,
  IconMinus,
} from "@tabler/icons-react";
import type { ProductionColumn, ProductionModel } from "@memlia/contracts";
import { formatCivilDate } from "../workflows/civil";
const icons = {
  circle: IconCircle,
  check: IconCheck,
  clock: IconClock,
  alert: IconAlertCircle,
  minus: IconMinus,
};
export function StageValue({
  column,
  value,
  models,
}: {
  column: ProductionColumn;
  value: string | boolean | null;
  models: ProductionModel[];
}) {
  if (value === null) return <span className="muted">À renseigner</span>;
  if (column.type === "status") {
    const m = models.find((m) => m.id === column.stageTypeId);
    const s =
      m?.model.kind === "stage_type"
        ? m.model.statuses.find((s) => s.id === value)
        : null;
    if (s) {
      const Icon = icons[s.icon];
      return (
        <span className={"production-status status-" + s.color}>
          <Icon size={14} />
          {s.name}
        </span>
      );
    }
  }
  return (
    <span>
      {column.type === "date"
        ? formatCivilDate(String(value))
        : typeof value === "boolean"
          ? value
            ? "Oui"
            : "Non"
          : column.type === "completion"
            ? ({
                done: "Fait",
                not_done: "Non fait",
                not_applicable: "Non applicable",
              }[String(value)] ?? String(value))
            : String(value)}
    </span>
  );
}
export { productionValueFinal as completed } from "@memlia/contracts";

export const columnTypeLabel = {
  status: "Statut",
  date: "Date",
  text: "Texte",
  boolean: "Oui / non",
  decimal: "Montant",
  completion: "Réalisation",
};
export const frequencyLabel = {
  once: "Ponctuelle",
  monthly: "Mensuelle",
  quarterly: "Trimestrielle",
  yearly: "Annuelle",
};
