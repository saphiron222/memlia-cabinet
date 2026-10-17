import { z } from "zod";
export const JobStateSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
]);
export const JobEventSchema = z
  .object({
    sequence: z.number().int().nonnegative(),
    at: z.iso.datetime(),
    code: z.string().max(80),
    message: z.string().max(500),
  })
  .strict();
export const JobSchema = z
  .object({
    id: z.uuid(),
    kind: z.string().max(80),
    state: JobStateSchema,
    attempts: z.number().int().min(0).max(3),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    events: z.array(JobEventSchema).max(500),
    error: z.string().max(500).nullable(),
  })
  .strict();
export type Job = z.infer<typeof JobSchema>;
export type JobEvent = z.infer<typeof JobEventSchema>;
