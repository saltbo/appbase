import 'dart:async';

import 'package:appbase_client/appbase_client.dart';
import 'package:http/http.dart' as http;
import 'package:oidc/oidc.dart';

/// Bounds machine work around the library's native browser authorization.
/// Uses OIDC's existing HTTP injection and lifecycle; no alternate transport.
class AppBaseOidcManager extends OidcUserManager {
  AppBaseOidcManager({
    required super.discoveryDocumentUri,
    required super.clientCredentials,
    required super.store,
    required super.settings,
    super.id,
    this.networkTimeout = const Duration(seconds: 20),
    this.providerLogoutInBackground = false,
  }) : super.lazy(httpClient: http.Client());

  final Duration networkTimeout;
  final bool providerLogoutInBackground;
  Future<void>? _initializing;
  Future<void>? _disposing;
  Future<void>? _restoring;
  final _deadlineKey = Object();

  @override
  Future<void> init() => _initializing ??= _bounded(super.init);

  @override
  Future<void> loadCachedTokens({bool forceRebuild = false}) {
    final run = _bounded(
      () => super.loadCachedTokens(forceRebuild: forceRebuild),
    );
    _restoring = run;
    return run.whenComplete(() {
      if (identical(_restoring, run)) _restoring = null;
    });
  }

  @override
  bool handleOfflineEligibleFailure({
    required Object error,
    required OidcToken? fallbackToken,
    bool scheduleRetry = false,
    void Function(Duration retryDelay)? onRetryScheduled,
    bool emitRepeatFailureWarning = false,
  }) {
    // Startup may retain a previously verified identity while offline. Actual
    // API requests must still surface the refresh error, never use stale tokens.
    if (_restoring == null) return false;
    return super.handleOfflineEligibleFailure(
      error: error,
      fallbackToken: fallbackToken,
      scheduleRetry: scheduleRetry,
      onRetryScheduled: onRetryScheduled,
      emitRepeatFailureWarning: emitRepeatFailureWarning,
    );
  }

  @override
  Future<OidcUser?> handleSuccessfulAuthResponse({
    required OidcAuthorizeResponse response,
    required String grantType,
    required OidcProviderMetadata metadata,
  }) => _bounded(
    () => super.handleSuccessfulAuthResponse(
      response: response,
      grantType: grantType,
      metadata: metadata,
    ),
  );

  @override
  Future<OidcEndSessionResponse?> getEndSessionResponse(
    OidcProviderMetadata metadata,
    OidcEndSessionRequest request,
    OidcPlatformSpecificOptions options,
    Map<String, dynamic> preparationResult,
  ) async {
    if (providerLogoutInBackground) {
      return _endSessionOverHttp(metadata, request);
    }
    final response = await super.getEndSessionResponse(
      metadata,
      request,
      options,
      preparationResult,
    );
    // OIDC treats a closed browser as local logout. Explicit provider logout
    // must instead prove that the registered callback completed this request.
    if (response == null) {
      throw const AppBaseApiException(
        kind: AppBaseFailureKind.authentication,
        code: 'sign_out_cancelled',
        message: 'Provider sign-out was cancelled.',
      );
    }
    if (request.state == null || response.state != request.state) {
      throw const AppBaseApiException(
        kind: AppBaseFailureKind.authentication,
        code: 'invalid_logout_response',
        message: 'Provider sign-out returned an invalid state.',
      );
    }
    return response;
  }

