// coverage:ignore-file

import 'dart:async';
import 'dart:convert';

import 'package:appbase_client/appbase_client.dart';
import 'package:crypto/crypto.dart';
import 'package:oidc/oidc.dart';
import 'package:oidc_default_store/oidc_default_store.dart';

import 'installation_id.dart';
import 'oidc_manager.dart';

typedef AppBaseRedirectUri = Uri Function();
typedef AppBaseOidcManagerFactory =
    OidcUserManager Function(AppBaseClientConfiguration configuration);
typedef AppBaseMultiResourceOidcManagerFactory =
    OidcUserManager Function(
      AppBaseClientConfiguration configuration,
      List<Uri> resources,
      Uri tokenResource,
    );

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
    return _createManager(
      configuration,
      resources: [configuration.audience],
      tokenResource: configuration.audience,
      automaticRefresh: true,
    );
  }

  OidcUserManager createMultiResourceManager(
    AppBaseClientConfiguration configuration, {
    required List<Uri> resources,
    required Uri tokenResource,
  }) {
    if (!configuration.usesResourceIndicator && resources.length > 1) {
      throw ArgumentError.value(
        resources,
        'resources',
        'multiple resources require RFC 8707 resource indicators',
      );
    }
    return _createManager(
      configuration,
      resources: resources,
      tokenResource: tokenResource,
      automaticRefresh: false,
    );
  }

  OidcUserManager _createManager(
    AppBaseClientConfiguration configuration, {
    required List<Uri> resources,
    required Uri tokenResource,
    required bool automaticRefresh,
  }) {
    final provider = sha256
        .convert(utf8.encode(configuration.issuer.toString()))
        .toString()
        .substring(0, 16);
    final authorizationResources = configuration.usesResourceIndicator
        ? {
            'resource': resources
                .map((resource) => resource.toString())
                .toList(),
          }
        : const <String, String>{};
    final tokenParameters = configuration.usesResourceIndicator
        ? {'resource': tokenResource.toString()}
        : const <String, String>{};
    return AppBaseOidcManager(
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
        extraAuthenticationParameters: authorizationResources,
        extraTokenParameters: tokenParameters,
        // A multi-resource grant rotates one refresh token across audiences.
        // AppBase serializes those exchanges and therefore owns refresh timing.
        refreshBefore: automaticRefresh ? defaultRefreshBefore : null,
      ),
    );
  }
}

/// One OAuth authorization grant shared by multiple protected resources.
///
/// Each resource session receives its own audience-restricted access token,
/// while the underlying OIDC manager owns the single rotating refresh token.
final class AppBaseOidcGrant {
  AppBaseOidcGrant({
    required this.configuration,
    required this.installationId,
    required List<Uri> resources,
    required this.tokenResource,
    required AppBaseOidcPolicy policy,
    AppBaseMultiResourceOidcManagerFactory? managerFactory,
  }) : resources = List.unmodifiable(_normalizeResources(resources)),
       _managerFactory =
           managerFactory ??
           ((configuration, resources, tokenResource) =>
               policy.createMultiResourceManager(
                 configuration,
                 resources: resources,
                 tokenResource: tokenResource,
               )) {
    if (!this.resources.contains(tokenResource)) {
      throw ArgumentError.value(
        tokenResource,
        'tokenResource',
        'must be included in resources',
      );
    }
  }

  final AppBaseClientConfiguration configuration;
  final AppBaseInstallationId installationId;
  final List<Uri> resources;
  final Uri tokenResource;
  final AppBaseMultiResourceOidcManagerFactory _managerFactory;
  final Map<Uri, OidcToken> _tokens = {};
  Future<void> _refreshTail = Future.value();
  OidcUserManager? _manager;

  AppBaseSession session(Uri resource) {
    if (!resources.contains(resource)) {
      throw ArgumentError.value(
        resource,
        'resource',
        'is not part of this authorization grant',
      );
    }
    return _AppBaseOidcResourceSession(grant: this, resource: resource);
  }

  Future<AppBaseAccount?> account() async {
    final manager = await _initializedManager();
    final user = manager.currentUser;
    return user == null ? null : _account(configuration.issuer, user);
  }

  Future<AppBaseAccount> signIn() async {
    final manager = await _initializedManager();
    final existing = manager.currentUser;
    if (existing != null) return _account(configuration.issuer, existing);
    final user = await manager.loginAuthorizationCodeFlow();
    if (user == null) {
      throw const AppBaseApiException(
        kind: AppBaseFailureKind.authentication,
        code: 'sign_in_cancelled',
        message: 'OIDC sign-in was cancelled.',
      );
    }
    _tokens[tokenResource] = user.token;
    return _account(configuration.issuer, user);
  }

  Future<String?> accessToken(Uri resource) async {
    final manager = await _initializedManager();
    if (manager.currentUser == null) return null;
    final cached = _tokens[resource];
    if (_isUsable(cached)) return cached!.accessToken;
    return _serializedRefresh(resource);
  }

