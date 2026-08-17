import 'dart:collection';

import 'errors.dart';

const appBaseProtocolVersion = '2026-08-17';
const _notProvided = Object();

final class AppBaseClientConfiguration {
  const AppBaseClientConfiguration({
    required this.protocolVersions,
    required this.issuer,
    required this.clientId,
    required this.audience,
    required this.usesResourceIndicator,
    required this.acceptsDynamicCollections,
    required this.encryptsAllPayloads,
    required this.maxMutationsPerBatch,
    required this.maxChangesPerPage,
    required this.maxPayloadBytes,
  });

  final List<String> protocolVersions;
  final Uri issuer;
  final String clientId;
  final Uri audience;
  final bool usesResourceIndicator;
  final bool acceptsDynamicCollections;
  final bool encryptsAllPayloads;
  final int maxMutationsPerBatch;
  final int maxChangesPerPage;
  final int maxPayloadBytes;

  void requireCompatible(String version) {
    if (!protocolVersions.contains(version)) {
      throw AppBaseProtocolException(
        code: 'unsupported_protocol_version',
        message: 'Server does not support AppBase protocol $version.',
      );
    }
  }
}

final class AppBaseAccount {
  const AppBaseAccount({
    required this.issuer,
    required this.subject,
    required this.deviceId,
    this.checkpoint,
    this.displayName,
    this.email,
    this.avatarUri,
  });

  final Uri issuer;
  final String subject;
  final String deviceId;
  final String? checkpoint;
  final String? displayName;
  final String? email;
  final Uri? avatarUri;

  AppBaseAccount copyWith({Object? checkpoint = _notProvided}) =>
      AppBaseAccount(
        issuer: issuer,
        subject: subject,
        deviceId: deviceId,
        checkpoint: identical(checkpoint, _notProvided)
            ? this.checkpoint
            : checkpoint as String?,
        displayName: displayName,
        email: email,
        avatarUri: avatarUri,
      );
}

enum AppBaseMutationOperation { put, delete }

final class AppBasePendingMutation {
  AppBasePendingMutation({
    required this.mutationId,
    required this.deviceId,
    required this.collection,
    required this.recordId,
    required this.operation,
    required Map<String, Object?>? payload,
    this.baseRevision,
  }) : payload = payload == null
           ? null
           : UnmodifiableMapView(Map<String, Object?>.from(payload));

  final String mutationId;
  final String deviceId;
  final String collection;
  final String recordId;
  final String? baseRevision;
  final AppBaseMutationOperation operation;
  final Map<String, Object?>? payload;
}

final class AppBaseRemoteChange {
  AppBaseRemoteChange({
    required this.sequence,
    required this.collection,
    required this.recordId,
    required this.revision,
    required this.deleted,
    required this.createdAt,
    required Map<String, Object?>? payload,
  }) : payload = payload == null
           ? null
           : UnmodifiableMapView(Map<String, Object?>.from(payload));

  final int sequence;
  final String collection;
  final String recordId;
  final String revision;
  final bool deleted;
  final DateTime createdAt;
  final Map<String, Object?>? payload;
}

final class AppBaseMutationResult {
  const AppBaseMutationResult({required this.mutationId, required this.change});

  final String mutationId;
  final AppBaseRemoteChange change;
}

final class AppBaseChangePage {
  const AppBaseChangePage({
    required this.items,
    required this.checkpoint,
    this.nextPageToken,
  });

  final List<AppBaseRemoteChange> items;
  final String checkpoint;
  final String? nextPageToken;
}

final class AppBaseMutationDraft {
  const AppBaseMutationDraft({
    required this.collection,
    required this.recordId,
    required this.operation,
    this.payload,
  });

  final String collection;
  final String recordId;
  final AppBaseMutationOperation operation;
  final Map<String, Object?>? payload;
}

enum AppBaseSyncPhase { idle, syncing, failed }

final class AppBaseSyncState {
  const AppBaseSyncState({required this.phase, this.account, this.error});

  const AppBaseSyncState.idle({this.account})
    : phase = AppBaseSyncPhase.idle,
      error = null;

  final AppBaseSyncPhase phase;
  final AppBaseAccount? account;
  final AppBaseException? error;
}
