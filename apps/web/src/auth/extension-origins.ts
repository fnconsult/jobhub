/** EXTENSION_ORIGINS, comma-separated: the `chrome-extension://<id>` origins of our extension builds the web app trusts. */
export function extensionOriginsFromEnv(env: Record<string, string | undefined> = process.env): string[] {
  return (env.EXTENSION_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}
