import 'dart:convert';
import 'dart:math';

import 'package:appbase_client/appbase_client.dart';
import 'package:drift/drift.dart';

import 'drift_schema.dart';

typedef AppBaseClock = DateTime Function();

final class AppBaseDriftPersistence
    implements
        AppBasePersistence,
        AppBaseMutationSink,
        AppBaseAccountDeletionPersistence {
  AppBaseDriftPersistence(
    this.database, {
    required AppBaseSession session,
    Iterable<AppBaseCollectionAdapter> adapters = const [],
    this.tables = const AppBaseDriftTables(),
    AppBaseClock? clock,
    Random? random,
    this.onMutationQueued,
  }) : _session = session,
       _adapters = {
         for (final adapter in adapters) adapter.collection: adapter,
       },
       _clock = clock ?? _utcNow,
       _random = random ?? Random.secure() {
    tables.validate();
    if (_adapters.length != adapters.length) {
      throw ArgumentError('AppBase collection names must be unique.');
    }
  }

  final GeneratedDatabase database;
  final AppBaseSession _session;
  final Map<String, AppBaseCollectionAdapter> _adapters;
  final AppBaseDriftTables tables;
  final AppBaseClock _clock;
  final Random _random;
  final void Function()? onMutationQueued;
  final Set<(Uri, String)> _deletedAccounts = {};

  Future<void> ensureSchema() => database.createAppBaseSchema(tables: tables);

  @override
  Future<void> deleteAccount(AppBaseAccount account) async {
    _deletedAccounts.add((account.issuer, account.storageKey));
    await _clearLocalAccount(account, deletion: true);
  }

  /// Clear an installation's account data without declaring the remote account deleted.
  Future<void> resetLocalAccount(AppBaseAccount account) =>
      _clearLocalAccount(account, deletion: false);

  Future<void> _clearLocalAccount(
    AppBaseAccount account, {
    required bool deletion,
  }) async {
    await _ensureAuxiliarySchema();
    for (final adapter in _adapters.values) {
      if (adapter is AppBaseCollectionDeletionAdapter) {
        await (adapter as AppBaseCollectionDeletionAdapter).deleteAccount(
          account,
        );
      } else {
        await adapter.deactivate(account);
      }
    }
    await database.transaction(() async {
      for (final table in [
        tables.outbox,
        tables.records,
        tables.syncState,
        if (deletion) tables.mutationClock,
        tables.deferredProjections,
      ]) {
        await database.customStatement(
          'DELETE FROM $table WHERE issuer = ? AND subject = ?',
          [account.issuer.toString(), account.storageKey],
        );
      }
    });
  }

  @override
  Future<AppBaseAccount> saveAccount(AppBaseAccount account) async {
    await _ensureAuxiliarySchema();
    final existing = await _account(account);
    final active = await database
        .customSelect(
          'SELECT issuer, subject FROM ${tables.syncState} WHERE active = 1',
        )
        .getSingleOrNull();
    final switches =
        active != null &&
        (active.read<String>('issuer') != account.issuer.toString() ||
            active.read<String>('subject') != account.storageKey);
    if (switches) {
      final old = AppBaseAccount(
        issuer: Uri.parse(active.read<String>('issuer')),
        subject: active.read<String>('subject'),
        deviceId: '',
      );
      await database.transaction(() async {
        for (final adapter in _adapters.values) {
          await adapter.deactivate(old);
        }
      });
    }
    final saved = account.copyWith(
      checkpoint: switches ? null : existing?[tables.checkpoint] as String?,
    );
    await database.transaction(() async {
      await database.customUpdate('UPDATE ${tables.syncState} SET active = 0');
      await database.customStatement(
        '''
        INSERT INTO ${tables.syncState}
          (issuer, subject, device_id, ${tables.checkpoint}, status, active, last_synced_at)
        VALUES (?, ?, ?, ?, ?, 1, ?)
        ON CONFLICT(issuer, subject) DO UPDATE SET
          device_id = excluded.device_id,
          ${tables.checkpoint} = excluded.${tables.checkpoint},
          active = 1
        ''',
        [
          saved.issuer.toString(),
          saved.storageKey,
          saved.deviceId,
          saved.checkpoint,
          existing?['status'] ?? 'active',
          existing?['last_synced_at'],
        ],
      );
    });
    return saved;
  }

  @override
  Future<void> seedIfNeeded(AppBaseAccount account) async {
    final row = await _account(account);
    if (row?['status'] == 'seeded') return;
    final drafts = <AppBaseMutationDraft>[];
    for (final adapter in _adapters.values) {
      drafts.addAll(await adapter.seed(account));
    }
    await database.transaction(() async {
      for (final draft in drafts) {
        await _enqueue(account, draft);
      }
      await database.customUpdate(
        'UPDATE ${tables.syncState} SET status = ? WHERE issuer = ? AND subject = ?',
        variables: [
          const Variable<String>('seeded'),
          Variable<String>(account.issuer.toString()),
          Variable<String>(account.storageKey),
        ],
      );
    });
  }

  @override
  Future<List<AppBasePendingMutation>> loadPending(
    AppBaseAccount account, {
    required int limit,
  }) async {
    if (limit < 1) {
      throw ArgumentError.value(limit, 'limit', 'must be positive');
    }
    final rows = await database
        .customSelect(
          '''
      SELECT mutation_id, device_id, collection, record_id, base_revision,
             operation, payload_json
      FROM ${tables.outbox}
      WHERE issuer = ? AND subject = ?
      ORDER BY created_at, mutation_id
      LIMIT ?
      ''',
          variables: [
            Variable<String>(account.issuer.toString()),
            Variable<String>(account.storageKey),
            Variable<int>(limit),
          ],
        )
        .get();
    return [
      for (final row in rows)
        AppBasePendingMutation(
          mutationId: row.read('mutation_id'),
          deviceId: row.read('device_id'),
          collection: row.read('collection'),
          recordId: row.read('record_id'),
          baseRevision: row.readNullable('base_revision'),
          operation: AppBaseMutationOperation.values.byName(
            row.read('operation'),
          ),
          payload: _decodePayload(row.readNullable('payload_json')),
        ),
    ];
  }

  @override
  Future<void> acknowledge(
    AppBaseAccount account,
    List<AppBaseMutationResult> results,
  ) => database.transaction(() async {
    for (final result in results) {
      await database.customUpdate(
        'DELETE FROM ${tables.outbox} WHERE mutation_id = ? AND issuer = ? AND subject = ?',
        variables: [
          Variable<String>(result.mutationId),
          Variable<String>(account.issuer.toString()),
          Variable<String>(account.storageKey),
        ],
      );
      await _applyChange(account, result.change);
    }
    await _drainDeferred(account);
  });

  @override
  Future<AppBaseAccount> applyPull(
    AppBaseAccount account,
    AppBaseChangePage page,
  ) async {
    await database.transaction(() async {
      for (final change in page.items) {
        await _applyChange(account, change);
      }
      await _drainDeferred(account);
      if (page.nextPageToken == null && await _hasDeferred(account)) {
        throw const AppBaseLocalException(
          message: 'Remote records reference missing parent records.',
        );
      }
      await database.customUpdate(
        '''
        UPDATE ${tables.syncState}
        SET ${tables.checkpoint} = ?, last_synced_at = ?
        WHERE issuer = ? AND subject = ?
        ''',
        variables: [
          Variable<String>(page.checkpoint),
          Variable<int>(_clock().millisecondsSinceEpoch),
          Variable<String>(account.issuer.toString()),
          Variable<String>(account.storageKey),
        ],
      );
    });
    return account.copyWith(checkpoint: page.checkpoint);
  }

  Future<bool> _applyChange(
    AppBaseAccount account,
    AppBaseRemoteChange change,
  ) async {
    final previous = await database
        .customSelect(
          'SELECT change_sequence FROM ${tables.records} WHERE issuer = ? AND subject = ? AND collection = ? AND record_id = ?',
          variables: [
            Variable<String>(account.issuer.toString()),
            Variable<String>(account.storageKey),
            Variable<String>(change.collection),
            Variable<String>(change.recordId),
          ],
        )
        .getSingleOrNull();
    if (previous != null &&
        previous.read<int>('change_sequence') > change.sequence) {
      await _clearDeferred(
        account,
        change,
        previous.read<int>('change_sequence'),
      );
      return true;
    }
    final adapter = _adapters[change.collection];
    if (adapter == null) {
      throw AppBaseApiException(
        kind: AppBaseFailureKind.validation,
        code: 'unknown_collection',
        message: 'No client adapter is registered for ${change.collection}.',
      );
    }
    final pending = await database
        .customSelect(
          'SELECT mutation_id FROM ${tables.outbox} WHERE issuer = ? AND subject = ? AND collection = ? AND record_id = ? LIMIT 1',
          variables: [
            Variable<String>(account.issuer.toString()),
            Variable<String>(account.storageKey),
            Variable<String>(change.collection),
            Variable<String>(change.recordId),
          ],
        )
        .getSingleOrNull();
    var deferred = false;
    if (pending == null) {
      if (adapter is AppBaseProjectionReadiness &&
          !await (adapter as AppBaseProjectionReadiness).readyForProjection(
            account,
            change,
          )) {
        deferred = true;
        await database.customStatement(
          '''INSERT INTO ${tables.deferredProjections} (issuer,subject,collection,record_id,change_sequence,change_json)
          VALUES (?,?,?,?,?,?) ON CONFLICT(issuer,subject,collection,record_id) DO UPDATE SET change_sequence=excluded.change_sequence,change_json=excluded.change_json
          WHERE change_sequence<=excluded.change_sequence''',
          [
            account.issuer.toString(),
            account.storageKey,
            change.collection,
            change.recordId,
            change.sequence,
            jsonEncode({
              'sequence': change.sequence,
              'collection': change.collection,
              'recordId': change.recordId,
              'revision': change.revision,
              'deleted': change.deleted,
              'createdAt': change.createdAt.toIso8601String(),
              'payload': change.payload,
            }),
          ],
        );
      } else {
        await adapter.apply(account, change);
      }
    }
    if (!deferred) {
      await _clearDeferred(account, change, change.sequence);
    }
    await database.customStatement(
      '''
          INSERT INTO ${tables.records}
            (issuer, subject, collection, record_id, revision, deleted,
             change_sequence, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(issuer, subject, collection, record_id) DO UPDATE SET
            revision = excluded.revision,
            deleted = excluded.deleted,
            change_sequence = excluded.change_sequence,
            updated_at = excluded.updated_at
          ''',
      [
        account.issuer.toString(),
        account.storageKey,
        change.collection,
        change.recordId,
        change.revision,
        change.deleted ? 1 : 0,
        change.sequence,
        change.createdAt.millisecondsSinceEpoch,
      ],
    );
    return !deferred;
  }

  Future<void> _clearDeferred(
    AppBaseAccount account,
    AppBaseRemoteChange change,
    int sequence,
  ) => database.customStatement(
    'DELETE FROM ${tables.deferredProjections} WHERE issuer=? AND subject=? AND collection=? AND record_id=? AND change_sequence<=?',
    [
      account.issuer.toString(),
      account.storageKey,
      change.collection,
      change.recordId,
      sequence,
    ],
  );

  Future<bool> _hasDeferred(AppBaseAccount account) async =>
      (await database
          .customSelect(
            'SELECT 1 FROM ${tables.deferredProjections} WHERE issuer=? AND subject=? LIMIT 1',
            variables: [
              Variable<String>(account.issuer.toString()),
              Variable<String>(account.storageKey),
            ],
          )
          .getSingleOrNull()) !=
      null;

  Future<void> _drainDeferred(AppBaseAccount account) async {
    while (true) {
      final rows = await database
          .customSelect(
            'SELECT change_json FROM ${tables.deferredProjections} WHERE issuer=? AND subject=? ORDER BY change_sequence',
            variables: [
              Variable<String>(account.issuer.toString()),
              Variable<String>(account.storageKey),
            ],
          )
          .get();
      var progressed = false;
      for (final row in rows) {
        final value =
            jsonDecode(row.read<String>('change_json')) as Map<String, dynamic>;
        final change = AppBaseRemoteChange(
          sequence: value['sequence'] as int,
          collection: value['collection'] as String,
          recordId: value['recordId'] as String,
          revision: value['revision'] as String,
          deleted: value['deleted'] as bool,
          createdAt: DateTime.parse(value['createdAt'] as String),
          payload: (value['payload'] as Map?)?.cast<String, Object?>(),
        );
        if (await _applyChange(account, change)) {
          progressed = true;
        }
      }
      if (!progressed) {
        return;
      }
    }
  }

  @override
  Future<void> recordFailure(
    AppBaseAccount account,
    AppBaseException error,
  ) async {
    await database.transaction(() async {
      await database.customUpdate(
        'UPDATE ${tables.outbox} SET attempt_count = attempt_count + 1 WHERE issuer = ? AND subject = ?',
        variables: [
          Variable<String>(account.issuer.toString()),
          Variable<String>(account.storageKey),
        ],
      );
    });
  }

  @override
  Future<void> commit(
    List<AppBaseMutationDraft> mutations,
    Future<void> Function() localWrite,
  ) async {
    final account = await _session.account();
    if (account == null) {
      await localWrite();
      return;
    }
    await database.transaction(() async {
      // A callback may have captured the old session before deletion/sign-out.
      if (_deletedAccounts.contains((account.issuer, account.storageKey))) {
        throw const AppBaseLocalException(
          message: 'The application account was deleted.',
        );
      }
      await localWrite();
      for (final mutation in mutations) {
        if (!_adapters.containsKey(mutation.collection)) {
          throw ArgumentError(
            'No adapter is registered for ${mutation.collection}.',
          );
        }
        await _enqueue(account, mutation);
      }
    });
    onMutationQueued?.call();
  }

  Future<void> _enqueue(
    AppBaseAccount account,
    AppBaseMutationDraft mutation,
  ) async {
    final existing = await database
        .customSelect(
          '''
      SELECT mutation_id, base_revision FROM ${tables.outbox}
      WHERE issuer = ? AND subject = ? AND collection = ? AND record_id = ?
      ORDER BY created_at DESC LIMIT 1
      ''',
          variables: [
            Variable<String>(account.issuer.toString()),
            Variable<String>(account.storageKey),
            Variable<String>(mutation.collection),
            Variable<String>(mutation.recordId),
          ],
        )
        .getSingleOrNull();
    final synced = await database
        .customSelect(
          '''
      SELECT revision FROM ${tables.records}
      WHERE issuer = ? AND subject = ? AND collection = ? AND record_id = ?
      ''',
          variables: [
            Variable<String>(account.issuer.toString()),
            Variable<String>(account.storageKey),
            Variable<String>(mutation.collection),
            Variable<String>(mutation.recordId),
          ],
        )
        .getSingleOrNull();
    if (existing != null) {
      await database.customUpdate(
        'DELETE FROM ${tables.outbox} WHERE mutation_id = ?',
        variables: [Variable<String>(existing.read('mutation_id'))],
      );
    }
    await database.customStatement(
      '''
      INSERT INTO ${tables.outbox}
        (mutation_id, issuer, subject, device_id, collection, record_id,
         base_revision, operation, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ''',
      [
        await _orderedMutationId(account),
        account.issuer.toString(),
        account.storageKey,
        account.deviceId,
        mutation.collection,
        mutation.recordId,
        existing?.readNullable<String>('base_revision') ??
            synced?.readNullable<String>('revision'),
        mutation.operation.name,
        mutation.payload == null ? null : jsonEncode(mutation.payload),
        _clock().millisecondsSinceEpoch,
      ],
    );
  }

  Future<void> _ensureAuxiliarySchema() async {
    await database.customStatement('''
      CREATE TABLE IF NOT EXISTS ${tables.mutationClock} (
        issuer TEXT NOT NULL, subject TEXT NOT NULL, device_id TEXT NOT NULL,
        value INTEGER NOT NULL, PRIMARY KEY (issuer, subject, device_id)
      )
    ''');
    await database.customStatement('''
      CREATE TABLE IF NOT EXISTS ${tables.deferredProjections} (
        issuer TEXT NOT NULL, subject TEXT NOT NULL, collection TEXT NOT NULL,
        record_id TEXT NOT NULL, change_sequence INTEGER NOT NULL, change_json TEXT NOT NULL,
        PRIMARY KEY (issuer,subject,collection,record_id)
      )
    ''');
  }

  Future<String> _orderedMutationId(AppBaseAccount account) async {
    await _ensureAuxiliarySchema();
    final row = await database
        .customSelect(
          '''INSERT INTO ${tables.mutationClock} (issuer, subject, device_id, value)
      VALUES (?, ?, ?, ?) ON CONFLICT(issuer,subject,device_id)
      DO UPDATE SET value = MAX(excluded.value, value + 1) RETURNING value''',
          variables: [
            Variable<String>(account.issuer.toString()),
            Variable<String>(account.storageKey),
            Variable<String>(account.deviceId),
            Variable<int>(_clock().microsecondsSinceEpoch),
          ],
        )
        .getSingle();
    return 's1:${row.read<int>('value')}:${_id()}';
  }

  Future<Map<String, Object?>?> _account(AppBaseAccount account) async {
    final row = await database
        .customSelect(
          'SELECT ${tables.checkpoint}, status, last_synced_at FROM ${tables.syncState} WHERE issuer = ? AND subject = ?',
          variables: [
            Variable<String>(account.issuer.toString()),
            Variable<String>(account.storageKey),
          ],
        )
        .getSingleOrNull();
    return row?.data;
  }

  String _id() {
    final bytes = List<int>.generate(18, (_) => _random.nextInt(256));
    return base64Url.encode(bytes).replaceAll('=', '');
  }
}

DateTime _utcNow() => DateTime.now().toUtc();

Map<String, Object?>? _decodePayload(String? value) =>
    value == null ? null : Map<String, Object?>.from(jsonDecode(value) as Map);
