/// <reference lib="dom" />
import {
  AdminCredentialStore,
  AdminSignInRequired,
} from "./admin_credentials.js";
import {
  AdminBrowserOidc,
  type AdminBrowserOidcConfiguration,
} from "./admin_oauth.js";

const config = JSON.parse(
  document.body.dataset.oidc!,
) as AdminBrowserOidcConfiguration;
const namespace = `appbase.admin:${config.issuer}:${config.clientId}:${config.resource}`;
const store = new AdminCredentialStore(
  namespace,
  localStorage,
  (name, action) => navigator.locks.request(name, action),
);
const oidc = new AdminBrowserOidc(config, store, sessionStorage);
const ready = (async () => {
  const url = new URL(location.href);
  if (url.pathname === new URL(config.redirectUri).pathname) {
    // Remove the authorization response before any later navigation or UI error.
    history.replaceState(null, "", document.body.dataset.base!);
    await oidc.callback(url);
  }
})();

const auth = {
  async headers(): Promise<Record<string, string>> {
    try {
      await ready;
      return { Authorization: `Bearer ${await oidc.accessToken()}` };
    } catch (cause) {
      const error = new Error("Sign in to administration again.", { cause });
      Object.assign(error, { status: 401 });
      throw error;
    }
  },
};
Object.assign(globalThis, { appbaseAdminAuth: auth });

document.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const link = target.closest<HTMLAnchorElement>("a[data-admin-auth]");
  if (!link) return;
  event.preventDefault();
  try {
    if (link.dataset.adminAuth === "logout") {
      await oidc.signOut();
      location.assign(document.body.dataset.base!);
    } else {
      location.assign(await oidc.authorizationUrl());
    }
  } catch (error) {
    const status = document.querySelector<HTMLElement>("#status")!;
    status.textContent =
      error instanceof AdminSignInRequired
        ? error.message
        : "Sign-in failed. Try again.";
    status.dataset.error = "true";
  }
});
