import 'dart:convert';

import 'package:appbase_client/appbase_client.dart';
import 'package:appbase_flutter/appbase_flutter.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:oidc/oidc.dart';

void main() {
  final primary = Uri.parse('https://app.example.com/appbase');
  final vocnet = Uri.parse('https://api.vocnet.app/rpc');
  final files = Uri.parse('https://files.example.com');
  final configuration = AppBaseClientConfiguration(
    protocolVersions: const [appBaseProtocolVersion],
    issuer: Uri.parse('https://id.example.com/api/auth'),
    clientId: 'client-1',
    audience: primary,
    usesResourceIndicator: true,
    acceptsDynamicCollections: true,
    encryptsAllPayloads: true,
    maxMutationsPerBatch: 1,
    maxChangesPerPage: 1,
    maxPayloadBytes: 1,
  );

  test('encodes repeated authorization resources and one token resource', () {
    final manager =
        AppBaseOidcPolicy(
          namespace: 'test',
          redirectUri: () => Uri.parse('com.example:/oauth/callback'),
          postLogoutRedirectUri: () =>
              Uri.parse('com.example:/oauth/signed-out'),
        ).createMultiResourceManager(
          configuration,
          resources: [primary, vocnet],
          tokenResource: primary,
        );

    expect(manager.settings.extraAuthenticationParameters, {
      'resource': [primary.toString(), vocnet.toString()],
    });
    expect(manager.settings.extraTokenParameters, {
      'resource': primary.toString(),
    });
    expect(manager.settings.refreshBefore, isNull);
  });

  test('keeps automatic refresh for a legacy single-resource session', () {
    final manager = AppBaseOidcPolicy(
      namespace: 'test',
      redirectUri: () => Uri.parse('com.example:/oauth/callback'),
      postLogoutRedirectUri: () => Uri.parse('com.example:/oauth/signed-out'),
    ).createManager(configuration);

    expect(manager.settings.refreshBefore, isNotNull);
  });

  test('shares one sign-in and serializes audience-specific refresh', () async {
    final manager = _FakeOidcManager(primary);
    final grant = AppBaseOidcGrant(
      configuration: configuration,
      installationId: AppBaseInstallationId(
        namespace: 'test',
        storage: _MemorySecureStorage(),
      ),
      resources: [primary, vocnet, files],
      tokenResource: primary,
      policy: AppBaseOidcPolicy(
        namespace: 'test',
        redirectUri: () => Uri.parse('com.example:/oauth/callback'),
        postLogoutRedirectUri: () => Uri.parse('com.example:/oauth/signed-out'),
      ),
      managerFactory: (_, _, _) => manager,
    );
    final primarySession = grant.session(primary);
    final vocnetSession = grant.session(vocnet);
    final filesSession = grant.session(files);

    final first = await primarySession.signIn();
    final second = await vocnetSession.signIn();
    expect(first.subject, 'learner-1');
    expect(second.subject, first.subject);
    expect(manager.loginCalls, 1);
    expect(await primarySession.accessToken(), _accessToken(primary));

    final tokens = await Future.wait([
      vocnetSession.accessToken(),
      filesSession.accessToken(),
    ]);
    expect(tokens, [_accessToken(vocnet), _accessToken(files)]);
    expect(manager.refreshResources, [vocnet, files]);
    expect(manager.maxConcurrentRefreshes, 1);

    await vocnetSession.signOut();
    await primarySession.signOut();
    expect(manager.forgetCalls, 1);
  });

  test('rejects a session outside the original resource grant', () {
    final grant = AppBaseOidcGrant(
      configuration: configuration,
      installationId: AppBaseInstallationId(
        namespace: 'test',
        storage: _MemorySecureStorage(),
      ),
      resources: [primary, vocnet],
      tokenResource: primary,
      policy: AppBaseOidcPolicy(
        namespace: 'test',
        redirectUri: () => Uri.parse('com.example:/oauth/callback'),
        postLogoutRedirectUri: () => Uri.parse('com.example:/oauth/signed-out'),
      ),
    );

    expect(
      () => grant.session(Uri.parse('https://outside.example.com')),
      throwsArgumentError,
    );
  });

  test('rejects a manager with automatic refresh enabled', () async {
    final manager = _FakeOidcManager(primary, automaticRefresh: true);
    final grant = AppBaseOidcGrant(
      configuration: configuration,
      installationId: AppBaseInstallationId(
        namespace: 'test',
        storage: _MemorySecureStorage(),
      ),
      resources: [primary, vocnet],
      tokenResource: primary,
      policy: AppBaseOidcPolicy(
        namespace: 'test',
        redirectUri: () => Uri.parse('com.example:/oauth/callback'),
        postLogoutRedirectUri: () => Uri.parse('com.example:/oauth/signed-out'),
      ),
      managerFactory: (_, _, _) => manager,
    );

    await expectLater(grant.account(), throwsStateError);
  });
}

