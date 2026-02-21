# CLI操作
以下のツールはCLI使えます。
- Vercel
- Supabase

# 拡張機能エクスポート手順
拡張機能を更新したら、必ず以下の手順でダウンロードしてからタスクを終了するようにして。
## 拡張機能を Windows の Downloads に保存する（WSL から）

Chrome を Windows 側で実行していて、`Load unpacked` に Windows パスが必要な場合に使用します。

```bash
mkdir -p /mnt/c/Users/keita/Downloads/english-flashcard-extension
rsync -a --delete /home/keita/english-learning-project/apps/extension/ /mnt/c/Users/keita/Downloads/english-flashcard-extension/
cd /mnt/c/Users/keita/Downloads
zip -r -FS english-flashcard-extension.zip english-flashcard-extension
```

- 注意: 実行環境のポリシーで `rm -rf` がブロックされることがあるため、削除+再コピーは `rsync -a --delete` を使う。

- Chrome 用の展開済みフォルダパス:
  `C:\Users\keita\Downloads\english-flashcard-extension`
- Zip ファイルパス（共有用・任意）:
  `C:\Users\keita\Downloads\english-flashcard-extension.zip`
