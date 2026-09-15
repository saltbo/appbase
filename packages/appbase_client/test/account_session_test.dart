import 'dart:async';
import 'package:appbase_client/appbase_client.dart';
import 'package:test/test.dart';

void main() {
  late _Identity identity;
  late _Api api;
  late _Store store;
  late AppBaseAccountSession session;
  late int cleared;
  late DateTime now;
  setUp(() {
    identity = _Identity();
    api = _Api();
    store = _Store();
    cleared = 0;
    now = DateTime.fromMillisecondsSinceEpoch(1000000);
    session = AppBaseAccountSession(
      identity: identity,
      api: api,
      store: store,
      beforeRegistration: () async {
        cleared++;
      },
      now: () => now,
    );
  });
  test(
    'registration is explicit and keeps the external subject separate',
    () async {
      await expectLater(
        session.signIn(),
        throwsA(
          isA<AppBaseApiException>().having(
            (e) => e.code,
            'code',
            'REGISTRATION_REQUIRED',
          ),
        ),
      );
      expect(api.registrations, 0);
      expect(await session.account(), isNull);
      final account = await session.register();
      expect(cleared, 1);
      expect(account.subject, 'identity-user');
      expect(account.accountId, 'application-1');
      expect(account.storageKey, 'application-1');
      expect(await session.accessToken(), 'application-token');
      expect(api.identityTokens, everyElement('identity-token'));
    },
  );
  test(
    'restart restores only the saved account and renewal stays pinned to it',
    () async {
      await session.register();
      api.currentId = 'application-replacement';
      now = DateTime.fromMillisecondsSinceEpoch(4000000);
      await expectLater(
        session.accessToken(),
        throwsA(isA<AppBaseApiException>()),
      );
      expect(api.requestedIds.last, 'application-1');
      expect((await session.account())!.accountId, 'application-1');
      expect(api.registrations, 1);
    },
  );
  test(
    'a pre-lifecycle installation cannot attach old data to a replacement',
    () async {
      api.currentId = 'application-replacement';
      expect(await session.restoreLegacy(), isNull);
      expect(api.requestedIds, isEmpty);
      api.currentId = 'identity-user';
      expect((await session.restoreLegacy())!.accountId, 'identity-user');
    },
  );
  test('deleting identity cannot register before cleanup finishes', () async {
    api.deleting = true;
    await expectLater(
      session.signIn(),
      throwsA(
        isA<AppBaseApiException>().having(
          (e) => e.code,
          'code',
          'ACCOUNT_DELETING',
        ),
      ),
    );
    expect(api.registrations, 0);
    expect(await session.account(), isNull);
  });
  test(
    'parallel refreshes share one exchange and logout clears the binding',
    () async {
      await session.register();
      now = DateTime.fromMillisecondsSinceEpoch(4000000);
      api.gate = Completer<void>();
      final first = session.accessToken();
      final second = session.accessToken();
      await Future<void>.delayed(Duration.zero);
      expect(api.requestedIds.length, 2); // Registration and one renewal.
      api.gate!.complete();
      await Future.wait([first, second]);
      await session.signOut();
      expect(store.value, isNull);
      expect(identity.signedIn, false);
      expect(api.revoked, ['application-token']);
    },
  );
  test('late renewal cannot restore a signed-out account', () async {
    await session.register();
    now = DateTime.fromMillisecondsSinceEpoch(4000000);
    api.gate = Completer<void>();
    final renewal = session.accessToken();
    final rejected = expectLater(renewal, throwsA(isA<AppBaseApiException>()));
    await Future<void>.delayed(Duration.zero);
    await session.signOut();
    api.gate!.complete();
    await rejected;
    expect(store.value, isNull);
  });
}

final class _Identity implements AppBaseSession {
  bool signedIn = true;
  final user = AppBaseAccount(
    issuer: Uri.parse('https://identity.example'),
    subject: 'identity-user',
    deviceId: 'phone',
  );
  @override
  Future<AppBaseAccount?> account() async => signedIn ? user : null;
  @override
  Future<String?> accessToken() async => signedIn ? 'identity-token' : null;
  @override
  Future<AppBaseAccount> signIn() async {
    signedIn = true;
    return user;
  }

  @override
  Future<void> signOut() async {
    signedIn = false;
  }
}

final class _Store implements AppBaseAccountBindingStore {
  Map<String, Object?>? value;
  @override
  Future<Map<String, Object?>?> read() async => value;
  @override
  Future<void> write(Map<String, Object?> v) async {
    value = v;
  }

  @override
  Future<void> clear() async {
    value = null;
  }
}

final class _Api implements AppBaseAccountApi {
  String? currentId;
  bool deleting = false;
  int registrations = 0;
  final requestedIds = <String?>[];
  final identityTokens = <String>[];
  final revoked = <String>[];
  Completer<void>? gate;
  @override
  Future<Map<String, Object?>> accountStatus(String token) async => {
    'status': deleting
        ? 'deleting'
        : currentId == null
        ? 'unregistered'
        : 'active',
    'accountId': currentId,
  };
  @override
  Future<Map<String, Object?>> openAccountSession({
    required String identityToken,
    required String deviceId,
    String? accountId,
    bool register = false,
  }) async {
    identityTokens.add(identityToken);
    requestedIds.add(accountId);
    if (register) {
      registrations++;
      currentId ??= 'application-$registrations';
    }
    if (deleting || (accountId != null && accountId != currentId)) {
      throw const AppBaseApiException(
        kind: AppBaseFailureKind.authorization,
        code: 'ACCOUNT_DELETED',
        message: 'Deleted',
      );
    }
    await gate?.future;
    return {
      'accountId': currentId,
      'accessToken': 'application-token',
      'expiresAt': 2800,
    };
  }

  @override
  Future<void> revokeAccountSession(String token) async {
    revoked.add(token);
  }
}
