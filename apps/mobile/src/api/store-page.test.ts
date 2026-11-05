import { storePageFor } from "./store-page";

describe("the store page an outdated build sends the person to (#704)", () => {
  it("is Google Play's page for the Android package", () => {
    expect(storePageFor("android", { android: { package: "ai.jobbbox.app" } })).toBe("https://play.google.com/store/apps/details?id=ai.jobbbox.app");
  });

  it("is the App Store's page for the app's Apple ID", () => {
    expect(storePageFor("ios", { extra: { appStoreId: "6740000000" } })).toBe("https://apps.apple.com/app/id6740000000");
  });

  it("is the App Store's search for Jobbbox until App Store Connect has given the app its Apple ID", () => {
    expect(storePageFor("ios", { extra: { appStoreId: null } })).toBe("https://apps.apple.com/search?term=Jobbbox");
    expect(storePageFor("ios", null)).toBe("https://apps.apple.com/search?term=Jobbbox");
  });
});
