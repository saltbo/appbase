import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:appbase_client/appbase_client.dart';
import 'package:appbase_flutter/appbase_flutter.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:oidc/oidc.dart';

// Covers: S_ACCOUNT_SIGN_IN_NETWORK_RECOVERY case=happy_path
// Covers: S_ACCOUNT_SIGN_IN_NETWORK_RECOVERY case=error_path
void main() {
  late HttpServer server;
  late AppBaseHttpApi api;
  late AppBaseOidcSession session;
  var configRequests = 0;
  var discoveryRequests = 0;
  String? blockedPath;
  var deny = false;
  var bodyOnly = false;
  final managers = <_BrowserManager>[];
  final held = <HttpResponse>[];

  setUp(() async {
    configRequests = discoveryRequests = 0;
    blockedPath = null;
    deny = bodyOnly = false;
    held.clear();
    managers.clear();
    server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    final origin = Uri.parse('http://127.0.0.1:${server.port}/');
    api = AppBaseHttpApi(
      baseUri: origin,
      requestTimeout: const Duration(milliseconds: 150),
    );
    server.listen((request) async {
      final path = request.uri.path;
      if (path == '/client-configuration') configRequests++;
      if (path == '/discovery') discoveryRequests++;
      request.response.headers.contentType = ContentType.json;
      if (path == blockedPath) {
        if (deny) {
          // A controlled failure at the network boundary, not an assertion
          // that a simulator can reproduce a regional iOS permission dialog.
          final socket = await request.response.detachSocket(
            writeHeaders: false,
          );
          socket.destroy();
        } else {
          held.add(request.response);
          if (bodyOnly) {
            request.response.write('{');
            await request.response.flush();
          }
        }
        return;
      }
      request.response.write(
        jsonEncode(
          path == '/client-configuration'
              ? {
                  'protocolVersions': [appBaseProtocolVersion],
                  'issuer': origin.toString(),
                  'clientId': 'test-client',
                  'audience': origin.toString(),
                  'usesResourceIndicator': true,
                  'acceptsDynamicCollections': true,
                  'encryptsAllPayloads': true,
                  'maxMutationsPerBatch': 50,
                  'maxChangesPerPage': 50,
                  'maxPayloadBytes': 1024,
                }
              : {
                  'issuer': origin.toString(),
                  'authorization_endpoint': '${origin}authorize',
                  'token_endpoint': '${origin}token',
                  'response_types_supported': ['code'],
                  'subject_types_supported': ['public'],
                  'id_token_signing_alg_values_supported': ['RS256'],
                },
        ),
      );
      await request.response.close();
    });
    session = AppBaseOidcSession(
      loadConfiguration: api.configuration,
      installationId: AppBaseInstallationId(namespace: 'network-test'),
      policy: AppBaseOidcPolicy(
        namespace: 'network-test',
        redirectUri: () => Uri.parse('test:/callback'),
        postLogoutRedirectUri: () => Uri.parse('test:/logout'),
      ),
      managerFactory: (_) {
        final manager = _BrowserManager(origin);
        managers.add(manager);
        return manager;
      },
    );
  });

  tearDown(() async {
    await session.dispose();
    await server.close(force: true);
  });

  test(
    'happy_path: concurrent cold initialization shares one request',
    () async {
      expect(await Future.wait([session.account(), session.account()]), [
        null,
        null,
      ]);
      expect(configRequests, 1);
      expect(discoveryRequests, 1);
    },
  );

  for (final path in ['/client-configuration', '/discovery']) {
    for (final failure in ['denied', 'no headers', 'unfinished body']) {
      test('error_path: $path $failure recovers in the same session', () async {
        blockedPath = path;
        deny = failure == 'denied';
        bodyOnly = failure == 'unfinished body';
        final first = session.account();
        final second = session.account();
        await Future.wait([
          expectLater(first, throwsA(isA<Exception>())),
          expectLater(second, throwsA(isA<Exception>())),
        ]).timeout(const Duration(seconds: 25));
        expect(configRequests, 1);
        blockedPath = null;
        expect(await session.account(), isNull);
        expect(configRequests, 2);
        expect(discoveryRequests, path == '/discovery' ? 2 : 1);
        // A response from the abandoned request must not populate the runtime.
        for (final response in held) {
          try {
            response.write('{}');
            await response.close();
          } on IOException {
            // The transport has already been closed by the deadline.
          }
        }
        expect(await session.account(), isNull);
        expect(configRequests, 2);
      });
    }
  }

  test('browser interaction is not limited by the network deadline', () async {
    await session.account();
    final manager = managers.single;
    final login = manager.loginAuthorizationCodeFlow();
    await manager.opened.future;
    await Future<void>.delayed(const Duration(milliseconds: 350));
    expect(manager.isDisposed, isFalse);
    manager.browser.complete(false);
    expect(await login, isNull);
  });

  for (final unfinishedBody in [false, true]) {
    test(
      'token exchange times out and retires runtime (body=$unfinishedBody)',
      () async {
        await session.account();
        final manager = managers.single;
        blockedPath = '/token';
        bodyOnly = unfinishedBody;
        final login = manager.loginAuthorizationCodeFlow();
        final failure = expectLater(login, throwsA(isA<TimeoutException>()));
        await manager.opened.future;
        manager.browser.complete(true);
        await failure;
        expect(manager.isDisposed, isTrue);
        final lateUser = await OidcUser.fromIdToken(
          token: OidcToken(
            creationTime: DateTime.now(),
            accessToken: 'late-token',
            idToken: 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJ1c2VyIn0.',
          ),
        );
        await expectLater(
          Future.sync(() => manager.saveUser(lateUser)),
          throwsStateError,
        );
        expect(
          await manager.store.get(
            OidcStoreNamespace.secureTokens,
            key: OidcConstants_Store.currentToken,
            managerId: manager.id,
          ),
          isNull,
        );
        blockedPath = null;
        expect(await Future.wait([session.account(), session.account()]), [
          null,
          null,
        ]);
        expect(managers, hasLength(2));
        expect(configRequests, 2);
      },
    );
  }

  test('error_path: one stalled request does not abort another', () async {
    blockedPath = '/client-configuration';
    final failure = expectLater(
      api.configuration(),
      throwsA(isA<AppBaseTransportException>()),
    );
    await Future<void>.delayed(const Duration(milliseconds: 40));
    blockedPath = null;
    expect(await session.account(), isNull);
    await failure;
    expect(await session.account(), isNull);
  });
}

final class _BrowserManager extends AppBaseOidcManager {
  _BrowserManager(Uri origin)
    : super(
        discoveryDocumentUri: origin.resolve('discovery'),
        clientCredentials: OidcClientAuthentication.none(
          clientId: 'test-client',
        ),
        store: OidcMemoryStore(),
        settings: OidcUserManagerSettings(
          redirectUri: Uri.parse('test:/callback'),
        ),
        networkTimeout: const Duration(milliseconds: 150),
      );

  final opened = Completer<void>();
  final browser = Completer<bool>();

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
    opened.complete();
    if (!await browser.future) return null;
    return OidcAuthorizeResponse.fromJson({
      'code': 'fixture-code',
      'state': request.state,
    });
  }
}
