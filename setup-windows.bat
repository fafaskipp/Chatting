@echo off
chcp 65001 > nul
title Kaigo Nikki - pengaturan awal
cd /d "%~dp0"

rem Harus dijalankan sebagai administrator (klik kanan - Run as administrator)
net session > nul 2>&1
if errorlevel 1 (
  echo.
  echo  [!] File ini harus dijalankan sebagai administrator.
  echo      Tutup jendela ini, klik KANAN setup-windows.bat,
  echo      lalu pilih "Run as administrator" / "Jalankan sebagai administrator".
  echo.
  pause
  exit /b 1
)

echo.
echo  === Pengaturan awal Kaigo Nikki ===
echo.

echo  [1/4] Membuka port 3000 di Windows Firewall (jaringan Private)...
netsh advfirewall firewall delete rule name="Kaigo Nikki" > nul 2>&1
netsh advfirewall firewall add rule name="Kaigo Nikki" dir=in action=allow protocol=TCP localport=3000 profile=private > nul
if errorlevel 1 (echo        Gagal. Coba lagi atau atur firewall manual.) else (echo        OK)

echo  [2/4] Mematikan sleep/hibernate saat komputer tersambung listrik...
powercfg /change standby-timeout-ac 0 > nul
powercfg /change hibernate-timeout-ac 0 > nul
echo        OK

echo  [3/4] Membuat server jalan otomatis setiap Windows menyala...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$s = (New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Startup') + '\Kaigo Nikki.lnk');" ^
  "$s.TargetPath = '%~dp0start.bat'; $s.Arguments = '--no-browser'; $s.WorkingDirectory = '%~dp0'; $s.WindowStyle = 7; $s.Save()"
if errorlevel 1 (echo        Gagal membuat shortcut otomatis.) else (echo        OK)

echo  [4/4] Membuat shortcut "Kaigo Nikki" di Desktop...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$s = (New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop') + '\Kaigo Nikki.lnk');" ^
  "$s.TargetPath = '%~dp0start.bat'; $s.WorkingDirectory = '%~dp0'; $s.Save()"
if errorlevel 1 (echo        Gagal membuat shortcut Desktop.) else (echo        OK)

echo.
echo  === Selesai ===
echo.
echo  Alamat IP komputer ini (pakai yang diawali 192.168. atau 10.):
ipconfig | findstr /C:"IPv4"
echo.
echo  Dari HP / iPad / komputer lain, buka:  http://ALAMAT-IP-DI-ATAS:3000
echo  Contoh:  http://192.168.1.10:3000
echo.
echo  Langkah berikutnya: klik dua kali start.bat (atau shortcut "Kaigo Nikki" di Desktop).
echo.
pause
