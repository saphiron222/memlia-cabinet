import { afterEach, expect, test } from "vitest";
import { fixture, operationId, dossier } from "./helpers.js";
let f: Awaited<ReturnType<typeof fixture>>;
afterEach(async () => {
  await f?.close();
});
test("installation et compte : identité persistante, préférences personnelles et aucun abonnement fictif", async () => {
  f = await fixture();
  const admin = await f.setup();
  const installation = await f.request("GET", "/administration/installation");
  expect(installation.statusCode).toBe(200);
  const initial = installation.json();
  expect(initial.id).toMatch(/^[a-f0-9-]{36}$/);
  expect(initial.delivery).toBe("local");
  expect(initial.usage.records).toBe(0);
  const saved = await f.request("PUT", "/administration/installation", {
    operationId: operationId(),
    expectedVersion: initial.version,
    name: "Cabinet A fictif",
    enabledModules: initial.enabledModules,
  });
  expect(saved.statusCode).toBe(200);
  const preferences = (await f.request("GET", "/account")).json();
  const changed = await f.request("PUT", "/account", {
    operationId: operationId(),
    expectedVersion: preferences.preferences.version,
    expectedUserVersion: admin.version,
    name: "Mon nom fictif",
    theme: "dark",
    density: "compact",
    sidebarCollapsed: true,
    widgetOrder: ["obligations", "tasks"],
  });
  expect(changed.statusCode).toBe(200);
  await f.restart();
  expect((await f.request("GET", "/account")).json()).toMatchObject({
    profile: { name: "Mon nom fictif" },
    preferences: {
      theme: "dark",
      density: "compact",
      widgetOrder: ["obligations", "tasks"],
    },
  });
  expect(
    (await f.request("GET", "/administration/installation")).json(),
  ).toMatchObject({ id: initial.id, name: "Cabinet A fictif" });
  const actualA = (
    await f.request("POST", "/records", dossier("Cabinet A seulement"))
  ).json();
  const other = await fixture();
  try {
    await other.setup();
    const b = (
      await other.request("GET", "/administration/installation")
    ).json();
    expect(b.id).not.toBe(initial.id);
    expect(
      (await other.request("GET", "/account")).json().preferences.theme,
    ).toBe("system");
    expect(
      (await other.request("GET", `/records/${actualA.id}`)).statusCode,
    ).toBe(404);
    expect(
      (await other.request("GET", "/records?q=Cabinet")).json().items,
    ).toEqual([]);
    expect(
      (await other.request("GET", "/dashboard")).json().counts.dossier,
    ).toBe(0);
  } finally {
    await other.close();
  }
});
test("module GED retiré après préparation : engagement refusé, original antérieur toujours conservé", async () => {
  f = await fixture();
  const actor = await f.setup();
  const d = (await f.request("POST", "/records", dossier())).json();
  const { DocumentStore } = await import("../src/documents/store.js");
  const { DocumentInputSchema } = await import("@memlia/contracts");
  const store = new DocumentStore(f.options.dataDirectory);
  const input = DocumentInputSchema.parse({
    operationId: operationId(),
    dossierId: d.id,
    filename: "fictif.txt",
    mediaType: "text/plain",
    source: { kind: "manual", reference: "fictif", version: "1" },
  });
  const prepared = await store.prepare(input, Buffer.from("fictif"));
  const state = (await f.request("GET", "/administration/installation")).json();
  expect(
    (
      await f.request("PUT", "/administration/installation", {
        operationId: operationId(),
        expectedVersion: state.version,
        name: state.name,
        enabledModules: state.enabledModules.filter((m: string) => m !== "ged"),
      })
    ).statusCode,
  ).toBe(200);
  await f.maintainDatabase(async (db) => {
    await expect(
      db.transaction((tx) => store.commit(tx, actor, prepared, new Date())),
    ).rejects.toMatchObject({ code: "MODULE_DISABLED" });
  });
  await store.discard(prepared);
  expect((await f.request("GET", "/documents")).json().total).toBe(0);
});

test("module collectes retiré dans la file : aucune observation ni pièce engagée", async () => {
  f = await fixture();
  const actor = await f.setup();
  const d = (await f.request("POST", "/records", dossier())).json();
  const { JobRunner } = await import("../src/jobs/runner.js"),
    { CollectionService } = await import("../src/collections/service.js"),
    { DocumentStore } = await import("../src/documents/store.js"),
    { CollectionInputSchema } = await import("@memlia/contracts"),
    { installation, updateInstallation } =
      await import("../src/administration/settings.js");
  await f.maintainDatabase(async (db) => {
    const runner = new JobRunner(db),
      store = new DocumentStore(f.options.dataDirectory),
      service = new CollectionService(db, runner, store, () => new Date());
    const input = CollectionInputSchema.parse({
      operationId: operationId(),
      connectorId: "dgfip-cfe",
      mode: "simulation",
      credentialRef: "fixture-account",
      cabinetRef: "fictif",
      scope: {
        dossierId: d.id,
        companyId: "001234567",
        accountId: "COMPTE-FICTIF",
        establishmentId: "00123456700011",
        contributorId: "COTISANT-FICTIF",
        service: "consultation",
        profile: "employeur",
      },
      period: { from: "2026-01-01", to: "2026-12-31" },
      scenario: "nominal",
    });
    const id = await db.transaction((tx) => service.enqueue(tx, actor, input));
    await db.transaction(async (tx) => {
      const p = await installation(tx);
      await updateInstallation(
        tx,
        actor,
        {
          operationId: operationId(),
          expectedVersion: p.version,
          name: p.name,
          enabledModules: p.enabledModules.filter((m) => m !== "collectes"),
        },
        new Date(),
      );
    });
    await runner.tick();
    await runner.tick();
    await runner.tick();
    const result = await db.transaction((tx) => service.get(tx, actor, id));
    expect(result.job.state).toBe("failed");
    expect(result.result).toBeNull();
    await expect(
      db.transaction((tx) => service.enqueue(tx, actor, input)),
    ).rejects.toMatchObject({ code: "MODULE_DISABLED" });
    await runner.stop();
  });
  expect((await f.request("GET", "/documents")).json().total).toBe(0);
});
