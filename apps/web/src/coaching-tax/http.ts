/** Bound bytes while reading; Content-Length is not trusted. Never log a fiscal request body. */
export async function fiscalJson(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return null;
  let bytes = 0,
    text = "";
  const decoder = new TextDecoder();
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 16384) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
