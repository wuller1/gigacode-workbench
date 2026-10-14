import { promises as fs } from "node:fs";

/** A same-handle bounded read; a file growing after stat cannot allocate unbounded memory. */
export async function readVisualArtifact(
  file: string,
  limit = 8 * 1024 ** 2,
): Promise<Buffer> {
  if (!Number.isSafeInteger(limit) || limit < 24 || limit > 8 * 1024 ** 2)
    throw new Error("Invalid visual artifact limit.");
  const handle = await fs.open(file, "r");
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > limit)
      throw new Error(
        "Visual artifact is not a regular image or exceeds 8 MiB.",
      );
    const bytes = Buffer.alloc(limit + 1);
    let read = 0;
    while (read < bytes.length) {
      const part = await handle.read(bytes, read, bytes.length - read, read);
      if (!part.bytesRead) break;
      read += part.bytesRead;
    }
    const after = await handle.stat();
    if (
      read > limit ||
      read !== before.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs
    )
      throw new Error(
        "Visual artifact changed while reading; capture it again.",
      );
    const result = bytes.subarray(0, read);
    if (
      result.length < 24 ||
      !result
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      result.toString("ascii", 12, 16) !== "IHDR"
    )
      throw new Error("Visual review requires a captured PNG artifact.");
    const width = result.readUInt32BE(16),
      height = result.readUInt32BE(20);
    if (
      !width ||
      !height ||
      width > 16384 ||
      height > 16384 ||
      width * height > 64 * 1024 ** 2
    )
      throw new Error(
        "Visual image dimensions exceed the review limit; use a smaller viewport or crop.",
      );
    return result;
  } finally {
    await handle.close();
  }
}
