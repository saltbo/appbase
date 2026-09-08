const escape = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
export const adminHtml = (
  base: string,
  product: string,
  environments?: readonly { name: string; url: string }[],
) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(product)} administration</title><link rel="stylesheet" href="${escape(base)}/admin.css"><script defer src="${escape(base)}/admin.js"></script></head><body data-base="${escape(base)}" data-environments="${escape(JSON.stringify(environments ?? []))}"><header><a class="brand" href="${escape(base)}">${escape(product)}<span>Admin</span></a><div class="header-tools"><label class="sr-only" for="environment">Environment</label><select id="environment" aria-label="Environment"></select><a href="${escape(base)}/session/logout">Sign out</a></div></header><div class="shell"><aside><span class="eyebrow">WORKSPACE</span><nav aria-label="Administration"><button id="customers-nav" class="nav-item" type="button">Customers</button><button id="plans-nav" class="nav-item" type="button" hidden>Plans & quotas</button></nav><p class="sidebar-note">Membership data is synchronized with RevenueCat.</p></aside><main><p id="status" role="status">Loading administration…</p><section id="content" aria-label="Administration content"></section></main></div></body></html>`;
export const adminStyle = `:root{--ink:#252330;--muted:#696575;--line:#e8e6ed;--paper:#fff;--wash:#faf9fc;--accent:#6850b8;--accent-wash:#f0ecfa;--danger:#b42332;--radius:12px}*{box-sizing:border-box}body{margin:0;background:var(--wash);color:var(--ink);font:14px/1.55 system-ui,sans-serif}header{height:76px;background:var(--paper);border-bottom:1px solid var(--line);padding:0 32px;display:flex;align-items:center;justify-content:space-between;gap:20px}.brand{font-size:22px;font-weight:750;color:var(--ink);text-decoration:none;letter-spacing:-.5px}.brand span{font-size:12px;font-weight:500;letter-spacing:0;color:var(--muted);border-left:1px solid var(--line);padding-left:12px;margin-left:12px}.header-tools{flex-shrink:0;display:flex;align-items:center;gap:20px}.header-tools a{white-space:nowrap}.header-tools select{width:auto;margin:0;background:var(--accent-wash);color:var(--accent);border-color:transparent;font-weight:650}.shell{display:grid;grid-template-columns:208px minmax(0,1fr);max-width:1600px;margin:auto;min-height:calc(100vh - 76px)}aside{padding:30px 16px;border-right:1px solid var(--line);background:var(--paper)}.eyebrow{font-size:10px;letter-spacing:.12em;color:var(--muted);padding:0 12px}.nav-item{display:block;width:100%;text-align:left;margin:8px 0;background:transparent;color:var(--muted);border-color:transparent}.nav-item[aria-current=page]{background:var(--accent-wash);color:var(--accent);font-weight:650}.sidebar-note{padding:18px 12px;font-size:12px;color:var(--muted)}main{min-width:0;padding:22px 36px 48px}h1{font-size:28px;letter-spacing:-.7px;margin:0}h2{font-size:24px;margin:12px 0}h3{font-size:16px}p{margin:8px 0}a{color:var(--accent)}button,input,select,textarea{font:inherit;min-height:42px;border:1px solid var(--line);border-radius:8px;padding:9px 13px}button{cursor:pointer;background:var(--accent);color:white;font-weight:600}button.secondary{background:var(--paper);color:var(--ink)}button:disabled{opacity:.45;cursor:default}button:hover:enabled{filter:brightness(.96)}:focus-visible{outline:3px solid var(--accent);outline-offset:3px}input,textarea,select{background:var(--paper);color:var(--ink)}input,select,textarea{width:100%;max-width:700px}label{display:block;margin:16px 0 5px}input[type=checkbox]{width:auto;min-height:auto;accent-color:var(--accent)}fieldset{min-width:0}textarea{min-height:110px}.card{background:var(--paper);border:1px solid var(--line);border-radius:var(--radius);padding:22px;margin:20px 0}.page-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:8px 0 24px}.muted,small{color:var(--muted)}.search{display:flex;gap:10px;align-items:center;max-width:620px}.search input{min-width:0}.list-card{background:var(--paper);border:1px solid var(--line);border-radius:var(--radius);margin-top:20px;overflow:hidden}.table{overflow-x:auto}table{width:100%;border-collapse:collapse;text-align:left}th{color:var(--muted);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;background:var(--wash)}th,td{padding:16px 20px;border-bottom:1px solid var(--line)}td{vertical-align:middle}.customer-link{padding:0;min-height:30px;color:var(--accent);background:transparent;border:0;text-align:left;font:inherit}.id{font:12px/1.6 ui-monospace,monospace;overflow-wrap:anywhere}.payment-id{color:var(--muted);font-size:11px}.badge{display:inline-block;padding:4px 10px;border-radius:20px;font-size:12px;background:var(--wash);color:var(--muted);white-space:nowrap}.badge.paid{background:var(--accent-wash);color:var(--accent)}.pagination{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 20px;color:var(--muted);font-size:12px}.actions{display:flex;gap:10px;flex-wrap:wrap;margin:18px 0}.pagination .actions{margin:0}.empty{text-align:center;padding:52px 20px;color:var(--muted)}.empty h2{color:var(--ink);font-size:18px}.detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:24px}.detail-grid dt{font-size:12px;color:var(--muted);margin-bottom:6px}.detail-grid dd{margin:0;overflow-wrap:anywhere}.back{margin-bottom:14px}#status{min-height:22px;color:var(--muted);font-size:12px;margin:0 0 12px}#status[data-error=true]{color:var(--danger)}code{overflow-wrap:anywhere}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}[hidden]{display:none!important}@media(max-width:850px){.shell{grid-template-columns:1fr}aside{padding:10px 20px;border-right:0;border-bottom:1px solid var(--line)}aside .eyebrow,.sidebar-note{display:none}nav{display:flex;gap:8px}.nav-item{width:auto;margin:0}main{padding:20px}header{padding:0 20px}.detail-grid{grid-template-columns:1fr}}@media(max-width:550px){header{height:auto;min-height:76px;padding:16px;gap:10px}.header-tools{gap:10px}.brand span{display:none}main{padding:16px}.page-heading{margin-bottom:18px}h1{font-size:25px}.desktop-only{display:none}th,td{padding:14px 12px}.pagination{padding:12px;flex-wrap:wrap}.card{padding:16px}.search button{white-space:nowrap}}`;

// Dynamic values are escaped; environment data never enters executable source.
export const adminScript = String.raw`
const base = document.body.dataset.base;
const content = document.querySelector("#content"), status = document.querySelector("#status");
const selector = document.querySelector("#environment");
let environments = JSON.parse(document.body.dataset.environments), context, active, selected, page = 1, query = "";
const esc = value => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const date = value => value ? new Date(value).toLocaleString(undefined, {dateStyle:"medium", timeStyle:"short"}) : "Not synchronized";
const planName = p => p.displayName || p.id;
function message(text, error = false) { status.textContent = text; status.dataset.error = String(error); }
function view() {
  active?.controller.abort();
  active = { controller: new AbortController(), url: selected.url, environment: selected.name };
  content.innerHTML = "";
  message("Loading…");
  return active;
}
function report(error, scope) {
  if (scope !== active || error.name === "AbortError") return;
  message(error.message, true);
  if (error.status === 401) content.innerHTML = '<div class="empty"><h2>Sign in to administration</h2><p>Use your authorized operator account.</p><a href="' + esc(base) + '/session/login">Sign in with OIDC</a></div>';
}
async function api(scope, path, options = {}) {
  const response = await fetch(scope.url + path, { ...options, signal: scope.controller.signal,
    headers: { "Content-Type":"application/json", ...options.headers } });
  const data = await response.json();
  if (scope !== active) throw new DOMException("View changed", "AbortError");
  if (!response.ok) { const error = new Error(response.status === 401 ? "Your session has expired. Sign in again." : response.status === 403 ? "You do not have access to this environment or operation." : data.detail || "The request failed."); error.status = response.status; throw error; }
  return { data, response };
}
function bindForm(id, scope, handler) {
  document.getElementById(id).addEventListener("submit", async event => {
    event.preventDefault();
    if (scope !== active) return;
    const button = event.target.querySelector("button[type=submit]"); button.disabled = true;
    message("Working…");
    try { await handler(new FormData(event.target)); } catch (e) { report(e, scope); }
    finally { button.disabled = false; }
  });
}
async function loadCatalog(scope) {
  const result = await api(scope, "/catalog");
  const revision = result.response.headers.get("AppBase-Catalog-Revision");
  if (!/^(0|[1-9][0-9]*)$/.test(revision ?? "")) throw new Error("Invalid catalog revision.");
  return { catalog: result.data, etag: '"' + revision + '"' };
}
function nav(name) {
  for (const id of ["customers", "plans"]) document.getElementById(id + "-nav").setAttribute("aria-current", id === name ? "page" : "false");
}
async function home() {
  const scope = view(); nav("customers");
  try {
    const {data} = await api(scope, "/customers?page=" + page + "&pageSize=20&query=" + encodeURIComponent(query));
    const p = data.pagination;
    content.innerHTML = '<div class="page-heading"><div><h1>Customers</h1><p class="muted">Payment accounts and membership status.</p></div><button class="secondary" id="reload">Refresh</button></div><form id="search" class="search"><label class="sr-only" for="query">Search customers</label><input id="query" name="query" placeholder="Search user or RevenueCat ID" maxlength="200" value="' + esc(query) + '"><button type="submit">Search</button></form><div class="list-card">' +
      (data.items.length ? '<div class="table"><table><thead><tr><th>Customer</th><th>Plan</th><th class="desktop-only">Last synchronized</th></tr></thead><tbody>' + data.items.map((c,i) => '<tr><td><button class="customer-link id" data-customer="' + i + '">' + esc(c.ownerSub) + '</button><div class="payment-id id">' + esc(c.appUserId) + '</div></td><td><span class="badge' + (c.isPaid ? ' paid' : '') + '">' + esc(c.planName) + '</span></td><td class="desktop-only">' + esc(date(c.synchronizedAt)) + '</td></tr>').join('') + '</tbody></table></div>' : '<div class="empty"><h2>' + (query ? 'No matching customers' : 'No payment customers yet') + '</h2><p>' + (query ? 'Try another user or RevenueCat ID.' : 'Customers appear here when a payment identity is created in this environment.') + '</p></div>') + '<div class="pagination"><span>' + p.totalItems + ' customers · Page ' + p.page + ' of ' + Math.max(1,p.totalPages) + '</span><div class="actions"><button class="secondary" id="previous"' + (page === 1 ? ' disabled' : '') + '>Previous</button><button class="secondary" id="next"' + (page >= p.totalPages ? ' disabled' : '') + '>Next</button></div></div></div>';
    bindForm("search", scope, async f => { query = String(f.get("query")).trim(); page = 1; await home(); });
    content.querySelectorAll("[data-customer]").forEach(b => b.onclick = () => showUser(data.items[Number(b.dataset.customer)].ownerSub));
    document.getElementById("reload").onclick = home;
    document.getElementById("previous").onclick = () => { page--; home(); };
    document.getElementById("next").onclick = () => { page++; home(); };
    message("");
  } catch (e) { report(e, scope); }
}
function membership(m, catalog) {
  const plan = [catalog.freePlan,...catalog.plans].find(p => p.id === m.planId) || {id:m.planId};
  return '<div class="card"><h2>' + esc(planName(plan)) + '</h2><p class="muted">' + (m.grantEndsAt ? 'Valid until ' + esc(date(m.grantEndsAt)) : 'No fixed expiry') + '</p><div class="table"><table><thead><tr><th>Capability</th><th>Used</th><th>Limit</th><th>Period</th></tr></thead><tbody>' + Object.entries(m.capabilities).map(([key,v]) => '<tr><td>' + esc(key) + '</td><td>' + esc(v.used) + '</td><td>' + esc(v.limit === null ? 'Unlimited' : v.limit) + '</td><td>' + esc(v.period.replaceAll('_',' ')) + '</td></tr>').join('') + '</tbody></table></div></div>';
}
async function showUser(query) {
  const scope = view(); nav("customers");
  try {
    const {catalog} = await loadCatalog(scope);
    const {data:user} = await api(scope, "/users?query=" + encodeURIComponent(query));
    content.innerHTML = '<button class="secondary back" id="back">Back to customers</button><div class="page-heading"><div><h1>Customer details</h1><p class="muted">Membership and usage</p></div><button class="secondary" id="refresh">Refresh</button></div><div class="card"><dl class="detail-grid"><div><dt>User ID</dt><dd class="id">' + esc(user.ownerSub) + '</dd></div><div><dt>RevenueCat ID</dt><dd class="id">' + esc(user.appUserId || 'Not created') + '</dd></div><div><dt>Membership source</dt><dd>' + esc({subscription:'RevenueCat',legacy:'Existing membership',default:'Default plan'}[user.source]) + '</dd></div><div><dt>Last synchronized</dt><dd>' + esc(date(user.subscription?.observedAt)) + '</dd></div></dl></div>' + membership(user.membership,catalog) + '<p class="muted">To grant complimentary access, use this customer’s RevenueCat ID in the RevenueCat dashboard.</p>';
    document.getElementById("back").onclick = home;
    document.getElementById("refresh").onclick = () => showUser(user.ownerSub);
    message("");
  } catch(e) { report(e,scope); }
}
async function configure() {
  const scope = view(); nav("plans");
  try {
    const { catalog, etag } = await loadCatalog(scope);
    const plans = [catalog.freePlan, ...catalog.plans];
    content.innerHTML =
      '<button class="secondary" id="cancel">Back to customers</button><h2>Plans and quotas</h2><p>Names and limits apply on the next membership read. Leave a limit blank for unlimited. Prices remain store-owned.</p><form id="catalog-form">' +
      plans
        .map(
          (p, i) =>
            '<fieldset class="card"><legend>' +
            esc(planName(p)) +
            "</legend><p>Plan ID: <code>" +
            esc(p.id) +
            '</code></p><label for="name-' +
            i +
            '">Display name for ' +
            esc(p.id) +
            '</label><input id="name-' +
            i +
            '" name="name-' +
            i +
            '" maxlength="100" value="' +
            esc(p.displayName || p.id) +
            '">' +
            Object.entries(p.capabilities)
              .map(
                ([key, v], j) =>
                  '<label for="limit-' +
                  i +
                  "-" +
                  j +
                  '">' +
                  esc(p.id) +
                  " / " +
                  esc(key) +
                  " limit (" +
                  esc(v.period) +
                  ')</label><input id="limit-' +
                  i +
                  "-" +
                  j +
                  '" name="limit-' +
                  i +
                  "-" +
                  j +
                  '" type="number" min="0" step="1" value="' +
                  esc(v.limit === null ? "" : v.limit) +
                  '">',
              )
              .join("") +
            "</fieldset>",
        )
        .join("") +
      "<h3>Subscription mapping</h3>" +
      Object.entries(catalog.entitlementPlans)
        .map(
          ([key, value], i) =>
            '<label for="mapping-' +
            i +
            '">Entitlement ' +
            esc(key) +
            '</label><select id="mapping-' +
            i +
            '" name="mapping-' +
            i +
            '">' +
            catalog.plans
              .map(
                (p) =>
                  '<option value="' +
                  esc(p.id) +
                  '"' +
                  (value === p.id ? " selected" : "") +
                  ">" +
                  esc(planName(p)) +
                  "</option>",
              )
              .join("") +
            "</select>",
        )
        .join("") +
      '<label><input type="checkbox" name="grace"' +
      (catalog.honorGracePeriod ? " checked" : "") +
      '> Honor provider grace periods</label><label for="confirm">Type ' +
      esc(context.environment) +
      ' to confirm</label><input id="confirm" name="environment" required><div class="actions"><button type="submit">Save catalog</button></div></form>';
    document.getElementById("cancel").onclick = home;
    bindForm("catalog-form", scope, async (f) => {
      const updated = structuredClone(catalog);
      [updated.freePlan, ...updated.plans].forEach((p, i) => {
        p.displayName = f.get("name-" + i);
        Object.entries(p.capabilities).forEach(([key, v], j) => {
          const value = f.get("limit-" + i + "-" + j);
          v.limit = value === "" ? null : Number(value);
        });
      });
      Object.keys(updated.entitlementPlans).forEach((key, i) => {
        updated.entitlementPlans[key] = f.get("mapping-" + i);
      });
      updated.honorGracePeriod = f.has("grace");
      await api(scope, "/catalog", {
        method: "PUT",
        headers: {
          "If-Match": etag,
          "Admin-Environment": f.get("environment"),
        },
        body: JSON.stringify(updated),
      });
      if (scope !== active) return;
      await configure();
      message("Catalog saved.");
    });
  } catch (e) {
    report(e, scope);
  }
}

async function start() {
  const scope = view();
  context = undefined;
  document.getElementById("plans-nav").hidden = true;
  try {
    context = (await api(scope, "/context")).data;
    document.getElementById("plans-nav").hidden = !context.canConfigure;
    await home();
  } catch(e) { report(e, scope); }
}
if (!environments.length) environments = [{name:"production",url:base}];
selected = environments[0];
selector.innerHTML = environments.map(e => '<option value="' + esc(e.name) + '">' + esc(e.name === 'production' ? 'Production' : 'Sandbox') + '</option>').join('');
selector.onchange = () => { selected = environments.find(e => e.name === selector.value); page = 1; query = ""; start(); };
document.getElementById("customers-nav").onclick = home;
document.getElementById("plans-nav").onclick = configure;
start();
`;
