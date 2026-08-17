import 'package:appbase_client/appbase_client.dart';
import 'package:test/test.dart';

void main() {
  test(
    'serializes concurrent runs, pages pulls, and honors server batch size',
    () async {
      final account = _account();
      final session = _Session(account);
      final api = _Api();
      final persistence = _Persistence(account);
      final engine = AppBaseSyncEngine(
        session: session,
        api: api,
        persistence: persistence,
        batchIds: _BatchIds(),
      );

      await Future.wait([engine.syncNow(), engine.syncNow()]);

      expect(api.configurationCalls, 1);
      expect(api.pushedSizes, [2, 1]);
      expect(api.pullTokens, [null, 'page-2', 'checkpoint-1']);
      expect(engine.state.phase, AppBaseSyncPhase.idle);
      expect(engine.state.account?.checkpoint, 'checkpoint-2');
      await engine.close();
    },
  );

  test('records a typed failure and preserves it in state', () async {
    final account = _account();
    final persistence = _Persistence(account);
    final engine = AppBaseSyncEngine(
      session: _Session(account, token: null),
      api: _Api(),
      persistence: persistence,
      batchIds: _BatchIds(),
    );

    await expectLater(engine.syncNow(), throwsA(isA<AppBaseApiException>()));

    expect(persistence.failure?.code, 'session_expired');
    expect(engine.state.phase, AppBaseSyncPhase.failed);
    await engine.close();
  });
}

AppBaseAccount _account() => AppBaseAccount(
  issuer: Uri.parse('https://identity.example'),
  subject: 'user-1',
  deviceId: 'device-1',
);

final class _Session implements AppBaseSession {
  _Session(this.value, {this.token = 'token'});
  AppBaseAccount? value;
  final String? token;
  @override
  Future<String?> accessToken() async => token;
  @override
  Future<AppBaseAccount?> account() async => value;
  @override
  Future<AppBaseAccount> signIn() async => value!;
  @override
  Future<void> signOut() async => value = null;
}

final class _BatchIds implements AppBaseBatchIdGenerator {
  var value = 0;
  @override
  String next() => 'batch-${++value}';
}

final class _Api implements AppBaseApi {
  var configurationCalls = 0;
  final pushedSizes = <int>[];
  final pullTokens = <String?>[];
  @override
  Future<AppBaseClientConfiguration> configuration() async {
    configurationCalls++;
    return AppBaseClientConfiguration(
      protocolVersions: const [appBaseProtocolVersion],
      issuer: Uri.parse('https://identity.example'),
      clientId: 'client',
      audience: Uri.parse('https://api.example'),
      usesResourceIndicator: true,
      acceptsDynamicCollections: true,
      encryptsAllPayloads: true,
      maxMutationsPerBatch: 2,
      maxChangesPerPage: 2,
      maxPayloadBytes: 1024,
    );
  }

  @override
  Future<AppBaseChangePage> pull({
    required String accessToken,
    String? pageToken,
    int? pageSize,
  }) async {
    pullTokens.add(pageToken);
    if (pullTokens.length == 1) {
      return const AppBaseChangePage(
        items: [],
        checkpoint: 'checkpoint-1',
        nextPageToken: 'page-2',
      );
    }
    return AppBaseChangePage(
      items: const [],
      checkpoint: pullTokens.length == 2 ? 'checkpoint-1' : 'checkpoint-2',
    );
  }

  @override
  Future<List<AppBaseMutationResult>> push({
    required String accessToken,
    required String batchId,
    required List<AppBasePendingMutation> mutations,
  }) async {
    pushedSizes.add(mutations.length);
    return [
      for (final mutation in mutations)
        AppBaseMutationResult(
          mutationId: mutation.mutationId,
          change: AppBaseRemoteChange(
            sequence: pushedSizes.length,
            collection: mutation.collection,
            recordId: mutation.recordId,
            revision: '00000000-0000-4000-8000-000000000001',
            deleted: false,
            createdAt: DateTime.utc(2026),
            payload: mutation.payload,
          ),
        ),
    ];
  }
}

final class _Persistence implements AppBasePersistence {
  _Persistence(this.value)
    : pending = List.generate(
        3,
        (index) => AppBasePendingMutation(
          mutationId: 'mutation-$index',
          deviceId: 'device-1',
          collection: 'notes',
          recordId: 'note-$index',
          operation: AppBaseMutationOperation.put,
          payload: {'value': index},
        ),
      );

  AppBaseAccount value;
  final List<AppBasePendingMutation> pending;
  AppBaseException? failure;
  @override
  Future<void> acknowledge(
    AppBaseAccount account,
    List<AppBaseMutationResult> results,
  ) async {
    final ids = results.map((result) => result.mutationId).toSet();
    pending.removeWhere((mutation) => ids.contains(mutation.mutationId));
  }

  @override
  Future<AppBaseAccount> applyPull(
    AppBaseAccount account,
    AppBaseChangePage page,
  ) async => value = account.copyWith(checkpoint: page.checkpoint);
  @override
  Future<List<AppBasePendingMutation>> loadPending(
    AppBaseAccount account, {
    required int limit,
  }) async => pending.take(limit).toList();
  @override
  Future<void> recordFailure(
    AppBaseAccount account,
    AppBaseException error,
  ) async => failure = error;
  @override
  Future<AppBaseAccount> saveAccount(AppBaseAccount account) async => value;
  @override
  Future<void> seedIfNeeded(AppBaseAccount account) async {}
}
