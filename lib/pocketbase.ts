import PocketBase from "pocketbase";

const pb = new PocketBase(process.env.NEXT_PUBLIC_POCKETBASE_URL);

let refreshPromise: Promise<void> | null = null;
let lastRefreshAt = 0;

async function refreshUserAuth() {
  await pb.collection("users").authRefresh();
}

export async function ensurePocketBaseAuth(force = false) {
  if (typeof window === "undefined" || !pb.authStore.isValid) {
    return;
  }

  const now = Date.now();
  const refreshCooldownMs = 5 * 60 * 1000;
  if (!force && now - lastRefreshAt < refreshCooldownMs) {
    return;
  }

  if (!refreshPromise) {
    refreshPromise = refreshUserAuth()
      .then(() => {
        lastRefreshAt = Date.now();
      })
      .catch((error) => {
        pb.authStore.clear();
        throw error;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }

  await refreshPromise;
}

pb.beforeSend = async (url, options) => {
  const isAuthRequest =
    url.includes("/auth-refresh") ||
    url.includes("/auth-with-password") ||
    url.includes("/auth-with-oauth2") ||
    url.includes("/request-password-reset") ||
    url.includes("/confirm-password-reset");

  if (!isAuthRequest) {
    await ensurePocketBaseAuth();
  }

  return { url, options };
};

// Keep auth token refreshed automatically
pb.autoCancellation(false);

export default pb;
