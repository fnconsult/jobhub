// What a crash report may carry off the device (#703, ADR-0076): what tells one crash apart from another (its type,
// stack, release, the device's model and system), never who it happened to or what they typed or read.
import type { Breadcrumb, ErrorEvent } from "@sentry/react-native";

/** Breadcrumbs that can hold what a person touched or typed, or anything the app logged: never sent. */
const DROPPED_CATEGORIES = new Set(["touch", "console"]);
/** Breadcrumbs of a request the app made: only its method, status and cleaned URL are kept. */
const REQUEST_CATEGORIES = new Set(["fetch", "xhr", "http"]);

/** A path segment that is a word of a route (`api`, `job-searches`); anything else (an id, an email, a token) is replaced. */
const ROUTE_WORD = /^[A-Za-z]+(?:-[A-Za-z]+)*$/;
const URL_PARTS = /^(?:([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]*))?([^?#]*)/;
const URL_IN_TEXT = /[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s"'<>()]+/g;
const EMAIL_IN_TEXT = /[^\s@<>"'(),;:]+@[^\s@<>"'(),;:]+\.[^\s@<>"'(),;:]+/g;

/**
 * A URL without its credentials, query or fragment, each path segment that is not a route word replaced by `:id`:
 * `https://user:pw@app.jobbbox.ai/api/applications/3f2c…?token=…` becomes `https://app.jobbbox.ai/api/applications/:id`.
 */
export function cleanUrl(url: string): string {
  const [, scheme, authority, path = ""] = URL_PARTS.exec(url) ?? [];
  const host = authority?.replace(/^.*@/, "");
  const cleanedPath = path
    .split("/")
    .map((segment) => (segment === "" || ROUTE_WORD.test(segment) ? segment : ":id"))
    .join("/");
  return scheme ? `${scheme}://${host ?? ""}${cleanedPath}` : cleanedPath;
}

/** A free text (an error's message) with its URLs cleaned and its email addresses replaced. */
function cleanText(text: string): string {
  return text.replace(URL_IN_TEXT, cleanUrl).replace(EMAIL_IN_TEXT, "[email]");
}

/** The event Sentry may send: no user, no request body, cookies or headers, no device identifier, URLs and messages cleaned. */
export function cleanEvent(event: ErrorEvent): ErrorEvent {
  const { user: _user, request, contexts, exception, message, breadcrumbs, ...rest } = event;
  const cleaned: ErrorEvent = { ...rest };
  if (request?.url) cleaned.request = { ...(request.method && { method: request.method }), url: cleanUrl(request.url) };
  if (message !== undefined) cleaned.message = cleanText(message);
  if (exception) {
    cleaned.exception = {
      ...exception,
      values: exception.values?.map((value) => (value.value === undefined ? value : { ...value, value: cleanText(value.value) })),
    };
  }
  if (contexts) {
    const { device, app, ...otherContexts } = contexts;
    cleaned.contexts = { ...otherContexts };
    if (device) {
      const { id: _id, name: _name, ...deviceKept } = device;
      cleaned.contexts.device = deviceKept;
    }
    if (app) {
      const { device_app_hash: _hash, ...appKept } = app;
      cleaned.contexts.app = appKept;
    }
  }
  if (breadcrumbs) cleaned.breadcrumbs = breadcrumbs.flatMap((breadcrumb) => cleanBreadcrumb(breadcrumb) ?? []);
  return cleaned;
}

/** The breadcrumb Sentry may keep, or null to drop it. */
export function cleanBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  const category = breadcrumb.category ?? "";
  if (DROPPED_CATEGORIES.has(category) || category.startsWith("ui.")) return null;
  const { data, message, ...rest } = breadcrumb;
  const cleaned: Breadcrumb = { ...rest };
  if (message !== undefined) cleaned.message = cleanText(message);
  if (data) cleaned.data = cleanData(category, breadcrumb.type, data);
  return cleaned;
}

function cleanData(category: string, type: string | undefined, data: Record<string, unknown>): Record<string, unknown> {
  if (type === "http" || REQUEST_CATEGORIES.has(category)) return pick(data, ["method", "url", "status_code"]);
  if (category === "navigation") return pick(data, ["from", "to"]);
  return { ...data, ...pick(data, ["url"]) };
}

/** The named fields of a breadcrumb's data, a URL among them cleaned. */
function pick(data: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const key of keys) {
    const value = data[key];
    if (value === undefined) continue;
    picked[key] = typeof value === "string" && key !== "method" ? cleanUrl(value) : value;
  }
  return picked;
}
