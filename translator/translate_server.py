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


GLOSSARY_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "glossary.json")


class Glossary:
    """介護の言葉の決まった訳。機械翻訳は専門用語を間違えやすい（例：褥瘡→「貝」）ので、
    その言葉を「Q1」のような印に置きかえて翻訳し、あとで決まった訳に戻す。"""

    def __init__(self, path=GLOSSARY_FILE):
        self.path = path
        self.mtime = None
        self.terms = {}

    def load(self):
        try:
            m = os.path.getmtime(self.path)
            if m != self.mtime:
                with open(self.path, encoding="utf-8") as f:
                    raw = json.load(f)
                self.terms = {k: v for k, v in raw.items() if isinstance(v, dict)}
                self.mtime = m
        except (OSError, ValueError) as err:
            sys.stderr.write("glossary: %r\n" % (err,))

    def protect(self, seg, target):
        """seg の中の用語を印に置きかえる。戻り値: (置きかえた文, [(印, 訳, 元の言葉)])"""
        self.load()
        found = []
        for term in sorted(self.terms, key=len, reverse=True):
            if term in seg and self.terms[term].get(target):
                key = "Q%d" % (len(found) + 1)
                seg = seg.replace(term, key)
                found.append((key, self.terms[term][target], term))
        return seg, found

    def pieces(self, seg, target):
        """seg を「ふつうの文字」と「用語」の並びに分ける。印が消えたときの代わりの方法で使う。"""
        self.load()
        terms = [t for t in sorted(self.terms, key=len, reverse=True) if self.terms[t].get(target)]
        if not terms:
            return [("text", seg)]
        out = []
        for part in re.split("(" + "|".join(re.escape(t) for t in terms) + ")", seg):
            if not part:
                continue
            out.append(("term", self.terms[part][target]) if part in self.terms and part in terms else ("text", part))
        return out

    @staticmethod
    def has_all(out, found):
        return all(re.search(r"(?<![A-Za-z0-9])%s(?![0-9])" % key, out) for key, _, _ in found)

    @staticmethod
    def restore(out, found):
        for key, word, term in found:
            if re.search(r"(?<![A-Za-z0-9])%s(?![0-9])" % key, out):
                out = re.sub(r"(?<![A-Za-z0-9])%s(?![0-9])" % key, word, out)
            else:
                # 印が消えた（まれ）→ 末尾に用語を添えて、意味が落ちないようにする
                out = "%s [%s = %s]" % (out, term, word)
        return out


class Service:
    def __init__(self, backend, glossary=None):
        self.backend = backend
        self.glossary = glossary or Glossary()
        self.cache = {}

    def translate_text(self, text, target):
        key = (text, target)
        if key in self.cache:
            return self.cache[key]
        lines = split_segments(text)
        flat = [s for segs in lines for s in segs if needs_translation(s)]
        prot = {s: self.glossary.protect(s, target) for s in flat}
        raw = self.backend.translate([prot[s][0] for s in flat], target) if flat else []
        done = {}
        for s, o in zip(flat, raw):
            found = prot[s][1]
            if found and not self.glossary.has_all(o, found):
                # 印が消えた → 用語以外の部分を別々に翻訳して、決まった訳とつなぐ（「内科受診」のような短い言葉用）
                parts = [
                    (k, p)
                    for k, p in self.glossary.pieces(s, target)
                    # 「を」「しました。」のような助詞・語尾だけの部分は、単独で訳すとおかしくなるので省く
                    if not (k == "text" and re.fullmatch(r"[\u3040-\u309f、。\s]{1,6}", p))
                ]
                texts = [p for k, p in parts if k == "text" and needs_translation(p)]
                tr = iter(self.backend.translate(texts, target)) if texts else iter(())
                done[s] = " ".join(next(tr) if (k == "text" and needs_translation(p)) else p for k, p in parts).strip()
            else:
                done[s] = self.glossary.restore(o, found)
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
