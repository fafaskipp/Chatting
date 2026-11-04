#!/usr/bin/env python3
"""介護日記 用 オフライン翻訳サービス（日本語 → インドネシア語 / シンハラ語）

インターネットなしで動きます。モデルは NLLB-200 (distilled 600M) を CTranslate2 で動かします。
  python translate_server.py --model model --port 5005
  python translate_server.py --fake            # モデルなしの動作確認用（本物の翻訳ではありません）
  python translate_server.py --model model --test "今日は食欲がありました。"

Node 側（server.js）が 127.0.0.1 のこのサービスを呼びます。外には公開しません。
"""
import argparse
import glob
import json
import os
import re
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

NLLB = {"ja": "jpn_Jpan", "id": "ind_Latn", "en": "eng_Latn"}
MAX_SEG = 180  # 1つの文がこれより長いときは「、」などで切る


def split_segments(text):
    """文章を (文, 区切り) の並びにする。改行はそのまま残す。"""
    out = []
    for line in text.split("\n"):
        parts = re.findall(r"[^。！？!?]+[。！？!?]*|[。！？!?]+", line) if line else []
        segs = []
        for p in parts:
            while len(p) > MAX_SEG:
                cut = max(p.rfind("、", 0, MAX_SEG), p.rfind("，", 0, MAX_SEG), p.rfind(" ", 0, MAX_SEG))
                cut = cut + 1 if cut > 20 else MAX_SEG
                segs.append(p[:cut])
                p = p[cut:]
            if p:
                segs.append(p)
        out.append(segs)
    return out


def needs_translation(seg):
    # 数字・記号・時刻だけの文字列は、そのまま返す
    return re.search(r"[^\d\s\W_]|[぀-ヿ㐀-鿿]", seg, re.UNICODE) is not None


class FakeBackend:
    name = "fake"

    def translate(self, segs, target):
        return [f"[{target}] {s}" for s in segs]


class Ct2Backend:
    name = "nllb-ct2"

    def __init__(self, model_dir):
        import ctranslate2
        import sentencepiece as spm

        sp_files = glob.glob(os.path.join(model_dir, "*.model")) + glob.glob(os.path.join(model_dir, "**", "*.model"), recursive=True)
        if not sp_files:
            raise SystemExit("モデルの中に sentencepiece の .model ファイルがありません: " + model_dir)
        self.sp = spm.SentencePieceProcessor(model_file=sp_files[0])
        self.tr = ctranslate2.Translator(
            model_dir, device="cpu", compute_type="int8", inter_threads=1, intra_threads=max(1, (os.cpu_count() or 2) - 1)
        )
        self.lock = threading.Lock()

    def translate(self, segs, target):
        src = [[NLLB["ja"]] + self.sp.encode(s, out_type=str) + ["</s>"] for s in segs]
        prefix = [[NLLB[target]]] * len(segs)
        with self.lock:
            res = self.tr.translate_batch(
                src,
                target_prefix=prefix,
                beam_size=4,
                max_decoding_length=256,
                no_repeat_ngram_size=3,
                repetition_penalty=1.1,
            )
        return [self.sp.decode(r.hypotheses[0][1:]).strip() for r in res]


class Service:
    def __init__(self, backend):
        self.backend = backend
        self.cache = {}

    def translate_text(self, text, target):
        key = (text, target)
        if key in self.cache:
            return self.cache[key]
        lines = split_segments(text)
        flat = [s for segs in lines for s in segs if needs_translation(s)]
        done = dict(zip(flat, self.backend.translate(flat, target))) if flat else {}
        result = "\n".join(" ".join(done.get(s, s) for s in segs) for segs in lines)
        if len(self.cache) > 500:
            self.cache.clear()
        self.cache[key] = result
        return result


def make_handler(service):
    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _send(self, code, obj):
            data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            if self.path == "/health":
                return self._send(200, {"ok": True, "backend": service.backend.name})
            self._send(404, {"error": "not found"})

        def do_POST(self):
            if self.path != "/translate":
                return self._send(404, {"error": "not found"})
            try:
                n = int(self.headers.get("Content-Length", "0"))
                body = json.loads(self.rfile.read(n).decode("utf-8"))
                texts = [str(t) for t in body.get("texts", [])][:20]
                targets = [t for t in body.get("targets", []) if t in ("id", "en")]
                out = {t: [service.translate_text(x, t) if x.strip() else "" for x in texts] for t in targets}
                self._send(200, out)
            except Exception as err:  # noqa: BLE001
                sys.stderr.write("translate error: %r\n" % (err,))
                self._send(500, {"error": str(err)})

    return H


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "model"))
    ap.add_argument("--port", type=int, default=5005)
    ap.add_argument("--fake", action="store_true")
    ap.add_argument("--test", help="1文を翻訳して表示して終了")
    a = ap.parse_args()

    backend = FakeBackend() if a.fake else Ct2Backend(a.model)
    service = Service(backend)
    if a.test:
        for t in ("id", "en"):
            print(t, "→", service.translate_text(a.test, t))
        return
    srv = ThreadingHTTPServer(("127.0.0.1", a.port), make_handler(service))
    print("translator ready on 127.0.0.1:%d (%s)" % (a.port, backend.name), flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
