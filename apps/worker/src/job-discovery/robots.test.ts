import { describe, expect, it } from "vitest";
import { robotsAllow, robotsCrawlDelay } from "./robots";

const BOT = "JobbboxBot";

describe("robots.txt rules", () => {
  it("allows everything when robots.txt is empty", () => {
    expect(robotsAllow("", BOT, "/offres/1")).toBe(true);
  });

  it("follows the group for every crawler", () => {
    const robots = "User-agent: *\nDisallow: /offres/\n";
    expect(robotsAllow(robots, BOT, "/offres/1")).toBe(false);
    expect(robotsAllow(robots, BOT, "/carrieres")).toBe(true);
  });

  it("prefers the group naming our crawler over the catch-all one, ignoring case and version", () => {
    const robots = "User-agent: *\nDisallow: /\n\nUser-agent: jobbboxbot\nDisallow: /admin\n";
    expect(robotsAllow(robots, `${BOT}/1.0`, "/offres/1")).toBe(true);
    expect(robotsAllow(robots, BOT, "/admin/x")).toBe(false);
  });

  it("lets the longest matching rule win, and Allow win a tie", () => {
    const robots = "User-agent: *\nDisallow: /offres\nAllow: /offres/publiques\nDisallow: /a\nAllow: /a\n";
    expect(robotsAllow(robots, BOT, "/offres/privees/1")).toBe(false);
    expect(robotsAllow(robots, BOT, "/offres/publiques/1")).toBe(true);
    expect(robotsAllow(robots, BOT, "/a")).toBe(true);
  });

  it("understands * wildcards, $ anchors, query strings and comments", () => {
    const robots = "# politesse\nUser-agent: *  # tous\nDisallow: /*.pdf$\nDisallow: /*?session=\n";
    expect(robotsAllow(robots, BOT, "/fiche.pdf")).toBe(false);
    expect(robotsAllow(robots, BOT, "/fiche.pdf?v=2")).toBe(true);
    expect(robotsAllow(robots, BOT, "/offre?session=abc")).toBe(false);
  });

  it("treats an empty Disallow as allowing everything", () => {
    expect(robotsAllow("User-agent: *\nDisallow:\n", BOT, "/x")).toBe(true);
  });

  it("shares rules between consecutive User-agent lines of one group", () => {
    const robots = "User-agent: OtherBot\nUser-agent: JobbboxBot\nDisallow: /prive\n";
    expect(robotsAllow(robots, BOT, "/prive")).toBe(false);
  });

  it("matches percent-encoded and plain paths alike", () => {
    expect(robotsAllow("User-agent: *\nDisallow: /été\n", BOT, "/%C3%A9t%C3%A9/1")).toBe(false);
  });

  it("reads the Crawl-delay of the group that applies, in seconds", () => {
    expect(robotsCrawlDelay("User-agent: *\nCrawl-delay: 1\nDisallow: /admin\n", BOT)).toBe(1);
    expect(robotsCrawlDelay("User-agent: *\nCrawl-delay: 5\n\nUser-agent: JobbboxBot\nCrawl-delay: 0.5\n", BOT)).toBe(0.5);
    expect(robotsCrawlDelay("User-agent: *\nDisallow: /admin\n", BOT)).toBe(0);
    expect(robotsCrawlDelay("User-agent: *\nCrawl-delay: bientôt\n", BOT)).toBe(0);
  });
});
