export interface OperationOptions {
  backupDirectory: string;
  dataDirectory: string;
  configFile: string;
  urlFile: string;
  pgDump?: string;
  pgRestore?: string;
}
export function backup(options: OperationOptions): Promise<unknown>;
export function restore(options: OperationOptions): Promise<unknown>;
export function validateBackup(root: string): Promise<unknown>;
export function safePath(
  path: string,
  options?: { directory?: boolean; privateMode?: boolean },
): Promise<void>;
