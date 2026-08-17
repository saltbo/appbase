import 'dart:math';

import 'package:appbase_client/appbase_client.dart';
import 'package:appbase_drift/appbase_drift.dart';
import 'package:drift/drift.dart' hide isNull;
import 'package:drift/native.dart';
import 'package:test/test.dart';

void main() {
  late _TestDatabase database;
  late _Session session;
  late _Adapter adapter;
  late AppBaseDriftPersistence persistence;

  setUp(() async {
    database = _TestDatabase();
    await database.customStatement(
      'CREATE TABLE notes (id TEXT PRIMARY KEY, value TEXT NOT NULL)',
    );
    session = _Session(_account());
    adapter = _Adapter(database);
    persistence = AppBaseDriftPersistence(
      database,
      session: session,
      adapters: [adapter],
      random: Random(1),
      clock: () => DateTime.utc(2026, 8, 17),
    );
    await persistence.ensureSchema();
    await persistence.saveAccount(session.value!);
  });

  tearDown(() => database.close());

  test('commits a product write and outbox mutation atomically', () async {
    await persistence.commit(
      const [
        AppBaseMutationDraft(
          collection: 'notes',
          recordId: 'n1',
          operation: AppBaseMutationOperation.put,
          payload: {'value': 'hello'},
        ),
      ],
      () => database.customStatement(
        'INSERT INTO notes (id, value) VALUES (?, ?)',
        ['n1', 'hello'],
      ),
    );

    expect(await _count(database, 'notes'), 1);
    expect(await _count(database, 'appbase_outbox'), 1);
  });

  test('rolls back the product write when enqueue validation fails', () async {
    await expectLater(
      persistence.commit(
        const [
          AppBaseMutationDraft(
            collection: 'unknown',
            recordId: 'n1',
            operation: AppBaseMutationOperation.put,
          ),
        ],
        () => database.customStatement(
          'INSERT INTO notes (id, value) VALUES (?, ?)',
          ['n1', 'hello'],
        ),
      ),
      throwsArgumentError,
    );

    expect(await _count(database, 'notes'), 0);
    expect(await _count(database, 'appbase_outbox'), 0);
  });

  test('rolls back projection and checkpoint when an adapter fails', () async {
    adapter.fail = true;
    final page = AppBaseChangePage(
      checkpoint: 'checkpoint-1',
      items: [
        AppBaseRemoteChange(
          sequence: 1,
          collection: 'notes',
          recordId: 'n1',
          revision: '00000000-0000-4000-8000-000000000001',
          deleted: false,
          createdAt: DateTime.utc(2026, 8, 17),
          payload: const {'value': 'remote'},
        ),
      ],
    );

    await expectLater(
      persistence.applyPull(session.value!, page),
      throwsStateError,
    );

    expect(await _count(database, 'notes'), 0);
    final account = await database
        .customSelect('SELECT checkpoint FROM appbase_accounts')
        .getSingle();
    expect(account.readNullable<String>('checkpoint'), isNull);
  });
}

Future<int> _count(GeneratedDatabase database, String table) async =>
    (await database
            .customSelect('SELECT COUNT(*) AS count FROM $table')
            .getSingle())
        .read<int>('count');

AppBaseAccount _account() => AppBaseAccount(
  issuer: Uri.parse('https://identity.example'),
  subject: 'user-1',
  deviceId: 'device-1',
);

final class _TestDatabase extends GeneratedDatabase {
  _TestDatabase() : super(NativeDatabase.memory());
  @override
  Iterable<TableInfo<Table, Object?>> get allTables => const [];
  @override
  int get schemaVersion => 1;
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

final class _Adapter implements AppBaseCollectionAdapter {
  _Adapter(this.database);
  final GeneratedDatabase database;
  bool fail = false;
  @override
  String get collection => 'notes';
  @override
  Future<void> apply(AppBaseAccount account, AppBaseRemoteChange change) async {
    await database.customStatement(
      'INSERT INTO notes (id, value) VALUES (?, ?)',
      [change.recordId, change.payload!['value']],
    );
    if (fail) throw StateError('projection failed');
  }

  @override
  Future<void> deactivate(AppBaseAccount account) =>
      database.customStatement('DELETE FROM notes');
  @override
  Future<List<AppBaseMutationDraft>> seed(AppBaseAccount account) async =>
      const [];
}
