// Covers: S_ADMIN_SESSION_REFRESH case=happy_path
// Covers: S_ADMIN_SESSION_REFRESH case=error_path
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { Hono } from 'hono';
import { generateKeyPair, exportJWK, SignJWT, jwtVerify } from 'jose';
import { createAdminPage } from '../../dist/admin.js';
const origin = 'https://admin.example.test';
const issuer = 'https://identity.example.test';
const clientId = 'public-admin';
const config = {issuer,clientId,resource:origin,redirectUri:origin+'/admin/callback',scopes:['admin:production:read','admin:sandbox:read']};
const environments = ['production','sandbox'].map(name=>({name,url:origin+(name==='sandbox'?'/sandbox':'')+'/admin/api'}));
const app = new Hono().route('/admin',createAdminPage({url:origin+'/admin',productName:'Example',environments,oidc:config}));
const keys = await generateKeyPair('RS256');
const jwk = {...await exportJWK(keys.publicKey),kid:'test',alg:'RS256',use:'sig'};
let nonce, challenge, refreshes = 0, codeExchanges = 0;
const errors=[];
const token = (aud,extra={})=>new SignJWT(extra).setProtectedHeader({alg:'RS256',kid:'test'}).setIssuer(issuer).setAudience(aud).setSubject('operator').setIssuedAt().setExpirationTime('5m').sign(keys.privateKey);
const browser = await chromium.launch({headless:true,...(process.env.APPBASE_CHROME_PATH?{executablePath:process.env.APPBASE_CHROME_PATH}:{})});
try {
 const context = await browser.newContext();
 await context.route('https://**/*',async route=>{
  const r=route.request(), url=new URL(r.url());
  const cors={'Access-Control-Allow-Origin':origin};
  const json = body=>route.fulfill({status:200,headers:cors,contentType:'application/json',body:JSON.stringify(body)});
  if(url.origin===issuer) {
   if(url.pathname==='/.well-known/openid-configuration') return json({issuer,authorization_endpoint:issuer+'/authorize',token_endpoint:issuer+'/token',jwks_uri:issuer+'/jwks',response_types_supported:['code'],id_token_signing_alg_values_supported:['RS256']});
   if(url.pathname==='/jwks') return json({keys:[jwk]});
   if(url.pathname==='/authorize') {
    nonce=url.searchParams.get('nonce');challenge=url.searchParams.get('code_challenge');
    assert.equal(url.searchParams.get('code_challenge_method'),'S256');
    return route.fulfill({status:302,headers:{Location:config.redirectUri+'?code=one&state='+url.searchParams.get('state')}});
   }
   if(url.pathname==='/token') {
    const body=new URLSearchParams(r.postData());
    assert.equal(body.get('client_id'),clientId);assert.equal(body.has('client_secret'),false);assert.equal(r.headers().authorization,undefined);
    assert.equal(body.get('resource'),origin);
    if(body.get('grant_type')==='refresh_token') {
     refreshes++; assert.equal(body.get('refresh_token'),'refresh-'+refreshes);
     return json({access_token:await token(origin),refresh_token:'refresh-'+(refreshes+1),token_type:'Bearer',expires_in:300});
    }
    codeExchanges++;
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body.get('code_verifier')));
    assert.equal(Buffer.from(digest).toString('base64url'),challenge);
    return json({access_token:await token(origin),id_token:await token(clientId,{nonce}),refresh_token:'refresh-1',token_type:'Bearer',expires_in:45});
   }
   throw new Error('Unexpected issuer path '+url.pathname);
  }
  assert.equal(url.origin,origin);
  if(url.pathname.includes('/api/')) {
   const auth=r.headers().authorization;
   if(!auth) return route.fulfill({status:401,contentType:'application/json',body:'{}'});
   assert.equal((await jwtVerify(auth.replace(/^Bearer /,''),keys.publicKey,{issuer,audience:origin})).payload.sub,'operator');
   if(url.pathname.endsWith('/context')) return json({environment:url.pathname.startsWith('/sandbox')?'sandbox':'production',environments,canConfigure:false,operator:'operator'});
   if(url.pathname.endsWith('/customers')) return json({items:[],pagination:{page:1,pageSize:20,totalItems:0,totalPages:0}});
   throw new Error('Unexpected API path');
  }
  const response=await app.fetch(new Request(r.url(),{headers:r.headers()}));
  return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.clock.install();
 await page.goto(origin+'/admin');
 await page.getByRole('link',{name:'Sign in with OIDC'}).click();
 await page.getByRole('heading',{name:'Customers',exact:true}).waitFor();
 assert.equal(page.url(),origin+'/admin'); assert.equal(codeExchanges,1);
 assert.equal((await context.cookies()).length,0);
 await page.clock.fastForward(20_000);
 await page.getByLabel('Environment',{exact:true}).selectOption('sandbox');
 await page.getByRole('heading',{name:'Customers',exact:true}).waitFor();
 assert.equal(refreshes,1);assert.equal(page.url(),origin+'/admin');
 // An expired shared token must be redeemed once even when two tabs request it.
 await page.evaluate(()=>{const key=Object.keys(localStorage).find(k=>k.startsWith('appbase.admin:'));const value=JSON.parse(localStorage.getItem(key));value.expiresAt=0;localStorage.setItem(key,JSON.stringify(value));});
 const second=await context.newPage();second.on('pageerror',e=>errors.push(e.message));
 await Promise.all([page.getByLabel('Environment',{exact:true}).selectOption('production'),second.goto(origin+'/admin')]);
 await second.getByRole('heading',{name:'Customers',exact:true}).waitFor();
 await page.getByRole('heading',{name:'Customers',exact:true}).waitFor();
 assert.equal(refreshes,2);
 await page.getByRole('link',{name:'Sign out'}).click();
 await page.getByRole('link',{name:'Sign in with OIDC'}).waitFor();
 assert.equal(await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('appbase.admin:')).length),0);
 assert.deepEqual(errors,[]);
 console.log('PASS: browser PKCE, signed callback, bearer API, refresh, environment switch and cookieless logout');
} finally {await browser.close();}
