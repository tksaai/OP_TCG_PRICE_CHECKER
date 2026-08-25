# ワンピカード 資産管理 (OP_TCG_PRICE_CHECKER)

ONE PIECE カードゲームの**買取価格**を複数ショップから毎日集めて、価格の推移と
自分の所持カードの資産額を見るための PWA です。スマホのホーム画面に追加して使う
ことを想定しています。

**アプリ:** https://tksaai.github.io/OP_TCG_PRICE_CHECKER/

> 非公式の個人開発ツールです。株式会社バンダイ、および価格の取得元である各
> ショップとは関係ありません。

## できること

- 3 ショップの買取価格を横並びで比較（最高買取・ショップ別・マージなし表示）
- 前日比・週間比・最安値・最高値の表示と、カードごとの価格推移グラフ
- 所持枚数の記録と、資産総額・資産推移の可視化
- カード名・型番・効果テキストでの検索、色/コスト/レアリティなどの絞り込み
- CSV での所持データの読み書き
- [OP_TCG_DB](https://github.com/tksaai/OP_TCG_DB) の所持カード JSON の取り込み

## データの出どころ

| 種類 | 取得元 |
| --- | --- |
| 買取価格 | メルカード（秋葉原カードショップ）、トレカード秋葉原 |
| カード属性・画像・カタログ | [OP_TCG_DB](https://github.com/tksaai/OP_TCG_DB) |

価格は毎日 6:10 / 18:10 (UTC) に GitHub Actions で取得しています
（`.github/workflows/update-prices.yml`）。カード画像は各ショップのものを
参照しており、このリポジトリには含めていません。

### カードラッシュの取得停止について

2026-07-15 以降、GitHub Actions からのアクセスに 403 が返るようになったため、
`scripts/scrape-prices.mjs` の `enabled: false` で取得を止めています。同じ
User-Agent でも手元の回線からは 200 が返るので、データセンター IP 側の拒否と
みられます。回避はせず停止という判断です。過去の価格履歴はそのまま残しており、
復旧を確認できたら `enabled` を `true` に戻すだけで再開できます。

## データファイル

| ファイル | 用途 |
| --- | --- |
| `data/cards.json` | 全カードの全履歴（原本）。差分を追えるよう整形して保存 |
| `data/cards-index.json` | 一覧表示用の軽量インデックス。履歴を畳んで前日比などを事前計算 |
| `data/card-details.json` | OP_TCG_DB 由来のカード属性（色・コスト・レアリティなど） |
| `data/db-catalog.json`, `data/db-variant-map.json` | 所持カード JSON 取り込み用のカタログ |
| `data/card-aliases.json`, `data/alias-candidates.json` | ショップ間の表記揺れを吸収する別名定義 |
| `data/scrape-report.json` | 直近の取得結果（ショップごとの件数と健全性） |

アプリの起動時に読むのは `cards-index.json`（約 4.9 MB）だけです。価格グラフや
資産推移を開いたときに、はじめて `cards.json`（約 20 MB）を読み込みます。

## ローカルでの実行

```sh
node scripts/dev-server.mjs      # http://localhost:8080 で配信 (PORT で変更可)
```

Service Worker を使うため、`file://` では動きません。

## テスト

CI では価格を取りに行く前に以下がすべて実行されます。失敗した場合、その日の
データは更新されません。

```sh
node scripts/test-search-filters.mjs      # 検索・フィルタ
node scripts/test-alias-candidates.mjs    # 別名候補の安全性
node scripts/test-alias-review-utils.mjs  # 別名レビュー用ユーティリティ
node scripts/test-collection-import.mjs   # OP_TCG_DB 所持カードの取り込み
node scripts/test-db-catalog-sync.mjs     # カタログ同期
node scripts/test-index-integration.mjs   # 画面と app.js の結線・CSP
node scripts/test-cards-index.mjs         # 一覧インデックスの生成
node scripts/test-pwa-update.mjs          # Service Worker と更新通知
```

## 取得が壊れたときの検知

1 ショップだけページ構造が変わって 0 件になっても、他店が生きていればワークフロー
自体は成功してしまいます。これを防ぐため、取得件数を前回と比較した結果を
`data/scrape-report.json` に残し、コミットの**後**に `check-scrape-health.mjs` で
判定しています。異常があるとジョブは失敗しますが、その日に取れた他店の価格は
コミット済みです。

## ライセンス / 利用について

このリポジトリのコードは個人利用のために公開しているもので、再利用のための
ライセンスは設定していません（著作権は放棄していません）。カード名・カード画像・
買取価格は、それぞれの権利者およびショップに帰属します。
