Good call on slowing down and understanding the system. Let me read the routing setup and app structure.

  Searched for 1 pattern, read 2 files

Let me also check the HailMap to see how pinning currently works.

  Read 1 file

Good enough picture. Here's the full breakdown:

---
How Routes Work

Everything lives in App.tsx. The flow

1. Splash → auth check — onSplashDone(logged in → 'app' phase, otherwise →'login' phase. In DEV mode it skips auth entirely.
2. DataStoreProvider wraps all routes , and HailSwath once on mount and putsthem in React context. Any page can call useDataStore() to get { lists, targets, swaths, loading, updateTarget, refresh }. This is the s these individually.
3. Adding a new page is three steps:
  - Create src/pages/YourPage/YourPage
  - Add <Route path="/your-page" element={<YourPage />} /> in App.tsx
  - Add a nav link in Navbar.tsx

That's the whole system. No code splitted layouts — it's intentionally flat.
