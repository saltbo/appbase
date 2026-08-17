import 'dart:convert';
import 'dart:math';

import 'package:appbase_client/appbase_client.dart';
import 'package:drift/drift.dart';

import 'drift_schema.dart';

typedef AppBaseClock = DateTime Function();

final class AppBaseDriftPersistence
    implements AppBasePersistence, AppBaseMutationSink {
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

  Future<void> ensureSchema() => database.createAppBaseSchema(tables: tables);

  @override
  Future<AppBaseAccount> saveAccount(AppBaseAccount account) async {
    final existing = await _account(account);
    final active = await database
        .customSelect(
          'SELECT issuer, subject FROM ${tables.accounts} WHERE active = 1',
        )
        .getSingleOrNull();
    final switches =
        active != null &&
        (active.read<String>('issuer') != account.issuer.toString() ||
            active.read<String>('subject') != account.subject);
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
      await database.customUpdate('UPDATE ${tables.accounts} SET active = 0');
      await database.customStatement(
        '''
        INSERT INTO ${tables.accounts}
          (issuer, subject, device_id, ${tables.checkpoint}, status, active, last_synced_at)
        VALUES (?, ?, ?, ?, ?, 1, ?)
        ON CONFLICT(issuer, subject) DO UPDATE SET
          device_id = excluded.device_id,
          ${tables.checkpoint} = excluded.${tables.checkpoint},
          active = 1
        ''',
        [
          saved.issuer.toString(),
          saved.subject,
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
        'UPDATE ${tables.accounts} SET status = ? WHERE issuer = ? AND subject = ?',
        variables: [
          const Variable<String>('seeded'),
          Variable<String>(account.issuer.toString()),
          Variable<String>(account.subject),
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
            Variable<String>(account.subject),
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
          Variable<String>(account.subject),
        ],
      );
    }
  });

  @override
  Future<AppBaseAccount> applyPull(
    AppBaseAccount account,
    AppBaseChangePage page,
  ) async {
    await database.transaction(() async {
      for (final change in page.items) {
        final adapter = _adapters[change.collection];
        if (adapter == null) {
          throw AppBaseApiException(
            kind: AppBaseFailureKind.validation,
            code: 'unknown_collection',
            message:
                'No client adapter is registered for ${change.collection}.',
          );
        }
        await adapter.apply(account, change);
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
            account.subject,
            change.collection,
            change.recordId,
            change.revision,
            change.deleted ? 1 : 0,
            change.sequence,
            change.createdAt.millisecondsSinceEpoch,
          ],
        );
      }
      await database.customUpdate(
        '''
        UPDATE ${tables.accounts}
        SET ${tables.checkpoint} = ?, last_synced_at = ?
        WHERE issuer = ? AND subject = ?
        ''',
        variables: [
          Variable<String>(page.checkpoint),
          Variable<int>(_clock().millisecondsSinceEpoch),
          Variable<String>(account.issuer.toString()),
          Variable<String>(account.subject),
        ],
      );
    });
    return account.copyWith(checkpoint: page.checkpoint);
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
          Variable<String>(account.subject),
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
            Variable<String>(account.subject),
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
            Variable<String>(account.subject),
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
        _id(),
        account.issuer.toString(),
        account.subject,
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

  Future<Map<String, Object?>?> _account(AppBaseAccount account) async {
    final row = await database
        .customSelect(
          'SELECT ${tables.checkpoint}, status, last_synced_at FROM ${tables.accounts} WHERE issuer = ? AND subject = ?',
          variables: [
            Variable<String>(account.issuer.toString()),
            Variable<String>(account.subject),
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
