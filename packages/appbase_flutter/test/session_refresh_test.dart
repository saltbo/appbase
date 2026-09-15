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
  setUp(() async => fixture = await _Fixture.create());
  tearDown(() => fixture.close());

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
  _Fixture(this.server);
  final HttpServer server;
  late final _Manager manager;
  late final AppBaseOidcSession session;
  String? error;
  int exchanges = 0;
  final requests = <Map<String, String>>[];
  Completer<void>? responseGate;
  final requestStarted = Completer<void>();
  final refreshed = Completer<void>();
  final failureServed = Completer<void>();
  Uri get origin => Uri.parse('http://127.0.0.1:${server.port}');

  static Future<_Fixture> create({bool enableTimers = false}) async {
    final fixture = _Fixture(
      await HttpServer.bind(InternetAddress.loopbackIPv4, 0),
    );
    fixture.server.listen(fixture.handle);
    fixture.manager = _Manager(fixture.origin, enableTimers: enableTimers);
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
          'jwks_uri': '$origin/jwks',
          'grant_types_supported': ['authorization_code', 'refresh_token'],
        }),
      );
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
  _Manager(Uri origin, {this.enableTimers = false})
    : super(
        discoveryDocumentUri: origin.resolve('/discovery'),
        clientCredentials: OidcClientAuthentication.none(
          clientId: 'test-client',
        ),
        store: OidcMemoryStore(),
        settings: OidcUserManagerSettings(
          redirectUri: Uri.parse('test:/callback'),
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
