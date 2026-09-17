import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:appbase_client/appbase_client.dart';
import 'package:appbase_flutter/appbase_flutter.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:oidc/oidc.dart';

// Covers: S_ACCOUNT_SESSION_REFRESH case=happy_path
// Covers: S_ACCOUNT_SESSION_REFRESH case=error_path
// Covers: S_ACCOUNT_SESSION_INVALIDATION case=error_path
void main() {
  late _Fixture fixture;
  late OidcPlatform originalPlatform;
  late _LogoutPlatform platform;
  setUp(() {
    originalPlatform = OidcPlatform.instance;
    platform = _LogoutPlatform();
    OidcPlatform.instance = platform;
  });
  tearDown(() => OidcPlatform.instance = originalPlatform);
  setUp(() async => fixture = await _Fixture.create());
  tearDown(() => fixture.close());

  // Covers: S_CLOUD_SYNC_PROVIDER_LOGOUT case=happy_path
  test(
    'provider logout sends session hint and callback before clearing user',
    () async {
      await fixture.seed(const Duration(hours: 1));
      final idToken = fixture.manager.currentUser!.idToken;
      await fixture.session.endProviderSession();
      expect(platform.logoutUri!.path, '/logout');
      expect(platform.logoutUri!.queryParameters['id_token_hint'], idToken);
      expect(platform.logoutUri!.queryParameters['client_id'], 'test-client');
      expect(
        platform.logoutUri!.queryParameters['post_logout_redirect_uri'],
        'test:/logout',
      );
      expect(platform.logoutUri!.queryParameters['state'], isNotEmpty);
      expect(await fixture.session.account(), isNull);
      expect(await fixture.session.accessToken(), isNull);
      await fixture.session.endProviderSession();
      expect(platform.calls, 1);
      await expectLater(
        fixture.session.signIn(),
        throwsA(isA<AppBaseApiException>()),
      );
      expect(platform.authorizationUri!.queryParameters['prompt'], 'login');
    },
  );

  // Covers: S_CLOUD_SYNC_PROVIDER_LOGOUT case=error_path
  for (final mode in ['cancel', 'bad-state', 'missing-state', 'network']) {
    test('provider logout does not hide $mode failure', () async {
      await fixture.seed(const Duration(hours: 1));
      platform.mode = mode;
      await expectLater(
        fixture.session.endProviderSession(),
        throwsA(isA<Exception>()),
      );
      expect(await fixture.session.account(), isNotNull);
    });
  }

  // Covers: S_CLOUD_SYNC_PROVIDER_LOGOUT case=error_path
  test(
    'missing provider logout endpoint fails without clearing credentials',
    () async {
      await fixture.close();
      fixture = await _Fixture.create(supportsLogout: false);
      await fixture.seed(const Duration(hours: 1));
      await expectLater(
        fixture.session.endProviderSession(),
        throwsA(
          isA<AppBaseApiException>().having(
            (error) => error.code,
            'code',
            'provider_logout_unavailable',
          ),
        ),
      );
      expect(platform.calls, 0);
      expect(await fixture.session.account(), isNotNull);
    },
  );

  test('background logout calls HTTP without invoking the browser', () async {
    await fixture.close();
    fixture = await _Fixture.create(providerLogoutInBackground: true);
    await fixture.seed(const Duration(hours: 1));
    final idToken = fixture.manager.currentUser!.idToken;
    await fixture.session.endProviderSession();
    expect(platform.calls, 0);
    expect(fixture.logoutRequests, hasLength(1));
    expect(fixture.logoutRequests.single, {
      'id_token_hint': idToken,
      'client_id': 'test-client',
    });
    expect(await fixture.session.account(), isNull);
    expect(await fixture.session.accessToken(), isNull);
  });

  for (final status in [302, 401, 503]) {
    test(
      'background logout rejects HTTP $status without clearing user',
      () async {
        await fixture.close();
        fixture = await _Fixture.create(providerLogoutInBackground: true);
        fixture.logoutStatus = status;
        await fixture.seed(const Duration(hours: 1));
        await expectLater(
          fixture.session.endProviderSession(),
          throwsA(
            isA<AppBaseApiException>().having(
              (error) => error.statusCode,
              'status',
              status,
            ),
          ),
        );
        expect(platform.calls, 0);
        expect(fixture.redirectRequests, 0);
        expect(await fixture.session.account(), isNotNull);
      },
    );
  }

  test('valid token is reused without a refresh request', () async {
    await fixture.seed(const Duration(hours: 1));
    expect(await fixture.session.accessToken(), 'old-token');
    expect(fixture.exchanges, 0);
  });

  test('real expiry timer survives a failed proactive refresh', () async {
    await fixture.close();
    fixture = await _Fixture.create(enableTimers: true);
    fixture.error = 'temporarily_unavailable';
    await fixture.seed(const Duration(seconds: 1));
    await fixture.failureServed.future;
    fixture.error = null;
    await fixture.refreshed.future.timeout(const Duration(seconds: 5));
    expect(fixture.exchanges, 2);
    expect(await fixture.session.accessToken(), 'fresh-token');
  });

  test('expired access tokens refresh once for concurrent requests', () async {
    await fixture.seed(const Duration(seconds: -10));
    final tokens = await Future.wait(
      List.generate(5, (_) => fixture.session.accessToken()),
    );
    expect(tokens, everyElement('fresh-token'));
    expect(fixture.exchanges, 1);
    expect(fixture.requests.single['refresh_token'], 'refresh-1');
    expect(fixture.requests.single['resource'], fixture.origin.toString());
    expect(fixture.manager.currentUser!.token.refreshToken, 'refresh-2');
  });

  test(
    'transient failure preserves the grant and the next request recovers',
    () async {
      await fixture.seed(const Duration(seconds: -10));
      fixture.error = 'temporarily_unavailable';
      await expectLater(
        fixture.session.accessToken(),
        throwsA(isA<OidcException>()),
      );
      expect(await fixture.session.account(), isNotNull);
      fixture.error = null;
      expect(await fixture.session.accessToken(), 'fresh-token');
      expect(fixture.exchanges, 2);
    },
  );

  test(
    'invalid grant clears stored credentials and notifies without sync',
    () async {
      await fixture.seed(const Duration(seconds: -10));
      var invalidations = 0;
      final subscription = fixture.session.invalidations.listen(
        (_) => invalidations++,
      );
      addTearDown(subscription.cancel);
      fixture.error = 'invalid_grant';
      await expectLater(
        fixture.session.accessToken(),
        throwsA(isA<OidcException>()),
      );
      await Future<void>.delayed(Duration.zero);
      expect(await fixture.session.account(), isNull);
      expect(await fixture.session.accessToken(), isNull);
      expect(invalidations, 1);
      expect(
        await fixture.manager.store.get(
          OidcStoreNamespace.secureTokens,
          key: OidcConstants_Store.currentToken,
          managerId: fixture.manager.id,
        ),
        isNull,
      );
    },
  );

  test('a nonrefreshable token remains usable until actual expiry', () async {
    await fixture.seed(const Duration(seconds: 10), refreshToken: null);
    expect(await fixture.session.accessToken(), 'old-token');
    expect(await fixture.session.account(), isNotNull);
    expect(fixture.exchanges, 0);
  });

  test('expired token without a refresh grant becomes signed out', () async {
    await fixture.seed(const Duration(seconds: -10), refreshToken: null);
    expect(await fixture.session.accessToken(), isNull);
    expect(await fixture.session.account(), isNull);
    expect(fixture.exchanges, 0);
  });

  test('timer and request share refresh and logout cannot be undone', () async {
    await fixture.seed(const Duration(seconds: 10));
    fixture.responseGate = Completer<void>();
    final timer = fixture.manager.expireSoon();
    await fixture.requestStarted.future;
    final request = fixture.session.accessToken();
    final logout = fixture.session.signOut();
    fixture.responseGate!.complete();
    await Future.wait([timer, request, logout]);
    expect(fixture.exchanges, 1);
    expect(await fixture.session.account(), isNull);
  });

  test('timer failure leaves expiry refresh available', () async {
    await fixture.seed(const Duration(seconds: 10));
    fixture.error = 'temporarily_unavailable';
    await fixture.manager.expireSoon();
    expect(await fixture.session.account(), isNotNull);
    fixture.error = null;
    fixture.manager.expireNow();
    await fixture.refreshed.future;
    expect(fixture.manager.currentUser!.token.accessToken, 'fresh-token');
    expect(fixture.exchanges, 2);
  });
}

