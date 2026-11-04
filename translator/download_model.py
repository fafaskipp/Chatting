"""翻訳モデル（NLLB-200 distilled 600M, CTranslate2 int8 変換済み, 約 0.6〜0.9GB）を model フォルダにダウンロードする。
インターネットが必要なのは、この1回だけ。"""
import os
import sys

from huggingface_hub import snapshot_download

HERE = os.path.dirname(os.path.abspath(__file__))
TARGET = os.path.join(HERE, "model")
# 変換済みモデルの置き場所（上から順に試す）。見つからないときは、ここに別の場所を足してください。
CANDIDATES = [
    "JustFrederik/nllb-200-distilled-600M-ct2-int8",
    "winstxnhdw/nllb-200-distilled-600M-ct2-int8",
    "entai2965/nllb-200-distilled-600M-ctranslate2",
]

if os.path.isdir(TARGET) and any(f.endswith(".bin") for f in os.listdir(TARGET)):
    print("model フォルダにはもうモデルが入っています。")
    sys.exit(0)

for repo in CANDIDATES:
    try:
        print("ダウンロード中:", repo)
        snapshot_download(repo_id=repo, local_dir=TARGET)
        print("完了")
        sys.exit(0)
    except Exception as err:  # noqa: BLE001
        print("  だめでした:", type(err).__name__, str(err)[:120])
print("どの場所からもダウンロードできませんでした。インターネットにつながっているか確認してください。")
sys.exit(1)
