import 'dart:convert';
import 'dart:math';

import 'ports.dart';

final class AppBaseRandomBatchIdGenerator implements AppBaseBatchIdGenerator {
  AppBaseRandomBatchIdGenerator({Random? random})
    : _random = random ?? Random.secure();

  final Random _random;

  @override
  String next() {
    final bytes = List<int>.generate(18, (_) => _random.nextInt(256));
    return base64Url.encode(bytes).replaceAll('=', '');
  }
}
