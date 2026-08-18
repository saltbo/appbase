# appbase_flutter

Flutter controller, secure installation identity, and configurable OIDC/PKCE
session adapter for AppBase. Product redirect URIs, namespace, and extra scopes
remain application-owned.

`AppBaseOidcGrant` lets one public client request multiple RFC 8707 Resource
Indicators in a single Authorization Code + PKCE flow. Create one resource
session per protected API; the shared grant serializes refresh rotation and
returns an audience-restricted access token from each session.
