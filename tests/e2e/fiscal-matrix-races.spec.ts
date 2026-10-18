import { test, expect } from "@playwright/test";
import type { CabinetRecord } from "@memlia/contracts";
const origin = "http://127.0.0.1:4191";
test.use({ baseURL: origin });
test("matrix pages: obsolete filters cannot merge, double trigger locks and cursor is independent of deduplication", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Nom complet").fill("Camille fictive");
  await page.getByLabel("Adresse email").fill("matrix-race@example.test");
  await page.getByLabel("Mot de passe").fill("MotDePasseFictif123!");
  await page.getByRole("button", { name: "Créer le cabinet" }).click();
  await page
    .getByRole("navigation", { name: "Navigation principale" })
    .waitFor();
  const post = async (path: string, data: unknown) => {
    const response = await page.request.post("/api/v1" + path, {
      headers: { origin },
      data,
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  };
  const dossier = await post("/records", {
    operationId: crypto.randomUUID(),
    record: { kind: "dossier", title: "Dossier fictif pagination", data: {} },
  });
  const fiscal = (
    await post("/fiscal", {
      operationId: crypto.randomUUID(),
      dossierId: dossier.id,
      title: "Occurrence modèle fictive",
      nature: "TVA",
      period: {
        start: "2026-09-01",
        end: "2026-09-30",
        campaign: "2026",
        subtype: "CA3",
      },
    })
  ).record;
  const occurrence = (title: string, month = "10"): CabinetRecord => ({
    ...fiscal,
    id: crypto.randomUUID(),
    title,
    data: { ...fiscal.data, dueDate: `2026-${month}-17` },
  });
  const initial = Array.from({ length: 200 }, (_, i) =>
    occurrence(`Octobre ${i}`),
  );
  const stale = occurrence("Réponse obsolète octobre");
  const fresh = occurrence("Novembre courant", "11");
  const added = [
    occurrence("Suite unique 1"),
    occurrence("Suite unique 2"),
    occurrence("Suite unique 3"),
  ];
  await page.route("**/api/v1/fiscal/matrix?*", async (route) => {
    const november =
      new URL(route.request().url()).searchParams.get("month") === "11";
    await route.fulfill({
      json: {
        rows: [
          {
            dossier,
            occurrences: november ? [fresh] : initial,
            total: november ? 1 : 203,
            complete: november,
          },
        ],
        total: 1,
        offset: 0,
        limit: 25,
      },
    });
  });
  let release: (() => void) | undefined;
  let finished: Promise<void> = Promise.resolve();
  const offsets: number[] = [];
  let phase = "stale";
  await page.route("**/api/v1/fiscal?*", async (route) => {
    const offset = Number(
      new URL(route.request().url()).searchParams.get("offset"),
    );
    offsets.push(offset);
    const currentPhase = phase;
    let finish!: () => void;
    finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await route
      .fulfill({
        json: {
          items:
            currentPhase === "stale"
              ? [stale]
              : offset === 200
                ? [initial[199], added[0]]
                : added.slice(1),
          total: 203,
          offset,
          limit: 200,
        },
      })
      .catch(() => {});
    finish();
  });
  await page.goto("/#fiscal?nature=TVA&year=2026&month=10");
  const more = page.getByRole("button", {
    name: /Charger les occurrences suivantes/,
  });
  await more.click();
  await expect.poll(() => offsets.length).toBe(1);
  await page.goto("/#fiscal?nature=TVA&year=2026&month=11");
  await expect(
    page.getByRole("link", { name: "Ouvrir Novembre courant", exact: true }),
  ).toBeVisible();
  release!();
  await finished;
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(page.locator(".matrix-occurrence")).toHaveCount(1);
  await expect(more).toHaveCount(0);
  phase = "deduplicate";
  await page.goto("/#fiscal?nature=TVA&year=2026&month=10");
  await more.waitFor();
  await more.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect.poll(() => offsets.length).toBe(2);
  await expect(more).toBeDisabled();
  release!();
  await expect(more).toContainText("201/203");
  await expect(
    page.getByRole("link", { name: "Ouvrir Octobre 199", exact: true }),
  ).toHaveCount(1);
  await more.click();
  await expect.poll(() => offsets.length).toBe(3);
  expect(offsets).toEqual([200, 200, 202]);
  release!();
  await expect(page.locator(".matrix-occurrence")).toHaveCount(203);
  await expect(more).toHaveCount(0);
  await expect(
    page.getByRole("link", {
      name: "Ouvrir Réponse obsolète octobre",
      exact: true,
    }),
  ).toHaveCount(0);
});
