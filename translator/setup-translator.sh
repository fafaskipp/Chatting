#!/bin/sh
# Pasang penerjemah offline di Linux/Mac (cukup 1 kali, butuh internet kecuali ada folder wheels/ dan model/)
cd "$(dirname "$0")" || exit 1

PY=$(command -v python3 || command -v python)
if [ -z "$PY" ]; then
  echo "[!] Python belum terinstal. Debian/Ubuntu: sudo apt install python3 python3-venv"
  exit 1
fi
echo "Python: $($PY --version)"

if [ ! -d venv ]; then
  echo "[1/3] Membuat lingkungan Python..."
  "$PY" -m venv venv || { echo "[!] Gagal. Debian/Ubuntu: sudo apt install python3-venv"; exit 1; }
fi

echo "[2/3] Memasang komponen..."
if [ -d wheels ]; then
  venv/bin/python -m pip install --no-index --find-links wheels -r requirements.txt || exit 1
else
  venv/bin/python -m pip install --upgrade pip >/dev/null 2>&1
  venv/bin/python -m pip install -r requirements.txt || exit 1
fi

echo "[3/3] Mengunduh model terjemahan (sekitar 600 MB)..."
venv/bin/python download_model.py || exit 1

echo
echo "Mengetes terjemahan..."
venv/bin/python translate_server.py --test "今日は食欲がありました。薬も飲めました。"
echo
echo "Selesai! Jalankan ./start.sh dari folder utama. Terjemahan aktif sendiri."
