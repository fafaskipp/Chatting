@echo off
chcp 65001 > nul
title Kaigo Nikki - siapkan paket untuk PC tanpa internet
cd /d "%~dp0"

echo.
echo  === Siapkan paket offline (jalankan di PC yang PUNYA internet) ===
echo  Hasilnya: folder "wheels" (komponen Python) dan "model" (model terjemahan).
echo  Folder itu nanti ikut di-zip dan dibawa ke PC kantor.
echo.

set PY=
where py > nul 2>&1 && set PY=py -3
if "%PY%"=="" where python > nul 2>&1 && set PY=python
if "%PY%"=="" (
  echo  [!] Python belum terinstal. Instal dari https://www.python.org/downloads/
  echo      dan centang "Add python.exe to PATH". Lalu jalankan file ini lagi.
  pause
  exit /b 1
)

echo  Versi Python di PC ini ^(PC kantor harus memakai versi yang SAMA, misalnya 3.12^):
%PY% --version
echo.

echo  [1/2] Mengunduh komponen Python ke folder wheels...
%PY% -m pip download -r requirements.txt -d wheels
if errorlevel 1 goto :fail

echo  [2/2] Mengunduh model terjemahan ^(sekitar 600 MB^)...
%PY% download_model.py
if errorlevel 1 goto :fail

echo.
echo  Selesai! Sekarang:
echo    1. Zip seluruh folder proyek. JANGAN ikutkan folder "venv" dan "data".
echo    2. Bawa zip itu, installer Node.js, dan installer Python ke PC kantor.
echo    3. Di PC kantor: instal Node.js dan Python (versi sama), unzip, lalu
echo       klik dua kali translator\setup-translator.bat  ^(tanpa internet pun bisa^).
echo.
pause
exit /b 0

:fail
echo.
echo  [!] Gagal. Foto layar ini dan kirimkan.
pause
exit /b 1
