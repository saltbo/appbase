import 'dart:async';
import 'dart:math';

import 'package:appbase_client/appbase_client.dart';
import 'package:flutter/foundation.dart';

final class AppBaseSyncController extends ChangeNotifier {
  AppBaseSyncController({
    required this.engine,
    Stream<Object?>? retrySignals,
    this.baseRetryDelay = const Duration(seconds: 2),
    this.maxRetryDelay = const Duration(minutes: 1),
    Duration Function(Duration delay)? retryJitter,
  }) : _retryJitter = retryJitter ?? _equalJitter {
    _state = engine.state;
    _stateSubscription = engine.states.listen((value) {
      _state = value;
      if (!_disposed) notifyListeners();
    });
    _retrySubscription = retrySignals?.listen(
      (_) => scheduleSync(Duration.zero),
    );
  }

  final AppBaseSyncEngine engine;
  final Duration baseRetryDelay;
  final Duration maxRetryDelay;
  final Duration Function(Duration delay) _retryJitter;
  late AppBaseSyncState _state;
  late final StreamSubscription<AppBaseSyncState> _stateSubscription;
  StreamSubscription<Object?>? _retrySubscription;
  Timer? _timer;
  Duration? _nextRetry;
  bool _disposed = false;

  AppBaseSyncState get state => _state;

  Future<void> restore() async {
    final account = await engine.restore();
    if (account != null) scheduleSync(Duration.zero);
  }

  Future<void> signInAndSync() => engine.signIn();

  Future<void> syncNow() async {
    try {
      await engine.syncNow();
      _nextRetry = null;
    } on AppBaseException catch (error) {
      if (!error.isRetryable) return;
      final retryBase = _nextRetry ?? baseRetryDelay;
      final delay = error.retryAfter ?? _retryJitter(retryBase);
      _nextRetry = Duration(
        milliseconds: (retryBase.inMilliseconds * 2).clamp(
          baseRetryDelay.inMilliseconds,
          maxRetryDelay.inMilliseconds,
        ),
      );
      scheduleSync(delay);
    }
  }

  void scheduleSync([Duration delay = const Duration(milliseconds: 300)]) {
    if (_disposed) return;
    _timer?.cancel();
    _timer = Timer(delay, () => unawaited(syncNow()));
  }

  Future<void> signOut() async {
    _timer?.cancel();
    await engine.signOut();
  }

  @override
  void dispose() {
    _disposed = true;
    _timer?.cancel();
    unawaited(_stateSubscription.cancel());
    unawaited(_retrySubscription?.cancel());
    unawaited(engine.close());
    super.dispose();
  }
}

Duration _equalJitter(Duration delay) {
  final ceiling = delay.inMilliseconds;
  if (ceiling <= 1) return delay;
  final floor = ceiling ~/ 2;
  return Duration(milliseconds: floor + Random().nextInt(ceiling - floor + 1));
}
