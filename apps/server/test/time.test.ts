import { afterEach, expect, test } from "vitest";
import { fixture, dossier, task, operationId } from "./helpers.js";
let f: Awaited<ReturnType<typeof fixture>>;
afterEach(async () => {
  await f?.close();
  f = undefined!;
});
async function start() {
  f = await fixture(() => new Date("2026-10-17T10:00:00Z"));
  const actor = await f.setup();
  const parent = (await f.request("POST", "/records", dossier())).json();
  const t = (await f.request("POST", "/records", task(parent.id))).json();
  return { actor, parent, t };
}
async function save(
  data: Record<string, unknown>,
  old?: { id: string; version: number },
) {
  const r = await f.request("POST", "/time/entities", {
    id: old?.id ?? operationId(),
    expectedVersion: old?.version ?? 0,
    operationId: operationId(),
    data,
  });
  expect(r.statusCode, r.body).toBe(200);
  return r.json();
}
async function report(recordId: string) {
  const r = await f.request(
    "GET",
    `/time/report?from=2026-10-01&to=2026-10-31&recordId=${recordId}`,
  );
  expect(r.statusCode, r.body).toBe(200);
  return r.json();
}
test("cabinet 120, dossier 90, occurrence 45 and return to inheritance preserve explicit children and explain provenance", async () => {
  const { parent, t } = await start();
  let cabinet = await save({
    kind: "plan",
    level: "cabinet",
    targetId: null,
    minutes: 120,
    component: "variable",
  });
  expect((await report(t.id)).planned).toMatchObject({
    minutes: 120,
    source: "cabinet",
    override: false,
  });
  const d = await save({
    kind: "plan",
    level: "dossier",
    targetId: parent.id,
    minutes: 90,
    component: "variable",
  });
  expect((await report(t.id)).planned).toMatchObject({
    minutes: 90,
    source: "dossier",
    override: false,
  });
  let occurrence = await save({
    kind: "plan",
    level: "occurrence",
    targetId: t.id,
    minutes: 45,
    component: "variable",
  });
  cabinet = await save({ ...cabinet.data, minutes: 180 }, cabinet);
  expect((await report(t.id)).planned).toMatchObject({
    minutes: 45,
    source: "occurrence",
    override: true,
  });
  occurrence = await save({ ...occurrence.data, minutes: null }, occurrence);
  expect((await report(t.id)).planned).toMatchObject({
    minutes: 90,
    source: "dossier",
    override: false,
    sourceId: d.id,
  });
  await f.restart();
  expect((await report(t.id)).planned.minutes).toBe(90);
});
test("manual and timer time retain nature, explicit task link, seconds, replay safety, closed-period rate and employee privacy", async () => {
  let instant = new Date("2026-10-17T10:00:00Z");
  f = await fixture(() => instant);
  const actor = await f.setup();
  const parent = (await f.request("POST", "/records", dossier())).json();
  const t = (await f.request("POST", "/records", task(parent.id))).json();
  const nature = await save({ kind: "nature", name: "Révision", active: true });
  const rate = await save({
    kind: "rate",
    userId: null,
    from: "2026-10-01",
    to: "2026-10-31",
    hourlyAmount: "99.99",
    currency: "EUR",
  });
  const linked = await save({
    kind: "entry",
    userId: actor.id,
    date: "2026-10-17",
    natureId: nature.id,
    link: { kind: "record", id: t.id },
    seconds: 3600,
    source: "manual",
    timerId: null,
    rate: null,
  });
  await save({
    ...linked.data,
    link: { kind: "free", label: t.title },
    seconds: 600,
  });
  expect((await report(t.id)).realizedSeconds).toBe(3600);
  const start = {
    operationId: operationId(),
    date: "2026-10-17",
    natureId: nature.id,
    link: { kind: "record", id: t.id },
  };
  const started = await f.request("POST", "/time/timers/start", start);
  expect(started.statusCode, started.body).toBe(200);
  const timer = started.json();
  const another = await f.request("POST", "/time/timers/start", {
    ...start,
    operationId: operationId(),
  });
  expect(another.statusCode).toBe(409);
  instant = new Date("2026-10-17T10:01:31Z");
  const stop = { operationId: operationId(), expectedVersion: 1 };
  const stopped = await f.request(
    "POST",
    `/time/timers/${timer.id}/stop`,
    stop,
  );
  expect(stopped.statusCode, stopped.body).toBe(200);
  expect(
    (await f.request("POST", `/time/timers/${timer.id}/stop`, stop)).json(),
  ).toEqual(stopped.json());
  expect(
    (
      await f.request("POST", `/time/timers/${timer.id}/stop`, {
        ...stop,
        operationId: operationId(),
      })
    ).statusCode,
  ).toBe(409);
  expect((await report(t.id)).realizedSeconds).toBe(3691);
  let lock = await save({
    kind: "period",
    from: "2026-10-01",
    to: "2026-10-31",
    closed: true,
    reason: "Contrôle terminé",
  });
  const blocked = await f.request("POST", "/time/entities", {
    operationId: operationId(),
    id: rate.id,
    expectedVersion: rate.version,
    data: { ...rate.data, hourlyAmount: "120.00" },
  });
  expect(blocked.statusCode).toBe(409);
  await save({ ...nature.data, active: false }, nature);
  expect((await report(t.id)).entries[0].data.rate.hourlyAmount).toBe("99.99");
  const u = await f.request("POST", "/users", {
    operationId: operationId(),
    email: "person@example.test",
    name: "Personne fictive",
    password: "UnMotDePasseFictif123!",
    permissions: [{ action: "read", kind: "*", dossierId: null }],
  });
  expect(u.statusCode, u.body).toBe(201);
  const login = await f.request(
    "POST",
    "/login",
    { email: "person@example.test", password: "UnMotDePasseFictif123!" },
    "",
  );
  const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
  const privateReport = await f.request(
    "GET",
    "/time/report?from=2026-10-01&to=2026-10-31",
    undefined,
    cookie,
  );
  expect(privateReport.json().realizedSeconds).toBe(0);
  expect(
    (
      await f.request(
        "GET",
        `/time/report?from=2026-10-01&to=2026-10-31&userId=${actor.id}`,
        undefined,
        cookie,
      )
    ).statusCode,
  ).toBe(404);
  lock = await save(
    { ...lock.data, closed: false, reason: "Correction autorisée" },
    lock,
  );
  await f.restart();
  expect((await report(t.id)).realizedSeconds).toBe(3691);
});
test("dated forfait late activity, midmonth change, weighted role collaborators and extra task contribute once with capacity provenance", async () => {
  const { actor, parent, t } = await start();
  const person = (
    await f.request("POST", "/users", {
      operationId: operationId(),
      email: "second@example.test",
      name: "Deuxième fictif",
      password: "UnMotDePasseFictif123!",
      permissions: [],
    })
  ).json();
  const roleResponse = await f.request("POST", "/administration/roles", {
    operationId: operationId(),
    order: 0,
    name: "Comptabilité",
    permissions: [],
  });
  expect(roleResponse.statusCode, roleResponse.body).toBe(201);
  const role = roleResponse.json();
  await save({
    kind: "capacity",
    userId: null,
    from: "2026-10-01",
    to: "2026-10-31",
    dailyMinutes: [420, 420, 420, 420, 420, 0, 0],
  });
  await save({
    kind: "capacity",
    userId: person.id,
    from: "2026-10-01",
    to: "2026-10-31",
    dailyMinutes: [210, 210, 210, 210, 210, 0, 0],
  });
  for (const userId of [actor.id, person.id])
    await save({
      kind: "assignment",
      dossierId: parent.id,
      roleId: role.id,
      userId,
      from: "2026-10-01",
      to: "2026-10-31",
      weight: 1,
      policyVersion: 1,
    });
  await save({
    kind: "forfait",
    dossierId: parent.id,
    roleId: role.id,
    from: "2026-10-01",
    to: "2026-10-15",
    activityStart: "2026-10-10",
    monthlyMinutes: 310,
    amount: "100.00",
    currency: "EUR",
    prorating: "calendar_days",
    policyVersion: 1,
  });
  await save({
    kind: "forfait",
    dossierId: parent.id,
    roleId: role.id,
    from: "2026-10-16",
    to: "2026-10-31",
    activityStart: "2026-10-10",
    monthlyMinutes: 620,
    amount: "200.00",
    currency: "EUR",
    prorating: "calendar_days",
    policyVersion: 1,
  });
  await save({
    kind: "plan",
    level: "occurrence",
    targetId: t.id,
    minutes: 45,
    component: "variable",
  });
  await save({
    kind: "allocation",
    target: { kind: "record", id: t.id },
    from: "2026-10-01",
    to: "2026-10-31",
    weights: [{ userId: actor.id, weight: 1 }],
    policyVersion: 1,
  });
  const r = await f.request(
    "GET",
    "/time/workload?from=2026-10-01&to=2026-10-31",
  );
  expect(r.statusCode, r.body).toBe(200);
  const w = r.json();
  expect(
    w.rows.reduce(
      (s: number, r: { plannedMinutes: number }) => s + (r.plannedMinutes ?? 0),
      0,
    ),
  ).toBe(425);
  expect(w.people.find((p: { id: string }) => p.id === actor.id)).toMatchObject(
    { plannedMinutes: 235, capacityMinutes: 9240, capacitySource: "cabinet" },
  );
  expect(
    w.people.find((p: { id: string }) => p.id === person.id),
  ).toMatchObject({
    plannedMinutes: 190,
    capacityMinutes: 4620,
    capacitySource: "individual",
  });
});
