import { useState, type ReactNode } from "react";
import { Day } from "react-day-picker";
import { fr } from "react-day-picker/locale";
import type { CabinetRecord } from "@memlia/contracts";
import { Calendar } from "../../upstream/cal/Calendar";
import { PanelCard } from "../../upstream/cal/PanelCard";
import { KanbanCard } from "../../upstream/plane/kanban-card";
import { formatCivilDate } from "./civil";

const due = (record: CabinetRecord) =>
  record.kind === "tache" || record.kind === "obligation"
    ? record.data.dueDate
    : null;
/** Memlia composition of the actual Cal Calendar + PanelCard and Plane KanbanCard ports.
 * DayPicker owns annual month/day structure, selection and keyboard navigation.
 * Counts and event links use only the current canonical provider page. */
export function AnnualCalendar({
  items,
  year,
  today,
  renderEvent,
}: {
  items: CabinetRecord[];
  year: string;
  today: string;
  renderEvent: (record: CabinetRecord) => ReactNode;
}) {
  const [selected, setSelected] = useState<Date>();
  const selectedDate = selected?.toISOString().slice(0, 10);
  const visible = selectedDate
    ? items.filter((record) => due(record) === selectedDate)
    : items;
  return (
    <div className="annual-calendar" aria-label="Calendrier annuel">
      <Calendar
        className="cal-annual"
        locale={fr}
        timeZone="UTC"
        month={new Date(year + "-01-01T12:00:00Z")}
        numberOfMonths={12}
        weekStartsOn={1}
        fixedWeeks
        hideNavigation
        showOutsideDays={false}
        today={new Date(today + "T12:00:00Z")}
        mode="single"
        selected={selected}
        onSelect={setSelected}
        classNames={{
          months: "annual-months",
          month: "annual-month",
          week: "annual-week",
          weekdays: "annual-weekdays",
          weekday: "annual-weekday",
          day: "annual-day",
          day_button: "annual-day-button",
          month_grid: "annual-month-grid",
        }}
        components={{
          Day: ({ day, children, ...props }) => {
            const date = day.date.toISOString().slice(0, 10);
            const count = items.filter((record) => due(record) === date).length;
            return (
              <Day
                day={day}
                {...props}
                aria-label={`${formatCivilDate(date)} · ${count} événement${count === 1 ? "" : "s"} sur cette page`}
              >
                {children}
                {count > 0 && (
                  <span className="annual-day-count" aria-hidden="true">
                    {count}
                  </span>
                )}
              </Day>
            );
          },
        }}
      />
      <PanelCard
        title={
          selectedDate
            ? "Échéances du " + formatCivilDate(selectedDate)
            : "Échéances de cette page"
        }
        subtitle={`${visible.length} événement${visible.length === 1 ? "" : "s"} chargé${visible.length === 1 ? "" : "s"} · les compteurs portent sur cette page`}
        cta={
          selectedDate
            ? { label: "Tous les jours", onClick: () => setSelected(undefined) }
            : undefined
        }
      >
        {visible.length ? (
          visible.map((record) => (
            <KanbanCard key={record.id}>{renderEvent(record)}</KanbanCard>
          ))
        ) : (
          <p className="muted">Aucune échéance chargée ce jour.</p>
        )}
      </PanelCard>
    </div>
  );
}
