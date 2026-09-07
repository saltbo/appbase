library;

import 'package:appbase_billing/appbase_billing.dart';
import 'package:flutter/foundation.dart';
import 'package:purchases_flutter/purchases_flutter.dart';
import 'package:purchases_ui_flutter/purchases_ui_flutter.dart';

/// Optional mobile UI. The host serializes identity changes through BillingController.
final class RevenueCatBillingUi implements BillingUi {
  @override
  bool get supported =>
      !kIsWeb &&
      (defaultTargetPlatform == TargetPlatform.iOS ||
          defaultTargetPlatform == TargetPlatform.android);
  @override
  Future<void> identify(BillingAccount account) async {
    if (!supported) {
      throw UnsupportedError(
        'Mobile billing is not available on this platform.',
      );
    }
    final key = defaultTargetPlatform == TargetPlatform.iOS
        ? account.iosKey
        : account.androidKey;
    if (key.isEmpty) {
      throw StateError('The store has not been connected to billing.');
    }
    if (await Purchases.isConfigured) {
      await Purchases.logIn(account.appUserId);
    } else {
      await Purchases.configure(
        PurchasesConfiguration(key)..appUserID = account.appUserId,
      );
    }
  }

  @override
  Future<BillingActionResult> purchase() async {
    // Omit an offering ID so RevenueCat's current offering/targeting owns the choice.
    final result = await RevenueCatUI.presentPaywall(displayCloseButton: true);
    return switch (result) {
      PaywallResult.purchased ||
      PaywallResult.restored => BillingActionResult.completed,
      PaywallResult.cancelled => BillingActionResult.cancelled,
      PaywallResult.error || PaywallResult.notPresented => throw StateError(
        'The purchase page could not complete the purchase.',
      ),
    };
  }

  @override
  Future<void> restore() async {
    await Purchases.restorePurchases();
  }

  @override
  Future<void> manage() => RevenueCatUI.presentCustomerCenter();
}
