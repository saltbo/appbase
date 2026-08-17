// coverage:ignore-file

import 'dart:convert';

import 'package:appbase_client/appbase_client.dart';
import 'package:crypto/crypto.dart';
import 'package:oidc/oidc.dart';
import 'package:oidc_default_store/oidc_default_store.dart';

import 'installation_id.dart';

typedef AppBaseRedirectUri = Uri Function();
typedef AppBaseOidcManagerFactory =
    OidcUserManager Function(AppBaseClientConfiguration configuration);

final class AppBaseOidcPolicy {
  AppBaseOidcPolicy({
    required this.namespace,
    required this.redirectUri,
    required this.postLogoutRedirectUri,
    this.scopes = const [
      'openid',
      'profile',
      'email',
      'offline_access',
      'appbase:read',
      'appbase:write',
    ],
  });

  final String namespace;
  final AppBaseRedirectUri redirectUri;
  final AppBaseRedirectUri postLogoutRedirectUri;
  final List<String> scopes;

  OidcUserManager createManager(AppBaseClientConfiguration configuration) {
    final provider = sha256
        .convert(utf8.encode(configuration.issuer.toString()))
        .toString()
        .substring(0, 16);
    final resource = configuration.usesResourceIndicator
        ? {'resource': configuration.audience.toString()}
        : const <String, String>{};
    return OidcUserManager.lazy(
      id: '$namespace.oidc.$provider',
      discoveryDocumentUri: OidcUtils.getOpenIdConfigWellKnownUri(
        configuration.issuer,
      ),
      clientCredentials: OidcClientAuthentication.none(
        clientId: configuration.clientId,
      ),
      store: OidcDefaultStore(storagePrefix: '$namespace.oidc.$provider'),
      settings: OidcUserManagerSettings(
        redirectUri: redirectUri(),
        postLogoutRedirectUri: postLogoutRedirectUri(),
        scope: scopes,
        extraAuthenticationParameters: resource,
        extraTokenParameters: resource,
        strictJwtVerification: true,
      ),
    );
  }
}

final class AppBaseOidcSession implements AppBaseSession {
  AppBaseOidcSession({
    required this.loadConfiguration,
    required this.installationId,
    required AppBaseOidcPolicy policy,
    AppBaseOidcManagerFactory? managerFactory,
  }) : _managerFactory = managerFactory ?? policy.createManager;

  final Future<AppBaseClientConfiguration> Function() loadConfiguration;
  final AppBaseInstallationId installationId;
  final AppBaseOidcManagerFactory _managerFactory;
  Future<_Runtime>? _runtimeFuture;

  @override
  Future<AppBaseAccount?> account() async {
    final runtime = await _runtime();
    await runtime.manager.init();
    final user = runtime.manager.currentUser;
    return user == null ? null : _account(runtime.configuration.issuer, user);
  }

  @override
  Future<String?> accessToken() async {
    final runtime = await _runtime();
    await runtime.manager.init();
    final current = runtime.manager.currentUser;
    if (current == null) return null;
    return current.token.accessToken ??
        (await runtime.manager.refreshToken())?.token.accessToken;
  }

  @override
  Future<AppBaseAccount> signIn() async {
    final runtime = await _runtime();
    await runtime.manager.init();
    final user = await runtime.manager.loginAuthorizationCodeFlow();
    if (user == null) {
      throw const AppBaseApiException(
        kind: AppBaseFailureKind.authentication,
        code: 'sign_in_cancelled',
        message: 'OIDC sign-in was cancelled.',
      );
    }
    return _account(runtime.configuration.issuer, user);
  }

  @override
  Future<void> signOut() async {
    final runtime = await _runtime();
    await runtime.manager.init();
    await runtime.manager.forgetUser();
  }

  Future<_Runtime> _runtime() {
    return _runtimeFuture ??= loadConfiguration().then(
      (config) => _Runtime(config, _managerFactory(config)),
    );
  }

  Future<AppBaseAccount> _account(Uri issuer, OidcUser user) async {
    final claims = user.aggregatedClaims;
    final picture = _claim(claims, 'picture');
    return AppBaseAccount(
      issuer: issuer,
      subject: user.uidRequired,
      deviceId: await installationId.get(),
      displayName:
          _claim(claims, 'name') ??
          _claim(claims, 'preferred_username') ??
          _claim(claims, 'email'),
      email: _claim(claims, 'email'),
      avatarUri: picture == null ? null : Uri.tryParse(picture),
    );
  }
}

final class _Runtime {
  const _Runtime(this.configuration, this.manager);
  final AppBaseClientConfiguration configuration;
  final OidcUserManager manager;
}

String? _claim(Map<String, dynamic> claims, String name) {
  final value = claims[name];
  return value is String && value.trim().isNotEmpty ? value.trim() : null;
}
