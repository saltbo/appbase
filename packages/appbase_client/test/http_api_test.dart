import 'dart:io';
import 'dart:convert';

import 'package:appbase_client/appbase_client.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:test/test.dart';

void main() {
  final fixtureFile = File(
    'packages/appbase_client/test/fixtures/http-contract.json',
  );
  final contract =
      jsonDecode(
            (fixtureFile.existsSync()
                    ? fixtureFile
                    : File('test/fixtures/http-contract.json'))
                .readAsStringSync(),
          )
          as Map<String, Object?>;

  test('loads configuration and sends the version contract', () async {
    final fixture = contract['configuration']! as Map<String, Object?>;
    final client = MockClient((request) async {
      expect(request.url.path, '/appbase/client-configuration');
      expect(request.headers['API-Version'], appBaseProtocolVersion);
      return http.Response(
        jsonEncode(fixture),
        200,
        headers: {'content-type': 'application/json'},
      );
    });
    final api = AppBaseHttpApi(
      baseUri: Uri.parse('https://api.example/appbase'),
      client: client,
    );

    final config = await api.configuration();

    expect(config.clientId, 'client-id');
    expect(config.maxMutationsPerBatch, 50);
  });

  test('consumes the shared TypeScript and Dart mutation fixture', () async {
    final fixture = contract['mutationBatch']! as Map<String, Object?>;
    final requestFixture = fixture['request']! as Map<String, Object?>;
    final responseFixture = fixture['response']! as Map<String, Object?>;
    final api = AppBaseHttpApi(
      baseUri: Uri.parse('https://api.example/appbase/'),
      client: MockClient((request) async {
        expect(
          jsonDecode(request.body) as Map<String, Object?>,
          requestFixture,
        );
        return http.Response(jsonEncode(responseFixture), 200);
      }),
    );
    final mutation =
        (requestFixture['mutations']! as List<Object?>).single
            as Map<String, Object?>;

    final results = await api.push(
      accessToken: 'token',
      batchId: fixture['id']! as String,
      mutations: [
        AppBasePendingMutation(
          mutationId: mutation['mutationId']! as String,
          deviceId: mutation['deviceId']! as String,
          collection: mutation['collection']! as String,
          recordId: mutation['recordId']! as String,
          baseRevision: mutation['baseRevision'] as String?,
          operation: AppBaseMutationOperation.values.byName(
            mutation['operation']! as String,
          ),
          payload: mutation['payload']! as Map<String, Object?>,
        ),
      ],
    );

    expect(results.single.mutationId, 'fixture-mutation-1');
    expect(results.single.change.payload, {'title': 'Shared contract'});
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
