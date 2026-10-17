import { CivilDateSchema } from "@memlia/contracts";

/** Cabinet civil-day convention, shared by dashboard and future calendars/recurrences. */
export function createCabinetCalendar(timeZone = "Europe/Paris") {
  let formatter: Intl.DateTimeFormat;
  try {
    if (typeof timeZone !== "string" || !timeZone) throw new Error();
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      calendar: "iso8601",
      numberingSystem: "latn",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    throw new Error("Fuseau du cabinet invalide.");
  }
  return (instant: Date): string => {
    const parts = formatter.formatToParts(instant);
    return CivilDateSchema.parse(
      ["year", "month", "day"]
        .map((type) => parts.find((part) => part.type === type)!.value)
        .join("-"),
    );
  };
}
