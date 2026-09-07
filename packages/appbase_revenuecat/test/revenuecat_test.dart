import 'package:appbase_billing/appbase_billing.dart';
import 'package:appbase_revenuecat/appbase_revenuecat.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  tearDown(() {
    debugDefaultTargetPlatformOverride = null;
  });
  test(
    'remote paywall owns the offering and maps completion/cancellation',
    () async {
      debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
      var response = 'PURCHASED';
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(
            const MethodChannel('purchases_ui_flutter'),
            (call) async {
              if (call.method == 'presentPaywall') {
                final arguments = call.arguments as Map<Object?, Object?>;
                expect(arguments['offeringIdentifier'], isNull);
                expect(arguments['displayCloseButton'], isTrue);
                return response;
              }
              return null;
            },
          );
      final ui = RevenueCatBillingUi();
      expect(ui.supported, isTrue);
      expect(await ui.purchase(), BillingActionResult.completed);
      response = 'RESTORED';
      expect(await ui.purchase(), BillingActionResult.completed);
      response = 'CANCELLED';
      expect(await ui.purchase(), BillingActionResult.cancelled);
      response = 'ERROR';
      await expectLater(ui.purchase(), throwsStateError);
      await ui.manage();
    },
  );
  test(
    'missing store configuration and desktop do not invoke native purchase',
    () async {
      final ui = RevenueCatBillingUi();
      debugDefaultTargetPlatformOverride = TargetPlatform.linux;
      expect(ui.supported, isFalse);
      await expectLater(
        ui.identify(
          const BillingAccount(appUserId: 'a', iosKey: '', androidKey: ''),
        ),
        throwsUnsupportedError,
      );
      debugDefaultTargetPlatformOverride = TargetPlatform.android;
      await expectLater(
        ui.identify(
          const BillingAccount(appUserId: 'a', iosKey: '', androidKey: ''),
        ),
        throwsStateError,
      );
    },
  );
}
