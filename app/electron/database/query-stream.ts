import QueryStream from "pg-query-stream";
/** pg-cursor.close normally waits for ReadyForQuery, which cannot arrive after socket loss.
 * Preserve the upstream implementation, but finish its destroy callback on a real disconnect.
 * The pinned driver + live disconnect/limit/cancel tests cover this adapter.
 */
export class SafeQueryStream extends QueryStream {
  override _destroy(error: Error, callback: Function) {
    const socket = this.cursor.connection?.stream;
    let finished = false;
    const done = (failure?: Error) => {
      if (finished) return;
      finished = true;
      socket?.removeListener("close", lost);
      callback(failure);
    };
    const lost = () =>
      done(
        error ||
          new Error("Соединение БД потеряно; исход операции требует проверки"),
      );
    if (!socket || socket.destroyed) {
      lost();
      return;
    }
    socket.once("close", lost);
    super._destroy(error, done);
  }
}
