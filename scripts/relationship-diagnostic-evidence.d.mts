export const DEFAULT_LIMITS: Readonly<{
  totalBytes: number;
  reserveBytes: number;
  fileBytes: number;
  eventBytes: number;
  streamBytes: number;
  lineBytes: number;
  files: number;
}>;
export class EvidenceLimit extends Error {
  constructor(reason: string);
}
export class EvidenceStore {
  constructor(directory: string, stage?: string, writer?: string);
  static create(
    directory: string,
    overrides?: Partial<typeof DEFAULT_LIMITS>,
  ): EvidenceStore;
  limits: typeof DEFAULT_LIMITS;
  directory: string;
  stage: string;
  writer: string;
  fail(reason: string, detail?: Record<string, unknown>): never;
  save(name: string, value: unknown): void;
  append(name: string, text: string): void;
  json(value: unknown, maximum?: number): string;
  stageReceipt(value: unknown): void;
  failureReceipt(message: unknown): void;
  limitsReached(): boolean;
  retainedBytes(): number;
}
