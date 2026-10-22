@echo off
chcp 65001 > nul
title 介護日記 サーバー
cd /d "%~dp0"
where node > nul 2>&1
if errorlevel 1 (
  echo Node.js が見つかりません。https://nodejs.org/ からインストールしてください。
  pause
  exit /b
)
start "" http://localhost:3000
node server.js
pause
