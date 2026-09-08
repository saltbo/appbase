import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:appbase_billing/appbase_billing.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  test('preserves sandbox prefix for account and synchronization', () async {
    for (final suffix in ['/sandbox', '/sandbox/']) {
      final paths = <String>[];
      final api = HttpBillingApi(
        baseUri: Uri.parse('https://billing.example$suffix'),
        accessToken: () async => 'token',
        client: MockClient((request) async {
          paths.add(request.url.path);
          expect(request.headers['Authorization'], 'Bearer token');
          return http.Response(
            '{"appUserId":"sandbox-id","sdkKeys":{"ios":"public","android":"public"}}',
            200,
          );
        }),
      );
      await api.account();
      await api.synchronize();
      api.close();
      expect(paths, [
        '/sandbox/billing/account',
        '/sandbox/billing/synchronizations',
      ]);
    }
  });

  test('decodes the shared server account contract', () async {
    final workspaceFile = File(
      'packages/appbase_billing/test/fixtures/billing-contract.json',
    );
    final fixtureFile = workspaceFile.existsSync()
        ? workspaceFile
        : File('test/fixtures/billing-contract.json');
    final fixture =
        jsonDecode(fixtureFile.readAsStringSync()) as Map<String, dynamic>;
    final api = HttpBillingApi(
      baseUri: Uri.parse('https://billing.example'),
      accessToken: () async => 'access',
      client: MockClient((request) async {
        expect(request.url.path, '/billing/account');
        return http.Response(jsonEncode(fixture['account']), 200);
      }),
    );
    addTearDown(api.close);
    final account = await api.account();
    expect(account.appUserId, 'fixture-billing-account');
    expect(account.iosKey, 'public-ios');
    expect(account.androidKey, 'public-android');
  });
  test(
    'purchase cancellation does not synchronize or grant membership',
    () async {
      final api = FakeApi();
      final ui = FakeUi();
      var refreshes = 0;
      final controller = BillingController(
        api: api,
        ui: ui,
        refreshMembership: () async {
          refreshes++;
        },
      );
      await controller.setAccount('a');
      expect(ui.ids, ['a']);
      expect(controller.phase, BillingPhase.ready);
      ui.result = BillingActionResult.cancelled;
      await controller.purchase();
      expect(api.syncs, 1);
      expect(refreshes, 1);
      ui.result = BillingActionResult.completed;
      await controller.purchase();
      expect(api.syncs, 2);
      expect(refreshes, 2);
      await controller.restore();
      await controller.manage();
      expect(ui.restores, 1);
      expect(ui.manages, 1);
      expect(refreshes, 4);
      controller.dispose();
    },
  );
  test('a switched account cannot receive an earlier UI result', () async {
    final api = FakeApi();
    final ui = FakeUi();
    var refreshes = 0;
    final controller = BillingController(
      api: api,
      ui: ui,
      refreshMembership: () async {
        refreshes++;
      },
    );
    await controller.setAccount('a');
    ui.pending = Completer();
    final purchase = controller.purchase();
    await Future<void>.delayed(Duration.zero);
    api.id = 'b';
    final login = controller.setAccount('b');
    ui.pending!.complete(BillingActionResult.completed);
    await purchase;
    await login;
    expect(refreshes, 2);
    expect(api.syncs, 2);
    expect(ui.ids.last, 'b');
    expect(controller.phase, BillingPhase.ready);
    await controller.setAccount(null);
    await controller.purchase();
    expect(controller.canPurchase, isFalse);
    expect(ui.purchases, 1);
    controller.dispose();
  });
  test(
    'failed initialization cannot purchase using the previous identity',
    () async {
      final api = FakeApi()..fail = true;
      final ui = FakeUi();
      final controller = BillingController(
        api: api,
        ui: ui,
        refreshMembership: () async {},
      );
      await controller.setAccount('a');
      await controller.purchase();
      expect(controller.phase, BillingPhase.failed);
      expect(ui.purchases, 0);
      api.fail = false;
      await controller.refresh();
      expect(controller.phase, BillingPhase.ready);
      controller.dispose();
    },
  );
  test(
    'signout during pending identity and disposal suppress stale work',
    () async {
      final api = FakeApi()..pendingAccount = Completer();
      final ui = FakeUi();
      final controller = BillingController(
        api: api,
        ui: ui,
        refreshMembership: () async {},
      );
      final login = controller.setAccount('a');
      await Future<void>.delayed(Duration.zero);
      await controller.setAccount(null);
      api.pendingAccount!.complete(
        const BillingAccount(
          appUserId: 'a',
          iosKey: 'ios',
          androidKey: 'android',
        ),
      );
      await login;
      expect(ui.ids, isEmpty);
      expect(controller.phase, BillingPhase.idle);
      controller.dispose();
      final other = BillingController(
        api: FakeApi(),
        ui: FakeUi()..available = false,
        refreshMembership: () async {},
      );
      await other.setAccount('a');
      await other.restore();
      await other.refresh();
      expect(other.canPurchase, isFalse);
      other.dispose();
    },
  );
  test(
    'double tap starts only one purchase and failures remain retryable',
    () async {
      final ui = FakeUi();
      final api = FakeApi();
      final controller = BillingController(
        api: api,
        ui: ui,
        refreshMembership: () async {},
      );
      await controller.setAccount('a');
      ui.pending = Completer();
      final purchase = controller.purchase();
      await controller.purchase();
      await Future<void>.delayed(Duration.zero);
      expect(ui.purchases, 1);
      ui.pending!.completeError(StateError('store offline'));
      await purchase;
      expect(controller.error, isA<StateError>());
      ui.pending = null;
      await controller.restore();
      expect(controller.error, isNull);
      controller.dispose();
    },
  );
  test(
    'HTTP binds requests to bearer identity and propagates failures',
    () async {
      final requests = <http.Request>[];
      final api = HttpBillingApi(
        baseUri: Uri.parse('https://billing.example'),
        accessToken: () async => 'access',
        client: MockClient((request) async {
          requests.add(request);
          expect(request.headers['Authorization'], 'Bearer access');
          return http.Response(
            jsonEncode(
              request.method == 'GET'
                  ? {
                      'appUserId': 'opaque',
                      'sdkKeys': {'ios': 'apple', 'android': 'google'},
                    }
                  : {},
            ),
            200,
          );
        }),
      );
      expect((await api.account()).appUserId, 'opaque');
      await api.synchronize();
      expect(requests.last.url.path, '/billing/synchronizations');
      expect(requests.last.body, isEmpty);
      api.close();
      final failed = HttpBillingApi(
        baseUri: Uri.parse('https://billing.example'),
        accessToken: () async => 'access',
        client: MockClient((_) async => http.Response('', 502)),
      );
      await expectLater(failed.account(), throwsA(isA<BillingApiException>()));
      failed.close();
      final signedOut = HttpBillingApi(
        baseUri: Uri.parse('https://billing.example'),
        accessToken: () async => null,
      );
      await expectLater(signedOut.account(), throwsStateError);
      signedOut.close();
    },
  );
}

class FakeApi implements BillingApi {
  String id = 'a';
  int syncs = 0;
  bool fail = false;
  Completer<BillingAccount>? pendingAccount;
  @override
  Future<BillingAccount> account() async {
    if (fail) throw StateError('offline');
    return pendingAccount?.future ??
        BillingAccount(appUserId: id, iosKey: 'ios', androidKey: 'android');
  }

  @override
  Future<void> synchronize() async {
    syncs++;
  }
}

class FakeUi implements BillingUi {
  bool available = true;
  final ids = <String>[];
  int purchases = 0;
  int restores = 0;
  int manages = 0;
  BillingActionResult result = BillingActionResult.completed;
  Completer<BillingActionResult>? pending;
  @override
  bool get supported => available;
  @override
  Future<void> identify(BillingAccount account) async {
    ids.add(account.appUserId);
  }

  @override
  Future<BillingActionResult> purchase() async {
    purchases++;
    return pending?.future ?? result;
  }

  @override
  Future<void> restore() async {
    restores++;
  }

  @override
  Future<void> manage() async {
    manages++;
  }
}
