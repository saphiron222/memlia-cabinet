import { vi } from "vitest";
import { installObserver, phase, event } from "./time-linux-observer.js";
installObserver();

vi.mock("../../apps/server/test/helpers.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../apps/server/test/helpers.js")>();
  return {
    ...actual,
    fixture: async (...args: Parameters<typeof actual.fixture>) => {
      const f = await phase("fixture", () => actual.fixture(...args));
      const setup = f.setup.bind(f),
        request = f.request.bind(f),
        close = f.close.bind(f),
        maintain = f.maintainDatabase.bind(f),
        restart = f.restart.bind(f);
      f.setup = () => phase("setup", setup);
      f.request = (...params) =>
        phase(`${params[0]} ${params[1]}`, async () => {
          const response = await request(...params);
          event("http.result", {
            method: params[0],
            path: params[1],
            status: response.statusCode,
            ...(response.statusCode >= 400 ? { errorBody: response.body } : {}),
          });
          return response;
        });
      f.maintainDatabase = (run) => phase("maintenance", () => maintain(run));
      f.restart = () => phase("restart", restart);
      f.close = () => phase("cleanup", close);
      return f;
    },
  };
});

vi.mock("../../apps/server/src/storage/database.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../apps/server/src/storage/database.js")
    >();
  return {
    ...actual,
    openDatabase: async (...args: Parameters<typeof actual.openDatabase>) => {
      const db = await phase("database.open", () =>
        actual.openDatabase(...args),
      );
      const transaction = db.transaction.bind(db);
      db.transaction = (run, options) =>
        phase("transaction", () => transaction(run, options));
      return db;
    },
  };
});
