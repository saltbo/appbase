import 'dart:convert';
import 'package:appbase_client/appbase_client.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

final class AppBaseSecureAccountBindingStore
    implements AppBaseAccountBindingStore {
  const AppBaseSecureAccountBindingStore({
    required this.namespace,
    this.storage = const FlutterSecureStorage(),
  });
  final String namespace;
  final FlutterSecureStorage storage;
  String get _key => '$namespace.appbase.account-session';
  @override
  Future<Map<String, Object?>?> read() async {
    final value = await storage.read(key: _key);
    return value == null
        ? null
        : Map<String, Object?>.from(jsonDecode(value) as Map);
  }

  @override
  Future<void> write(Map<String, Object?> value) =>
      storage.write(key: _key, value: jsonEncode(value));
  @override
  Future<void> clear() => storage.delete(key: _key);
}