  Future<void> signOut() async {
    final manager = await _initializedManager();
    _tokens.clear();
    if (manager.currentUser != null) await manager.forgetUser();
  }

  Future<OidcUserManager> _initializedManager() async {
    if (_manager?.isDisposed == true) _manager = null;
    final manager = _manager ??= _managerFactory(
      configuration,
      resources,
      tokenResource,
    );
    if (manager.settings.refreshBefore != null) {
      throw StateError(
        'A multi-resource OIDC manager must disable automatic token refresh.',
      );
    }
    try {
      await manager.init();
    } catch (_) {
      if (identical(_manager, manager)) _manager = null;
      await manager.dispose();
      rethrow;
    }
    final current = manager.currentUser;
    if (current != null) _rememberTokenAudience(current.token);
    return manager;
  }

  Future<String?> _serializedRefresh(Uri resource) {
    final previous = _refreshTail;
    final complete = Completer<void>();
    _refreshTail = complete.future;
    return (() async {
      await previous;
      try {
        final cached = _tokens[resource];
        if (_isUsable(cached)) return cached!.accessToken;
        final manager = await _initializedManager();
        final user = await manager.refreshToken(
          extraBodyFields: {'resource': resource.toString()},
        );
        if (user == null) return null;
        _tokens[resource] = user.token;
        return user.token.accessToken;
      } finally {
        complete.complete();
      }
    })();
  }

  void _rememberTokenAudience(OidcToken token) {
    final accessToken = token.accessToken;
    if (accessToken == null) return;
    for (final audience in _jwtAudiences(accessToken)) {
      final resource = Uri.tryParse(audience);
      if (resource != null && resources.contains(resource)) {
        _tokens[resource] = token;
      }
    }
  }

  bool _isUsable(OidcToken? token) {
    return token?.accessToken != null &&
        !token!.isAccessTokenAboutToExpire(
          tolerance: const Duration(minutes: 1),
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

final class _AppBaseOidcResourceSession implements AppBaseSession {
  const _AppBaseOidcResourceSession({
    required this.grant,
    required this.resource,
  });

  final AppBaseOidcGrant grant;
  final Uri resource;

  @override
  Future<String?> accessToken() => grant.accessToken(resource);

  @override
  Future<AppBaseAccount?> account() => grant.account();

  @override
  Future<AppBaseAccount> signIn() => grant.signIn();

  @override
  Future<void> signOut() => grant.signOut();
}

final class AppBaseOidcSession implements AppBaseSession, AppBaseSessionEvents {
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
  _Runtime? _readyRuntime;
  bool _disposed = false;
  final _invalidations = StreamController<void>.broadcast(sync: true);
  StreamSubscription<OidcUser?>? _userSubscription;
  bool _hadUser = false;

  @override
  Stream<void> get invalidations => _invalidations.stream;

  Future<void> dispose() async {
    _disposed = true;
    await _userSubscription?.cancel();
    try {
      final runtime = await _runtimeFuture;
      await runtime?.manager.dispose();
    } on Object {
      // Failed initialization already disposes its manager.
    } finally {
      await _invalidations.close();
    }
  }

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
    return runtime.manager.getAccessToken();
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
    if (_disposed) return Future.error(StateError('Session is disposed'));
    if (_readyRuntime?.manager.isDisposed == true) {
      _readyRuntime = null;
      _runtimeFuture = null;
    }
    return _runtimeFuture ??= _initializeRuntime().onError((
      Object error,
      StackTrace stack,
    ) {
      // A denied first request must not poison every retry for this process.
      _runtimeFuture = null;
      Error.throwWithStackTrace(error, stack);
    });
  }

  Future<_Runtime> _initializeRuntime() async {
    await _userSubscription?.cancel();
    final config = await loadConfiguration();
    if (_disposed) throw StateError('Session is disposed');
    final manager = _managerFactory(config);
    try {
      await manager.init();
      if (_disposed) throw StateError('Session is disposed');
    } catch (_) {
      await manager.dispose();
      rethrow;
    }
    _hadUser = manager.currentUser != null;
    _userSubscription = manager.userChanges().listen((user) {
      if (user == null && _hadUser) _invalidations.add(null);
      _hadUser = user != null;
    });
    return _readyRuntime = _Runtime(config, manager);
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

List<Uri> _normalizeResources(List<Uri> resources) {
  if (resources.isEmpty) {
    throw ArgumentError.value(resources, 'resources', 'must not be empty');
  }
  return {...resources}.toList(growable: false);
}

List<String> _jwtAudiences(String token) {
  final segments = token.split('.');
  if (segments.length != 3) return const [];
  try {
    final payload = jsonDecode(
      utf8.decode(base64Url.decode(base64Url.normalize(segments[1]))),
    );
    if (payload is! Map<String, dynamic>) return const [];
    final audience = payload['aud'];
    if (audience is String) return [audience];
    if (audience is List) return audience.whereType<String>().toList();
  } on FormatException {
    return const [];
  }
  return const [];
}
