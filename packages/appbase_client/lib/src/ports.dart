import 'errors.dart';
import 'models.dart';

abstract interface class AppBaseApi {
  Future<AppBaseClientConfiguration> configuration();

  Future<List<AppBaseMutationResult>> push({
    required String accessToken,
    required String batchId,
    required List<AppBasePendingMutation> mutations,
  });

  Future<AppBaseChangePage> pull({
    required String accessToken,
    String? pageToken,
    int? pageSize,
  });
}

abstract interface class AppBaseSession {
  Future<AppBaseAccount?> account();
  Future<String?> accessToken();
  Future<AppBaseAccount> signIn();
  Future<void> signOut();
}

abstract interface class AppBasePersistence {
  Future<AppBaseAccount> saveAccount(AppBaseAccount account);
  Future<void> seedIfNeeded(AppBaseAccount account);
  Future<List<AppBasePendingMutation>> loadPending(
    AppBaseAccount account, {
    required int limit,
  });
  Future<void> acknowledge(
    AppBaseAccount account,
    List<AppBaseMutationResult> results,
  );
  Future<AppBaseAccount> applyPull(
    AppBaseAccount account,
    AppBaseChangePage page,
  );
  Future<void> recordFailure(AppBaseAccount account, AppBaseException error);
}

abstract interface class AppBaseMutationSink {
  Future<void> commit(
    List<AppBaseMutationDraft> mutations,
    Future<void> Function() localWrite,
  );
}

abstract interface class AppBaseCollectionAdapter {
  String get collection;
  Future<List<AppBaseMutationDraft>> seed(AppBaseAccount account);
  Future<void> apply(AppBaseAccount account, AppBaseRemoteChange change);
  Future<void> deactivate(AppBaseAccount account);
}

abstract interface class AppBaseBatchIdGenerator {
  String next();
}
