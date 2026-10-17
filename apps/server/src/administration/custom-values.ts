import {
  CustomFieldSchema,
  CivilDateSchema,
  type CabinetRecord,
  type CustomField,
} from "@memlia/contracts";
import type { Connection } from "../storage/database.js";
import { fail } from "../errors.js";
export function valid(field: CustomField, value: unknown) {
  if (value === null) return true;
  switch (field.type) {
    case "text":
      return typeof value === "string" && value.length <= 300;
    case "long_text":
      return typeof value === "string" && value.length <= 10000;
    case "number":
      return (
        typeof value === "string" &&
        /^-?\d+(\.\d+)?$/.test(value) &&
        value.length <= 100
      );
    case "date":
      return CivilDateSchema.safeParse(value).success;
    case "boolean":
      return typeof value === "boolean";
    case "choice":
      return typeof value === "string" && field.choices.includes(value);
  }
}
export async function validateCustomFields(
  tx: Connection,
  record: Pick<CabinetRecord, "kind" | "data">,
) {
  const ids = Object.keys(record.data.customFields);
  if (!ids.length) return;
  const rows = await tx.query(
    "SELECT content FROM cabinet_custom_fields WHERE id=ANY($1::uuid[])",
    [ids],
  );
  const fields = rows.map((r) => CustomFieldSchema.parse(r.content));
  for (const id of ids) {
    const field = fields.find((f) => f.id === id);
    if (
      !field ||
      field.kind !== record.kind ||
      !valid(field, record.data.customFields[id])
    )
      fail(
        400,
        "INVALID_CUSTOM_VALUE",
        "Valeur incompatible avec le champ personnalisé.",
      );
  }
}
