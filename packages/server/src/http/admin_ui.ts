import type { AdminBrowserOidcConfiguration } from "../browser/admin_oauth.js";
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
  oidc?: AdminBrowserOidcConfiguration,
) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(product)} administration</title><link rel="stylesheet" href="${escape(base)}/admin.css">${oidc ? `<script defer src="${escape(base)}/auth.js"></script>` : ""}<script defer src="${escape(base)}/admin.js"></script></head><body data-oidc="${escape(JSON.stringify(oidc ?? null))}" data-base="${escape(base)}" data-environments="${escape(JSON.stringify(environments ?? []))}"><header><a class="brand" href="${escape(base)}">${escape(product)}<span>Admin</span></a><div class="header-tools"><label class="sr-only" for="environment">Environment</label><select id="environment" aria-label="Environment"></select><a data-admin-auth="logout" href="${escape(base)}/session/logout">Sign out</a></div></header><div class="shell"><aside><span class="eyebrow">WORKSPACE</span><nav aria-label="Administration"><button id="customers-nav" class="nav-item" type="button">Customers</button><button id="plans-nav" class="nav-item" type="button" hidden>Plans & quotas</button><button id="payments-nav" class="nav-item" type="button" hidden>Payment settings</button><button id="events-nav" class="nav-item" type="button" hidden>Webhook events</button></nav><p class="sidebar-note">Payment access is synchronized from the configured provider.</p></aside><main><p id="status" role="status">Loading administration…</p><section id="content" aria-label="Administration content"></section></main></div></body></html>`;
export const adminStyle = `:root{--ink:#252330;--muted:#696575;--line:#e8e6ed;--paper:#fff;--wash:#faf9fc;--accent:#6850b8;--accent-wash:#f0ecfa;--danger:#b42332;--radius:12px}*{box-sizing:border-box}body{margin:0;background:var(--wash);color:var(--ink);font:14px/1.55 system-ui,sans-serif}header{height:76px;background:var(--paper);border-bottom:1px solid var(--line);padding:0 32px;display:flex;align-items:center;justify-content:space-between;gap:20px}.brand{font-size:22px;font-weight:750;color:var(--ink);text-decoration:none;letter-spacing:-.5px}.brand span{font-size:12px;font-weight:500;letter-spacing:0;color:var(--muted);border-left:1px solid var(--line);padding-left:12px;margin-left:12px}.header-tools{flex-shrink:0;display:flex;align-items:center;gap:20px}.header-tools a{white-space:nowrap}.header-tools select{width:auto;margin:0;background:var(--accent-wash);color:var(--accent);border-color:transparent;font-weight:650}.shell{display:grid;grid-template-columns:208px minmax(0,1fr);max-width:1600px;margin:auto;min-height:calc(100vh - 76px)}aside{padding:30px 16px;border-right:1px solid var(--line);background:var(--paper)}.eyebrow{font-size:10px;letter-spacing:.12em;color:var(--muted);padding:0 12px}.nav-item{display:block;width:100%;text-align:left;margin:8px 0;background:transparent;color:var(--muted);border-color:transparent}.nav-item[aria-current=page]{background:var(--accent-wash);color:var(--accent);font-weight:650}.sidebar-note{padding:18px 12px;font-size:12px;color:var(--muted)}main{min-width:0;padding:22px 36px 48px}h1{font-size:28px;letter-spacing:-.7px;margin:0}h2{font-size:24px;margin:12px 0}h3{font-size:16px}p{margin:8px 0}a{color:var(--accent)}button,input,select,textarea{font:inherit;min-height:42px;border:1px solid var(--line);border-radius:8px;padding:9px 13px}button{cursor:pointer;background:var(--accent);color:white;font-weight:600}button.secondary{background:var(--paper);color:var(--ink)}button:disabled{opacity:.45;cursor:default}button:hover:enabled{filter:brightness(.96)}:focus-visible{outline:3px solid var(--accent);outline-offset:3px}input,textarea,select{background:var(--paper);color:var(--ink)}input,select,textarea{width:100%;max-width:700px}label{display:block;margin:16px 0 5px}input[type=checkbox]{width:auto;min-height:auto;accent-color:var(--accent)}fieldset{min-width:0}textarea{min-height:110px}.card{background:var(--paper);border:1px solid var(--line);border-radius:var(--radius);padding:22px;margin:20px 0}.page-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:8px 0 24px}.muted,small{color:var(--muted)}.search{display:flex;gap:10px;align-items:center;max-width:620px}.search input{min-width:0}.list-card{background:var(--paper);border:1px solid var(--line);border-radius:var(--radius);margin-top:20px;overflow:hidden}.table{overflow-x:auto}table{width:100%;border-collapse:collapse;text-align:left}th{color:var(--muted);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;background:var(--wash)}th,td{padding:16px 20px;border-bottom:1px solid var(--line)}td{vertical-align:middle}.customer-link{padding:0;min-height:30px;color:var(--accent);background:transparent;border:0;text-align:left;font:inherit}.id{font:12px/1.6 ui-monospace,monospace;overflow-wrap:anywhere}.payment-id{color:var(--muted);font-size:11px}.badge{display:inline-block;padding:4px 10px;border-radius:20px;font-size:12px;background:var(--wash);color:var(--muted);white-space:nowrap}.badge.paid{background:var(--accent-wash);color:var(--accent)}.pagination{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 20px;color:var(--muted);font-size:12px}.actions{display:flex;gap:10px;flex-wrap:wrap;margin:18px 0}.pagination .actions{margin:0}.empty{text-align:center;padding:52px 20px;color:var(--muted)}.empty h2{color:var(--ink);font-size:18px}.detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:24px}.detail-grid dt{font-size:12px;color:var(--muted);margin-bottom:6px}.detail-grid dd{margin:0;overflow-wrap:anywhere}.back{margin-bottom:14px}#status{min-height:22px;color:var(--muted);font-size:12px;margin:0 0 12px}#status[data-error=true]{color:var(--danger)}code{overflow-wrap:anywhere}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}[hidden]{display:none!important}@media(max-width:850px){.shell{grid-template-columns:1fr;grid-template-rows:auto 1fr}aside{padding:10px 20px;border-right:0;border-bottom:1px solid var(--line)}aside .eyebrow,.sidebar-note{display:none}nav{display:flex;gap:8px;flex-wrap:wrap}.nav-item{width:auto;margin:0}main{padding:20px}header{padding:0 20px}.detail-grid{grid-template-columns:1fr}}@media(max-width:550px){header{height:auto;min-height:76px;padding:16px;gap:10px}.header-tools{gap:10px}.brand span{display:none}main{padding:16px}.page-heading{margin-bottom:18px}h1{font-size:25px}.desktop-only{display:none}th,td{padding:14px 12px}.pagination{padding:12px;flex-wrap:wrap}.card{padding:16px}.search button{white-space:nowrap}}`;

// Dynamic values are escaped; environment data never enters executable source.
export const adminScript = String.raw`
const base = document.body.dataset.base;
const content = document.querySelector("#content"), status = document.querySelector("#status");
const selector = document.querySelector("#environment");
let environments = JSON.parse(document.body.dataset.environments), context, active, selected, page = 1, query = "", section = "customers";
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
  if (error.status === 401) content.innerHTML = '<div class="empty"><h2>Sign in to administration</h2><p>Use your authorized operator account.</p><a data-admin-auth="login" href="' + esc(base) + '/session/login">Sign in with OIDC</a></div>';
}
async function api(scope, path, options = {}) {
  const authHeaders = globalThis.appbaseAdminAuth ? await globalThis.appbaseAdminAuth.headers() : {};
  if (scope.controller.signal.aborted) throw new DOMException("View changed", "AbortError");
  const response = await fetch(scope.url + path, { ...options, signal: scope.controller.signal,
    headers: { "Content-Type":"application/json", ...options.headers, ...authHeaders } });
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
  section = name;
  for (const id of ["customers", "plans", "payments", "events"]) document.getElementById(id + "-nav").setAttribute("aria-current", id === name ? "page" : "false");
}
async function home() {
  const scope = view(); nav("customers");
  try {
    const {data} = await api(scope, "/customers?page=" + page + "&pageSize=20&query=" + encodeURIComponent(query));
    const p = data.pagination;
    content.innerHTML = '<div class="page-heading"><div><h1>Customers</h1><p class="muted">Payment accounts and membership status.</p></div><button class="secondary" id="reload">Refresh</button></div><form id="search" class="search"><label class="sr-only" for="query">Search customers</label><input id="query" name="query" placeholder="Search user or Payment ID" maxlength="200" value="' + esc(query) + '"><button type="submit">Search</button></form><div class="list-card">' +
      (data.items.length ? '<div class="table"><table><thead><tr><th>Customer</th><th>Plan</th><th class="desktop-only">Last synchronized</th></tr></thead><tbody>' + data.items.map((c,i) => '<tr><td><button class="customer-link id" data-customer="' + i + '">' + esc(c.ownerSub) + '</button><div class="payment-id id">' + esc(c.appUserId) + '</div></td><td><span class="badge' + (c.isPaid ? ' paid' : '') + '">' + esc(c.planName) + '</span></td><td class="desktop-only">' + esc(date(c.synchronizedAt)) + '</td></tr>').join('') + '</tbody></table></div>' : '<div class="empty"><h2>' + (query ? 'No matching customers' : 'No payment customers yet') + '</h2><p>' + (query ? 'Try another user or Payment ID.' : 'Customers appear here when a payment identity is created in this environment.') + '</p></div>') + '<div class="pagination"><span>' + p.totalItems + ' customers · Page ' + p.page + ' of ' + Math.max(1,p.totalPages) + '</span><div class="actions"><button class="secondary" id="previous"' + (page === 1 ? ' disabled' : '') + '>Previous</button><button class="secondary" id="next"' + (page >= p.totalPages ? ' disabled' : '') + '>Next</button></div></div></div>';
    bindForm("search", scope, async f => { query = String(f.get("query")).trim(); page = 1; await home(); });
    content.querySelectorAll("[data-customer]").forEach(b => b.onclick = () => showUser(data.items[Number(b.dataset.customer)].ownerSub));
    document.getElementById("reload").onclick = home;
    document.getElementById("previous").onclick = () => { page--; home(); };
    document.getElementById("next").onclick = () => { page++; home(); };
    message("");
  } catch (e) { report(e, scope); }
}
function benefit(key) { return context.benefits?.[key]; }
function benefitName(key) { return benefit(key)?.displayName || key; }
function limitLabel(key, value) {
  if (value === null) return "Unlimited";
  const unit = benefit(key)?.unit;
  const resolution = unit === "pixels" ? ({921600:"720p",2073600:"1080p",8294400:"4K"})[value] : null;
  return resolution ? resolution + " (" + value.toLocaleString() + " pixels)" : value.toLocaleString() + (unit ? " " + unit : "");
}
function benefitGroups(capabilities, render) {
  const rows = Object.entries(capabilities).map(([key,value],index) => ({key,value,index}));
  return [["cloud","Cloud quotas"],["client","Local unlock policy"],[undefined,"Benefits"]].map(([kind,title]) => {
    const group = rows.filter(row => benefit(row.key)?.enforcement === kind);
    return group.length ? '<section class="benefit-group"><h3>' + title + '</h3>' + (kind === 'client' ? '<p class="muted">Policy is configured here and enforced on the device. Device usage is not reported to this server.</p>' : '') + render(group) + '</section>' : '';
  }).join('');
}
function membership(m,catalog) {
  const plan = [catalog.freePlan,...catalog.plans].find(p => p.id === m.planId) || {id:m.planId};
  return '<div class="card"><h2>' + esc(planName(plan)) + '</h2><p class="muted">' + (m.grantEndsAt ? 'Valid until ' + esc(date(m.grantEndsAt)) : 'No fixed expiry') + '</p>' + benefitGroups(m.capabilities, rows => '<div class="table"><table><thead><tr><th>Benefit</th><th>Used</th><th>Limit</th><th>Period</th></tr></thead><tbody>' + rows.map(({key,value:v}) => '<tr><td>' + esc(benefitName(key)) + '<div class="id muted">' + esc(key) + '</div></td><td>' + esc(v.used === null ? 'On device' : v.limit === null ? 'Not metered' : v.used) + '</td><td>' + esc(limitLabel(key,v.limit)) + '</td><td>' + esc(v.period.replaceAll('_',' ')) + '</td></tr>').join('') + '</tbody></table></div>') + '</div>';
}
function benefitInputs(plan) {
  return benefitGroups(plan.capabilities, rows => rows.map(({key,value:v,index:i}) => '<label for="limit-' + i + '">' + esc(benefitName(key)) + '</label><p class="muted">' + esc(benefit(key)?.description || key) + '</p><input aria-label="' + esc(plan.id + ' / ' + key + ' limit (' + v.period + ')') + '" id="limit-' + i + '" name="limit-' + i + '" type="number" min="0" step="1" value="' + esc(v.limit === null ? '' : v.limit) + '"><small>' + esc((benefit(key)?.unit || 'units') + ' · ' + v.period.replaceAll('_',' ')) + ' · Current: ' + esc(limitLabel(key,v.limit)) + '</small>').join(''));
}
function providerName() { return context.paymentProvider?.providerName || "Payment provider"; }
function dashboardLink() {
  const value = context.paymentProvider?.dashboardUrl;
  if (!value) return '';
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error("Invalid payment dashboard URL.");
  return '<a href="' + esc(url.href) + '" target="_blank" rel="noopener noreferrer">Open ' + esc(providerName()) + ' dashboard ↗</a>';
}
function accessDetails(user) {
  const entitlements = user.subscription?.entitlements || [];
  return '<div class="card"><h2>Provider entitlements</h2>' + (entitlements.length ? '<div class="table"><table><thead><tr><th>Entitlement / Product</th><th>Access</th><th>Status</th><th>Expiry</th><th>Renewal</th></tr></thead><tbody>' + entitlements.map((e,i) => '<tr><td><strong>' + esc(e.id) + '</strong><div class="id muted">' + esc(e.productId) + '</div><small>' + esc(e.store) + '</small></td><td>' + esc(user.access?.[i]?.kind || 'unknown') + '</td><td>' + esc((user.access?.[i]?.status || 'unknown').replaceAll('_',' ')) + '</td><td>' + esc(e.expiresAt ? date(e.expiresAt) : 'No expiry') + '</td><td>' + (e.willRenew ? 'Will renew' : 'Not renewing') + '</td></tr>').join('') + '</tbody></table></div>' : '<p class="muted">No synchronized provider entitlements.</p>') + '<div class="actions">' + dashboardLink() + '</div></div>';
}
async function showPayments() {
  const scope = view(); nav("payments");
  try {
  const {catalog} = await loadCatalog(scope);
  const provider = context.paymentProvider;
  content.innerHTML = '<div class="page-heading"><div><h1>Payment settings</h1><p class="muted">Provider configuration for ' + esc(scope.environment) + '.</p></div></div>' + (provider ? '<div class="card"><h2>' + esc(provider.providerName) + '</h2><p class="id muted">' + esc(provider.providerId) + '</p><p>Configuration is supplied by the application deployment.</p><div class="table"><table><thead><tr><th>Setting</th><th>Configuration</th></tr></thead><tbody>' + provider.settings.map(setting => '<tr><td>' + esc(setting.name) + '</td><td>' + (setting.configured ? 'Configured' : 'Not configured') + '</td></tr>').join('') + '</tbody></table></div><p class="muted">These checks confirm configuration presence, not provider connectivity. Secret values are never displayed.</p><h3>Webhook endpoint</h3><p class="id">' + esc(provider.webhookPath ? new URL(provider.webhookPath,location.origin).href : 'Not configured') + '</p><p class="muted">Verified notifications determine the payment environment. The page selector does not reassign transactions.</p><div class="actions">' + dashboardLink() + '</div></div>' : '<div class="empty"><h2>No provider inspection configured</h2><p>The host application has not supplied payment configuration metadata.</p></div>');
  content.innerHTML += '<div class="card"><h2>Grace period policy</h2><p>' + (catalog.honorGracePeriod ? 'Enabled' : 'Disabled') + '</p><p class="muted">When enabled, access continues until the provider’s grace-period end during renewal payment issues.</p>' + (context.canConfigure ? '<button class="secondary" id="edit-grace">Edit grace period policy</button>' : '') + '</div>';
  document.getElementById("edit-grace")?.addEventListener("click",()=>configure(null));
  message("");
  return scope;
  } catch(error) { report(error,scope); }
}
async function showEvents(eventPage = 1) {
  const scope = view(); nav("events");
  try {
    const {data} = await api(scope, "/events?page=" + eventPage);
    content.innerHTML = '<div class="page-heading"><div><h1>Webhook events</h1><p class="muted">Successfully processed notification IDs in ' + esc(scope.environment) + '.</p></div></div><p class="muted">The current event store contains processing receipts. It does not record failed deliveries, transaction history or event payloads; inspect those in the provider dashboard.</p><div class="list-card"><div class="table"><table><thead><tr><th>Event ID</th><th>Processed at</th></tr></thead><tbody>' + data.items.map(e => '<tr><td class="id">' + esc(e.id) + '</td><td>' + esc(date(e.processedAt)) + '</td></tr>').join('') + '</tbody></table></div>' + (data.items.length ? '' : '<p class="empty">No processed notifications in this environment.</p>') + '<div class="pagination"><span>' + data.totalItems + ' events · Page ' + data.page + ' of ' + Math.max(1,data.totalPages) + '</span><div class="actions"><button class="secondary" id="previous-events"' + (eventPage <= 1 ? ' disabled' : '') + '>Previous</button><button class="secondary" id="next-events"' + (eventPage >= data.totalPages ? ' disabled' : '') + '>Next</button></div></div></div>';
    document.getElementById("previous-events").onclick = () => showEvents(eventPage-1);
    document.getElementById("next-events").onclick = () => showEvents(eventPage+1);
    message("");
  } catch (error) { report(error,scope); }
}
async function showUser(query) {
  const scope = view(); nav("customers");
  try {
    const {catalog} = await loadCatalog(scope);
    const {data:user} = await api(scope, "/users?query=" + encodeURIComponent(query));
    content.innerHTML = '<button class="secondary back" id="back">Back to customers</button><div class="page-heading"><div><h1>Customer details</h1><p class="muted">Membership and usage</p></div><button class="secondary" id="refresh">Refresh</button></div><div class="card"><dl class="detail-grid"><div><dt>User ID</dt><dd class="id">' + esc(user.ownerSub) + '</dd></div><div><dt>Payment ID</dt><dd class="id">' + esc(user.appUserId || 'Not created') + '</dd></div><div><dt>Membership source</dt><dd>' + esc({subscription:providerName(),legacy:'Existing membership',default:'Default plan'}[user.source]) + '</dd></div><div><dt>Last synchronized</dt><dd>' + esc(date(user.subscription?.observedAt)) + '</dd></div></dl></div>' + membership(user.membership,catalog) + accessDetails(user) + '<p class="muted">Complimentary access is managed in the payment provider dashboard using the Payment ID.</p>';
    document.getElementById("back").onclick = home;
    document.getElementById("refresh").onclick = () => showUser(user.ownerSub);
    message("");
  } catch(e) { report(e,scope); }
}
function entitlementFields(catalog, planId) {
  const ids = Object.entries(catalog.entitlementPlans).filter(([,id]) => id === planId).map(([id]) => id);
  return '<h3>Provider entitlements</h3>' + (ids.length ? ids.map((id,index) => '<label for="bound-' + index + '">Entitlement ' + esc(id) + '</label><select id="bound-' + index + '" name="bound-' + index + '">' + catalog.plans.map(plan => '<option value="' + esc(plan.id) + '"' + (plan.id === planId ? ' selected' : '') + '>' + esc(planName(plan)) + '</option>').join('') + '</select>').join('') + '<p class="muted">Changing a binding changes access for existing holders. Historical entitlement IDs cannot be deleted.</p>' : '') + '<label for="entitlement-id">' + (ids.length ? 'Additional entitlement ID' : 'Entitlement ID') + '</label><input id="entitlement-id" name="entitlement" maxlength="100"' + (ids.length ? '' : ' required') + '><p class="muted">Enter the exact entitlement ID from ' + esc(providerName()) + '. This saves the binding; it does not create an entitlement in the provider.</p>';
}
function bindEntitlement(catalog, planId, form) {
  const id = String(form.get("entitlement") || "").trim();
  if (!id) {
    if (!Object.values(catalog.entitlementPlans).includes(planId)) throw new Error("An entitlement ID is required for this plan.");
    return;
  }
  if (Object.hasOwn(catalog.entitlementPlans,id)) throw new Error("This entitlement is already bound to a plan.");
  Object.defineProperty(catalog.entitlementPlans,id,{value:planId,enumerable:true,writable:true,configurable:true});
}
async function showPlans() {
  const scope = view(); nav("plans");
  try {
    const {catalog} = await loadCatalog(scope);
    const plans = [catalog.freePlan, ...catalog.plans];
    content.innerHTML = '<div class="page-heading"><div><h1>Plans</h1><p class="muted">Membership names and benefit limits.</p></div>' + (context.canConfigure ? '<div class="actions"><button id="new-plan">Create plan</button></div>' : '') + '</div><div class="list-card"><div class="table"><table><thead><tr><th>Plan</th><th>Type / Priority</th><th>Entitlements</th><th class="desktop-only">Benefits</th>' + (context.canConfigure ? '<th><span class="sr-only">Actions</span></th>' : '') + '</tr></thead><tbody>' + plans.map((p,i) => '<tr><td><strong>' + esc(planName(p)) + '</strong><div class="id muted">' + esc(p.id) + '</div></td><td><span class="badge' + (i ? ' paid' : '') + '">' + (i ? 'Paid · ' + i : 'Free · Default') + '</span></td><td>' + (i ? Object.entries(catalog.entitlementPlans).filter(([,id])=>id===p.id).map(([id])=>'<code>' + esc(id) + '</code>').join(', ') || 'Not bound' : 'No entitlement required') + '</td><td class="desktop-only">' + Object.keys(p.capabilities).length + ' benefits</td>' + (context.canConfigure ? '<td><button class="secondary" data-edit="' + i + '" aria-label="Edit ' + esc(planName(p)) + '">Edit</button></td>' : '') + '</tr>').join('') + '</tbody></table></div><div class="pagination"><span>' + plans.length + ' plans</span><span>Lower priority numbers win when multiple entitlements are active. Prices and offers are managed in the provider and store.</span></div></div>';
    content.querySelectorAll("[data-edit]").forEach(b => b.onclick = () => configure(plans[Number(b.dataset.edit)].id));
    document.getElementById("new-plan")?.addEventListener("click", createPlan);
    message("");
  } catch(e) { report(e, scope); }
}
async function createPlan() {
  const scope = view(); nav("plans");
  try {
    const {catalog, etag} = await loadCatalog(scope);
    const plans = [catalog.freePlan,...catalog.plans];
    content.innerHTML = '<button class="secondary back" id="cancel">Back to plans</button><h1>Create plan</h1><form id="create-plan-form"><div class="card"><label for="new-plan-id">Plan ID</label><input id="new-plan-id" name="id" required maxlength="100" pattern="([a-zA-Z0-9_.:]|-)+"><p class="muted">Stable technical identifier. Existing plan IDs cannot be renamed or removed.</p><label for="new-plan-name">Display name</label><input id="new-plan-name" name="name" required maxlength="100"><label for="template">Copy benefit limits from</label><select id="template" name="template">' + plans.map((p,i)=>'<option value="' + i + '">' + esc(planName(p)) + '</option>').join('') + '</select><p class="muted">The new plan has the lowest selection priority. Existing application capabilities are reused.</p><div id="new-benefits">' + benefitInputs(plans[0]) + '</div>' + entitlementFields(catalog,null) + '</div><label for="confirm">Type ' + esc(scope.environment) + ' to confirm</label><input id="confirm" name="environment" required><div class="actions"><button type="submit">Create plan</button></div></form>';
    document.getElementById("cancel").onclick = showPlans;
    document.getElementById("template").onchange = event => { document.getElementById("new-benefits").innerHTML = benefitInputs(plans[Number(event.target.value)]); };
    bindForm("create-plan-form",scope,async f=>{
      const id=String(f.get("id")).trim();
      if (plans.some(p=>p.id===id)) throw new Error("This plan ID already exists.");
      const updated=structuredClone(catalog), template=plans[Number(f.get("template"))];
      const capabilities = structuredClone(template.capabilities);
      Object.values(capabilities).forEach((value,index) => { const limit = f.get("limit-" + index); value.limit = limit === "" ? null : Number(limit); });
      updated.plans.push({id,displayName:String(f.get("name")).trim(),capabilities});
      bindEntitlement(updated,id,f);
      await api(scope,"/catalog",{method:"PUT",headers:{"If-Match":etag,"Admin-Environment":f.get("environment")},body:JSON.stringify(updated)});
      await configure(id);
    });
    message("");
  } catch(error) { report(error,scope); }
}
async function configure(planId) {
  const scope = view(); nav(planId === null ? "payments" : "plans");
  try {
    const {catalog, etag} = await loadCatalog(scope);
    const plans = [catalog.freePlan, ...catalog.plans];
    const plan = planId === null ? null : plans.find(p => p.id === planId);
    if (planId !== null && !plan) throw new Error("This plan is no longer available. Return to the plan list.");
    const fields = plan ? '<div class="card"><p class="muted">Plan ID: <code>' + esc(plan.id) + '</code></p><label for="plan-name">Display name for ' + esc(plan.id) + '</label><input id="plan-name" name="name" required maxlength="100" value="' + esc(planName(plan)) + '"><h3>Benefit limits</h3><p class="muted">Leave a limit blank for unlimited.</p>' + benefitInputs(plan) + (plan.id === catalog.freePlan.id ? '' : '<label for="priority">Selection priority</label><select id="priority" name="priority">' + catalog.plans.map((p,index)=>'<option value="' + index + '"' + (p.id === plan.id ? ' selected' : '') + '>' + (index + 1) + '</option>').join('') + '</select><p class="muted">Priority 1 wins when multiple entitlements are active.</p>' + entitlementFields(catalog,plan.id)) + '</div>' : '<div class="card"><label><input type="checkbox" name="grace"' + (catalog.honorGracePeriod ? ' checked' : '') + '> Honor provider grace periods</label><p class="muted">Keep access until the provider’s grace-period end while a renewal payment is being resolved.</p></div>';
    content.innerHTML = '<button class="secondary back" id="cancel">Back to plans</button><h1>' + esc(plan ? 'Edit ' + planName(plan) : 'Edit grace period policy') + '</h1><form id="catalog-form">' + fields + '<label for="confirm">Type ' + esc(scope.environment) + ' to confirm</label><input id="confirm" name="environment" required><div class="actions"><button type="submit">Save changes</button></div></form>';
    document.getElementById("cancel").textContent = plan ? "Back to plans" : "Back to payment settings";
    document.getElementById("cancel").onclick = plan ? showPlans : showPayments;
    bindForm("catalog-form", scope, async f => {
      const updated = structuredClone(catalog);
      if (plan) {
        const edited = [updated.freePlan,...updated.plans].find(p => p.id === planId);
        edited.displayName = String(f.get("name"));
        Object.values(edited.capabilities).forEach((v,i) => { const value = f.get("limit-" + i); v.limit = value === "" ? null : Number(value); });
        if (plan.id !== catalog.freePlan.id) {
          Object.entries(catalog.entitlementPlans).filter(([,id]) => id === plan.id).forEach(([id],index) => { updated.entitlementPlans[id] = String(f.get("bound-" + index)); });
          bindEntitlement(updated,plan.id,f);
          const index = updated.plans.findIndex(p => p.id === plan.id);
          const [moved] = updated.plans.splice(index,1);
          updated.plans.splice(Number(f.get("priority")),0,moved);
        }
      } else {
        updated.honorGracePeriod = f.has("grace");
      }
      await api(scope, "/catalog", {method:"PUT",headers:{"If-Match":etag,"Admin-Environment":f.get("environment")},body:JSON.stringify(updated)});
      const shown = await (plan ? configure(planId) : showPayments());
      if (shown === active) message("Changes saved.");
    });
    message("");
    return scope;
  } catch(e) { report(e, scope); }
}

async function start() {
  const scope = view();
  context = undefined;
  for (const id of ["plans", "payments", "events"]) document.getElementById(id + "-nav").hidden = true;
  try {
    context = (await api(scope, "/context")).data;
    document.getElementById("plans-nav").hidden = false;
    document.getElementById("payments-nav").hidden = false;
    document.getElementById("events-nav").hidden = !context.canInspectEvents;
    await (section === "plans" ? showPlans() : section === "payments" ? showPayments() : section === "events" && context.canInspectEvents ? showEvents() : home());
  } catch(e) { report(e, scope); }
}
if (!environments.length) environments = [{name:"production",url:base}];
selected = environments[0];
selector.innerHTML = environments.map(e => '<option value="' + esc(e.name) + '">' + esc(e.name === 'production' ? 'Production' : 'Sandbox') + '</option>').join('');
selector.onchange = () => { selected = environments.find(e => e.name === selector.value); page = 1; query = ""; start(); };
document.getElementById("customers-nav").onclick = home;
document.getElementById("plans-nav").onclick = showPlans;
document.getElementById("payments-nav").onclick = showPayments;
document.getElementById("events-nav").onclick = () => showEvents();
start();
`;
