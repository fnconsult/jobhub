import { act, waitFor } from "@testing-library/react-native";
import { AppState, type AppStateStatus } from "react-native";
import { renderInApp } from "../testing";
import { AppIconBadge } from "./AppIconBadge";

/** The web app's `GET /api/offer-box/count`, answering each count in turn (the last one again once they run out). */
function serve(...counts: number[]) {
  let reads = 0;
  jest.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    if (new URL(String(input)).pathname !== "/api/offer-box/count") return new Response(null, { status: 404 });
    return Response.json({ toHandle: counts[Math.min(reads++, counts.length - 1)] });
  });
  return { reads: () => reads };
}

/** The app coming back to the foreground, as the system tells it. */
function foreground() {
  const listeners: ((state: AppStateStatus) => void)[] = [];
  jest.spyOn(AppState, "addEventListener").mockImplementation((_type, listener) => {
    listeners.push(listener as (state: AppStateStatus) => void);
    return { remove: () => listeners.splice(listeners.indexOf(listener as never), 1) } as never;
  });
  return () => act(() => listeners.forEach((listener) => listener("active")));
}

afterEach(() => jest.restoreAllMocks());

describe("the app icon's badge: the offers à traiter, set at each opening (#818, ADR-0090)", () => {
  it("is set to the count at opening, and again with the count read on each return to the foreground", async () => {
    const web = serve(3, 0);
    const comesBack = foreground();
    const setBadge = jest.fn(async () => {});
    await renderInApp(<AppIconBadge setBadge={setBadge} />);
    await waitFor(() => expect(setBadge).toHaveBeenCalledWith(3));

    await comesBack();
    await waitFor(() => expect(setBadge).toHaveBeenLastCalledWith(0));
    expect(web.reads()).toBe(2);
  });

  it("is set again at each opening even when the count read is the same: a push may have set the icon's badge meanwhile", async () => {
    // Opened with 5, then away: a Job Digest push brings 2 offers and sets the badge to 7 itself (`aps.badge`), and the
    // Candidate handles those 2 on the web. Back in the app, the count read is 5 again: the icon must go back from 7 to 5.
    serve(5);
    const comesBack = foreground();
    const setBadge = jest.fn(async () => {});
    await renderInApp(<AppIconBadge setBadge={setBadge} />);
    await waitFor(() => expect(setBadge).toHaveBeenCalledWith(5));

    await comesBack();
    await waitFor(() => expect(setBadge).toHaveBeenCalledTimes(2));
    expect(setBadge).toHaveBeenLastCalledWith(5);
  });

  it("is left as it is when the count cannot be read", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));
    const setBadge = jest.fn(async () => {});
    await renderInApp(<AppIconBadge setBadge={setBadge} />);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(setBadge).not.toHaveBeenCalled();
  });
});
