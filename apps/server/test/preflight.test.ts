import { it, expect } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
  realpath,
  chmod,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
it("installer preflight refuses occupied, linked, public paths and ports without changing them", async () => {
  const parent = await realpath(
    await mkdtemp(join(tmpdir(), "memlia-install-")),
  );
  const root = join(parent, "installation");
  await mkdir(root, { mode: 0o700 });
  const run = (directory = root, extra: Record<string, string> = {}) =>
    spawnSync(process.execPath, ["deploy/preflight.mjs", "init"], {
      env: {
        ...process.env,
        INSTALL_DIRECTORY: directory,
        PUBLIC_ORIGIN: "https://cabinet.example.test",
        HTTP_PORT: "4329",
        ...extra,
      },
      encoding: "utf8",
    });
  try {
    await writeFile(join(root, "sentinel"), "untouched", { mode: 0o600 });
    expect(run().status).toBe(1);
    expect(await readFile(join(root, "sentinel"), "utf8")).toBe("untouched");
    await rm(join(root, "sentinel"));
    await chmod(root, 0o755);
    expect(run().status).toBe(1);
    await chmod(root, 0o700);
    const link = join(parent, "link");
    await symlink(root, link);
    expect(run(link).status).toBe(1);
    expect(
      run(root, { PUBLIC_ORIGIN: "http://cabinet.example.test" }).status,
    ).toBe(1);
    expect(
      run(root, {
        PUBLIC_ORIGIN: "ftp://localhost",
        ALLOW_HTTP_LOOPBACK: "true",
      }).status,
    ).toBe(1);
    const server = createServer();
    await new Promise<void>((accept) =>
      server.listen(4329, "127.0.0.1", accept),
    );
    try {
      expect(run().status).toBe(1);
    } finally {
      await new Promise<void>((accept) => server.close(() => accept()));
    }
    expect(await readdir(root)).toEqual([]);
    const initialized = run();
    expect(initialized.status).toBe(0);
    const appSecret = (
      await readFile(join(root, "secrets/application-password"), "utf8")
    ).trim();
    const adminSecret = (
      await readFile(join(root, "secrets/database-password"), "utf8")
    ).trim();
    expect(appSecret.length).toBe(64);
    expect(appSecret).not.toBe(adminSecret);
    expect(initialized.stdout + initialized.stderr).not.toContain(appSecret);
    expect(run().status).toBe(1);
    expect(
      (
        await readFile(join(root, "secrets/application-password"), "utf8")
      ).trim(),
    ).toBe(appSecret);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
