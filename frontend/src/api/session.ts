/**
 * Token storage. The short-lived access token lives only in memory. The refresh token is kept in sessionStorage
 * (cleared when the tab closes) so a page reload doesn't sign the user out. Trade-off: sessionStorage is readable by
 * any script on the page, so the app must never inject untrusted HTML. Moving the refresh token to an httpOnly
 * cookie is the stronger option once the API and UI share a site.
 */
const KEY = "ht_refresh";
let access: string | null = null;

export const session = {
  get access() { return access; },
  set access(v: string | null) { access = v; },
  get refresh(): string | null { try { return sessionStorage.getItem(KEY); } catch { return null; } },
  set refresh(v: string | null) {
    try { v ? sessionStorage.setItem(KEY, v) : sessionStorage.removeItem(KEY); } catch { /* storage unavailable */ }
  },
  clear() { access = null; this.refresh = null; },
};
