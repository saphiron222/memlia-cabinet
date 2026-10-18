import type { FastifyRequest } from "fastify";
import type { SessionUser } from "@memlia/contracts";
import type { Connection, Database } from "./storage/database.js";
export interface RouteContext {
  db: Database;
  now: () => Date;
  user: (tx: Connection, request: FastifyRequest) => Promise<SessionUser>;
}
