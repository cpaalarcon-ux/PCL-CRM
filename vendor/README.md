# Vendored QR renderer

`qrcode-generator-2.0.4.mjs` is the unmodified ES module from qrcode-generator 2.0.4 by Kazuhiko Arase, licensed under MIT. The copyright and licence reference are retained in the source header; the permission notice is included in `qrcode-generator-LICENSE.txt`.

Upstream: https://github.com/kazuhikoarase/qrcode-generator

npm tarball integrity: `sha512-mZSiP6RnbHl4xL2Ap5HfkjLnmxfKcPWpWe/c+5XxCuetEenqmNFf1FH/ftXPCtFG5/TDobjsjz6sSNL0Sr8Z9g==`

The renderer runs locally in the browser. It makes no network request to a third-party QR service. The communication URL contains only an opaque record reference; access is checked by the existing authenticated API and database record policies.

# Supabase discussion client

`supabase-discussion.mjs` bundles @supabase/supabase-js 2.118.0 and its locked dependencies from the Edge Function package lock for browser use. The MIT copyright notices are retained in the bundle. It connects only to the application's configured Supabase project for private, authorised change signals. Message text is fetched through the authenticated workspace API.
