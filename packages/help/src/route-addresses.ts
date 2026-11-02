/**
 * Each address a page article's `route` names, its query parameters in order: one per value of a parameter whose values
 * `|` separates (`/admin/parametres?tab=sources|extension` names `/admin/parametres?tab=extension` and `?tab=sources`).
 * Two articles naming one address would compete for « Sur cette page ».
 */
export function routeAddresses(route: string): string[] {
  const [address = "", query = ""] = route.split("?");
  const params = [...new URLSearchParams(query)].sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return params.reduce(
    (addresses, [name, values]) =>
      addresses.flatMap((each) =>
        values
          .split("|")
          .map(
            (value) =>
              `${each}${each.includes("?") ? "&" : "?"}${name}=${value}`,
          ),
      ),
    [address.replace(/\/$/, "") || "/"],
  );
}
