# BE-FIRST-LIVE

BE:LIVE専用リポジトリ。正本はGoogle Driveの「BE:LIVE｜アプリ設計書」（現在v0.27、2026-11-12）。確定したWhite Aqua Glassの既存画面と共通データモデルを移行し、Spark無料構成へ接続しています。

## 今回使える画面

- `app/app-entry.html`: Googleログイン後の本体。既存の接続テストで保存したFirebase設定・GAS URLをそのまま使用。
- `app/app-entry.html?trial=1`: 公開情報の1ツアー・4公演、3/3のみ29曲の試験表示。参加記録0件から開始。操作はメモリ内だけで本番へ書き込まない。
- `index.html`: 接続設定・ルールコピー・既存GAS接続テスト。

HOME、LIVE内MY LIVE／ALL LIVE切替、参戦記録の詳細編集、MY LIVE STATS、SONG ARCHIVE、楽曲ランキング・披露率、共通セトリエディタ、設定の登録・管理画面を接続。予想・バックテストは後段です。Phase 1の全受入完了を意味しません。残件は `docs/IMPLEMENTATION_STATUS.md`。

## 次の本人操作

1. いつもの接続テストページを再読み込みし、「本人限定ルールをコピー」。
2. Firebase Consoleの `live-record-3e3b6` → Firestore Database → ルールへ全文を貼り付け「公開」。今回は本人専用の本体保存先を追加しているため、以前のルールのままでは本体を使えません。
3. 接続テストページから「LIVE ARCHIVE本体を開く」。既存のGoogleログインと設定を使用します。
4. 「試験データで確認する」では登録せずに画面を確認できます。本体は最初は空です。歴代公演・参戦履歴の初期一括投入は未実施で、本人承認後です。

GASコード・manifest・デプロイ・保存済みURLの変更は今回不要。実プロジェクトへのルール公開とiPhone/PCの保存・再読込は本人環境で確認します。

## 楽曲同期

Universe `06_Songs` のArtistをtrimした値が `BE:FIRST` の曲だけを同期（直近の本人確認で66曲）。他グループ・UNIT・空欄は除外。BE:FIRST内ユニット曲もArtistがBE:FIRSTなら対象。Universeへの変更は行いません。LIVE限定カバー等は独立した `L:` 参照です。

本人による保存・再読込・匿名拒否・GAS接続・対象外91曲の除外・66曲同期・起動時更新の実動作確認が完了しています。起動時はFirestoreの前回値を先に表示し、GASを裏で実行。成功後に再読込、失敗時は前回値とエラーを表示。15分トリガーは不要です。

公開GAS URLへのPOSTにはUUIDだけを渡します。本人だけがFirestoreに作れる期限120秒の要求を、GASが要求ID・PENDING・時刻で照合し、CASで消費してから実行。完了結果は認証済みFirestoreから読みます。非公開SheetsのデータやIDトークンをURLへ送信しません。

`gas/UniverseSync.gs` は独立GAS専用です。既存Universe GASへ追加しないでください。手順は `docs/GAS_SETUP.html`。

## 本体データと安全性

`users/{ownerUid}/control/state` にactiveDatasetId、previousDatasetId、revisionを保持。各データセットはtours / shows / templates / overrides / directEntries / entryFacts / localSongs / songMetadata / releases / releaseTracks / attendanceの11コレクションです。スキーマは `shared/model.ts`、参照検証と集計は `shared/domain.ts` に集約。

本人Google UID以外は読書き不可。楽曲キャッシュは本人も読取のみ、更新はGASのIAM経由。編集は全体revisionと対象entity revisionで競合検知し、無条件上書きしません。復元は別領域に保存・読戻し照合した後にactiveポインターを原子的に切替え、直前のデータを残します。オフライン編集は提供しません。

## 開発と検証

Node 22、Java 21。

```sh
npm ci
npm test
npm run test:body
npm run build
```

ルール/GAS/起動処理はFirestoreエミュレーターだけで検証し、実プロジェクトへ書き込みません。本体ビルドは `app/`、接続ページと共にGitHub Pagesで配信します。元の移行ブランチは保全。設計・不足項目の監査記録は `docs/IMPLEMENTATION_STATUS.md`、試験データの出典は `docs/TRIAL_DATA.md`。

## v0.27 リニューアル（2026-11-12）

- 下部タブはHOME／LIVE／ANALYSIS。LIVEの初期表示はMY LIVEで、ALL LIVEへ切替。設定はヘッダー右上。
- MY LIVE STATSは年／月・都道府県・会場・ツアーの参戦公演統計。セトリ未登録でも参戦数に含む。
- ANALYSISのSONG ARCHIVEは選択した参戦公演／全公演の披露履歴・曲順・FULL／SHORT・年別・ツアー別分析。セトリ未登録公演は披露率の分母から除外。
- BE:LIVEロゴは承認済み画像に基づく軽量ベクター、Outfit×Zen Kaku Gothic New、White Aqua Glass。
- 登録済み公演の詳細編集と新規登録を分離し、曲の追加はエディタ下部1か所から位置指定。CSV書出しも提供。
- GitHub ActionsでビルドとVitestを実行。mainへの反映後にViteビルドのappフォルダを自動更新する。既存のFirebase/GAS/Firestoreの設定・保存データを変更しない。
- 初期全歴代公演・未確認セトリの投入、実Firebase/iPhoneでの操作確認、後段PREDICTは別途必要。推測による公演・セトリの自動補完は行わない。
