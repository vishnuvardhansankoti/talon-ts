// Expo's "winter" runtime installs `fetch` as a lazily-resolving Proxy
// getter. Left untouched, the first real access happens mid-test (in
// whichever file touches fetch first) and triggers an async native-module
// resolution that logs a benign warning — there's no native module
// registry in a Jest/Node environment — but it logs *after* that test
// file's run has already completed. Jest's per-file console buffering
// misattributes that as "logging after tests are done" and fails the
// whole run even though every assertion passed. Forcing the resolution
// here, once, before any test file runs, keeps the (harmless) warning
// confined to setup instead of straddling test-file boundaries.
void globalThis.fetch;