  Future<OidcEndSessionResponse> _endSessionOverHttp(
    OidcProviderMetadata metadata,
    OidcEndSessionRequest request,
  ) => _bounded(() async {
    final endpoint = metadata.endSessionEndpoint;
    final idToken = request.idTokenHint;
    if (endpoint == null || idToken == null || idToken.isEmpty) {
      throw const AppBaseApiException(
        kind: AppBaseFailureKind.authentication,
        code: 'provider_logout_unavailable',
        message:
            'Provider logout requires an end-session endpoint and ID token.',
      );
    }
    // This is an authenticated machine request, not a browser redirect flow.
    // Never follow redirects or forward the ID token to another destination.
    final uri = OidcEndSessionRequest(
      idTokenHint: idToken,
      clientId: request.clientId,
    ).generateUri(endpoint);
    try {
      final response = await httpClient!.send(
        http.Request('GET', uri)..followRedirects = false,
      );
      await response.stream.drain<void>();
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw AppBaseApiException(
          kind: AppBaseFailureKind.authentication,
          code: 'provider_logout_failed',
          message: 'Provider logout failed (HTTP ${response.statusCode}).',
          statusCode: response.statusCode,
        );
      }
    } on http.ClientException catch (_, stack) {
      // ClientException includes its URL, which contains the ID-token hint.
      Error.throwWithStackTrace(
        const AppBaseTransportException(
          message: 'Provider logout network request failed.',
        ),
        stack,
      );
    }
    // Complete the library's pending state only after the HTTP response succeeds.
    return OidcEndSessionResponse.fromJson({'state': request.state});
  });

  Future<OidcUser?>? _refresh;

  @override
  Future<OidcUser?> refreshToken({
    String? overrideRefreshToken,
    OidcProviderMetadata? discoveryDocumentOverride,
    Map<String, dynamic>? extraBodyFields,
  }) {
    final active = _refresh;
    if (active != null) return active;
    final run = _exchange(
      overrideRefreshToken: overrideRefreshToken,
      discoveryDocumentOverride: discoveryDocumentOverride,
      extraBodyFields: extraBodyFields,
    );
    _refresh = run;
    return run.whenComplete(() {
      if (identical(_refresh, run)) _refresh = null;
    });
  }

  Future<OidcUser?> _exchange({
    String? overrideRefreshToken,
    OidcProviderMetadata? discoveryDocumentOverride,
    Map<String, dynamic>? extraBodyFields,
  }) async {
    await _restoring;
    try {
      final user = await _bounded(
        () => super.refreshToken(
          overrideRefreshToken: overrideRefreshToken,
          discoveryDocumentOverride: discoveryDocumentOverride,
          extraBodyFields: extraBodyFields,
        ),
      );
      if (user == null) {
        final current = currentUser;
        // A provider without refresh grants may still have a valid access token.
        // Sign out at expiry, not at the proactive refresh threshold.
        if (current?.token.accessToken != null &&
            !current!.token.isAccessTokenExpired()) {
          return current;
        }
      }
      if (user == null ||
          user.token.accessToken == null ||
          user.token.isAccessTokenExpired()) {
        await super.forgetUser();
        return null;
      }
      return user;
    } on OidcException catch (error) {
      if (error.errorResponse?.error == 'invalid_grant') {
        await super.forgetUser();
      }
      rethrow;
    }
  }

  @override
  Future<void> forgetUser() async {
    // A completed refresh must never resurrect a session after explicit logout.
    try {
      await _restoring;
      await _refresh;
    } on Object {
      // Logout still removes credentials when an outstanding refresh failed.
    }
    await super.forgetUser();
  }

  @override
  Future<void> handleTokenExpiring(OidcToken event) => _refreshFromTimer(event);

  @override
  void handleTokenExpired(OidcToken event) {
    unawaited(_refreshFromTimer(event));
  }

  Future<void> _refreshFromTimer(OidcToken token) async {
    if (!identical(currentUser?.token, token)) return;
    try {
      await refreshToken();
    } on Object catch (error) {
      // Keep the expiry timer after a transient failure. Foreground requests
      // also retry refresh and propagate the original error to their caller.
      logger.warning('OIDC background refresh failed', error);
    }
  }

  @override
  Future<String?> getAccessToken({
    Duration minValidity = const Duration(seconds: 30),
    bool forceRefresh = false,
  }) async {
    await _restoring;
    final user = currentUser;
    if (user == null) return null;
    if (!forceRefresh &&
        !user.token.isAccessTokenAboutToExpire(tolerance: minValidity)) {
      return user.token.accessToken;
    }
    return (await refreshToken())?.token.accessToken;
  }

  Future<T> _bounded<T>(Future<T> Function() action) {
    if (isDisposed) return Future.error(StateError('OIDC session is closed'));
    if ((Zone.current[_deadlineKey] as Timer?)?.isActive == true) {
      return action();
    }
    final result = Completer<T>();
    final timer = Timer(networkTimeout, () {
      // This manager owns its client. Retire the runtime before allowing retry
      // so no late response may save credentials for the abandoned operation.
      unawaited(dispose());
      result.completeError(
        TimeoutException(
          'Authentication network request timed out',
          networkTimeout,
        ),
      );
    });
    runZoned(() {
      unawaited(
        Future<T>.sync(action)
            .then(
              (value) {
                if (!result.isCompleted) result.complete(value);
              },
              onError: (Object error, StackTrace stack) {
                if (!result.isCompleted) result.completeError(error, stack);
              },
            )
            .whenComplete(timer.cancel),
      );
    }, zoneValues: {_deadlineKey: timer});
    return result.future;
  }

  @override
  Future<void> saveUser(OidcUser user) {
    if (isDisposed) throw StateError('Cannot save an expired authentication');
    // All network verification is finished. Do not time out a local credential
    // commit halfway through and then report the successful login as a failure.
    (Zone.current[_deadlineKey] as Timer?)?.cancel();
    return super.saveUser(user);
  }

  @override
  Future<void> dispose() {
    httpClient?.close();
    return _disposing ??= super.dispose();
  }
}
