import 'package:drift/drift.dart';

final class AppBaseDriftTables {
  const AppBaseDriftTables({
    this.accounts = 'appbase_accounts',
    this.records = 'appbase_records',
    this.outbox = 'appbase_outbox',
    this.checkpoint = 'checkpoint',
  });

  const AppBaseDriftTables.legacySublyra()
    : accounts = 'sync_accounts',
      records = 'sync_records',
      outbox = 'sync_outbox',
      checkpoint = 'cursor';

  final String accounts;
  final String records;
  final String outbox;
  final String checkpoint;

  void validate() {
    for (final name in [accounts, records, outbox, checkpoint]) {
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
      await customStatement('''
        CREATE TABLE IF NOT EXISTS ${tables.accounts} (
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
        CREATE UNIQUE INDEX IF NOT EXISTS ${tables.accounts}_one_active
        ON ${tables.accounts}(active) WHERE active = 1
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
