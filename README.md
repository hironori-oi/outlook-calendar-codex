# NAGI Calendar

Outlook Calendarより軽く、複数人・会議室の予定を見比べやすくするWindows向けデスクトップカレンダーです。現在はTauri 2 + WebView2 + SQLiteで動くMVPで、Microsoft 365へ外部送信しない安全なデモプロバイダーを接続しています。

## 現在できること

- SQLiteへ30,000件の合成社員名簿を初回構築し、名前・所属などをNFKC正規化した複合AND検索（上位50件）
- 社員と会議室を検索して表示セットへ登録し、独自のグループを作成
- 日・週・月表示、表示セット切替、空き時間レンズ
- ローカル予定と下書きの保存
- 表示セット、選択中セット、背景、透過設定を再起動後に復元
- 手動の名簿更新履歴と最終成功日時を表示
- Tauriの最小化・最大化・終了操作
- ブラウザプレビュー時はlocalStorageへフォールバック

SQLiteには30,000件を保持しますが、WebViewへ返すのは表示セットで参照中の社員と検索上位50件だけです。名簿全件をフロントエンドへ読み込むことはありません。

## 起動

前提はWindows、WebView2 Runtime、Node.js 20以降、Rust MSVC toolchain、Visual Studio C++ Build Toolsです。

```powershell
npm install
npm run desktop:dev
```

ブラウザだけでUIを確認する場合:

```powershell
npm run dev
```

配布用NSISインストーラーを作る場合:

```powershell
npm run desktop:build
```

インストーラーを作らず実行ファイルだけ確認する場合は `npm run desktop:build -- --no-bundle` を使います。成果物は `src-tauri/target/release/nagi-calendar.exe` です。

## 検証

```powershell
npm test
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

## 構成

- `index.html` / `styles.css` / `app.js` — 既存デザインを維持したUIと画面操作
- `src/services/app-repository.js` — SQLite / localStorage共通の永続化境界
- `src/services/graph-client.js` — users delta、Places、getSchedule、calendarView、予定作成の未接続Graph契約
- `src/services/platform.js` — Tauri判定、SQL接続、ウィンドウ操作
- `src/domain/` — 検索・日付・IDの正規化
- `src-tauri/migrations/` — ローカルDB、30,000件デモ名簿、段階的なスキーマ更新
- `tests/` — 永続化・検索・Graph契約テスト
- `PRODUCT_PROPOSAL.md` — 製品方針と段階的なMicrosoft 365統合案

## Microsoft 365接続について

現MVPは外部へ招待を送らず、「ローカルに保存」と明示します。Graphの契約と自動テストまでは実装済みですが、UIからは呼び出していません。実接続にはEntraアプリ登録、tenant ID / client ID、管理者同意、テストアカウント、Windows認証方式の決定が必要です。本番接続では認証とGraph HTTPをネイティブ側へ置き、アクセストークンをWebViewやSQLiteへ渡さない方針です。

実社員情報を扱う段階では、表示セット更新をネイティブ側の単一トランザクションへ移し、rendererからの任意SQLを廃止し、端末の暗号化・ACL方針を確定することを接続前の必須条件とします。現MVPのSQLiteには合成データだけを格納します。