final class _FakeOidcManager extends OidcUserManager {
  _FakeOidcManager(this.primary, {bool automaticRefresh = false})
    : super.lazy(
        id: 'fake',
        discoveryDocumentUri: Uri.parse(
          'https://id.example.com/api/auth/.well-known/openid-configuration',
        ),
        clientCredentials: OidcClientAuthentication.none(clientId: 'client-1'),
        store: OidcMemoryStore(),
        settings: OidcUserManagerSettings(
          redirectUri: Uri.parse('com.example:/oauth/callback'),
          refreshBefore: automaticRefresh ? defaultRefreshBefore : null,
        ),
      );

  final Uri primary;
  OidcUser? _current;
  int loginCalls = 0;
  int forgetCalls = 0;
  int _concurrentRefreshes = 0;
  int maxConcurrentRefreshes = 0;
  final List<Uri> refreshResources = [];

  @override
  OidcUser? get currentUser => _current;

  @override
  Future<void> init() async {}

  @override
  Future<OidcUser?> loginAuthorizationCodeFlow({
    OidcProviderMetadata? discoveryDocumentOverride,
    Uri? redirectUriOverride,
    Uri? originalUri,
    List<String>? scopeOverride,
    List<String>? promptOverride,
    List<String>? uiLocalesOverride,
    String? displayOverride,
    List<String>? acrValuesOverride,
    dynamic extraStateData,
    bool includeIdTokenHintFromCurrentUser = true,
    String? idTokenHintOverride,
    String? loginHint,
    Duration? maxAgeOverride,
    Map<String, dynamic>? extraParameters,
    Map<String, dynamic>? extraTokenParameters,
    Map<String, String>? extraTokenHeaders,
    OidcPlatformSpecificOptions? options,
  }) async {
    loginCalls++;
    return _current = await _user(primary, 'refresh-1');
  }

  @override
  Future<OidcUser?> refreshToken({
    String? overrideRefreshToken,
    OidcProviderMetadata? discoveryDocumentOverride,
    Map<String, dynamic>? extraBodyFields,
  }) async {
    final resource = Uri.parse(extraBodyFields!['resource'] as String);
    refreshResources.add(resource);
    _concurrentRefreshes++;
    if (_concurrentRefreshes > maxConcurrentRefreshes) {
      maxConcurrentRefreshes = _concurrentRefreshes;
    }
    await Future<void>.delayed(const Duration(milliseconds: 5));
    _concurrentRefreshes--;
    return _current = await _user(
      resource,
      'refresh-${refreshResources.length + 1}',
    );
  }

  @override
  Future<void> forgetUser() async {
    if (_current == null) return;
    forgetCalls++;
    _current = null;
  }
}

final class _MemorySecureStorage extends FlutterSecureStorage {
  final Map<String, String> values = {};

  @override
  Future<String?> read({
    required String key,
    AppleOptions? iOptions,
    AndroidOptions? aOptions,
    LinuxOptions? lOptions,
    WebOptions? webOptions,
    AppleOptions? mOptions,
    WindowsOptions? wOptions,
  }) async => values[key];

  @override
  Future<void> write({
    required String key,
    required String? value,
    AppleOptions? iOptions,
    AndroidOptions? aOptions,
    LinuxOptions? lOptions,
    WebOptions? webOptions,
    AppleOptions? mOptions,
    WindowsOptions? wOptions,
  }) async {
    if (value == null) {
      values.remove(key);
    } else {
      values[key] = value;
    }
  }
}

Future<OidcUser> _user(Uri resource, String refreshToken) {
  return OidcUser.fromIdToken(
    token: OidcToken(
      creationTime: DateTime.now().toUtc(),
      expiresIn: const Duration(hours: 1),
      accessToken: _accessToken(resource),
      refreshToken: refreshToken,
      idToken: _jwt({'sub': 'learner-1', 'name': 'Learner'}),
    ),
  );
}

String _accessToken(Uri resource) => _jwt({'aud': resource.toString()});

String _jwt(Map<String, Object?> payload) {
  String encode(Object value) =>
      base64Url.encode(utf8.encode(jsonEncode(value))).replaceAll('=', '');
  return '${encode({'alg': 'none'})}.${encode(payload)}.';
}
