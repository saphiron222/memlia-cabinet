// Shared filesystem budget for the runner, observer worker and JSON reporter.
// Reservations precede writes; an interrupted writer can overcount, never overspend.
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  renameSync,
  rmSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
export const DEFAULT_LIMITS = Object.freeze({
  totalBytes: 128 * 1024 * 1024,
  reserveBytes: 1024 * 1024,
  fileBytes: 8 * 1024 * 1024,
  eventBytes: 32 * 1024 * 1024,
  streamBytes: 8 * 1024 * 1024,
  lineBytes: 64 * 1024,
  files: 256,
});
export class EvidenceLimit extends Error {
  constructor(reason) {
    super(`Diagnostic evidence limit: ${reason}`);
    this.name = "EvidenceLimit";
  }
}
const stages = /^(runner|N[1-7]-(baseline|probe)|synthetic[1-9])$/;
export class EvidenceStore {
  constructor(directory, stage = "runner", writer = "runner") {
    if (
      !stages.test(stage) ||
      !["runner", "observer", "reporter"].includes(writer)
    )
      throw new Error("Invalid evidence writer identity");
    this.directory = directory;
    this.stage = stage;
    this.writer = writer;
    this.limits = JSON.parse(
      readFileSync(join(directory, "evidence-budget.json"), "utf8"),
    );
  }
  static create(directory, overrides = {}) {
    for (const key of Object.keys(overrides))
      if (!Object.hasOwn(DEFAULT_LIMITS, key) || key === "reserveBytes")
        throw new Error("Unsupported diagnostic bound override");
    const limits = { ...DEFAULT_LIMITS, ...overrides };
    for (const [key, value] of Object.entries(limits))
      if (
        !Number.isSafeInteger(value) ||
        value <= 0 ||
        value > DEFAULT_LIMITS[key]
      )
        throw new Error("Invalid diagnostic bound");
    if (limits.reserveBytes >= limits.totalBytes)
      throw new Error("Evidence reserve must fit budget");
    writeFileSync(
      join(directory, "evidence-budget.json"),
      JSON.stringify(limits),
      { flag: "wx", mode: 0o600 },
    );
    writeFileSync(
      join(directory, ".evidence-ledger.json"),
      '{"bytes":0,"files":{}}',
      { flag: "wx", mode: 0o600 },
    );
    return new EvidenceStore(directory);
  }
  fail(reason, detail = {}) {
    const receipt = JSON.stringify({
      type: "diagnostic-limit",
      stage: this.stage,
      writer: this.writer,
      reason: reason.slice(0, 100),
      ...detail,
    });
    // One fixed <=4KiB emergency receipt per known writer/stage. This and all
    // stage receipts/ledger copies fit the separately reserved 1MiB envelope.
    // At most 24 stage identities × (3 × 4KiB + 16KiB), plus 2 × 64KiB
    // ledgers, one 4KiB error and the small fixed budget config: < 1MiB.
    this.#reserved(`limit-${this.stage}-${this.writer}.json`, receipt, 4096);
    throw new EvidenceLimit(reason);
  }
  #reserved(name, text, maximum) {
    if (Buffer.byteLength(text) > maximum)
      throw new Error("Emergency receipt exceeds reserved bound");
    try {
      writeFileSync(join(this.directory, name), text, {
        flag: "wx",
        mode: 0o600,
      });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
  stageReceipt(value) {
    const text = JSON.stringify(value);
    this.#reserved(`${this.stage}-result.json`, text, 16384);
  }
  failureReceipt(message) {
    this.#reserved(
      "diagnostic-error.json",
      JSON.stringify({ message: String(message).slice(0, 1500) }),
      4096,
    );
  }
  limitsReached() {
    return readdirSync(this.directory).some((name) =>
      name.startsWith("limit-"),
    );
  }
  json(value, maximum = this.limits.fileBytes) {
    let estimate = 0;
    const text = JSON.stringify(value, (key, item) => {
      estimate +=
        Buffer.byteLength(key) +
        (typeof item === "string" ? Buffer.byteLength(item) : 8);
      if (estimate > maximum) this.fail("json-artifact", { maximum });
      return item;
    });
    if (Buffer.byteLength(text) > maximum)
      this.fail("json-artifact", { maximum });
    return text + "\n";
  }
  save(name, value) {
    this.write(name, this.json(value), false);
  }
  append(name, text) {
    this.write(name, text, true);
  }
  write(name, text, append) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]{0,119}$/.test(name))
      throw new Error("Invalid evidence filename");
    const bytes = Buffer.byteLength(text),
      maximum = name.endsWith("-events.jsonl")
        ? this.limits.eventBytes
        : this.limits.fileBytes;
    if (bytes > maximum) this.fail("file-bytes", { maximum });
    const lock = join(this.directory, ".evidence-lock"),
      started = Date.now();
    while (true) {
      try {
        mkdirSync(lock);
        break;
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        if (Date.now() - started > 1000) this.fail("budget-lock");
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
      }
    }
    try {
      const ledger = JSON.parse(
        readFileSync(join(this.directory, ".evidence-ledger.json"), "utf8"),
      );
      const previous = ledger.files[name] ?? 0;
      if (!append && previous)
        throw new Error("Evidence artifacts are immutable");
      if (previous + bytes > maximum) this.fail("file-bytes", { maximum });
      if (
        !Object.hasOwn(ledger.files, name) &&
        Object.keys(ledger.files).length >= this.limits.files
      )
        this.fail("file-count");
      if (
        ledger.bytes + bytes >
        this.limits.totalBytes - this.limits.reserveBytes
      )
        this.fail("aggregate-bytes", {
          maximum: this.limits.totalBytes - this.limits.reserveBytes,
        });
      ledger.files[name] = previous + bytes;
      ledger.bytes += bytes;
      const encoded = JSON.stringify(ledger);
      if (Buffer.byteLength(encoded) > 65536) this.fail("ledger-bytes");
      writeFileSync(
        join(this.directory, ".evidence-ledger-next.json"),
        encoded,
        { mode: 0o600 },
      );
      renameSync(
        join(this.directory, ".evidence-ledger-next.json"),
        join(this.directory, ".evidence-ledger.json"),
      );
      if (append)
        appendFileSync(join(this.directory, name), text, { mode: 0o600 });
      else
        writeFileSync(join(this.directory, name), text, {
          mode: 0o600,
          flag: "wx",
        });
    } finally {
      rmSync(lock, { recursive: true });
    }
  }
  retainedBytes() {
    return readdirSync(this.directory).reduce((sum, name) => {
      const s = statSync(join(this.directory, name));
      return sum + (s.isFile() ? s.size : 0);
    }, 0);
  }
}
