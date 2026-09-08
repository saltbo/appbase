const escape = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
export const adminHtml = (base: string, product: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(product)} administration</title><link rel="stylesheet" href="${escape(base)}/admin.css"><script defer src="${escape(base)}/admin.js"></script></head><body data-base="${escape(base)}"><header><div><span class="eyebrow">ADMINISTRATION</span><h1>${escape(product)}</h1></div><nav id="environments" aria-label="Environment"></nav></header><main><div id="identity"></div><p id="status" role="status">Loading administration…</p><section id="content"></section></main></body></html>`;
export const adminStyle = `:root{--ink:#171717;--muted:#475569;--line:#d4d4d4;--paper:#fff;--wash:#f4f5f7;--accent:#174ea6;--danger:#a31515}*{box-sizing:border-box}body{margin:0;background:var(--wash);color:var(--ink);font:16px/1.5 system-ui,sans-serif}header,main{max-width:1120px;margin:auto;padding:24px}header{display:flex;justify-content:space-between;align-items:center;gap:24px}h1{margin:4px 0;font-size:28px}h2{font-size:22px}.eyebrow{font-size:12px;letter-spacing:.14em;color:var(--muted)}nav{display:flex;gap:12px;flex-wrap:wrap}a{color:var(--accent)}button,input,select,textarea{font:inherit;min-height:44px;border:1px solid var(--line);border-radius:6px;padding:8px 12px}button{cursor:pointer;background:var(--ink);color:white}button:disabled{opacity:.55;cursor:wait}button.secondary{background:var(--paper);color:var(--ink)}:focus-visible{outline:3px solid var(--accent);outline-offset:3px}section,.card{background:var(--paper);border:1px solid var(--line);border-radius:10px;padding:24px}.card{margin:16px 0}.actions{display:flex;flex-wrap:wrap;gap:12px;margin:20px 0}label{display:block;margin:16px 0 4px}input,select,textarea{width:100%;max-width:700px}textarea{min-height:110px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px}table{width:100%;border-collapse:collapse;text-align:left}th,td{padding:12px 8px;border-bottom:1px solid var(--line);overflow-wrap:anywhere}code{overflow-wrap:anywhere}.table{overflow-x:auto}.warning{border-left:4px solid var(--danger);padding:12px;background:#fff5f5}#status{color:var(--muted)}#status[data-error=true]{color:var(--danger)}.badge{display:inline-block;padding:6px 12px;background:var(--ink);color:white;border-radius:5px;font-weight:650}small{color:var(--muted)}@media(max-width:600px){header{align-items:flex-start;flex-direction:column}header,main,section,.card{padding:16px}th,td{padding:8px 4px}}`;

// No user data enters executable source. Dynamic values go through textContent or escape().
export const adminScript = String.raw`
const base = document.body.dataset.base;
const content = document.querySelector('#content');
const status = document.querySelector('#status');
let context, user, catalog, etag;
const esc = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
function message(text, error=false) { status.textContent=text; status.dataset.error=String(error); }
async function api(path, options={}) {
 const response = await fetch(base+path,{...options,headers:{'Content-Type':'application/json',...options.headers}});
 const data = await response.json();
 if(!response.ok) throw new Error(response.status===401?'Your session has expired. Sign in again.':response.status===403?'You do not have permission for this operation.':data.detail || 'The request failed.');
 return {data,response};
}
function bindForm(id, handler) {
 document.getElementById(id).addEventListener('submit', async event => {
  event.preventDefault();const button=event.target.querySelector('button[type=submit]');button.disabled=true;message('Working…');
  try{await handler(new FormData(event.target));}catch(error){message(error.message,true);status.tabIndex=-1;status.focus();}finally{button.disabled=false;}
 });
}
const pretty = value => '<pre>'+esc(JSON.stringify(value,null,2))+'</pre>';
const planName = plan => plan.displayName || plan.name || plan.id;
function membership(m) { return '<h3>'+esc(planName([catalog.freePlan,...catalog.plans].find(p=>p.id===m.planId)||{id:m.planId}))+'</h3><p>Valid until: '+esc(m.grantEndsAt || 'No fixed expiry')+'</p><div class="table"><table><thead><tr><th>Capability</th><th>Used</th><th>Limit</th><th>Period</th></tr></thead><tbody>'+Object.entries(m.capabilities).map(([key,v])=>'<tr><td>'+esc(key)+'</td><td>'+esc(v.used)+'</td><td>'+esc(v.limit===null?'Unlimited':v.limit)+'</td><td>'+esc(v.period)+'</td></tr>').join('')+'</tbody></table></div>'; }
async function loadCatalog(){const result=await api('/catalog');catalog=result.data;etag=result.response.headers.get('etag');}
function home() {
 content.innerHTML='<h2>Find a user</h2><p>Look up an exact login subject or payment identity.</p><form id="search"><label for="query">Subject or payment identity</label><input id="query" name="query" required maxlength="200" autocomplete="off"><div class="actions"><button type="submit">Find user</button>'+(context.canConfigure?'<button type="button" class="secondary" id="plans">Manage plans and quotas</button>':'')+'</div></form>';
 bindForm('search',async f=>{await showUser(f.get('query'));});
 document.getElementById('plans')?.addEventListener('click',configure);
}
async function showUser(query) {
 await loadCatalog();user=(await api('/users?query='+encodeURIComponent(query))).data;
 const grants=(await api('/manual-grants?ownerSub='+encodeURIComponent(user.ownerSub))).data;
 content.innerHTML='<button class="secondary" id="back">Back to search</button><h2>User membership</h2><p>Subject: <code>'+esc(user.ownerSub)+'</code></p>'+(user.appUserId?'<p>Payment identity: <code>'+esc(user.appUserId)+'</code></p>':'')+'<p>Effective source: '+(user.manualGrant?'Manual override':'Subscription / existing membership / default')+'</p>'+membership(user.membership)+'<h3>Subscription state</h3>'+pretty(user.subscription)+'<div class="actions">'+(context.canGrant?'<button id="grant">Grant membership</button>':'')+'<button class="secondary" id="refresh">Refresh</button></div><h2>Manual grant history</h2><div id="history"></div>';
 document.getElementById('back').onclick=home;
 document.getElementById('grant')?.addEventListener('click',grantForm);
 document.getElementById('refresh').onclick=()=>showUser(user.ownerSub).catch(e=>message(e.message,true));
 renderGrants(grants);
 message('Membership loaded in '+context.environment+'.');
}
function renderGrants(page,append=false) {
 const target=document.getElementById('history');if(!append)target.innerHTML='';document.getElementById('more')?.remove();
 if(!page.items.length&&!append)target.innerHTML='<p>No manual grants.</p>';
 for(const grant of page.items){const card=document.createElement('article');card.className='card';card.innerHTML='<h3>'+esc(grant.planId)+'</h3><p>'+esc(grant.startsAt)+' — '+esc(grant.endsAt)+'</p><p>Reason: '+esc(grant.reason)+'</p><small>Created by '+esc(grant.createdBy)+' at '+esc(grant.createdAt)+'</small>'+(grant.revocation?'<p>Revoked by '+esc(grant.revocation.createdBy)+' at '+esc(grant.revocation.createdAt)+': '+esc(grant.revocation.reason)+'</p>':'<p>Not revoked</p>');
 if(context.canGrant&&!grant.revocation){const b=document.createElement('button');b.textContent='Revoke grant';b.className='secondary';b.onclick=()=>revokeForm(grant);card.append(b);}target.append(card);}
 if(page.next){const b=document.createElement('button');b.id='more';b.textContent='Load older grants';b.onclick=async()=>{try{renderGrants((await api('/manual-grants?ownerSub='+encodeURIComponent(user.ownerSub)+'&before='+encodeURIComponent(page.next))).data,true);}catch(e){message(e.message,true);}};target.append(b);}
}
function grantForm(){
 const id=crypto.randomUUID();
 content.innerHTML='<button class="secondary" id="cancel">Back to membership</button><h2>Grant membership</h2><p>Target: <code>'+esc(user.ownerSub)+'</code> · <strong>'+esc(context.environment)+'</strong></p><div class="warning">This overrides all active subscription benefits, even when the selected plan has lower limits. Expiry or revocation restores underlying membership. It does not cancel a subscription.</div><h3>Current effective membership</h3>'+membership(user.membership)+'<form id="grant-form"><label for="plan">Override plan</label><select id="plan" name="planId">'+[catalog.freePlan,...catalog.plans].map(p=>'<option value="'+esc(p.id)+'">'+esc(planName(p))+'</option>').join('')+'</select><div id="proposed"></div><label for="ends">Expires at (UTC)</label><input id="ends" name="endsAt" type="datetime-local" required><label for="reason">Reason</label><textarea id="reason" name="reason" required maxlength="2000"></textarea><label for="confirm">Type '+esc(context.environment)+' to confirm the override</label><input id="confirm" name="environment" required autocomplete="off"><div class="actions"><button type="submit">Confirm manual grant</button></div></form>';
 const plan=document.getElementById('plan');const preview=()=>{const p=[catalog.freePlan,...catalog.plans].find(p=>p.id===plan.value);document.getElementById('proposed').innerHTML='<h3>Resulting plan limits</h3>'+pretty(p.capabilities);};plan.onchange=preview;preview();
 document.getElementById('cancel').onclick=()=>showUser(user.ownerSub).catch(e=>message(e.message,true));
 bindForm('grant-form',async f=>{await api('/manual-grants',{method:'POST',body:JSON.stringify({id,ownerSub:user.ownerSub,planId:f.get('planId'),endsAt:new Date(f.get('endsAt')+'Z').toISOString(),reason:f.get('reason'),environment:f.get('environment'),expectedMembership:user.membership,expectedCatalogRevision:Number(etag.slice(1,-1))})});await showUser(user.ownerSub);message('Manual grant created. Effective membership refreshed.');});
}
function revokeForm(grant){
 content.innerHTML='<button class="secondary" id="cancel">Back to membership</button><h2>Revoke manual grant</h2><p>Target: <code>'+esc(user.ownerSub)+'</code> · <strong>'+esc(context.environment)+'</strong></p><p>Grant: '+esc(grant.planId)+' · '+esc(grant.id)+'</p><p>Revocation is permanent. The next active manual grant, then underlying subscription or default membership, takes effect. Payment transactions are unchanged.</p><form id="revoke-form"><label for="reason">Revocation reason</label><textarea name="reason" id="reason" required maxlength="2000"></textarea><label for="confirm">Type '+esc(context.environment)+' to confirm</label><input name="environment" id="confirm" required autocomplete="off"><div class="actions"><button type="submit">Confirm revocation</button></div></form>';
 document.getElementById('cancel').onclick=()=>showUser(user.ownerSub).catch(e=>message(e.message,true));
 bindForm('revoke-form',async f=>{await api('/manual-grants/'+grant.id+'/revocation',{method:'PUT',body:JSON.stringify({reason:f.get('reason'),environment:f.get('environment')})});await showUser(user.ownerSub);message('Grant revoked. Effective membership refreshed.');});
}
async function configure(){try{await loadCatalog();content.innerHTML='<button class="secondary" id="cancel">Back to search</button><h2>Plans and quotas</h2><p>Existing plan identities and accounting periods are preserved. Prices remain store-owned.</p><form id="catalog-form"><label for="catalog">Catalog configuration</label><textarea id="catalog" name="catalog" rows="22" spellcheck="false">'+esc(JSON.stringify(catalog,null,2))+'</textarea><label for="confirm">Type '+esc(context.environment)+' to confirm</label><input id="confirm" name="environment" required><div class="actions"><button type="submit">Save catalog</button></div></form>';document.getElementById('cancel').onclick=home;bindForm('catalog-form',async f=>{await api('/catalog',{method:'PUT',headers:{'If-Match':etag,'Admin-Environment':f.get('environment')},body:JSON.stringify(JSON.parse(f.get('catalog')))});await configure();message('Catalog saved.');});}catch(e){message(e.message,true);}}
async function start(){try{context=(await api('/context')).data;document.getElementById('identity').innerHTML='<span class="badge">'+esc(context.environment)+'</span><p>Signed in as '+esc(context.operator)+'</p>';document.getElementById('environments').innerHTML=context.environments.map(e=>'<a href="'+esc(e.url)+'">'+esc(e.name)+'</a>').join('')+'<a href="'+esc(base)+'/session/logout">Sign out</a>';home();message('Select a user to inspect membership.');}catch(e){message(e.message,true);content.innerHTML='<h2>Administration access required</h2><p>Use your authorized operator account.</p><a href="'+esc(base)+'/session/login">Sign in with OIDC</a>';}}
start();
`;
