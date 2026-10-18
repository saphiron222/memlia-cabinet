import { vi } from "vitest";
import { installObserver, event } from "./relationship-linux-observer.js";
installObserver();
vi.mock("../../apps/server/src/app.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../apps/server/src/app.js")>();
  return {
    ...actual,
    createApplication: async (
      ...args: Parameters<typeof actual.createApplication>
    ) => {
      const app = await actual.createApplication(...args);
      const started = new Map<string, number>();
      app.addHook("onRequest", async (request) => {
        started.set(request.id, performance.now());
        event("http.start", {
          id: request.id,
          method: request.method,
          path: request.url.slice(0, 1024),
        });
      });
      app.addHook("onResponse", async (request, reply) => {
        event("http.end", {
          id: request.id,
          method: request.method,
          path: request.url.slice(0, 1024),
          status: reply.statusCode,
          ms:
            performance.now() - (started.get(request.id) ?? performance.now()),
        });
        started.delete(request.id);
      });
      return app;
    },
  };
});
