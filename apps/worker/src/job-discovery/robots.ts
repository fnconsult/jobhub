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
  const groups = parse(robotsTxt);
  const token = productToken(userAgent);
  let applicable = groups.filter((group) => group.agents.includes(token));
  if (applicable.length === 0) applicable = groups.filter((group) => group.agents.includes("*"));
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
