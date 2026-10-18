import { z } from "zod";
import type { FastifyInstance } from "fastify";
import {
  CollectionCatalogueSchema,
  CollectionInputSchema,
  CollectionScenarioSchema,
} from "@memlia/contracts";
import type { RouteContext } from "../context.js";
import type { CollectionService } from "./service.js";
import {
  collectorLabels,
  fixtureIdentity,
  fixturePeriod,
} from "../../fixtures/collections.js";
export function registerCollectionRoutes(
  app: FastifyInstance,
  { db, user }: RouteContext,
  service: CollectionService,
) {
  app.get("/api/v1/collections/catalogue", async (req) =>
    db.transaction(async (tx) => {
      await user(tx, req);
      return CollectionCatalogueSchema.parse({
        items: Object.entries(collectorLabels).map(([id, label]) => ({
          id,
          label,
          mode: "simulation",
          realAvailable: false,
        })),
        scenarios: CollectionScenarioSchema.options,
        fixture: { identity: fixtureIdentity, period: fixturePeriod },
      });
    }),
  );
  app.post("/api/v1/collections", async (req, reply) => {
    const input = CollectionInputSchema.parse(req.body);
    const result = await db.transaction(async (tx) => {
      const actor = await user(tx, req);
      const id = await service.enqueue(tx, actor, input);
      return service.get(tx, actor, id);
    });
    reply.code(202);
    return result;
  });
  app.get("/api/v1/collections/:id", async (req) =>
    db.transaction(async (tx) => {
      const actor = await user(tx, req);
      const { id } = z.object({ id: z.uuid() }).parse(req.params);
      return service.get(tx, actor, id);
    }),
  );
}
