/** Examine only PostgreSQL message headers before pg-protocol can buffer a huge value.
 * Attach after authentication to the final plaintext/TLS socket. No protocol payload logging.
 */
export function wireLimit(
  socket: {
    prependListener: (event: string, fn: (chunk: Buffer) => void) => unknown;
    destroy: (error?: Error) => unknown;
  },
  maximum = 8 * 1024 ** 2,
) {
  const header = Buffer.alloc(5);
  let used = 0,
    remaining = 0,
    failed = false;
  const data = (chunk: Buffer) => {
    if (failed) return;
    let offset = 0;
    while (offset < chunk.length) {
      if (remaining) {
        const take = Math.min(remaining, chunk.length - offset);
        remaining -= take;
        offset += take;
        continue;
      }
      const take = Math.min(5 - used, chunk.length - offset);
      chunk.copy(header, used, offset, offset + take);
      used += take;
      offset += take;
      if (used === 5) {
        const size = header.readUInt32BE(1);
        used = 0;
        if (size < 4 || size > maximum) {
          failed = true;
          socket.destroy(
            Object.assign(
              new Error(
                "Сообщение PostgreSQL превышает 8 MiB. Сессия потеряна; проверьте исход записи перед повтором. Для больших значений выберите substring/large-object streaming.",
              ),
              { code: "WB_MESSAGE_LIMIT" },
            ),
          );
          return;
        }
        remaining = size - 4;
      }
    }
  };
  socket.prependListener("data", data);
}