final class _Fixture {
  _Fixture(this.server, {this.supportsLogout = true});
  final bool supportsLogout;
  final HttpServer server;
  late final _Manager manager;
  late final AppBaseOidcSession session;
  String? error;
  int exchanges = 0;
  int logoutStatus = 200;
  int redirectRequests = 0;
  final logoutRequests = <Map<String, String>>[];
  final requests = <Map<String, String>>[];
  Completer<void>? responseGate;
  final requestStarted = Completer<void>();
  final refreshed = Completer<void>();
  final failureServed = Completer<void>();
  Uri get origin => Uri.parse('http://127.0.0.1:${server.port}');

  static Future<_Fixture> create({
    bool enableTimers = false,
    bool supportsLogout = true,
    bool providerLogoutInBackground = false,
  }) async {
    final fixture = _Fixture(
      await HttpServer.bind(InternetAddress.loopbackIPv4, 0),
      supportsLogout: supportsLogout,
    );
    fixture.server.listen(fixture.handle);
    fixture.manager = _Manager(
      fixture.origin,
      enableTimers: enableTimers,
      providerLogoutInBackground: providerLogoutInBackground,
    );
    await fixture.manager.init();
    fixture.manager.userChanges().listen((user) {
      if (user?.token.accessToken == 'fresh-token' &&
          !fixture.refreshed.isCompleted) {
        fixture.refreshed.complete();
      }
    });
    fixture.session = AppBaseOidcSession(
      loadConfiguration: () async => AppBaseClientConfiguration(
        protocolVersions: const [appBaseProtocolVersion],
        issuer: fixture.origin,
        clientId: 'test-client',
        audience: fixture.origin,
        usesResourceIndicator: true,
        acceptsDynamicCollections: true,
        encryptsAllPayloads: true,
        maxMutationsPerBatch: 50,
        maxChangesPerPage: 50,
        maxPayloadBytes: 1024,
      ),
      installationId: AppBaseInstallationId(
        namespace: 'test',
        storage: _Storage(),
      ),
      policy: AppBaseOidcPolicy(
        namespace: 'test',
        redirectUri: () => Uri.parse('test:/callback'),
        postLogoutRedirectUri: () => Uri.parse('test:/logout'),
      ),
      managerFactory: (_) => fixture.manager,
    );
    await fixture.session.account();
    return fixture;
  }

