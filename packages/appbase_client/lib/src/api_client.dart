import 'dart:convert';

import 'package:http/http.dart' as http;

import 'errors.dart';
import 'models.dart';
import 'ports.dart';

final class AppBaseHttpApi implements AppBaseApi {
  AppBaseHttpApi({
    required Uri baseUri,
    http.Client? client,
    this.protocolVersion = appBaseProtocolVersion,
  }) : baseUri = _directoryUri(baseUri),
       _client = client ?? http.Client();

  final Uri baseUri;
  final String protocolVersion;
  final http.Client _client;

  @override
  Future<AppBaseClientConfiguration> configuration() async {
    final json = await _request('GET', 'client-configuration');
    final data = json;
    return AppBaseClientConfiguration(
      protocolVersions: _strings(data['protocolVersions'], 'protocolVersions'),
      issuer: _absoluteUri(data, 'issuer'),
      clientId: _string(data, 'clientId'),
      audience: _absoluteUri(data, 'audience'),
      usesResourceIndicator: _bool(data, 'usesResourceIndicator'),
      acceptsDynamicCollections: _bool(data, 'acceptsDynamicCollections'),
      encryptsAllPayloads: _bool(data, 'encryptsAllPayloads'),
      maxMutationsPerBatch: _int(data, 'maxMutationsPerBatch'),
      maxChangesPerPage: _int(data, 'maxChangesPerPage'),
      maxPayloadBytes: _int(data, 'maxPayloadBytes'),
    );
  }

  @override
  Future<List<AppBaseMutationResult>> push({
    required String accessToken,
    required String batchId,
    required List<AppBasePendingMutation> mutations,
  }) async {
    final json = await _request(
      'PUT',
      'mutation-batches/${Uri.encodeComponent(batchId)}',
      token: accessToken,
      body: {
        'mutations': [for (final mutation in mutations) _mutation(mutation)],
      },
    );
    return [
      for (final item in _array(json['results'], 'results'))
        _result(_object(item, 'result')),
    ];
  }

  @override
  Future<AppBaseChangePage> pull({
    required String accessToken,
    String? pageToken,
    int? pageSize,
  }) async {
    final uri = baseUri
        .resolve('changes')
        .replace(
          queryParameters: {
            'pageToken': ?pageToken,
            if (pageSize != null) 'pageSize': '$pageSize',
          },
        );
    final json = await _requestUri('GET', uri, token: accessToken);
    final pagination = _object(json['pagination'], 'pagination');
    return AppBaseChangePage(
      items: [
        for (final item in _array(json['items'], 'items'))
          _change(_object(item, 'change')),
      ],
      checkpoint: _string(pagination, 'checkpoint'),
      nextPageToken: pagination['nextPageToken'] as String?,
    );
  }

  Future<Map<String, Object?>> _request(
    String method,
    String path, {
    String? token,
    Map<String, Object?>? body,
  }) => _requestUri(method, baseUri.resolve(path), token: token, body: body);

  Future<Map<String, Object?>> _requestUri(
    String method,
    Uri uri, {
    String? token,
    Map<String, Object?>? body,
  }) async {
    try {
      final request = http.Request(method, uri)
        ..headers.addAll({
          'Accept': 'application/json',
          'API-Version': protocolVersion,
          if (token != null) 'Authorization': 'Bearer $token',
          if (body != null) 'Content-Type': 'application/json',
        });
      if (body != null) request.body = jsonEncode(body);
      final streamed = await _client.send(request);
      final response = await http.Response.fromStream(streamed);
      final decoded = response.body.isEmpty
          ? <String, Object?>{}
          : jsonDecode(response.body);
      if (decoded is! Map) {
        throw const AppBaseApiException(
          kind: AppBaseFailureKind.malformedResponse,
          code: 'invalid_response',
          message: 'AppBase returned a non-object JSON response.',
        );
      }
      final json = Map<String, Object?>.from(decoded);
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw _problem(response, json);
      }
      return json;
    } on AppBaseException {
      rethrow;
    } on Object catch (error) {
      throw AppBaseTransportException(
        message: 'AppBase request failed: $error',
      );
    }
  }
}

Uri _directoryUri(Uri uri) {
  if (!uri.isAbsolute) {
    throw ArgumentError.value(uri, 'baseUri', 'must be absolute');
  }
  return uri.path.endsWith('/') ? uri : uri.replace(path: '${uri.path}/');
}

AppBaseApiException _problem(
  http.Response response,
  Map<String, Object?> json,
) {
  final status = response.statusCode;
  final kind = switch (status) {
    401 => AppBaseFailureKind.authentication,
    403 => AppBaseFailureKind.authorization,
    409 => AppBaseFailureKind.conflict,
    422 => AppBaseFailureKind.validation,
    429 => AppBaseFailureKind.rateLimited,
    >= 500 => AppBaseFailureKind.server,
    _ => AppBaseFailureKind.validation,
  };
  final retry = response.headers['retry-after'];
  return AppBaseApiException(
    kind: kind,
    code: json['code'] as String? ?? 'http_$status',
    message: json['detail'] as String? ?? 'AppBase returned HTTP $status.',
    requestId: response.headers['request-id'] ?? json['requestId'] as String?,
    statusCode: status,
    retryAfter: retry == null
        ? null
        : Duration(seconds: int.tryParse(retry) ?? 0),
  );
}

Map<String, Object?> _mutation(AppBasePendingMutation value) => {
  'mutationId': value.mutationId,
  'deviceId': value.deviceId,
  'collection': value.collection,
  'recordId': value.recordId,
  'baseRevision': value.baseRevision,
  'operation': value.operation.name,
  if (value.payload != null) 'payload': value.payload,
};

AppBaseMutationResult _result(Map<String, Object?> json) =>
    AppBaseMutationResult(
      mutationId: _string(json, 'mutationId'),
      change: _change(_object(json['change'], 'change')),
    );

AppBaseRemoteChange _change(Map<String, Object?> json) => AppBaseRemoteChange(
  sequence: _int(json, 'sequence'),
  collection: _string(json, 'collection'),
  recordId: _string(json, 'recordId'),
  revision: _string(json, 'revision'),
  deleted: _bool(json, 'deleted'),
  createdAt: DateTime.parse(_string(json, 'createdAt')).toUtc(),
  payload: json['payload'] == null ? null : _object(json['payload'], 'payload'),
);

Map<String, Object?> _object(Object? value, String field) {
  if (value is Map) return Map<String, Object?>.from(value);
  throw _malformed(field);
}

List<Object?> _array(Object? value, String field) {
  if (value is List) return List<Object?>.from(value);
  throw _malformed(field);
}

List<String> _strings(Object? value, String field) => [
  for (final item in _array(value, field))
    if (item is String) item else throw _malformed(field),
];

String _string(Map<String, Object?> json, String field) {
  final value = json[field];
  if (value is String) return value;
  throw _malformed(field);
}

int _int(Map<String, Object?> json, String field) {
  final value = json[field];
  if (value is int) return value;
  throw _malformed(field);
}

bool _bool(Map<String, Object?> json, String field) {
  final value = json[field];
  if (value is bool) return value;
  throw _malformed(field);
}

Uri _absoluteUri(Map<String, Object?> json, String field) {
  final value = Uri.tryParse(_string(json, field));
  if (value != null && value.isAbsolute) return value;
  throw _malformed(field);
}

AppBaseApiException _malformed(String field) => AppBaseApiException(
  kind: AppBaseFailureKind.malformedResponse,
  code: 'invalid_response',
  message: 'AppBase returned an invalid $field.',
);
