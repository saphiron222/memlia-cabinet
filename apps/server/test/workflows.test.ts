import { afterEach, expect, test } from "vitest";
import { fixture, dossier, operationId } from "./helpers.js";
let f: Awaited<ReturnType<typeof fixture>>;
afterEach(async () => {
  await f?.close();
});
async function start() {
  f = await fixture(() => new Date("2026-10-17T10:00:00Z"));
  const actor = await f.setup();
  const parent = (await f.request("POST", "/records", dossier())).json();
  return { actor, parent };
}
const monthly = {
  frequency: "monthly",
  start: "2027-01-01",
  end: "2028-03-31",
  nominalDay: 31,
  lastDay: false,
  weekDay: 1,
};
test("civil recurrence preserves nominal 31 through short months, leap years, DST and past starts", async () => {
  await start();
  for (const [rule, from, to, want] of [
    [
      monthly,
      "2027-02-01",
      "2027-04-30",
      ["2027-02-28", "2027-03-31", "2027-04-30"],
    ],
    [monthly, "2028-02-01", "2028-02-29", ["2028-02-29"]],
    [
      { ...monthly, frequency: "quarterly" },
      "2027-01-01",
      "2027-12-31",
      ["2027-01-31", "2027-04-30", "2027-07-31", "2027-10-31"],
    ],
    [
      {
        ...monthly,
        frequency: "yearly",
        start: "2024-02-01",
        end: "2028-12-31",
      },
      "2027-01-01",
      "2028-12-31",
      ["2027-02-28", "2028-02-29"],
    ],
    [
      {
        ...monthly,
        frequency: "weekly",
        start: "2026-03-01",
        end: "2026-04-30",
        weekDay: 7,
      },
      "2026-03-22",
      "2026-04-05",
      ["2026-03-22", "2026-03-29", "2026-04-05"],
    ],
  ] as const) {
    const response = await f.request("POST", "/workflows/preview", {
      rule,
      from,
      to,
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().dates).toEqual(want);
  }
});
