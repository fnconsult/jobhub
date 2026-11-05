// The cookie manager's TurboModule has no native side under Jest: an empty store stands in for the WebViews' (#689).
const CookieManager = {
  set: async () => true,
  clearAll: async () => true,
  clearAllStores: async () => true,
  clearByName: async () => true,
  get: async () => ({}),
  flush: async () => undefined,
};

export default CookieManager;
