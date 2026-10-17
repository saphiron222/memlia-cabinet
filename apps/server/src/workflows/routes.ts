import type { FastifyInstance } from "fastify";
import { RecurrencePreviewSchema, previewOccurrences } from "@memlia/contracts";
import type { RouteContext } from "../context.js";
export function registerWorkflowRoutes(
  app: FastifyInstance,
  { db, user }: RouteContext,
) {
  app.post("/api/v1/workflows/preview", async (req) =>
    db.transaction(async (tx) => {
      await user(tx, req);
      const i = RecurrencePreviewSchema.parse(req.body);
      return { dates: previewOccurrences(i.rule, i.from, i.to) };
    }),
  );
}
