import 'dart:async';

import 'errors.dart';
import 'models.dart';
import 'ports.dart';

final class AppBaseSyncEngine {
  AppBaseSyncEngine({
    required this.session,
    required this.api,
    required this.persistence,
    required this.batchIds,
  });

  final AppBaseSession session;
  final AppBaseApi api;
  final AppBasePersistence persistence;
  final AppBaseBatchIdGenerator batchIds;

  final _states = StreamController<AppBaseSyncState>.broadcast(sync: true);
  AppBaseSyncState _state = const AppBaseSyncState.idle();
  Future<void>? _activeRun;

  AppBaseSyncState get state => _state;
  Stream<AppBaseSyncState> get states => _states.stream;

  Future<AppBaseAccount?> restore() async {
    final account = await session.account();
    if (account == null) return null;
    final saved = await persistence.saveAccount(account);
    await persistence.seedIfNeeded(saved);
    _set(AppBaseSyncState.idle(account: saved));
    return saved;
  }

  Future<AppBaseAccount> signIn() async {
    final account = await persistence.saveAccount(await session.signIn());
    await persistence.seedIfNeeded(account);
    _set(AppBaseSyncState.idle(account: account));
    await syncNow();
    return state.account ?? account;
  }

  Future<void> signOut() async {
    await _activeRun;
    await session.signOut();
    _set(const AppBaseSyncState.idle());
  }

  Future<void> syncNow() {
    final active = _activeRun;
    if (active != null) return active;
    final run = _synchronize();
    _activeRun = run;
    return run.whenComplete(() {
      if (identical(_activeRun, run)) _activeRun = null;
    });
  }

  Future<void> close() => _states.close();

  Future<void> _synchronize() async {
    final current = await session.account();
    if (current == null) return;
    var account = await persistence.saveAccount(current);
    _set(AppBaseSyncState(phase: AppBaseSyncPhase.syncing, account: account));
    try {
      final token = await session.accessToken();
      if (token == null) {
        throw const AppBaseApiException(
          kind: AppBaseFailureKind.authentication,
          code: 'session_expired',
          message: 'The AppBase session has expired.',
        );
      }
      final config = await api.configuration();
      config.requireCompatible(appBaseProtocolVersion);
      account = await _pullAll(account, token, config.maxChangesPerPage);
      while (true) {
        final pending = await persistence.loadPending(
          account,
          limit: config.maxMutationsPerBatch,
        );
        if (pending.isEmpty) break;
        final results = await api.push(
          accessToken: token,
          batchId: batchIds.next(),
          mutations: pending,
        );
        await persistence.acknowledge(account, results);
      }
      account = await _pullAll(account, token, config.maxChangesPerPage);
      _set(AppBaseSyncState.idle(account: account));
    } on AppBaseException catch (error) {
      await persistence.recordFailure(account, error);
      _set(
        AppBaseSyncState(
          phase: AppBaseSyncPhase.failed,
          account: account,
          error: error,
        ),
      );
      rethrow;
    } on Object catch (error) {
      final failure = AppBaseLocalException(
        message: 'The local AppBase transaction failed: $error',
      );
      await persistence.recordFailure(account, failure);
      _set(
        AppBaseSyncState(
          phase: AppBaseSyncPhase.failed,
          account: account,
          error: failure,
        ),
      );
      throw failure;
    }
  }

  Future<AppBaseAccount> _pullAll(
    AppBaseAccount account,
    String token,
    int pageSize,
  ) async {
    String? pageToken = account.checkpoint;
    while (true) {
      final page = await api.pull(
        accessToken: token,
        pageToken: pageToken,
        pageSize: pageSize,
      );
      account = await persistence.applyPull(account, page);
      pageToken = page.nextPageToken;
      if (pageToken == null) return account;
    }
  }

  void _set(AppBaseSyncState value) {
    _state = value;
    _states.add(value);
  }
}
