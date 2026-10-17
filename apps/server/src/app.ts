import { registerChecklistImportRoutes } from "./workflows/imports.js";
import { Reminders } from "./notifications/reminders.js";
import { registerNotificationRoutes } from "./notifications/routes.js";
import { registerWorkflowRoutes } from "./workflows/routes.js";
import { registerFiscalRoutes } from "./fiscal/routes.js";
import { registerExportRoutes, Exports } from "./administration/export.js";
import { registerScopeRoutes } from "./administration/scopes.js";
import { registerViewRoutes } from "./administration/views.js";
import { initializeInstallation } from "./administration/settings.js";
import { registerSettingsRoutes } from "./administration/settings-routes.js";
import { ImportParser } from "./imports/parser.js";
import { Imports } from "./imports/service.js";
import { registerImportRoutes } from "./imports/routes.js";
import { registerCompanyRoutes } from "./administration/companies.js";
import { registerCustomFieldRoutes } from "./administration/custom-fields.js";
import { registerCapabilitiesRoutes } from "./administration/capabilities.js";
import { registerAdministrationRoutes } from "./administration/routes.js";
import { createCabinetCalendar } from "./civil-date.js";
import { LoginThrottle } from "./identity/login-throttle.js";
import { registerWeb } from "./web.js";
import { mkdir, access } from "node:fs/promises";
import { constants } from "node:fs";
import { JobRunner } from "./jobs/runner.js";
import { CollectionService } from "./collections/service.js";
import { registerCollectionRoutes } from "./collections/routes.js";
import multipart from "@fastify/multipart";
import { registerDocumentRoutes } from "./documents/routes.js";
import { DocumentStore } from "./documents/store.js";
import { DOCUMENT_MAX_BYTES, HealthSchema } from "@memlia/contracts";
import { timingSafeEqual } from "node:crypto";
import Fastify, { type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { z, ZodError } from "zod";
import {
  ApiErrorSchema,
  SessionSchema,
  SetupInputSchema,
  SetupStatusSchema,
  LoginInputSchema,
} from "@memlia/contracts";
import { openDatabase, type Connection } from "./storage/database.js";
import { ApiFault, fail } from "./errors.js";
import {
  adminPermissions,
  createUser,
  authenticate,
  issueSession,
  login,
} from "./identity/service.js";
import { registerUserRoutes } from "./identity/routes.js";
import { registerRecordRoutes } from "./records/routes.js";
import { digest } from "./identity/security.js";
export interface ApplicationOptions {
  dataDirectory: string;
  /** Fixed public API or local HTTP fixture only. */
  companySearchOrigin?: string;
  exportPartBytes?: number;
  csvSyncRows?: number;
  publicOrigin: string;
  databaseUrl?: string;
  allowEmbeddedDatabase?: boolean;
  clock?: () => Date;
  /** Cabinet civil time, independent of host TZ; defaults to Europe/Paris. */
  cabinetTimeZone?: string;
  bootstrapToken?: string;
  webDirectory?: string;
  /** Maximum in-memory login accounts, default 5000; lower bounds support small installations/tests. */
  loginThrottleCapacity?: number;
}
export async function createApplication(options: ApplicationOptions) {
  const publicOrigin = new URL(options.publicOrigin).origin;
  if (options.publicOrigin !== publicOrigin)
    throw new Error("publicOrigin doit être une origine sans chemin.");
  const requiresToken =
    Boolean(options.bootstrapToken) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(
      new URL(publicOrigin).hostname,
    );
  if (options.bootstrapToken && options.bootstrapToken.length < 32)
    throw new Error(
      "Le jeton d’initialisation doit contenir au moins 32 caractères aléatoires.",
    );
  const loginCapacity = options.loginThrottleCapacity ?? 5000;
  if (
    !Number.isInteger(loginCapacity) ||
    loginCapacity < 1 ||
    loginCapacity > 5000
  )
    throw new Error(
      "La capacité des connexions doit être comprise entre 1 et 5000.",
    );
  const civilDate = createCabinetCalendar(options.cabinetTimeZone);
  const db = await openDatabase(options);
  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 });
  const now = options.clock ?? (() => new Date());
  await db.transaction((tx) => initializeInstallation(tx, now()));
  const loginThrottle = new LoginThrottle(now, loginCapacity);
  await app.register(cookie);
  await app.register(multipart, {
    limits: {
      fileSize: DOCUMENT_MAX_BYTES,
      files: 1,
      fields: 1,
      parts: 2,
      fieldSize: 8192,
    },
    preservePath: true,
  });
  await app.register(rateLimit, {
    global: false,
    max: 10,
    timeWindow: "15 minutes",
  });
  const jobs = new JobRunner(db, now);
  const importParser = new ImportParser();
  app.addHook("onClose", async () => {
    await jobs.stop();
    await importParser.stop();
    await db.close();
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send(
        ApiErrorSchema.parse({
          error: {
            code: "VALIDATION_ERROR",
            message: "Données invalides.",
            details: error.issues,
          },
        }),
      );
    }
    if (error instanceof ApiFault)
      return reply.code(error.status).send(
        ApiErrorSchema.parse({
          error: {
            code: error.code,
            message: error.message,
            details: error.details,
          },
        }),
      );
    const err = error as {
      statusCode?: number;
      code?: string;
      message?: string;
    };
    if (err.statusCode === 413)
      return reply.code(413).send({
        error: {
          code: "PAYLOAD_TOO_LARGE",
          message: "La requête dépasse la taille autorisée (pièce : 10 Mio).",
        },
      });
    if (
      err.code === "ERR_STREAM_PREMATURE_CLOSE" ||
      err.message?.includes("Unexpected end of")
    )
      return reply.code(400).send({
        error: {
          code: "INTERRUPTED_UPLOAD",
          message: "Transfert interrompu. Réessayez avec le fichier complet.",
        },
      });
    if (err.statusCode === 429)
      return reply.code(429).send({
        error: {
          code: "RATE_LIMITED",
          message: "Trop de tentatives. Réessayez plus tard.",
        },
      });
    if (err.statusCode === 400 || err.statusCode === 415)
      return reply.code(err.statusCode).send({
        error: { code: "INVALID_REQUEST", message: "Requête invalide." },
      });
    return reply
      .code(500)
      .send({ error: { code: "INTERNAL_ERROR", message: "Erreur interne." } });
  });
  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).send(
      ApiErrorSchema.parse({
        error: { code: "NOT_FOUND", message: "Ressource inaccessible." },
      }),
    ),
  );
  app.addHook("onRequest", async (request, reply) => {
    reply.header("cache-control", "no-store");
    if (
      ["POST", "PUT", "PATCH", "DELETE"].includes(request.method) &&
      request.headers.origin !== publicOrigin
    )
      fail(403, "INVALID_ORIGIN", "Origine de la requête refusée.");
  });
  const setSession = (reply: import("fastify").FastifyReply, token: string) =>
    reply.setCookie("memlia_session", token, {
      path: "/",
      httpOnly: true,
      sameSite: "strict",
      secure: publicOrigin.startsWith("https:"),
      maxAge: 8 * 60 * 60,
    });
  const user = (tx: Connection, req: FastifyRequest) =>
    authenticate(tx, req.cookies.memlia_session, now());
  app.get("/api/v1/setup", async () => {
    const needsSetup =
      (await db.query("SELECT id FROM cabinet_users LIMIT 1")).length === 0;
    return SetupStatusSchema.parse({
      requiresToken: needsSetup && requiresToken,
      needsSetup,
    });
  });
  app.post(
    "/api/v1/setup",
    { config: { rateLimit: { max: 5, timeWindow: "15 minutes" } } },
    async (req, reply) => {
      const input = SetupInputSchema.parse(req.body);
      const result = await db.transaction(async (tx) => {
        if ((await tx.query("SELECT id FROM cabinet_users LIMIT 1")).length)
          fail(409, "ALREADY_CONFIGURED", "Installation déjà initialisée.");
        if (requiresToken) {
          const provided = req.headers["x-bootstrap-token"];
          if (
            !options.bootstrapToken ||
            typeof provided !== "string" ||
            !timingSafeEqual(
              Buffer.from(digest(provided), "hex"),
              Buffer.from(digest(options.bootstrapToken), "hex"),
            )
          )
            fail(
              403,
              "BOOTSTRAP_TOKEN_REQUIRED",
              "Jeton local d’initialisation requis ou incorrect.",
            );
        } else if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.ip))
          fail(
            403,
            "LOCAL_SETUP_REQUIRED",
            "Initialisation depuis la machine du cabinet requise.",
          );
        const created = await createUser(tx, input, adminPermissions);
        const token = await issueSession(tx, created, now());
        return { created, token };
      });
      setSession(reply, result.token);
      reply.code(201);
      return SessionSchema.parse({ user: result.created });
    },
  );
  app.get("/api/v1/session", async (req) => {
    try {
      return SessionSchema.parse({
        user: await db.transaction((tx) => user(tx, req)),
      });
    } catch (error) {
      if (error instanceof ApiFault && error.status === 401)
        return { user: null };
      throw error;
    }
  });
  app.post(
    "/api/v1/login",
    { config: { rateLimit: { max: 100, timeWindow: "15 minutes" } } },
    async (req, reply) => {
      const input = LoginInputSchema.parse(req.body);
      const result = await loginThrottle.attempt(input.email, () =>
        db.transaction(async (tx) => {
          const current = await login(tx, input.email, input.password);
          if (req.cookies.memlia_session)
            await tx.query("DELETE FROM cabinet_sessions WHERE token_hash=$1", [
              digest(req.cookies.memlia_session),
            ]);
          return {
            user: current,
            token: await issueSession(tx, current, now()),
          };
        }),
      );
      setSession(reply, result.token);
      return SessionSchema.parse({ user: result.user });
    },
  );
  app.post("/api/v1/logout", async (req, reply) => {
    await db.transaction(async (tx) => {
      await user(tx, req);
      await tx.query("DELETE FROM cabinet_sessions WHERE token_hash=$1", [
        digest(req.cookies.memlia_session!),
      ]);
    });
    reply.clearCookie("memlia_session", { path: "/" });
    return SessionSchema.parse({ user: null });
  });
  const reminders = new Reminders(
    db,
    jobs,
    now,
    civilDate,
    options.cabinetTimeZone ?? "Europe/Paris",
  );
  let reminderTick: Promise<void> | undefined;
  const reminderTimer = setInterval(() => {
    if (!reminderTick)
      reminderTick = reminders
        .tick()
        .catch(() => undefined)
        .finally(() => {
          reminderTick = undefined;
        });
  }, 30000);
  reminderTimer.unref();
  app.addHook("onClose", async () => {
    clearInterval(reminderTimer);
    await reminderTick;
  });
  registerChecklistImportRoutes(app, { db, now, user }, importParser);
  registerNotificationRoutes(app, { db, now, user }, reminders);
  registerWorkflowRoutes(app, { db, now, user }, jobs, civilDate);
  registerRecordRoutes(app, { db, now, user }, civilDate, options.csvSyncRows);
  registerUserRoutes(app, { db, now, user });
  registerAdministrationRoutes(app, { db, now, user });
  registerCapabilitiesRoutes(app, { db, now, user });
  registerSettingsRoutes(
    app,
    { db, now, user },
    options.cabinetTimeZone ?? "Europe/Paris",
  );
  registerImportRoutes(
    app,
    { db, now, user },
    new Imports(db, jobs, now),
    importParser,
  );
  registerScopeRoutes(app, { db, now, user });
  registerViewRoutes(app, { db, now, user });
  registerCustomFieldRoutes(app, { db, now, user });
  registerCompanyRoutes(app, { db, now, user }, options.companySearchOrigin);
  const documents = new DocumentStore(options.dataDirectory);
  registerDocumentRoutes(app, { db, now, user }, documents);
  registerFiscalRoutes(app, { db, now, user }, documents, civilDate);
  registerExportRoutes(
    app,
    { db, now, user },
    new Exports(db, jobs, documents, now, options.exportPartBytes, civilDate),
  );
  registerCollectionRoutes(
    app,
    { db, now, user },
    new CollectionService(db, jobs, documents, now),
  );
  await mkdir(options.dataDirectory, { recursive: true, mode: 0o700 });
  app.get("/api/v1/health", async (_req, reply) => {
    try {
      await db.query("SELECT 1");
      await access(options.dataDirectory, constants.R_OK | constants.W_OK);
      return HealthSchema.parse({ ready: true });
    } catch {
      return reply.code(503).send(HealthSchema.parse({ ready: false }));
    }
  });
  if (options.webDirectory) await registerWeb(app, options.webDirectory);
  jobs.start();
  return app;
}