  Future<void> seed(
    Duration lifetime, {
    String? refreshToken = 'refresh-1',
  }) async {
    await manager.seed(
      await OidcUser.fromIdToken(
        token: OidcToken(
          creationTime: DateTime.now().toUtc(),
          expiresIn: lifetime,
          accessToken: 'old-token',
          refreshToken: refreshToken,
          idToken: jwt(),
        ),
      ),
    );
    await Future<void>.delayed(Duration.zero);
  }

  String jwt() {
    String encode(Object value) =>
        base64Url.encode(utf8.encode(jsonEncode(value))).replaceAll('=', '');
    return "${encode({'alg': 'none'})}.${encode({'iss': origin.toString(), 'aud': 'test-client', 'sub': 'user-1', 'iat': DateTime.now().millisecondsSinceEpoch ~/ 1000, 'exp': DateTime.now().millisecondsSinceEpoch ~/ 1000 + 3600})}.";
  }

  Future<void> handle(HttpRequest request) async {
    request.response.headers.contentType = ContentType.json;
    if (request.uri.path == '/discovery') {
      request.response.write(
        jsonEncode({
          'issuer': origin.toString(),
          'authorization_endpoint': '$origin/authorize',
          'token_endpoint': '$origin/token',
          if (supportsLogout) 'end_session_endpoint': '$origin/logout',
          'jwks_uri': '$origin/jwks',
          'grant_types_supported': ['authorization_code', 'refresh_token'],
        }),
      );
    } else if (request.uri.path == '/logout') {
      logoutRequests.add(request.uri.queryParameters);
      request.response.statusCode = logoutStatus;
      if (logoutStatus == 302) {
        request.response.headers.set('location', '$origin/redirect-target');
      }
    } else if (request.uri.path == '/redirect-target') {
      redirectRequests++;
    } else if (request.uri.path == '/token') {
      exchanges++;
      requests.add(
        Uri.splitQueryString(await utf8.decoder.bind(request).join()),
      );
      if (!requestStarted.isCompleted) requestStarted.complete();
      await responseGate?.future;
      if (error != null) {
        request.response.statusCode = error == 'invalid_grant' ? 400 : 503;
        request.response.write(jsonEncode({'error': error}));
        if (!failureServed.isCompleted) failureServed.complete();
      } else {
        request.response.write(
          jsonEncode({
            'access_token': 'fresh-token',
            'refresh_token': 'refresh-2',
            'token_type': 'Bearer',
            'expires_in': 3600,
            'id_token': jwt(),
          }),
        );
      }
    } else {
      request.response.write('{"keys":[]}');
    }
    await request.response.close();
  }

