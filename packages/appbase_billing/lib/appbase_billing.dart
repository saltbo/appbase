library;

import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

enum BillingActionResult { cancelled, completed }

enum BillingPhase {
  idle,
  loading,
  ready,
  purchasing,
  restoring,
  synchronizing,
  failed,
}

final class BillingAccount {
  const BillingAccount({
    required this.appUserId,
    required this.iosKey,
    required this.androidKey,
  });
  final String appUserId;
  final String iosKey;
  final String androidKey;
}

abstract interface class BillingApi {
  Future<BillingAccount> account();
  Future<void> synchronize();
}

abstract interface class BillingUi {
  bool get supported;
  Future<void> identify(BillingAccount account);
  Future<BillingActionResult> purchase();
  Future<void> restore();
  Future<void> manage();
}

final class HttpBillingApi implements BillingApi {
  HttpBillingApi({
    required this.baseUri,
    required this.accessToken,
    http.Client? client,
  }) : _client = client ?? http.Client();
  final Uri baseUri;
  final Future<String?> Function() accessToken;
  final http.Client _client;
  Future<Object?> _request(String method, String path) async {
    final token = await accessToken();
    if (token == null) throw StateError('Sign in before using billing.');
    final request =
        http.Request(
            method,
            baseUri.replace(
              path: '${baseUri.path.replaceFirst(RegExp(r'/+$'), '')}$path',
              query: null,
              fragment: null,
            ),
          )
          ..headers.addAll({
            'Authorization': 'Bearer $token',
            'Accept': 'application/json',
          });
    final response = await http.Response.fromStream(
      await _client.send(request),
    ).timeout(const Duration(seconds: 20));
    if (response.statusCode != 200) {
      throw BillingApiException(response.statusCode);
    }
    return jsonDecode(response.body);
  }

  @override
  Future<BillingAccount> account() async {
    final data =
        await _request('GET', '/billing/account') as Map<String, dynamic>;
    final keys = data['sdkKeys'] as Map<String, dynamic>;
    return BillingAccount(
      appUserId: data['appUserId'] as String,
      iosKey: keys['ios'] as String,
      androidKey: keys['android'] as String,
    );
  }

  @override
  Future<void> synchronize() async {
    await _request('POST', '/billing/synchronizations');
  }

  void close() => _client.close();
}

final class BillingApiException implements Exception {
  const BillingApiException(this.status);
  final int status;
  @override
  String toString() => 'Billing request failed (HTTP $status).';
}

/// Serializes SDK identity and UI operations; generation checks isolate app accounts.
final class BillingController extends ChangeNotifier {
  BillingController({
    required this.api,
    required this.ui,
    required this.refreshMembership,
  });
  final BillingApi api;
  final BillingUi ui;
  final Future<void> Function() refreshMembership;
  String? _account;
  int _generation = 0;
  bool _disposed = false;
  Future<void> _tail = Future<void>.value();
  BillingPhase _phase = BillingPhase.idle;
  Object? _error;
  BillingPhase get phase => _phase;
  Object? get error => _error;
  bool get supported => ui.supported;
  bool get busy => switch (_phase) {
    BillingPhase.loading ||
    BillingPhase.purchasing ||
    BillingPhase.restoring ||
    BillingPhase.synchronizing => true,
    _ => false,
  };
  bool get canPurchase =>
      supported && _account != null && !busy && _phase != BillingPhase.idle;
  void _publish(BillingPhase phase, [Object? error]) {
    if (_disposed) return;
    _phase = phase;
    _error = error;
    notifyListeners();
  }

  bool _current(int generation) =>
      !_disposed && generation == _generation && _account != null;
  Future<void> setAccount(String? account) {
    if (_account == account) return Future.value();
    _account = account;
    final generation = ++_generation;
    _publish(
      account == null || !supported ? BillingPhase.idle : BillingPhase.loading,
    );
    if (account == null || !supported) return Future.value();
    return _enqueue(generation, () async {
      final config = await api.account();
      if (!_current(generation)) return;
      await ui.identify(config);
      if (!_current(generation)) return;
      // SDK registration precedes the first server lookup for a new customer.
      await _synchronize(generation);
    });
  }

  Future<void> purchase() => _action(
    BillingPhase.purchasing,
    () async => await ui.purchase() == BillingActionResult.completed,
  );
  Future<void> restore() => _action(BillingPhase.restoring, () async {
    await ui.restore();
    return true;
  });
  Future<void> manage() => _action(BillingPhase.purchasing, () async {
    await ui.manage();
    return true;
  });
  Future<void> refresh() {
    if (!supported || _account == null || busy) return Future.value();
    return _action(BillingPhase.synchronizing, () async => true);
  }

  Future<void> _action(BillingPhase phase, Future<bool> Function() operation) {
    if (!canPurchase) return Future.value();
    final generation = _generation;
    _publish(phase);
    return _enqueue(generation, () async {
      // Rebind after failed initialization; no purchase can use an older SDK identity.
      final config = await api.account();
      if (!_current(generation)) return;
      await ui.identify(config);
      if (!_current(generation)) return;
      final completed = await operation();
      if (!_current(generation)) return;
      if (completed) await _synchronize(generation);
    });
  }

  Future<void> _synchronize(int generation) async {
    if (!_current(generation)) return;
    _publish(BillingPhase.synchronizing);
    await api.synchronize();
    if (_current(generation)) await refreshMembership();
  }

  Future<void> _enqueue(int generation, Future<void> Function() work) {
    final next = _tail.then((_) async {
      if (!_current(generation)) return;
      try {
        await work();
        if (_current(generation)) _publish(BillingPhase.ready);
      } on Object catch (error) {
        if (_current(generation)) _publish(BillingPhase.failed, error);
      }
    });
    _tail = next;
    return next;
  }

  @override
  void dispose() {
    _disposed = true;
    _generation++;
    super.dispose();
  }
}
