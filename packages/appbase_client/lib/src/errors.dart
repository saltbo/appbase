enum AppBaseFailureKind {
  authentication,
  authorization,
  conflict,
  validation,
  incompatibleProtocol,
  rateLimited,
  transport,
  server,
  malformedResponse,
}

sealed class AppBaseException implements Exception {
  const AppBaseException({
    required this.kind,
    required this.code,
    required this.message,
    this.requestId,
    this.statusCode,
    this.retryAfter,
  });

  final AppBaseFailureKind kind;
  final String code;
  final String message;
  final String? requestId;
  final int? statusCode;
  final Duration? retryAfter;

  bool get isRetryable => switch (kind) {
    AppBaseFailureKind.transport ||
    AppBaseFailureKind.server ||
    AppBaseFailureKind.rateLimited ||
    AppBaseFailureKind.conflict => true,
    _ => false,
  };

  @override
  String toString() => 'AppBaseException($code): $message';
}

final class AppBaseProtocolException extends AppBaseException {
  const AppBaseProtocolException({
    required super.code,
    required super.message,
    super.requestId,
  }) : super(kind: AppBaseFailureKind.incompatibleProtocol);
}

final class AppBaseApiException extends AppBaseException {
  const AppBaseApiException({
    required super.kind,
    required super.code,
    required super.message,
    super.requestId,
    super.statusCode,
    super.retryAfter,
  });
}

final class AppBaseTransportException extends AppBaseException {
  const AppBaseTransportException({required super.message})
    : super(kind: AppBaseFailureKind.transport, code: 'transport_failure');
}

final class AppBaseLocalException extends AppBaseException {
  const AppBaseLocalException({required super.message})
    : super(kind: AppBaseFailureKind.transport, code: 'local_failure');
}
