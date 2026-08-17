#!/usr/bin/env bash
set -euo pipefail

pnpm install --frozen-lockfile
dart pub get --enforce-lockfile
pnpm protocol:check
pnpm format:check
pnpm typecheck
pnpm test:coverage
pnpm build
pnpm --filter appbase-cloudflare-worker types --check
pnpm --filter appbase-cloudflare-worker check
dart format --output=none --set-exit-if-changed packages examples
dart analyze --fatal-infos
dart test packages/appbase_client/test packages/appbase_drift/test
flutter test packages/appbase_flutter/test

for package in appbase_client appbase_drift appbase_flutter; do
  (cd "packages/$package" && dart pub publish --dry-run)
done
