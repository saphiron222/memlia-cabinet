import { useEffect, useState } from "react";
import {
  AccountSchema,
  InstallationInfoSchema,
  type ModuleId,
  type Preferences,
} from "@memlia/contracts";
import { z } from "zod";
import { request, useScope, message } from "../../api";
export function useAccountSettings() {
  const signal = useScope(),
    [account, setAccount] = useState<z.infer<typeof AccountSchema> | null>(
      null,
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    try {
      setAccount(await request("/account", AccountSchema, signal));
    } catch (e) {
      if (!signal.aborted) setError(message(e));
    }
  }
  useEffect(() => {
    void load();
    const changed = () => void load();
    window.addEventListener("memlia-account-updated", changed);
    return () => window.removeEventListener("memlia-account-updated", changed);
  }, []);
  async function save(patch: Partial<Preferences> & { name?: string }) {
    if (!account || busy) return;
    setBusy(true);
    setError("");
    try {
      const { version, ...p } = account.preferences;
      setAccount(
        await request("/account", AccountSchema, signal, {
          method: "PUT",
          body: JSON.stringify({
            ...p,
            ...patch,
            version: undefined,
            operationId: crypto.randomUUID(),
            expectedVersion: version,
            expectedUserVersion: account.profile.version,
            name: patch.name ?? account.profile.name,
          }),
        }),
      );
      window.dispatchEvent(new Event("memlia-account-updated"));
    } catch (e) {
      if (!signal.aborted) setError(message(e));
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }
  return { account, error, busy, save };
}
export function useInstallation() {
  const signal = useScope(),
    [info, setInfo] = useState<z.infer<typeof InstallationInfoSchema> | null>(
      null,
    ),
    [error, setError] = useState("");
  async function load() {
    try {
      setInfo(
        await request(
          "/administration/installation",
          InstallationInfoSchema,
          signal,
        ),
      );
    } catch (e) {
      if (!signal.aborted) setError(message(e));
    }
  }
  useEffect(() => {
    void load();
    const changed = () => void load();
    window.addEventListener("memlia-modules-updated", changed);
    return () => window.removeEventListener("memlia-modules-updated", changed);
  }, []);
  return { info, error, reload: load };
}
export function useModuleEnabled(id: ModuleId) {
  const { info } = useInstallation();
  return info?.enabledModules.includes(id) ?? false;
}
