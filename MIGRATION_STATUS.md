# LIVE ARCHIVE 移行記録（2026-11-11）

移行元：kotori118/BMSG-PJ の `feature/live-archive-foundation-20261111`（Draft PR #63、ソースコミット `c45b52c23a0ca15260737fc77a998f9fcd33473c`）。
移行先：kotori118/BE-FIRST-LIVE の `migration/live-archive-foundation-20261111`。

## 移行内容
- `apps/live-archive/` 以下の33ファイルを移行先のルートへ同じ内容のまま移動。
- Universe専用の `.claspignore` と旧monorepo用CIは不要な設定として削除するのではなく、`migration-reference/` に原文を保存。
- 全35ファイルのGit blob SHAが移行元と一致することを確認してコピー。元の `BMSG-PJ/main` と `BMSG-DB` は変更しない。

## ⚠ 実行前に更新が必要
このブランチは**設計書v0.24時点のソースの完全コピー**であり、現在の設計書v0.26（Firebase Spark／クレジットカード登録なし／Googleログイン／Cloud Functions不使用／GASによる一方向同期）にまだ更新されていない。
- `functions/` は**履歴保存用**。Blaze必須のCloud Functionsを絶対にデプロイしない。
- `src/firebase.ts` などに `httpsCallable` が残るため、現状のままではSparkでアプリを運用できない。
- `docs/FIREBASE_SETUP.md` のBlaze・Functions設定手順は現在の方針と異なる。**実行しない**。
- Firebase無料構成への置換とテスト後に初めて本番用mainへ反映する。
- 参戦履歴・座席・初期公演データの大量登録は本人が確認・承認するまで行わない。

この記録はコピーの履歴であり、アプリ公開・Firebase連携・実機テストが完了したことを意味しない。
