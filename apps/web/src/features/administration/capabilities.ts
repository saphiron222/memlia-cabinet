import { useEffect, useState } from "react";
import {
  CapabilitiesSchema,
  CreationCapabilitiesSchema,
  type Action,
  type RecordKind,
} from "@memlia/contracts";
import { request, message } from "../../api";
export function useRecordCapabilities(ids: string[]) {
  const key = [...new Set(ids)].sort().join(","),
    [state, setState] = useState<{
      key: string;
      grants: Record<string, Action[]>;
      error: string;
    }>({ key: "", grants: {}, error: "" });
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      const selected = key ? key.split(",") : [],
        grants: Record<string, Action[]> = {};
      try {
        for (let i = 0; i < selected.length; i += 200) {
          const result = await request(
            "/capabilities/records?ids=" + selected.slice(i, i + 200).join(","),
            CapabilitiesSchema,
            controller.signal,
          );
          for (const item of result.items) grants[item.id] = item.actions;
        }
        setState({ key, grants, error: "" });
      } catch (e) {
        if (!controller.signal.aborted)
          setState({ key, grants: {}, error: message(e) });
      }
    }
    void load();
    return () => controller.abort();
  }, [key]);
  return {
    grants: state.key === key ? state.grants : {},
    error: state.key === key ? state.error : "",
  };
}
export function useCreationCapabilities(
  kind: RecordKind,
  dossierId: string | null,
  confidential: boolean,
  recordId?: string,
) {
  const key = new URLSearchParams({
      kind,
      ...(recordId ? { id: recordId } : {}),
      confidential: String(confidential),
      ...(dossierId ? { dossierId } : {}),
    }).toString(),
    [state, setState] = useState<{
      key: string;
      actions: Action[];
      error: string;
    }>({ key: "", actions: [], error: "" });
  useEffect(() => {
    const controller = new AbortController();
    void request(
      "/capabilities/create?" + key,
      CreationCapabilitiesSchema,
      controller.signal,
    )
      .then((r) => setState({ key, actions: r.actions, error: "" }))
      .catch((e) => {
        if (!controller.signal.aborted)
          setState({ key, actions: [], error: message(e) });
      });
    return () => controller.abort();
  }, [key]);
  return {
    actions: state.key === key ? state.actions : [],
    error: state.key === key ? state.error : "",
  };
}
