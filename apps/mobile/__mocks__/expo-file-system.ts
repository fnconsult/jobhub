// expo-file-system has no native module under Jest: the app's cache stands at a fixed address, and a download lands
// there without a network. The app downloads through its own fetch (#756): a test that writes a file mocks this module
// (src/web-pages/WebPage.test.tsx).
export const Paths = { cache: { uri: "file:///cache/" } };
export const File = { downloadFileAsync: async (url: string) => ({ uri: `file:///cache/${url.split("/").pop() ?? "download"}` }) };
