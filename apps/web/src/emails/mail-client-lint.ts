/**
 * A basic mail-client lint of an email's HTML (#472): what mail clients drop or block, found by its shape.
 * No external stylesheet (a `<link rel="stylesheet">` or an `@import`), no web font, no script, no flex or grid
 * layout (tables only), and every image described by alt text. Returns one problem per line, none when it passes.
 */
export function mailClientLint(html: string): string[] {
  const problems: string[] = [];
  for (const [link] of html.matchAll(/<link\b[^>]*\brel=["']?stylesheet[^>]*>/gi)) problems.push(`external stylesheet: ${link}`);
  for (const [rule] of html.matchAll(/@import\s+[^;]+/gi)) problems.push(`external stylesheet: ${rule}`);
  if (/@font-face/i.test(html)) problems.push("web font: @font-face");
  if (/<script\b/i.test(html)) problems.push("script: <script>");
  for (const [image] of html.matchAll(/<img\b[^>]*>/gi)) if (!/\balt=(["'])\s*[^"'\s][^"']*\1/i.test(image)) problems.push(`image without alt text: ${image}`);
  for (const [display] of html.matchAll(/display:\s*(?:flex|grid|inline-flex|inline-grid)\b/gi)) problems.push(`layout mail clients drop: ${display}`);
  if (!/<table\b/i.test(html)) problems.push("no table layout");
  return problems;
}
