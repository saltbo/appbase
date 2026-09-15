import 'dart:convert';
import 'dart:io';
import 'package:appbase_client/appbase_client.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:test/test.dart';

void main() {
  test(
    'uses the existing HTTP transport and shared deletion contract',
    () async {
      final file = File(
        'packages/appbase_client/test/fixtures/http-contract.json',
      );
      final fixture =
          (jsonDecode(await file.readAsString()) as Map)['accountDeletion']
              as Map;
      final api = AppBaseHttpApi(
        baseUri: Uri.parse('https://api.example/appbase/'),
        client: MockClient((request) async {
          expect(request.method, fixture['method']);
          expect(request.url.path, '/appbase/${fixture['path']}');
          expect(request.headers['Authorization'], 'Bearer fixture-token');
          expect(request.headers['API-Version'], appBaseProtocolVersion);
          expect(request.body, isEmpty);
          return http.Response('', fixture['successStatus'] as int);
        }),
      );
      await api.deleteAccount(accessToken: 'fixture-token');
    },
  );
}
