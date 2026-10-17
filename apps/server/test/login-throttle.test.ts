import { expect, it } from "vitest";
import { fixture, credentials, operationId } from "./helpers.js";

it("exposes structured HTTP login saturation and recovers capacity after success or expiration", async () => {
  let now = new Date("2026-10-17T10:00:00Z");
  const f = await fixture(() => now, { loginThrottleCapacity: 2 });
  const attempt = (email: string, password = credentials.password) =>
    f.request("POST", "/login", { email, password }, "");
  const first = credentials.email;
  const second = "second@example.test";
  const third = "third@example.test";
  try {
    await f.setup();
    for (const email of [second, third]) {
      expect(
        (
          await f.request("POST", "/users", {
            operationId: operationId(),
            name: "Compte fictif",
            email,
            password: credentials.password,
            permissions: [],
          })
        ).statusCode,
      ).toBe(201);
    }
    expect((await attempt(first, "incorrect")).statusCode).toBe(401);
    expect((await attempt(second, "incorrect")).statusCode).toBe(401);
    const saturated = await attempt(third);
    expect(saturated.statusCode).toBe(503);
    expect(saturated.json()).toEqual({
      error: {
        code: "LOGIN_CAPACITY",
        message:
          "Connexions temporairement indisponibles. Réessayez plus tard.",
      },
    });
    // A real successful authentication releases its account entry.
    expect((await attempt(first)).statusCode).toBe(200);
    expect((await attempt(third, "incorrect")).statusCode).toBe(401);
    expect((await attempt(first)).statusCode).toBe(503);
    // TTL is driven through the public application clock; passwords and DB are real.
    now = new Date("2026-10-17T10:16:00Z");
    const recovered = await attempt(first);
    expect(recovered.statusCode).toBe(200);
    expect(recovered.json().user.email).toBe(first);
    const cookie = String(recovered.headers["set-cookie"]).split(";")[0]!;
    expect(
      (await f.request("GET", "/session", undefined, cookie)).json().user.email,
    ).toBe(first);
  } finally {
    await f.close();
  }
});
