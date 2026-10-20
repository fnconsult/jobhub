/**
 * robots.txt rules (RFC 9309), as Job discovery follows them (ADR-0002).
 */

interface Rule {
  allow: boolean;
  pattern: string;
}

interface Group {
  agents: string[];
  rules: Rule[];
  /** Seconds between two requests (Crawl-delay: not in RFC 9309, but a site's stated wish). */
  crawlDelay?: number;
}

function parse(robotsTxt: string): Group[] {
  const groups: Group[] = [];
  let current: Group | undefined;
  let readingAgents = false;
  for (const rawLine of robotsTxt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === "user-agent") {
      if (!readingAgents || !current) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      readingAgents = true;
    } else if ((field === "allow" || field === "disallow") && current) {
      readingAgents = false;
      // An empty Disallow allows everything: it simply adds no rule.
      if (value) current.rules.push({ allow: field === "allow", pattern: normalise(value) });
    } else if (field === "crawl-delay" && current) {
      readingAgents = false;
      const seconds = Number(value);
      if (value && Number.isFinite(seconds) && seconds >= 0) current.crawlDelay = Math.max(current.crawlDelay ?? 0, seconds);
    } else {
      readingAgents = false;
    }
  }
  return groups;
}

/** Percent-decodes what can be decoded, so "/été" and "/%C3%A9t%C3%A9" compare equal. */
function normalise(path: string): string {
  try {
    return decodeURI(path);
  } catch {
    return path;
  }
}

/** The product token of a User-Agent: "JobbboxBot/1.0 (+url)" → "jobbboxbot". */
function productToken(userAgent: string): string {
  return userAgent.split(/[/\s]/)[0]!.toLowerCase();
}

/** The groups for this crawler: those naming it, else the "*" ones. */
function applicableGroups(robotsTxt: string, userAgent: string): Group[] {
  const groups = parse(robotsTxt);
  const token = productToken(userAgent);
  const named = groups.filter((group) => group.agents.includes(token));
  return named.length > 0 ? named : groups.filter((group) => group.agents.includes("*"));
}

function toRegExp(pattern: string): RegExp {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

/**
 * Whether robots.txt lets `userAgent` fetch `path` (path plus query string).
 * The group naming the crawler wins over "*"; within it the longest matching
 * rule wins, and Allow wins a tie.
 */
export function robotsAllow(robotsTxt: string, userAgent: string, path: string): boolean {
  const applicable = applicableGroups(robotsTxt, userAgent);
  const target = normalise(path || "/");

  let best: Rule | undefined;
  for (const rule of applicable.flatMap((group) => group.rules)) {
    if (!toRegExp(rule.pattern).test(target)) continue;
    if (
      !best ||
      rule.pattern.length > best.pattern.length ||
      (rule.pattern.length === best.pattern.length && rule.allow && !best.allow)
    ) {
      best = rule;
    }
  }
  return best ? best.allow : true;
}

/** The Crawl-delay robots.txt asks of `userAgent`, in seconds (0 when it asks none). */
export function robotsCrawlDelay(robotsTxt: string, userAgent: string): number {
  return Math.max(0, ...applicableGroups(robotsTxt, userAgent).map((group) => group.crawlDelay ?? 0));
}
