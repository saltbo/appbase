import 'package:appbase_client/appbase_client.dart';
import 'package:appbase_flutter/appbase_flutter.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('restore exposes the account and schedules synchronization', () async {
    final account = AppBaseAccount(
      issuer: Uri.parse('https://identity.example'),
      subject: 'user-1',
      deviceId: 'device-1',
    );
    final engine = AppBaseSyncEngine(
      session: _Session(account),
      api: _Api(),
      persistence: _Persistence(account),
      batchIds: AppBaseRandomBatchIdGenerator(),
    );
    final controller = AppBaseSyncController(engine: engine);

    await controller.restore();
    await Future<void>.delayed(Duration.zero);

    expect(controller.state.account?.subject, 'user-1');
    controller.dispose();
  });

  test('retryable failures use bounded injectable jitter', () async {
    final account = AppBaseAccount(
      issuer: Uri.parse('https://identity.example'),
      subject: 'user-1',
      deviceId: 'device-1',
    );
    final engine = AppBaseSyncEngine(
      session: _Session(account),
      api: _FailingApi(),
      persistence: _Persistence(account),
      batchIds: AppBaseRandomBatchIdGenerator(),
    );
    final jitterInputs = <Duration>[];
    final controller = AppBaseSyncController(
      engine: engine,
      retryJitter: (delay) {
        jitterInputs.add(delay);
        return const Duration(days: 1);
      },
    );
    addTearDown(controller.dispose);

    await controller.syncNow();

    expect(jitterInputs, [const Duration(seconds: 2)]);
    expect(controller.state.phase, AppBaseSyncPhase.failed);
  });
}

final class _Session implements AppBaseSession {
  _Session(this.value);
  AppBaseAccount? value;
  @override
  Future<String?> accessToken() async => 'token';
  @override
  Future<AppBaseAccount?> account() async => value;
  @override
  Future<AppBaseAccount> signIn() async => value!;
  @override
  Future<void> signOut() async => value = null;
}

class _Api implements AppBaseApi {
  @override
  Future<AppBaseClientConfiguration> configuration() async =>
      AppBaseClientConfiguration(
        protocolVersions: const [appBaseProtocolVersion],
        issuer: Uri.parse('https://identity.example'),
        clientId: 'client',
        audience: Uri.parse('https://api.example'),
        usesResourceIndicator: true,
        acceptsDynamicCollections: true,
        encryptsAllPayloads: true,
        maxMutationsPerBatch: 50,
        maxChangesPerPage: 200,
        maxPayloadBytes: 65536,
      );
  @override
  Future<AppBaseChangePage> pull({
    required String accessToken,
    String? pageToken,
    int? pageSize,
  }) async => const AppBaseChangePage(items: [], checkpoint: 'checkpoint');
  @override
  Future<List<AppBaseMutationResult>> push({
    required String accessToken,
    required String batchId,
    required List<AppBasePendingMutation> mutations,
  }) async => const [];
}

final class _FailingApi extends _Api {
  @override
  Future<AppBaseClientConfiguration> configuration() =>
      throw const AppBaseApiException(
        kind: AppBaseFailureKind.transport,
        code: 'unavailable',
        message: 'Temporarily unavailable.',
      );
}

final class _Persistence implements AppBasePersistence {
  _Persistence(this.value);
  AppBaseAccount value;
  @override
  Future<void> acknowledge(
    AppBaseAccount account,
    List<AppBaseMutationResult> results,
  ) async {}
  @override
  Future<AppBaseAccount> applyPull(
    AppBaseAccount account,
    AppBaseChangePage page,
  ) async => value = account.copyWith(checkpoint: page.checkpoint);
  @override
  Future<List<AppBasePendingMutation>> loadPending(
    AppBaseAccount account, {
    required int limit,
  }) async => const [];
  @override
  Future<void> recordFailure(
    AppBaseAccount account,
    AppBaseException error,
  ) async {}
  @override
  Future<AppBaseAccount> saveAccount(AppBaseAccount account) async => value;
  @override
  Future<void> seedIfNeeded(AppBaseAccount account) async {}
}