  Future<void> close() async {
    await session.dispose();
    await server.close(force: true);
  }
}

final class _Manager extends AppBaseOidcManager {
  _Manager(
    Uri origin, {
    this.enableTimers = false,
    super.providerLogoutInBackground,
  }) : super(
         discoveryDocumentUri: origin.resolve('/discovery'),
         clientCredentials: OidcClientAuthentication.none(
           clientId: 'test-client',
         ),
         store: OidcMemoryStore(),
         settings: OidcUserManagerSettings(
           redirectUri: Uri.parse('test:/callback'),
           postLogoutRedirectUri: Uri.parse('test:/logout'),
           prompt: const ['login'],
           extraTokenParameters: {'resource': origin.toString()},
         ),
       );

  final bool enableTimers;

  // Tests trigger both production callbacks deterministically rather than wait
  // for a real token lifetime. HTTP exchanges and persistence remain real.
  @override
  Future<void> listenToTokenRefreshIfSupported(
    OidcTokenEventsManager events,
    OidcUser? user,
  ) async {
    if (enableTimers) await super.listenToTokenRefreshIfSupported(events, user);
  }

  Future<void> seed(OidcUser user) async {
    await saveUser(user);
    userSubject.add(user);
  }

  Future<void> expireSoon() => handleTokenExpiring(currentUser!.token);
  void expireNow() => handleTokenExpired(currentUser!.token);
}

final class _Storage extends FlutterSecureStorage {
  @override
  Future<String?> read({
    required String key,
    AppleOptions? iOptions,
    AndroidOptions? aOptions,
    LinuxOptions? lOptions,
    WebOptions? webOptions,
    AppleOptions? mOptions,
    WindowsOptions? wOptions,
  }) async => 'test-device';
}

final class _LogoutPlatform extends NoOpOidcPlatform {
  Uri? logoutUri;
  Uri? authorizationUri;
  int calls = 0;
  String mode = 'success';

  @override
  Map<String, dynamic> prepareForRedirectFlow(
    OidcPlatformSpecificOptions options,
  ) => {};

  @override
  Future<OidcAuthorizeResponse?> getAuthorizationResponse(
    OidcProviderMetadata metadata,
    OidcAuthorizeRequest request,
    OidcPlatformSpecificOptions options,
    Map<String, dynamic> preparationResult,
  ) async {
    authorizationUri = request.generateUri(metadata.authorizationEndpoint!);
    return null;
  }

  @override
  Future<OidcEndSessionResponse?> getEndSessionResponse(
    OidcProviderMetadata metadata,
    OidcEndSessionRequest request,
    OidcPlatformSpecificOptions options,
    Map<String, dynamic> preparationResult,
  ) async {
    calls++;
    logoutUri = request.generateUri(metadata.endSessionEndpoint!);
    if (mode == 'cancel') return null;
    if (mode == 'network') throw const SocketException('fixture unavailable');
    return OidcEndSessionResponse.fromJson({
      if (mode != 'missing-state')
        'state': mode == 'bad-state' ? 'wrong' : request.state,
    });
  }
}
