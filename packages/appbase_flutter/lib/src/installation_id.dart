import 'dart:convert';
import 'dart:math';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

final class AppBaseInstallationId {
  AppBaseInstallationId({
    required this.namespace,
    FlutterSecureStorage? storage,
    Random? random,
  }) : _storage = storage ?? const FlutterSecureStorage(),
       _random = random ?? Random.secure() {
    if (!RegExp(r'^[a-zA-Z0-9._-]+$').hasMatch(namespace)) {
      throw ArgumentError.value(
        namespace,
        'namespace',
        'contains unsafe characters',
      );
    }
  }

  final String namespace;
  final FlutterSecureStorage _storage;
  final Random _random;

  Future<String> get() async {
    final key = '$namespace.appbase.installation-id';
    final existing = await _storage.read(key: key);
    if (existing != null && existing.isNotEmpty) return existing;
    final bytes = List<int>.generate(18, (_) => _random.nextInt(256));
    final created = base64Url.encode(bytes).replaceAll('=', '');
    await _storage.write(key: key, value: created);
    return created;
  }
}
