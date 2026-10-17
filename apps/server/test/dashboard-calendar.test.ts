import { it, expect } from "vitest";
import { fixture, dossier, task } from "./helpers.js";
import { createApplication } from "../src/app.js";

it.each([
  {
    instants: ["2026-10-17T22:30:00Z"],
    previous: "2026-10-17",
    today: "2026-10-18",
  },
  {
    instants: ["2026-12-17T23:30:00Z"],
    previous: "2026-12-17",
    today: "2026-12-18",
  },
  {
    instants: [
      "2026-10-24T22:30:00Z",
      "2026-10-25T00:30:00Z",
      "2026-10-25T01:30:00Z",
    ],
    previous: "2026-10-24",
    today: "2026-10-25",
  },
])(
  "dashboard uses the Paris civil day across midnight and DST: $today",
  async ({ instants, previous, today }) => {
    let instant = new Date(instants[0]!);
    const f = await fixture(() => instant);
    try {
      await f.setup();
      const parent = (await f.request("POST", "/records", dossier())).json();
      const records = [];
      for (const dueDate of [previous, today]) {
        const input = task(parent.id);
        input.record.data.dueDate = dueDate;
        const created = await f.request("POST", "/records", input);
        expect(created.statusCode).toBe(201);
        expect(created.json().data.dueDate).toBe(dueDate);
        records.push(created.json());
      }
      for (const value of instants) {
        instant = new Date(value);
        const response = await f.request("GET", "/dashboard");
        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({
          openTasks: 2,
          overdueTasks: 1,
          asOf: instant.toISOString(),
        });
      }
      for (const record of records)
        expect(
          (await f.request("GET", "/records/" + record.id)).json().data.dueDate,
        ).toBe(record.data.dueDate);
    } finally {
      await f.close();
    }
  },
);

it("dashboard respects an explicit cabinet zone independent of the host", async () => {
  const f = await fixture(() => new Date("2026-10-18T01:30:00Z"), {
    cabinetTimeZone: "America/New_York",
  });
  try {
    await f.setup();
    const parent = (await f.request("POST", "/records", dossier())).json();
    const input = task(parent.id);
    input.record.data.dueDate = "2026-10-17";
    expect((await f.request("POST", "/records", input)).statusCode).toBe(201);
    expect((await f.request("GET", "/dashboard")).json()).toMatchObject({
      openTasks: 1,
      overdueTasks: 0,
    });
  } finally {
    await f.close();
  }
});

it.each(["Invalid/Zone", ""])(
  "rejects an invalid cabinet time zone before opening storage: %s",
  async (cabinetTimeZone) => {
    await expect(
      createApplication({
        dataDirectory: "/not-used",
        publicOrigin: "http://localhost:3000",
        cabinetTimeZone,
      }),
    ).rejects.toThrow("Fuseau du cabinet invalide");
  },
);
