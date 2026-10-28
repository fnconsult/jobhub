import { describe, expect, it } from "vitest";
import { mailClientLint } from "./mail-client-lint";

const page = (body: string, head = "") => `<!doctype html><html lang="fr"><head>${head}</head><body><table role="presentation"><tr><td>${body}</td></tr></table></body></html>`;

describe("mailClientLint", () => {
  it("passes a table-based page with inline styles and described images", () => {
    expect(mailClientLint(page('<img src="https://x/logo.png" alt="Jobbbox" width="24"><p style="color:#000">Bonjour</p>'))).toEqual([]);
  });

  it("refuses an external stylesheet, linked or imported", () => {
    expect(mailClientLint(page("", '<link rel="stylesheet" href="https://cdn.example/x.css">'))).toEqual(["external stylesheet: <link rel=\"stylesheet\" href=\"https://cdn.example/x.css\">"]);
    expect(mailClientLint(page("", '<style>@import url("https://cdn.example/x.css");</style>'))).toEqual(['external stylesheet: @import url("https://cdn.example/x.css")']);
  });

  it("refuses an image without alt text", () => {
    expect(mailClientLint(page('<img src="https://x/a.png">'))).toEqual(['image without alt text: <img src="https://x/a.png">']);
    expect(mailClientLint(page('<img src="https://x/a.png" alt="">'))).toEqual(['image without alt text: <img src="https://x/a.png" alt="">']);
  });

  it("refuses scripts, web fonts and layout mail clients drop", () => {
    expect(mailClientLint(page("<script>1</script>"))).toEqual(["script: <script>"]);
    expect(mailClientLint(page("", "<style>@font-face{font-family:X;src:url(https://x/f.woff2)}</style>"))).toEqual(["web font: @font-face"]);
    expect(mailClientLint(page('<p style="display:flex">x</p>'))).toEqual(["layout mail clients drop: display:flex"]);
    expect(mailClientLint(page('<div style="display: grid">x</div>'))).toEqual(["layout mail clients drop: display: grid"]);
  });

  it("refuses a page with no table layout", () => {
    expect(mailClientLint('<!doctype html><html lang="fr"><body><p>x</p></body></html>')).toEqual(["no table layout"]);
  });
});
