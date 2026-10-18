import { useEffect, useMemo } from "react";
import { z } from "zod";
import {
  ApiErrorSchema,
  RecordListQuerySchema,
  type RecordListQuery,
} from "@memlia/contracts";
export class RequestError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
export function useScope() {
  const controller = useMemo(() => new AbortController(), []);
  useEffect(() => () => controller.abort(), [controller]);
  return controller.signal;
}
export async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  signal: AbortSignal,
  options: RequestInit = {},
) {
  let response: Response;
  try {
    response = await fetch("/api/v1" + path, {
      ...options,
      signal,
      headers: {
        ...(options.body instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
        ...options.headers,
      },
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new RequestError(
      0,
      "NETWORK",
      "Connexion au cabinet interrompue. Réessayez.",
    );
  }
  const body: unknown = await response.json();
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  if (!response.ok) {
    const fault = ApiErrorSchema.parse(body);
    if (response.status === 401 && !["/login", "/setup"].includes(path))
      window.dispatchEvent(new Event("memlia-session-expired"));
    throw new RequestError(
      response.status,
      fault.error.code,
      fault.error.message,
      fault.error.details,
    );
  }
  return schema.parse(body);
}
export function queryString(input: Partial<RecordListQuery>) {
  const query = RecordListQuerySchema.parse(input);
  return new URLSearchParams(
    Object.entries(query)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, String(value)]),
  ).toString();
}
export function message(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Une erreur empêche cette opération.";
}

export async function downloadDocument(
  id: string,
  filename: string,
  signal: AbortSignal,
) {
  const response = await fetch("/api/v1/documents/" + id + "/download", {
    signal,
  });
  if (!response.ok) {
    const fault = ApiErrorSchema.parse(await response.json());
    if (response.status === 401)
      window.dispatchEvent(new Event("memlia-session-expired"));
    throw new RequestError(
      response.status,
      fault.error.code,
      fault.error.message,
    );
  }
  const blob = await response.blob();
  if (signal.aborted) return;
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
