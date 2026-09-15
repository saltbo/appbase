import 'dart:async';
import 'models.dart';
import 'ports.dart';
import 'errors.dart';

/// A revocable application-device session bootstrapped by the existing OIDC grant.
/// The IdP subject is retained separately from the application's account ID.
final class AppBaseAccountSession
    implements
        AppBaseSession,
        AppBaseRegistrationSession,
        AppBaseSessionEvents {
  AppBaseAccountSession({
    required this.identity,
    required this.api,
    required this.store,
    required this.beforeRegistration,
    this.beforeAccountChange,
    DateTime Function()? now,
  }) : now = now ?? DateTime.now;
  final AppBaseSession identity;
  final AppBaseAccountApi api;
  final AppBaseAccountBindingStore store;
  final Future<void> Function() beforeRegistration;
  final Future<void> Function(String accountId)? beforeAccountChange;
  final DateTime Function() now;
  @override
  Stream<void> get invalidations => identity is AppBaseSessionEvents
      ? (identity as AppBaseSessionEvents).invalidations
      : const Stream.empty();
  Future<String?>? _refresh;
  int _generation = 0;
  Future<void> _storage = Future.value();

  Future<void> _mutateStore(Future<void> Function() action) {
    final run = _storage.then((_) => action());
    _storage = run.then<void>((_) {}, onError: (Object _, StackTrace _) {});
    return run;
  }

  @override
  Future<AppBaseAccount?> account() async {
    final user = await identity.account();
    if (user == null) return null;
    final binding = await store.read();
    if (binding == null ||
        binding['subject'] != user.subject ||
        binding['issuer'] != user.issuer.toString()) {
      return null;
    }
    return _bound(user, binding['accountId'] as String);
  }

  @override
  Future<AppBaseAccount> signIn() async {
    final user = await identity.signIn();
    final token = await identity.accessToken();
    if (token == null) throw _failure('session_expired', 'Sign in again.');
    final state = await api.accountStatus(token);
    if (state['status'] == 'deleting') {
      throw _failure(
        'ACCOUNT_DELETING',
        'Account deletion is still in progress.',
      );
    }
    if (state['status'] != 'active') {
      throw _failure(
        'REGISTRATION_REQUIRED',
        'Confirm creation of an empty application account.',
      );
    }
    await beforeAccountChange?.call(state['accountId'] as String);
    return _open(user, token, accountId: state['accountId'] as String);
  }

  /// Restore a pre-lifecycle installation only to its existing server account.
  Future<AppBaseAccount?> restoreLegacy() async {
    final existing = await account();
    if (existing != null) return existing;
    final user = await identity.account();
    if (user == null) return null;
    final token = await identity.accessToken();
    if (token == null) return null;
    final state = await api.accountStatus(token);
    // A migrated account has the original subject as its ID. Never attach stale
    // pre-lifecycle local records to a newly registered incarnation.
    if (state['status'] != 'active' || state['accountId'] != user.subject) {
      return null;
    }
    return _open(user, token, accountId: user.subject);
  }

  @override
  Future<AppBaseAccount> register() async {
    final user = await identity.account();
    final token = await identity.accessToken();
    if (user == null || token == null) {
      throw _failure('session_expired', 'Sign in again.');
    }
    await beforeRegistration();
    return _open(user, token, register: true);
  }

  Future<AppBaseAccount> _open(
    AppBaseAccount user,
    String token, {
    String? accountId,
    bool register = false,
  }) async {
    final generation = _generation;
    final result = await api.openAccountSession(
      identityToken: token,
      deviceId: user.deviceId,
      accountId: accountId,
      register: register,
    );
    if (generation != _generation) {
      throw _failure('session_expired', 'The sign-in was cancelled.');
    }
    final id = result['accountId'];
    if (id is! String ||
        result['accessToken'] is! String ||
        result['expiresAt'] is! int) {
      throw _failure('invalid_response', 'Invalid application session.');
    }
    await _mutateStore(() async {
      if (generation != _generation) {
        throw _failure('session_expired', 'The sign-in was cancelled.');
      }
      await store.write({
        ...result,
        'subject': user.subject,
        'issuer': user.issuer.toString(),
      });
    });
    if (generation != _generation) {
      throw _failure('session_expired', 'The sign-in was cancelled.');
    }
    return _bound(user, id);
  }

  @override
  Future<String?> accessToken() async {
    final user = await account();
    if (user == null) return null;
    final binding = await store.read();
    if (binding == null) return null;
    if ((binding['expiresAt'] as int) >
        now().millisecondsSinceEpoch ~/ 1000 + 60) {
      return binding['accessToken'] as String;
    }
    final active = _refresh;
    if (active != null) return active;
    final run = () async {
      final token = await identity.accessToken();
      if (token == null) return null;
      await _open(user, token, accountId: user.accountId);
      return (await store.read())?['accessToken'] as String?;
    }();
    _refresh = run;
    try {
      return await run;
    } finally {
      if (identical(_refresh, run)) _refresh = null;
    }
  }

  @override
  Future<void> signOut() async {
    _generation++;
    final binding = await store.read();
    await _mutateStore(store.clear);
    await identity.signOut();
    if (binding != null) {
      try {
        await api.revokeAccountSession(binding['accessToken'] as String);
      } on AppBaseException {
        // Local logout is complete; any unreachable server session has a 30-minute expiry.
      }
    }
  }
}

AppBaseAccount _bound(AppBaseAccount user, String id) => AppBaseAccount(
  issuer: user.issuer,
  subject: user.subject,
  accountId: id,
  deviceId: user.deviceId,
  displayName: user.displayName,
  email: user.email,
  avatarUri: user.avatarUri,
);
AppBaseApiException _failure(String code, String message) =>
    AppBaseApiException(
      kind: AppBaseFailureKind.authentication,
      code: code,
      message: message,
    );
