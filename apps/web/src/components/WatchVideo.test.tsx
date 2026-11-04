// @vitest-environment jsdom
import type { HelpArticle } from "@jobhub/help";
import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderInFrench } from "@/design/testing";

const tutorial = (id: string, motion: string | null): HelpArticle => ({
  id,
  locale: "fr",
  kind: "tutorial",
  audience: "candidate",
  topic: "utiliser",
  title: "Retrouver une candidature",
  synonyms: [],
  route: null,
  motion,
  microAnimations: [],
  body: "1. Ouvrez « Mes candidatures ».\n2. Cliquez sur une candidature.",
});

afterEach(() => vi.unstubAllGlobals());

/** A fresh module each time: the durations are asked once per page, and kept. */
async function fresh() {
  vi.resetModules();
  return (await import("./WatchVideo")).WatchVideo;
}

describe("« Voir la vidéo (durée) » on the Coach Panel's card of a Tutorial (#568)", () => {
  it("links to the Tutorial's video in the Help Centre, with the duration, when it is published in the article's language", async () => {
    const fetch = vi.fn(async () => Response.json({ durations: { "retrouver-une-candidature": 65.4 } }));
    vi.stubGlobal("fetch", fetch);
    const WatchVideo = await fresh();
    renderInFrench(<WatchVideo article={tutorial("tutorial-retrouver", "retrouver-une-candidature")} />);
    const link = await screen.findByRole("link", { name: "Voir la vidéo (1 min 05 s) dans le centre d'aide : Retrouver une candidature" });
    expect(link.textContent).toBe("Voir la vidéo (1 min 05 s)");
    expect(link.getAttribute("href")).toBe("/aide/utiliser/tutorial-retrouver#video");
    expect(fetch).toHaveBeenCalledWith("/api/help-videos?locale=fr");
  });

  it("shows nothing while the video is not published, and asks nothing for an article without a motion", async () => {
    const fetch = vi.fn(async () => Response.json({ durations: {} }));
    vi.stubGlobal("fetch", fetch);
    const WatchVideo = await fresh();
    const { container } = renderInFrench(<WatchVideo article={tutorial("tutorial-autre", "pas-encore-rendue")} />);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(container.textContent).toBe("");
    fetch.mockClear();
    const without = renderInFrench(<WatchVideo article={tutorial("tutorial-sans", null)} />);
    expect(without.container.textContent).toBe("");
    expect(fetch).not.toHaveBeenCalled();
  });
});
