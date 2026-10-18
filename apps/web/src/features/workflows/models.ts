import { z } from "zod";
import { WorkflowModelSchema, type WorkflowModel } from "@memlia/contracts";
import { request } from "../../api";
export async function loadWorkflowModels(signal: AbortSignal) {
  const items: WorkflowModel[] = [];
  let cursor: string | null = null;
  do {
    const page: { items: WorkflowModel[]; nextCursor: string | null } =
      await request(
        "/workflows/models" + (cursor ? "?after=" + cursor : ""),
        z.object({
          items: z.array(WorkflowModelSchema),
          nextCursor: z.string().nullable(),
        }),
        signal,
      );
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return { items };
}
