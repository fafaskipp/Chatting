"""翻訳モデル（NLLB-200 distilled 600M, CTranslate2 int8 変換済み, 約 0.6GB）を model フォルダにダウンロードする。
インターネットが必要なのは、この1回だけ。途中で止まっても、もう一度動かせば続きから再開します。
追加のライブラリは使いません（Python 標準だけ）。"""
import os
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
TARGET = os.path.join(HERE, "model")
# 変換済みモデルの置き場所（上から順に試す）
REPOS = [
    "JustFrederik/nllb-200-distilled-600M-ct2-int8",
    "entai2965/nllb-200-distilled-600M-ctranslate2",
]
# 必要なファイル（どの置き場所にも同じ名前である）
FILES = ["config.json", "sentencepiece.bpe.model", "shared_vocabulary.txt", "model.bin"]
ALT_VOCAB = "shared_vocabulary.json"  # 置き場所によっては .txt ではなく .json


def complete():
    return os.path.isfile(os.path.join(TARGET, "model.bin")) and os.path.isfile(os.path.join(TARGET, "sentencepiece.bpe.model"))


def fetch(url, dest):
    part = dest + ".part"
    done = os.path.getsize(part) if os.path.exists(part) else 0
    req = urllib.request.Request(url, headers={"Range": "bytes=%d-" % done} if done else {})
    with urllib.request.urlopen(req, timeout=60) as r:
        if done and r.status != 206:
            done = 0  # 続きから取れないときは、はじめから
        total = int(r.headers.get("Content-Length", "0")) + done
        with open(part, "ab" if done else "wb") as f:
            got = done
            last = -1
            while True:
                chunk = r.read(1 << 20)
                if not chunk:
                    break
                f.write(chunk)
                got += len(chunk)
                pct = int(got * 100 / total) if total else 0
                if pct != last and pct % 5 == 0:
                    print("   %s  %d%%  (%d MB)" % (os.path.basename(dest), pct, got >> 20), flush=True)
                    last = pct
    os.replace(part, dest)


def main():
    if complete():
        print("model フォルダにはもうモデルが入っています。")
        return 0
    os.makedirs(TARGET, exist_ok=True)
    for repo in REPOS:
        print("ダウンロード中:", repo)
        base = "https://huggingface.co/%s/resolve/main/" % repo
        try:
            for name in FILES:
                dest = os.path.join(TARGET, name)
                if os.path.isfile(dest):
                    continue
                try:
                    fetch(base + name, dest)
                except Exception:
                    if name == "shared_vocabulary.txt":
                        fetch(base + ALT_VOCAB, os.path.join(TARGET, ALT_VOCAB))
                    else:
                        raise
            if complete():
                print("完了")
                return 0
        except Exception as err:  # noqa: BLE001
            print("  だめでした:", type(err).__name__, str(err)[:120])
    print("どの場所からもダウンロードできませんでした。インターネットにつながっているか確認して、もう一度動かしてください。")
    return 1


if __name__ == "__main__":
    sys.exit(main())
