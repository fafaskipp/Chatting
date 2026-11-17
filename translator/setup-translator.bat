@echo off
setlocal
title Kaigo Nikki - pasang penerjemah offline
cd /d "%~dp0"

echo.
echo  === Pasang penerjemah offline - cukup 1 kali ===
echo  Folder: %CD%
echo.

rem ---------- 1. Cari Python 3.10 - 3.15 yang benar-benar bisa jalan ----------
rem  "py" adalah peluncur dari python.org. Ia ada walaupun "Add to PATH" tidak dicentang.
rem  "python" bisa saja tiruan dari Microsoft Store yang tidak bisa dipakai, jadi dicek dulu.
set "PY="
for %%V in (3.13 3.12 3.11 3.10 3.14 3.15) do (
  if not defined PY (
    py -%%V -c "import sys" >nul 2>&1 && set "PY=py -%%V"
  )
)
if not defined PY (
  python -c "import sys; sys.exit(0 if (3, 10) <= sys.version_info[:2] <= (3, 15) else 1)" >nul 2>&1 && set "PY=python"
)
if not defined PY (
  echo  [!] Python 3.10 - 3.15 tidak ditemukan di komputer ini.
  echo.
  echo      1. Buka https://www.python.org/downloads/windows/
  echo      2. Unduh "Windows installer 64-bit" versi 3.12 atau 3.13
  echo      3. Saat instal, centang "Add python.exe to PATH"
  echo      4. Klik dua kali file ini lagi
  echo.
  echo      Kalau Python sudah terinstal tetapi tetap muncul pesan ini:
  echo      Settings - Apps - Advanced app settings - App execution aliases,
  echo      matikan "python.exe" dan "python3.exe" milik App Installer.
  echo.
  pause
  exit /b 1
)
echo  Python yang dipakai:
%PY% --version
echo.

rem ---------- 2. Lingkungan Python khusus untuk penerjemah: folder venv ----------
if not exist "venv\Scripts\python.exe" (
  if exist "venv" rmdir /s /q "venv"
  echo  [1/3] Membuat lingkungan Python...
  %PY% -m venv venv
)
if not exist "venv\Scripts\python.exe" (
  echo  [!] Gagal membuat lingkungan Python - folder venv.
  echo      Foto layar ini dan kirimkan.
  pause
  exit /b 1
)

rem ---------- 3. Komponen: ctranslate2, sentencepiece ----------
echo  [2/3] Memasang komponen - beberapa menit...
if exist "wheels\" (
  "venv\Scripts\python.exe" -m pip install --no-deps --no-index --find-links wheels -r requirements.txt
) else (
  "venv\Scripts\python.exe" -m pip install --upgrade pip
  "venv\Scripts\python.exe" -m pip install --no-deps --only-binary=:all: -r requirements.txt
)
if errorlevel 1 (
  echo.
  echo  [!] Gagal memasang komponen.
  echo      Cek koneksi internet. Kalau memakai folder wheels, versi Python
  echo      di komputer ini harus sama dengan komputer yang membuat wheels.
  echo      Foto layar ini dan kirimkan.
  pause
  exit /b 1
)

rem ---------- 4. Model terjemahan, sekitar 600 MB ----------
echo  [3/3] Mengunduh model terjemahan - sekitar 600 MB, bisa beberapa menit...
"venv\Scripts\python.exe" download_model.py
if errorlevel 1 (
  echo.
  echo  [!] Model gagal diunduh. Jalankan file ini lagi untuk melanjutkan unduhan.
  echo      Komputer tanpa internet: salin folder translator\model dari komputer lain.
  pause
  exit /b 1
)

rem ---------- 5. Tes ----------
echo.
echo  Mengetes terjemahan...
"venv\Scripts\python.exe" translate_server.py --selftest
if errorlevel 1 (
  echo.
  echo  [!] Tes terjemahan gagal. Foto layar ini dan kirimkan.
  pause
  exit /b 1
)

echo.
echo  Selesai! Tutup jendela server lalu jalankan start.bat lagi.
echo  Terjemahan otomatis akan aktif sendiri - lihat tab Kanri / pengaturan.
echo.
pause
exit /b 0
