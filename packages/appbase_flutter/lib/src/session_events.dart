import 'package:appbase_client/appbase_client.dart';

/// Optional session lifecycle events, independent of an identity provider.
abstract interface class AppBaseSessionEvents implements AppBaseSession {
  Stream<void> get invalidations;
}
