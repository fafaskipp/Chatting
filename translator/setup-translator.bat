@echo off
chcp 65001 > nul
title Kaigo Nikki - pasang penerjemah offline
cd /d "%~dp0"

echo.
echo  === Pasang penerjemah offline (cukup 1 kali, butuh internet) ===
echo.

set PY=
where py > nul 2>&1 && set PY=py -3
if "%PY%"=="" where python > nul 2>&1 && set PY=python
if "%PY%"=="" (
  echo  [!] Python belum terinstal.
  echo      Instal dari https://www.python.org/downloads/  ^(versi 3.10 - 3.13^)
  echo      PENTING: centang "Add python.exe to PATH" saat instal.
  echo      Lalu klik dua kali file ini lagi.
  echo.
  pause
  exit /b 1
)

if not exist venv (
  echo  [1/3] Membuat lingkungan Python...
  %PY% -m venv venv
  if errorlevel 1 goto :fail
)

echo  [2/3] Memasang komponen ^(beberapa menit^)...
if exist wheels (
  venv\Scripts\python.exe -m pip install --no-index --find-links wheels -r requirements.txt
) else (
  venv\Scripts\python.exe -m pip install --upgrade pip
  venv\Scripts\python.exe -m pip install -r requirements.txt
)
if errorlevel 1 goto :fail

echo  [3/3] Mengunduh model terjemahan ^(sekitar 1 GB, beberapa menit^)...
venv\Scripts\python.exe download_model.py
if errorlevel 1 goto :fail

echo.
echo  Mengetes terjemahan...
venv\Scripts\python.exe translate_server.py --test "今日は食欲がありました。薬も飲めました。"
echo.
echo  Selesai! Tutup jendela server lalu jalankan start.bat lagi.
echo  Terjemahan otomatis akan aktif sendiri.
echo.
pause
exit /b 0

:fail
echo.
echo  [!] Gagal. Foto layar ini dan kirimkan.
echo.
pause
exit /b 1
