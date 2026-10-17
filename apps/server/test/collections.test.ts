import { CollectionInputSchema } from "@memlia/contracts";
import { expect, it } from "vitest";
import { fixture, dossier, operationId } from "./helpers.js";
const input = (dossierId: string, extra = {}) =>
  CollectionInputSchema.parse({
    operationId: operationId(),
    connectorId: "dgfip-cfe",
    mode: "simulation",
    credentialRef: "fixture-account",
    cabinetRef: "cabinet-fictif",
    scope: {
      dossierId,
      companyId: "001234567",
      accountId: "COMPTE-FICTIF",
      establishmentId: "00123456700011",
      contributorId: "COTISANT-FICTIF",
      service: "consultation",
      profile: "employeur",
    },
    period: { from: "2026-01-01", to: "2026-12-31" },
    scenario: "nominal",
    ...extra,
  });
async function done(f: Awaited<ReturnType<typeof fixture>>, id: string) {
  for (let i = 0; i < 200; i++) {
    const r = await f.request("GET", "/collections/" + id);
    expect(r.statusCode).toBe(200);
    if (["completed", "failed"].includes(r.json().job.state)) return r.json();
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("collecte non terminée");
}
it("CFE fictive : identité, période, référence et original GED durable sans doublon", async () => {
  const f = await fixture();
  try {
    await f.setup();
    const d = (await f.request("POST", "/records", dossier())).json();
    const command = input(d.id);
    const r = await f.request("POST", "/collections", command);
    expect(r.statusCode).toBe(202);
    const result = await done(f, r.json().job.id);
    expect(result.result).toMatchObject({
      mode: "simulation",
      status: "complete",
      records: [
        {
          reference: "CFE-FICTIF-2026",
          period: command.period,
          scope: command.scope,
          provenance: { mode: "simulation" },
          data: {
            kind: "tax-notice",
            tax: "CFE",
            amountCents: 125000,
            directDebitEnabled: true,
            paymentObserved: false,
          },
        },
      ],
    });
    const artifact = result.result.artifacts[0];
    expect(artifact.source.kind).toBe("simulation:dgfip-cfe");
    const pdf = await f.request(
      "GET",
      "/documents/" + artifact.id + "/download",
    );
    expect(pdf.statusCode).toBe(200);
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.rawPayload.toString()).toContain("CFE-FICTIF-2026");
    expect(pdf.rawPayload.toString()).toContain("125000");
    expect(pdf.rawPayload.toString()).toContain("2026-12-15");
    const replay = await f.request("POST", "/collections", command);
    expect(replay.json().job.id).toBe(result.job.id);
    expect(
      (
        await f.request("POST", "/collections", {
          ...command,
          scenario: "empty",
        })
      ).statusCode,
    ).toBe(409);
    await f.restart();
    expect((await done(f, result.job.id)).result.artifacts[0].id).toBe(
      artifact.id,
    );
  } finally {
    await f.close();
  }
});
it.each([
  ["wrong-identity", "needs-human"],
  ["missing-page", "partial"],
  ["html-login", "needs-human"],
  ["empty", "empty-observed"],
  ["unavailable", "not-available"],
  ["interrupted", "complete"],
])(
  "CFE scénario %s : couverture conservatrice %s",
  async (scenario, status) => {
    const f = await fixture();
    try {
      await f.setup();
      const d = (await f.request("POST", "/records", dossier())).json();
      const r = await f.request(
        "POST",
        "/collections",
        input(d.id, { scenario }),
      );
      expect(r.statusCode).toBe(202);
      const result = await done(f, r.json().job.id);
      expect(result.result.status).toBe(status);
      if (scenario === "interrupted") {
        expect(result.job.attempts).toBe(2);
        expect(result.result.artifacts).toHaveLength(1);
      }
      if (["wrong-identity", "html-login"].includes(scenario))
        expect(result.result.artifacts).toHaveLength(0);
    } finally {
      await f.close();
    }
  },
);
it("mode réel refusé sans produire de travail", async () => {
  const f = await fixture();
  try {
    await f.setup();
    const d = (await f.request("POST", "/records", dossier())).json();
    const r = await f.request(
      "POST",
      "/collections",
      input(d.id, { mode: "real" }),
    );
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe("REAL_MODE_DISABLED");
  } finally {
    await f.close();
  }
});
export { input, done };
it("17 adaptateurs explicites : variantes métier, axes et provenance ne créent ni déclaration ni paiement", async () => {
  const f = await fixture();
  try {
    await f.setup();
    const d = (await f.request("POST", "/records", dossier())).json();
    const catalogue = (await f.request("GET", "/collections/catalogue")).json();
    expect(catalogue.items).toHaveLength(17);
    const results: Record<string, any> = {};
    for (const c of catalogue.items) {
      const r = await f.request(
        "POST",
        "/collections",
        input(d.id, { connectorId: c.id, scenario: "variation" }),
      );
      expect(r.statusCode).toBe(202);
      const run = await done(f, r.json().job.id);
      expect(run.job.state).toBe("completed");
      results[c.id] = run.result;
      expect(
        run.result.records.every(
          (r: any) => r.provenance.mode === "simulation",
        ),
      ).toBe(true);
      expect(
        run.result.artifacts.every(
          (r: any) => r.source.kind === "simulation:" + c.id,
        ),
      ).toBe(true);
    }
    expect(
      results["dgfip-dettes"].records.map((r: any) => r.data.kind).sort(),
    ).toEqual(["debt", "settlement"]);
    expect(
      results["dgfip-dettes"].records.find(
        (r: any) => r.data.kind === "settlement",
      ).data,
    ).toMatchObject({ nature: "remission", paymentReference: null });
    expect(results["dgfip-messages"]).toMatchObject({
      status: "partial",
      records: [{ data: { attachmentsMissing: 1, unreadBefore: true } }],
      artifacts: [],
    });
    expect(results["urssaf-messages"].records).toHaveLength(1);
    expect(results["urssaf-messages"].records[0].data.portfolios).toEqual([
      "PORTEFEUILLE-A",
      "PORTEFEUILLE-B",
    ]);
    expect(results["jedeclare-retours"].status).toBe("partial");
    expect(
      results["jedeclare-retours"].records.find(
        (r: any) => r.data.recipient === "DESTINATAIRE-B",
      ).data,
    ).toMatchObject({ state: "pending", expectedReturnPolicy: "unknown" });
    expect(results["pennylane-dossiers"].records[0].data.connection).toBe(
      "firm-api",
    );
    expect(results["pennylane-echeances"].records[0].data).toMatchObject({
      connection: "tax-data-sharing",
      accepted: null,
      paymentValidated: true,
      bankPaymentObserved: false,
      isExpected: false,
    });
    expect(results["inpi-creations"].records[0].data).toMatchObject({
      event: "modification",
      scope: "public-rne",
      privateFormalityAccess: false,
    });
    expect(results["inpi-comptes"].artifacts).toEqual([]);
    for (const profile of ["TI", "PAM"] as const) {
      const command = input(d.id, {
        connectorId: "urssaf-echeances",
        scenario: "variation",
      });
      command.scope.profile = profile;
      const r = await f.request("POST", "/collections", command);
      const run = await done(f, r.json().job.id);
      expect(
        run.result.records.find((r: any) => r.data.contributionYear === 2026)
          .data,
      ).toMatchObject({
        profile,
        axis: profile === "TI" ? "provisional" : "called",
        incomeYear: 2025,
        paymentObserved: false,
      });
    }
    expect(
      (await f.request("GET", "/records?kind=obligation")).json().total,
    ).toBe(0);
  } finally {
    await f.close();
  }
});
it("second passage déduplique, HTML reste refusé après succès, période et établissement erronés arrêtent l’acquisition", async () => {
  const f = await fixture();
  try {
    await f.setup();
    const d = (await f.request("POST", "/records", dossier())).json();
    const a = (await f.request("POST", "/collections", input(d.id))).json();
    const first = await done(f, a.job.id);
    const b = (await f.request("POST", "/collections", input(d.id))).json();
    const second = await done(f, b.job.id);
    expect(second.result.records[0].id).toBe(first.result.records[0].id);
    expect(second.result.artifacts[0].id).toBe(first.result.artifacts[0].id);
    const html = (
      await f.request(
        "POST",
        "/collections",
        input(d.id, { scenario: "html-login" }),
      )
    ).json();
    expect((await done(f, html.job.id)).result.status).toBe("needs-human");
    for (const field of [
      "accountId",
      "contributorId",
      "establishmentId",
      "service",
    ]) {
      const command = input(d.id);
      command.scope = { ...command.scope, [field]: "INCORRECT" };
      const r = (await f.request("POST", "/collections", command)).json();
      expect((await done(f, r.job.id)).result).toMatchObject({
        status: "needs-human",
        artifacts: [],
        records: [],
      });
    }
    for (const field of ["cabinetRef", "credentialRef"]) {
      const command = input(d.id, { [field]: "AUTRE-CONTEXTE" });
      const run = (await f.request("POST", "/collections", command)).json();
      expect((await done(f, run.job.id)).result).toMatchObject({
        status: "needs-human",
        artifacts: [],
        records: [],
      });
    }
    const command = input(d.id, {
      period: { from: "2025-01-01", to: "2025-12-31" },
    });
    const r = (await f.request("POST", "/collections", command)).json();
    expect((await done(f, r.job.id)).result.status).toBe("needs-human");
  } finally {
    await f.close();
  }
});
it("droits courants : lecture, lancement et pièces restent dans le dossier autorisé", async () => {
  const f = await fixture();
  try {
    await f.setup();
    const d = (await f.request("POST", "/records", dossier())).json();
    const run = await done(
      f,
      (await f.request("POST", "/collections", input(d.id))).json().job.id,
    );
    const created = (
      await f.request("POST", "/users", {
        operationId: operationId(),
        name: "Lecteur fictif",
        email: "collectes@example.test",
        password: "UnMotDePasseFictif123!",
        permissions: [{ action: "read", kind: "dossier", dossierId: d.id }],
      })
    ).json();
    const login = await f.request(
      "POST",
      "/login",
      { email: created.email, password: "UnMotDePasseFictif123!" },
      "",
    );
    const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
    expect(
      (await f.request("GET", "/collections/" + run.job.id, undefined, cookie))
        .statusCode,
    ).toBe(200);
    expect(
      (await f.request("POST", "/collections", input(d.id), cookie)).statusCode,
    ).toBe(404);
    expect(
      (
        await f.request(
          "GET",
          "/documents/" + run.result.artifacts[0].id + "/download",
          undefined,
          cookie,
        )
      ).statusCode,
    ).toBe(404);
    await f.request("PUT", "/users/" + created.id, {
      operationId: operationId(),
      expectedVersion: created.version,
      active: true,
      permissions: [],
    });
    expect(
      (await f.request("GET", "/collections/" + run.job.id, undefined, cookie))
        .statusCode,
    ).toBe(404);
    expect(
      (await f.request("GET", "/collections/" + run.job.id, undefined, ""))
        .statusCode,
    ).toBe(401);
  } finally {
    await f.close();
  }
});
it("rollback après GED : recrée la préparation et engage une seule observation après reprise", async () => {
  const { JobRunner } = await import("../src/jobs/runner.js");
  const { CollectionService } = await import("../src/collections/service.js");
  const { DocumentStore } = await import("../src/documents/store.js");
  const f = await fixture();
  try {
    const actor = await f.setup();
    const d = (await f.request("POST", "/records", dossier())).json();
    await f.maintainDatabase(async (db) => {
      let reject = true;
      const wrapped = {
        ...db,
        transaction: <T>(
          work: (
            tx: import("../src/storage/database.js").Connection,
          ) => Promise<T>,
        ) =>
          db.transaction((tx) =>
            work({
              query: async (sql, params) => {
                if (
                  reject &&
                  sql.startsWith("INSERT INTO cabinet_collection_snapshots")
                ) {
                  reject = false;
                  throw Error("Interruption SQL fictive");
                }
                return tx.query(sql, params);
              },
            }),
          ),
      };
      const runner = new JobRunner(wrapped);
      const service = new CollectionService(
        wrapped,
        runner,
        new DocumentStore(f.options.dataDirectory),
        () => new Date(),
      );
      const id = await wrapped.transaction((tx) =>
        service.enqueue(tx, actor, input(d.id)),
      );
      await runner.tick();
      expect(await db.query("SELECT id FROM cabinet_documents")).toEqual([]);
      expect(
        await db.query("SELECT identity FROM cabinet_collection_observations"),
      ).toEqual([]);
      const before = await db.transaction((tx) => runner.get(tx, id));
      expect(before.checkpoint).toEqual({ page: 0, lastReference: null });
      await runner.tick();
      const result = await db.transaction((tx) => service.get(tx, actor, id));
      expect(result.result?.status).toBe("complete");
      expect(await db.query("SELECT id FROM cabinet_documents")).toHaveLength(
        1,
      );
      expect(
        await db.query("SELECT identity FROM cabinet_collection_observations"),
      ).toHaveLength(1);
      expect(result.job.attempts).toBe(2);
      await runner.stop();
    });
  } finally {
    await f.close();
  }
});
it("révocation pendant préparation : aucun original publié, aucune observation ni checkpoint avancé", async () => {
  const { JobRunner } = await import("../src/jobs/runner.js");
  const { CollectionService } = await import("../src/collections/service.js");
  const { DocumentStore } = await import("../src/documents/store.js");
  const f = await fixture();
  try {
    const actor = await f.setup();
    const d = (await f.request("POST", "/records", dossier())).json();
    await f.maintainDatabase(async (db) => {
      class RevokingStore extends DocumentStore {
        override async prepare(
          ...args: Parameters<InstanceType<typeof DocumentStore>["prepare"]>
        ) {
          const handle = await super.prepare(...args);
          await db.transaction(async (tx) => {
            await tx.query(
              "UPDATE cabinet_users SET permissions='[]'::jsonb WHERE id=$1",
              [actor.id],
            );
          });
          return handle;
        }
      }
      const runner = new JobRunner(db);
      const service = new CollectionService(
        db,
        runner,
        new RevokingStore(f.options.dataDirectory),
        () => new Date(),
      );
      const id = await db.transaction((tx) =>
        service.enqueue(tx, actor, input(d.id)),
      );
      await runner.tick();
      await runner.tick();
      await runner.tick();
      const result = await db.transaction((tx) => runner.get(tx, id));
      expect(result.job.state).toBe("failed");
      expect(result.checkpoint).toEqual({ page: 0, lastReference: null });
      expect(await db.query("SELECT id FROM cabinet_documents")).toEqual([]);
      expect(
        await db.query("SELECT identity FROM cabinet_collection_observations"),
      ).toEqual([]);
      await runner.stop();
    });
  } finally {
    await f.close();
  }
});
