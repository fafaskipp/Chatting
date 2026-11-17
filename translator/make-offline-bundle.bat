@echo off
setlocal
title Kaigo Nikki - siapkan paket untuk PC tanpa internet
cd /d "%~dp0"

echo.
echo  === Siapkan paket offline - jalankan di PC yang PUNYA internet ===
echo  Hasilnya: folder "wheels" - komponen Python - dan "model" - model terjemahan.
echo  Kedua folder itu nanti ikut di-zip dan dibawa ke PC kantor.
echo.

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
  echo  [!] Python 3.10 - 3.15 tidak ditemukan.
  echo      Instal dari https://www.python.org/downloads/windows/ - versi 3.12 atau 3.13 -
  echo      dan centang "Add python.exe to PATH". Lalu jalankan file ini lagi.
  pause
  exit /b 1
)

echo  Versi Python di PC ini - PC kantor harus memakai versi yang SAMA:
%PY% --version
echo.

echo  [1/2] Mengunduh komponen Python ke folder wheels...
%PY% -m pip download --no-deps --only-binary=:all: -r requirements.txt -d wheels
if errorlevel 1 (
  echo  [!] Gagal. Foto layar ini dan kirimkan.
  pause
  exit /b 1
)

echo  [2/2] Mengunduh model terjemahan - sekitar 600 MB...
%PY% download_model.py
if errorlevel 1 (
  echo  [!] Gagal. Jalankan lagi untuk melanjutkan unduhan.
  pause
  exit /b 1
)

echo.
echo  Selesai! Sekarang:
echo    1. Zip seluruh folder proyek. JANGAN ikutkan folder "venv" dan "data".
echo    2. Bawa zip itu, installer Node.js, dan installer Python versi yang sama ke PC kantor.
echo    3. Di PC kantor: instal Node.js dan Python, unzip, lalu
echo       klik dua kali translator\setup-translator.bat - tanpa internet pun bisa.
echo.
pause
exit /b 0
