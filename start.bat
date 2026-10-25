@echo off
chcp 65001 > nul
title Kaigo Nikki - server (jangan ditutup)
cd /d "%~dp0"

where node > nul 2>&1
if errorlevel 1 (
  echo.
  echo  [!] Node.js belum terinstal di komputer ini.
  echo      Instal dulu dari https://nodejs.org/  ^(pilih versi LTS^),
  echo      lalu klik dua kali start.bat lagi.
  echo.
  pause
  exit /b 1
)

rem Buka browser 2 detik setelah server mulai (kecuali saat jalan otomatis waktu Windows menyala)
if /i not "%~1"=="--no-browser" start "" /min cmd /c "timeout /t 2 > nul & start http://localhost:3000"

node server.js

echo.
echo  Server berhenti. Kalau ada pesan error di atas, foto layar ini dan kirimkan.
pause
