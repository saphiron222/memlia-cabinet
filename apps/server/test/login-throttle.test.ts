import { expect, it } from "vitest";
import { LoginThrottle } from "../src/identity/login-throttle.js";
import { ApiFault } from "../src/errors.js";

it("bounds account memory, retains pending reservations past TTL, and recovers after expiration", async () => {
  let time = new Date("2026-10-17T10:00:00Z");
  const throttle = new LoginThrottle(() => time, 2);
  const bad = () =>
    Promise.reject(
      new ApiFault(401, "INVALID_CREDENTIALS", "Identifiants incorrects."),
    );
  await expect(
    throttle.attempt("first@example.test", bad),
  ).rejects.toMatchObject({ status: 401 });
  let finish!: () => void;
  const pending = throttle.attempt(
    "pending@example.test",
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await expect(
    throttle.attempt("third@example.test", async () => "ok"),
  ).rejects.toMatchObject({ status: 503, code: "LOGIN_CAPACITY" });
  time = new Date("2026-10-17T10:16:00Z");
  await expect(
    throttle.attempt("third@example.test", bad),
  ).rejects.toMatchObject({ status: 401 });
  await expect(
    throttle.attempt("fourth@example.test", async () => "ok"),
  ).rejects.toMatchObject({ status: 503 });
  finish();
  await pending;
  await expect(
    throttle.attempt("fourth@example.test", async () => "ok"),
  ).resolves.toBe("ok");
});
