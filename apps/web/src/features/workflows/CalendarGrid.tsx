import { useState } from "react";
import type { CabinetRecord } from "@memlia/contracts";
import { fr } from "react-day-picker/locale";
import { Day, Week } from "react-day-picker";
import { Calendar } from "../../upstream/cal/Calendar";
import { formatCivilDate } from "./civil";
const dateOf = (r: CabinetRecord) =>
  r.kind === "tache" || r.kind === "obligation" ? r.data.dueDate : null;
export function CalendarGrid({
  items,
  anchor,
  today,
  week,
  onSelect,
}: {
  items: CabinetRecord[];
  anchor: string;
  today: string;
  week: boolean;
  onSelect: (r: CabinetRecord) => void;
}) {
  const [selected, setSelected] = useState<Date>();
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  const first = new Date(anchor + "T12:00:00Z");
  first.setUTCDate(first.getUTCDate() - ((first.getUTCDay() + 6) % 7));
  return (
    <Calendar
      className={"cal-cabinet-calendar" + (week ? " cal-cabinet-week" : "")}
      aria-label={week ? "Calendrier de la semaine" : "Calendrier du mois"}
      locale={fr}
      today={new Date(today + "T12:00:00Z")}
      timeZone="UTC"
      month={new Date(anchor + "T12:00:00Z")}
      weekStartsOn={1}
      fixedWeeks
      hideNavigation
      mode="single"
      selected={selected}
      onSelect={setSelected}
      classNames={{
        month_grid: "cal-month-grid",
        week: "cal-week",
        weekdays: "cal-weekdays",
        weekday: "cal-weekday",
        day: "cal-day",
        day_button: "cal-day-button",
        outside: "cal-outside",
        selected: "cal-selected",
        month_caption: "sr-only",
        months: "cal-months",
        month: "cal-month",
      }}
      components={{
        Week: ({ week: calendarWeek, ...props }) =>
          week &&
          !calendarWeek.days.some(
            (d) =>
              d.date.toISOString().slice(0, 10) ===
              first.toISOString().slice(0, 10),
          ) ? (
            <></>
          ) : (
            <Week week={calendarWeek} {...props} />
          ),
        Day: ({ day, children, ...props }) => {
          const date = day.date.toISOString().slice(0, 10);
          const events = items.filter((r) => dateOf(r) === date);
          const expanded = expandedDays.has(date);
          return (
            <Day day={day} {...props} aria-label={formatCivilDate(date)}>
              {children}
              <div className="cal-day-events">
                {events.slice(0, expanded ? events.length : 2).map((r) => (
                  <button
                    key={r.id}
                    className="calendar-event"
                    data-state={
                      r.kind === "tache"
                        ? r.data.state
                        : r.kind === "obligation"
                          ? r.data.preparation
                          : undefined
                    }
                    title={r.title}
                    onClick={() => onSelect(r)}
                  >
                    <span className="calendar-event-type">
                      {r.kind === "obligation" ? r.data.nature : "Tâche"}
                    </span>
                    <strong>{r.title}</strong>
                    <small>
                      {r.kind === "tache"
                        ? {
                            a_faire: "À faire",
                            en_cours: "En cours",
                            terminee: "Terminée",
                          }[r.data.state]
                        : "Échéance fiscale"}
                    </small>
                  </button>
                ))}
                {events.length > 2 && (
                  <button
                    className="calendar-more"
                    aria-expanded={expanded}
                    onClick={() =>
                      setExpandedDays((old) => {
                        const next = new Set(old);
                        expanded ? next.delete(date) : next.add(date);
                        return next;
                      })
                    }
                  >
                    {expanded ? "Réduire" : `+${events.length - 2} événements`}
                  </button>
                )}
              </div>
            </Day>
          );
        },
      }}
    />
  );
}
