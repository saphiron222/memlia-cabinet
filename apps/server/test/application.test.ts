import { afterEach, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApplication } from "../src/app.js";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
it("requires one local setup and creates no default credentials", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "memlia-"));
  roots.push(dataDirectory);
  const app = await createApplication({
    dataDirectory,
    publicOrigin: "http://localhost:3000",
    allowEmbeddedDatabase: true,
  });
  try {
    expect((await app.inject("/api/v1/setup")).json()).toEqual({
      needsSetup: true,
      requiresToken: false,
    });
    expect((await app.inject("/api/v1/session")).json()).toEqual({
      user: null,
    });
    const setup = await app.inject({
      method: "POST",
      url: "/api/v1/setup",
      headers: { origin: "http://localhost:3000" },
      payload: {
        email: "admin@example.test",
        name: "Admin fictif",
        password: "UnMotDePasseFictif123!",
      },
    });
    expect(setup.statusCode).toBe(201);
    expect(setup.json().user.email).toBe("admin@example.test");
    expect(setup.headers["set-cookie"]).toContain("HttpOnly");
    expect((await app.inject("/api/v1/setup")).json()).toEqual({
      needsSetup: false,
      requiresToken: false,
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/setup",
          headers: { origin: "http://localhost:3000" },
          payload: {
            email: "autre@example.test",
            name: "Autre",
            password: "UnMotDePasseFictif123!",
          },
        })
      ).statusCode,
    ).toBe(409);
  } finally {
    await app.close();
  }
});

it("requires a local bootstrap secret for a network origin even behind a loopback proxy", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "memlia-"));
  roots.push(dataDirectory);
  const common = {
    dataDirectory,
    publicOrigin: "https://cabinet.example.test",
    allowEmbeddedDatabase: true,
  };
  const payload = {
    email: "admin@example.test",
    name: "Admin fictif",
    password: "UnMotDePasseFictif123!",
  };
  let app = await createApplication(common);
  try {
    expect((await app.inject("/api/v1/setup")).json()).toEqual({
      needsSetup: true,
      requiresToken: true,
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/setup",
          headers: { origin: common.publicOrigin },
          payload,
        })
      ).statusCode,
    ).toBe(403);
  } finally {
    await app.close();
  }
  const bootstrapToken = "fictitious-bootstrap-token-for-interface-test-123456";
  const options = { ...common, bootstrapToken };
  app = await createApplication(options);
  try {
    const wrong = await app.inject({
      method: "POST",
      url: "/api/v1/setup",
      headers: {
        origin: common.publicOrigin,
        "x-bootstrap-token": "incorrect",
      },
      payload,
    });
    expect(wrong.statusCode).toBe(403);
    const status = await app.inject("/api/v1/setup");
    expect(status.body).not.toContain(bootstrapToken);
    const correct = await app.inject({
      method: "POST",
      url: "/api/v1/setup",
      headers: {
        origin: common.publicOrigin,
        "x-bootstrap-token": bootstrapToken,
      },
      payload,
    });
    expect(correct.statusCode).toBe(201);
    expect(correct.headers["set-cookie"]).toContain("Secure");
    expect((await app.inject("/api/v1/setup")).json()).toEqual({
      needsSetup: false,
      requiresToken: false,
    });
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/login",
      headers: { origin: common.publicOrigin },
      payload: { email: payload.email, password: payload.password },
    });
    expect(login.statusCode).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/setup",
          headers: { origin: common.publicOrigin },
          payload,
        })
      ).statusCode,
    ).toBe(409);
  } finally {
    await app.close();
  }
});

it("configured bootstrap token enables explicit loopback-origin setup through a container bridge without trusting its peer", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "memlia-bridge-"));
  roots.push(dataDirectory);
  const bootstrapToken = "fictitious-loopback-bootstrap-token-123456789";
  const options = {
    dataDirectory,
    publicOrigin: "http://localhost:3000",
    bootstrapToken,
    allowEmbeddedDatabase: true,
  };
  const app = await createApplication(options);
  try {
    expect((await app.inject("/api/v1/setup")).json()).toEqual({
      needsSetup: true,
      requiresToken: true,
    });
    const request = {
      method: "POST" as const,
      url: "/api/v1/setup",
      remoteAddress: "172.20.0.2",
      payload: {
        email: "bridge@example.test",
        name: "Bridge fictif",
        password: "Mot-de-passe-fictif-2026!",
      },
    };
    expect(
      (
        await app.inject({
          ...request,
          headers: { origin: options.publicOrigin },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          ...request,
          headers: {
            origin: options.publicOrigin,
            "x-bootstrap-token": bootstrapToken,
          },
        })
      ).statusCode,
    ).toBe(201);
    expect((await app.inject("/api/v1/setup")).json()).toEqual({
      needsSetup: false,
      requiresToken: false,
    });
  } finally {
    await app.close();
  }
});
