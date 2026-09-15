import 'package:drift/drift.dart';

final class AppBaseDriftTables {
  const AppBaseDriftTables({
    String? syncState,
    String? accounts,
    this.records = 'appbase_records',
    this.outbox = 'appbase_outbox',
    this.checkpoint = 'checkpoint',
  }) : assert(syncState == null || accounts == null),
       syncState = syncState ?? accounts ?? 'appbase_sync_state';

  const AppBaseDriftTables.legacySublyra()
    : syncState = 'sync_accounts',
      records = 'sync_records',
      outbox = 'sync_outbox',
      checkpoint = 'cursor';

  /// Per-identity synchronization state on this installation, not an account registry.
  final String syncState;

  /// Compatibility alias for hosts that supplied a table name before 0.2.1.
  String get accounts => syncState;
  final String records;
  final String outbox;
  final String checkpoint;

  void validate() {
    for (final name in [syncState, records, outbox, checkpoint]) {
      if (!RegExp(r'^[a-z][a-z0-9_]*$').hasMatch(name)) {
        throw ArgumentError.value(name, 'table name', 'is not a safe SQL name');
      }
    }
  }
}

extension AppBaseDriftSchema on GeneratedDatabase {
  Future<void> createAppBaseSchema({
    AppBaseDriftTables tables = const AppBaseDriftTables(),
  }) async {
    tables.validate();
    await transaction(() async {
      if (tables.syncState == 'appbase_sync_state') {
        final existing = await customSelect(
          "SELECT name FROM sqlite_master WHERE type = 'table' "
          "AND name IN ('appbase_accounts', 'appbase_sync_state')",
        ).get();
        final names = existing.map((row) => row.read<String>('name')).toSet();
        if (names.contains('appbase_accounts')) {
          if (names.contains('appbase_sync_state')) {
            throw StateError(
              'Both legacy and current AppBase sync state exist.',
            );
          }
          await customStatement(
            'ALTER TABLE appbase_accounts RENAME TO appbase_sync_state',
          );
          await customStatement(
            'DROP INDEX IF EXISTS appbase_accounts_one_active',
          );
        }
      }
      await customStatement('''
        CREATE TABLE IF NOT EXISTS ${tables.syncState} (
          issuer TEXT NOT NULL,
          subject TEXT NOT NULL,
          device_id TEXT NOT NULL,
          ${tables.checkpoint} TEXT,
          status TEXT NOT NULL DEFAULT 'active',
          active INTEGER NOT NULL DEFAULT 0,
          last_synced_at INTEGER,
          PRIMARY KEY (issuer, subject)
        )
      ''');
      await customStatement('''
        CREATE UNIQUE INDEX IF NOT EXISTS ${tables.syncState}_one_active
        ON ${tables.syncState}(active) WHERE active = 1
      ''');
      await customStatement('''
        CREATE TABLE IF NOT EXISTS ${tables.records} (
          issuer TEXT NOT NULL,
          subject TEXT NOT NULL,
          collection TEXT NOT NULL,
          record_id TEXT NOT NULL,
          revision TEXT NOT NULL,
          deleted INTEGER NOT NULL,
          change_sequence INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (issuer, subject, collection, record_id)
        )
      ''');
      await customStatement('''
        CREATE TABLE IF NOT EXISTS ${tables.outbox} (
          mutation_id TEXT PRIMARY KEY NOT NULL,
          issuer TEXT NOT NULL,
          subject TEXT NOT NULL,
          device_id TEXT NOT NULL,
          collection TEXT NOT NULL,
          record_id TEXT NOT NULL,
          base_revision TEXT,
          operation TEXT NOT NULL CHECK (operation IN ('put', 'delete')),
          payload_json TEXT,
          created_at INTEGER NOT NULL,
          attempt_count INTEGER NOT NULL DEFAULT 0
        )
      ''');
      await customStatement('''
        CREATE INDEX IF NOT EXISTS ${tables.outbox}_account_created
        ON ${tables.outbox}(issuer, subject, created_at)
      ''');
      await customStatement('''
        CREATE INDEX IF NOT EXISTS ${tables.outbox}_record
        ON ${tables.outbox}(issuer, subject, collection, record_id)
      ''');
    });
  }
}
