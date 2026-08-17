import 'dart:convert';

import 'package:appbase_client/appbase_client.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:test/test.dart';

void main() {
  test('loads configuration and sends the version contract', () async {
    final client = MockClient((request) async {
      expect(request.url.path, '/appbase/client-configuration');
      expect(request.headers['API-Version'], appBaseProtocolVersion);
      return http.Response(
        jsonEncode({
          'protocolVersions': [appBaseProtocolVersion],
          'issuer': 'https://identity.example',
          'clientId': 'desktop',
          'audience': 'https://api.example',
          'usesResourceIndicator': true,
          'acceptsDynamicCollections': true,
          'encryptsAllPayloads': true,
          'maxMutationsPerBatch': 50,
          'maxChangesPerPage': 200,
          'maxPayloadBytes': 65536,
          'links': <String, Object?>{},
        }),
        200,
        headers: {'content-type': 'application/json'},
      );
    });
    final api = AppBaseHttpApi(
      baseUri: Uri.parse('https://api.example/appbase'),
      client: client,
    );

    final config = await api.configuration();

    expect(config.clientId, 'desktop');
    expect(config.maxMutationsPerBatch, 50);
  });

  test('maps RFC problem details to a stable retryable exception', () async {
    final api = AppBaseHttpApi(
      baseUri: Uri.parse('https://api.example/appbase/'),
      client: MockClient(
        (_) async => http.Response(
          jsonEncode({'code': 'RATE_LIMITED', 'detail': 'Slow down.'}),
          429,
          headers: {'request-id': 'req-1', 'retry-after': '7'},
        ),
      ),
    );

    await expectLater(
      api.pull(accessToken: 'token'),
      throwsA(
        isA<AppBaseApiException>()
            .having((error) => error.code, 'code', 'RATE_LIMITED')
            .having((error) => error.requestId, 'requestId', 'req-1')
            .having(
              (error) => error.retryAfter,
              'retryAfter',
              const Duration(seconds: 7),
            )
            .having((error) => error.isRetryable, 'isRetryable', true),
      ),
    );
  });

  test('parses a canonical change page', () async {
    final api = AppBaseHttpApi(
      baseUri: Uri.parse('https://api.example/appbase/'),
      client: MockClient((request) async {
        expect(request.url.queryParameters['pageToken'], 'p1');
        return http.Response(
          jsonEncode({
            'items': [
              {
                'sequence': 4,
                'collection': 'notes',
                'recordId': 'n1',
                'revision': '00000000-0000-4000-8000-000000000001',
                'deleted': false,
                'createdAt': '2026-08-17T00:00:00Z',
                'payload': {'title': 'hello'},
              },
            ],
            'pagination': {
              'pageSize': 1,
              'checkpoint': 'p2',
              'nextPageToken': 'p2',
            },
          }),
          200,
        );
      }),
    );

    final page = await api.pull(accessToken: 'token', pageToken: 'p1');

    expect(page.items.single.payload, {'title': 'hello'});
    expect(page.nextPageToken, 'p2');
  });
}
