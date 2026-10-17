/** USTAR regular files only; no paths, links, ownership or executable modes from source metadata.
 * Format: https://www.gnu.org/software/tar/manual/html_node/Standard.html */
export function tarHeader(name: string, size: number) {
  if (
    !/^[a-zA-Z0-9_./-]+$/.test(name) ||
    name.startsWith("/") ||
    name.split("/").some((p) => p === "..") ||
    Buffer.byteLength(name) > 100
  )
    throw Error("Chemin d’archive invalide.");
  const header = Buffer.alloc(512);
  const octal = (offset: number, length: number, value: number) =>
    header.write(
      value.toString(8).padStart(length - 1, "0") + "\0",
      offset,
      length,
      "ascii",
    );
  header.write(name, 0, 100, "ascii");
  octal(100, 8, 0o600);
  octal(108, 8, 0);
  octal(116, 8, 0);
  octal(124, 12, size);
  octal(136, 12, 0);
  header.fill(32, 148, 156);
  header.write("0", 156);
  header.write("ustar\0", 257);
  header.write("00", 263);
  const checksum = header.reduce((total, byte) => total + byte, 0);
  header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "ascii");
  return header;
}
export function* tarFile(name: string, bytes: Uint8Array) {
  yield tarHeader(name, bytes.byteLength);
  for (let offset = 0; offset < bytes.byteLength; offset += 65536)
    yield bytes.subarray(offset, offset + 65536);
  const padding = (512 - (bytes.byteLength % 512)) % 512;
  if (padding) yield Buffer.alloc(padding);
}
export function originalPath(id: string, filename: string) {
  return `originals/${id}-${filename
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 45)}`;
}
