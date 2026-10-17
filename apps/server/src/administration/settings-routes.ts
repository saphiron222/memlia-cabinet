import type { FastifyInstance } from "fastify";
import {
  InstallationInfoSchema,
  InstallationCommandSchema,
  AccountSchema,
  AccountCommandSchema,
  PreferencesSchema,
} from "@memlia/contracts";
import type { RouteContext } from "../context.js";
import { installation, preferences, updateInstallation } from "./settings.js";
import { requireGlobal } from "../records/permissions.js";
import { effectiveUser } from "../identity/service.js";
import { idempotent } from "../storage/operations.js";
import { fail } from "../errors.js";
export function registerSettingsRoutes(
  app: FastifyInstance,
  { db, user, now }: RouteContext,
  timeZone: string,
) {
  app.get("/api/v1/administration/installation", async (req) =>
    db.transaction(async (tx) => {
      const actor = await user(tx, req),
        p = await installation(tx);
      const manager = actor.permissions.some(
        (p) =>
          p.action === "manage_users" && p.kind === "*" && p.dossierId === null,
      );
      let usage: null | {
        records: number;
        documents: number;
        documentBytes: number;
        users: number;
        pendingJobs: number;
      } = null;
      if (manager) {
        const r = (
          await tx.query(
            "SELECT (SELECT count(*) FROM cabinet_records) AS records,(SELECT count(*) FROM cabinet_documents) AS documents,(SELECT COALESCE(sum((content->>'size')::bigint),0) FROM cabinet_documents) AS bytes,(SELECT count(*) FROM cabinet_users) AS users,(SELECT count(*) FROM cabinet_jobs WHERE state IN ('queued','running')) AS jobs",
          )
        )[0]!;
        usage = {
          records: Number(r.records),
          documents: Number(r.documents),
          documentBytes: Number(r.bytes),
          users: Number(r.users),
          pendingJobs: Number(r.jobs),
        };
      }
      return InstallationInfoSchema.parse({
        ...p,
        delivery: "local",
        applicationVersion: "0.1.0",
        cabinetTimeZone: timeZone,
        usage,
        commercialDocuments: [],
        modules: [
          ...[
            {
              id: "ged",
              label: "Documents du cabinet",
              impact:
                "La désactivation bloque l’ajout et les nouvelles versions. Les originaux restent consultables.",
            },
            {
              id: "collectes",
              label: "Collectes simulées",
              impact:
                "La désactivation bloque les nouvelles collectes et les prochains engagements des traitements en attente. Aucun fournisseur réel n’est connecté.",
            },
            {
              id: "imports",
              label: "Reprise CSV / XLSX",
              impact:
                "La désactivation bloque les nouveaux aperçus et engagements. Les aperçus et rapports restent conservés.",
            },
            {
              id: "recherche_publique",
              label: "Recherche publique d’entreprises",
              impact:
                "La désactivation bloque la recherche publique et ses propositions. Les dossiers conservés restent accessibles.",
            },
          ].map((m) => ({
            ...m,
            availability: "available",
            enabled: p.enabledModules.includes(
              m.id as (typeof p.enabledModules)[number],
            ),
            connection:
              m.id === "collectes" ? "simulation_only" : "not_required",
            usable: p.enabledModules.includes(
              m.id as (typeof p.enabledModules)[number],
            ),
          })),
          {
            id: "signature",
            label: "Signature électronique",
            availability: "future",
            enabled: false,
            connection: "not_connected",
            usable: false,
            impact:
              "Traitements de signature à construire et qualifier avant disponibilité.",
          },
          {
            id: "fournisseurs_reels",
            label: "Connexions réelles aux fournisseurs",
            availability: "future",
            enabled: false,
            connection: "not_connected",
            usable: false,
            impact:
              "Aucune connexion réelle activée. Validation en cabinet en dernière phase.",
          },
          {
            id: "assistant_dossier",
            label: "Assistant de dossier",
            availability: "future",
            enabled: false,
            connection: "not_connected",
            usable: false,
            impact:
              "Proposition désactivée ; aucun contenu de dossier transmis.",
          },
        ],
      });
    }),
  );
  app.put("/api/v1/administration/installation", async (req) => {
    const input = InstallationCommandSchema.parse(req.body);
    return db.transaction(async (tx) => {
      const actor = await user(tx, req);
      return updateInstallation(tx, actor, input, now());
    });
  });
  app.get("/api/v1/account", async (req) =>
    db.transaction(async (tx) => {
      const actor = await user(tx, req);
      return AccountSchema.parse({
        profile: actor,
        preferences: await preferences(tx, actor.id),
      });
    }),
  );
  app.put("/api/v1/account", async (req) => {
    const input = AccountCommandSchema.parse(req.body);
    return db.transaction(async (tx) => {
      const actor = await user(tx, req);
      return idempotent(
        tx,
        actor,
        input.operationId,
        { action: "account.update", input },
        async () => {
          const prior = await preferences(tx, actor.id);
          if (
            prior.version !== input.expectedVersion ||
            actor.version !== input.expectedUserVersion
          )
            fail(
              409,
              "VERSION_CONFLICT",
              "Votre profil ou vos préférences ont changé.",
            );
          const next = PreferencesSchema.parse({
            theme: input.theme,
            density: input.density,
            sidebarCollapsed: input.sidebarCollapsed,
            widgetOrder: input.widgetOrder,
            version: prior.version + 1,
          });
          await tx.query(
            "INSERT INTO cabinet_preferences(user_id,content) VALUES($1,$2::jsonb) ON CONFLICT(user_id) DO UPDATE SET content=EXCLUDED.content",
            [actor.id, JSON.stringify(next)],
          );
          await tx.query(
            "UPDATE cabinet_users SET name=$1,version=version+1 WHERE id=$2",
            [input.name, actor.id],
          );
          const current = await effectiveUser(
            tx,
            (
              await tx.query("SELECT * FROM cabinet_users WHERE id=$1", [
                actor.id,
              ])
            )[0]!,
          );
          await tx.query(
            "INSERT INTO cabinet_identity_events(id,actor_id,event) VALUES($1,$2,$3::jsonb)",
            [
              input.operationId,
              actor.id,
              JSON.stringify({
                action: "account.updated",
                name: input.name,
                preferences: next,
                at: now().toISOString(),
              }),
            ],
          );
          return AccountSchema.parse({ profile: current, preferences: next });
        },
      );
    });
  });
}
