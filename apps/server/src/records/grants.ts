import type { Action, RecordKind, SessionUser } from "@memlia/contracts";
// Canonical direct-grant matching. Null dossier means global; kind * matches
// every resource kind. Assignment grants remain in administration/access.
export function hasPermission(
  user: SessionUser,
  action: Action,
  kind: RecordKind | "*",
  dossierId: string | null = null,
) {
  return user.permissions.some(
    (p) =>
      p.action === action &&
      (p.kind === "*" || p.kind === kind) &&
      (p.dossierId === null || p.dossierId === dossierId),
  );
}
export function directPermissionSql(
  permissions: SessionUser | string,
  action: Action,
  kind: RecordKind,
  scope: string,
  parameter?: (value: unknown) => string,
): string {
  if (typeof permissions !== "string") {
    if (hasPermission(permissions, action, kind)) return "TRUE";
    const ids = permissions.permissions
      .filter(
        (p) =>
          p.action === action &&
          (p.kind === "*" || p.kind === kind) &&
          p.dossierId,
      )
      .map((p) => p.dossierId);
    return `${scope}=ANY(${parameter!(ids)}::uuid[])`;
  }
  return `EXISTS(SELECT 1 FROM jsonb_array_elements(${permissions}) permission WHERE permission->>'action'='${action}' AND permission->>'kind' IN ('*','${kind}') AND (permission->>'dossierId' IS NULL OR (permission->>'dossierId')::uuid=${scope}))`;
}
