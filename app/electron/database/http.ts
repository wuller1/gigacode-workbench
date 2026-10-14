import { fetch, type Dispatcher } from "undici";
/** Bound JSON/HTML bodies and individual SSE events, including decompressed responses. */
export async function mcpFetch(
  input: any,
  init: any,
  dispatcher: Dispatcher,
): Promise<Response> {
  const r = await fetch(input, { ...init, dispatcher });
  if (!r.body) return r as unknown as Response;
  const sse = r.headers.get("content-type")?.includes("text/event-stream"),
    maximum = 10 * 1024 ** 2;
  if (!sse && Number(r.headers.get("content-length")) > maximum) {
    await r.body.cancel();
    throw new Error("Ответ MCP превышает 10 MiB");
  }
  let bytes = 0,
    line = 0;
  const body = (r.body as unknown as ReadableStream<Uint8Array>).pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        if (sse) {
          for (const value of chunk) {
            bytes++;
            if (value === 10) {
              if (line === 0) bytes = 0;
              line = 0;
            } else if (value !== 13) line++;
            if (bytes > maximum) {
              controller.error(new Error("SSE event MCP превышает 10 MiB"));
              return;
            }
          }
        } else {
          bytes += chunk.byteLength;
          if (bytes > maximum) {
            controller.error(new Error("Ответ MCP превышает 10 MiB"));
            return;
          }
        }
        controller.enqueue(chunk);
      },
    }),
  );
  const response = new Response(body, {
    status: r.status,
    statusText: r.statusText,
    headers: r.headers as unknown as Headers,
  });
  Object.defineProperty(response, "url", { value: r.url });
  return response;
}
