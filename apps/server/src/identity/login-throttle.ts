import { ApiFault, fail } from "../errors.js";
import { digest, normalizeEmail } from "./security.js";

type Attempts = { failures: number; pending: number; expires: number };

// Process-local, bounded defense. Pending reservations prevent parallel requests
// from all observing the same failure count before password verification finishes.
export class LoginThrottle {
  private readonly accounts = new Map<string, Attempts>();
  constructor(
    private readonly now: () => Date,
    private readonly capacity = 5000,
  ) {}

  async attempt<T>(email: string, authenticate: () => Promise<T>): Promise<T> {
    const time = this.now().getTime();
    const key = digest(normalizeEmail(email));
    let entry = this.accounts.get(key);
    if (entry && entry.expires <= time && entry.pending === 0) {
      this.accounts.delete(key);
      entry = undefined;
    }
    if (!entry) {
      for (const [oldKey, old] of this.accounts) {
        if (old.expires <= time && old.pending === 0)
          this.accounts.delete(oldKey);
      }
      if (this.accounts.size >= this.capacity)
        fail(
          503,
          "LOGIN_CAPACITY",
          "Connexions temporairement indisponibles. Réessayez plus tard.",
        );
      entry = { failures: 0, pending: 0, expires: time + 15 * 60 * 1000 };
      this.accounts.set(key, entry);
    }
    if (entry.failures + entry.pending >= 10)
      fail(429, "LOGIN_LIMIT", "Trop de tentatives. Réessayez plus tard.");
    entry.pending++;
    try {
      const result = await authenticate();
      entry.failures = 0;
      return result;
    } catch (error) {
      if (error instanceof ApiFault && error.status === 401) entry.failures++;
      throw error;
    } finally {
      entry.pending--;
      if (entry.pending === 0 && entry.failures === 0)
        this.accounts.delete(key);
    }
  }
}
