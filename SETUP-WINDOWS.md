# Cara memasang 介護日記 di komputer Windows

Komputer ini akan menjadi **server**: tempat semua data disimpan. Komputer lain, HP, dan iPad cukup membuka alamatnya di browser selama tersambung ke Wi-Fi/LAN yang sama.

Internet hanya dibutuhkan di **Langkah 1 dan 2** (download). Setelah itu aplikasi berjalan offline.

---

## Langkah 1 — Instal Node.js (sekali saja)

1. Buka https://nodejs.org/
2. Klik tombol download versi **LTS**.
3. Buka file `.msi` yang terdownload → klik **Next** terus sampai **Install** → **Finish**.
   - Biarkan semua pilihan bawaan. Tidak perlu mencentang "Tools for Native Modules".
4. Cek: tekan `Windows + R`, ketik `cmd`, Enter. Di jendela hitam ketik `node -v` lalu Enter. Kalau muncul angka seperti `v22.x.x`, berarti berhasil. Tutup jendela itu.

## Langkah 2 — Download aplikasinya

1. Buka link ini di komputer tersebut:
   https://github.com/fafaskipp/Chatting/archive/refs/heads/claude/kaigo-daily-notes-app-189iy9.zip
2. File ZIP akan terdownload ke folder **Downloads**.
3. Klik kanan file ZIP → **Extract All…** (展開) → **Extract**.
4. Di dalam hasil extract ada folder dengan nama panjang (`Chatting-claude-kaigo-…`). Buka folder itu sampai terlihat file `start.bat`, `server.js`, folder `public`, dan lainnya.
5. **Pindahkan folder itu ke `C:\` dan ganti namanya menjadi `KaigoNikki`**, sehingga file `start.bat` berada di `C:\KaigoNikki\start.bat`.
   - Jangan biarkan di folder Downloads, supaya tidak terhapus tidak sengaja.

## Langkah 3 — Pengaturan awal (sekali saja)

1. Buka folder `C:\KaigoNikki`.
2. **Klik kanan** `setup-windows.bat` → **Run as administrator** (管理者として実行) → **Yes**.
   - Kalau muncul layar biru "Windows protected your PC": klik **More info** → **Run anyway**.
3. Script ini otomatis:
   - membuka port 3000 di Windows Firewall, supaya HP/iPad bisa masuk,
   - mematikan sleep saat komputer tersambung listrik (karena server menyala 24 jam),
   - membuat server **jalan otomatis** setiap Windows menyala,
   - membuat shortcut **Kaigo Nikki** di Desktop.
4. Di akhir akan tampil **alamat IP** komputer, misalnya `192.168.1.10`. **Catat alamat ini.**
5. Tekan tombol apa saja untuk menutup.

## Langkah 4 — Jalankan

1. Klik dua kali shortcut **Kaigo Nikki** di Desktop (atau `start.bat`).
2. Jendela hitam terbuka dan browser otomatis membuka `http://localhost:3000`.
3. **Jangan tutup jendela hitam itu.** Boleh di-minimize. Kalau ditutup, aplikasi berhenti.
4. Kalau muncul jendela Windows Firewall yang bertanya tentang Node.js: centang **Private networks** → **Allow access**.

## Langkah 5 — Buka dari HP / iPad / komputer lain

1. Sambungkan HP/iPad ke **Wi-Fi yang sama** dengan komputer server.
2. Buka Safari/Chrome, ketik: `http://ALAMAT-IP:3000`
   Contoh: `http://192.168.1.10:3000`
3. Supaya mudah dibuka seperti aplikasi:
   - **iPad/iPhone (Safari):** tombol Share → **Add to Home Screen** (ホーム画面に追加).
   - **Android (Chrome):** menu ⋮ → **Add to Home screen**.

Alamat yang sama juga tertulis di aplikasi: tab **⚙️ 管理** → paling bawah.

### Langkah 5b — Buat ikon 「📒 介護日記」 untuk staf (sekali per perangkat)
Manual untuk staf (`docs/manual-ja.pdf`) dimulai dengan「tekan ikon 介護日記」, jadi pasang ikonnya dulu:
- **Komputer Windows (selain server):** klik kanan di Desktop → **New → Shortcut** → ketik alamat unit, misalnya `http://192.168.1.10:3000` → **Next** → beri nama `介護日記` → **Finish**.
- **iPad / iPhone (Safari):** buka alamatnya → tombol Share → **Add to Home Screen** → nama `介護日記`.
- **Android (Chrome):** buka alamatnya → menu ⋮ → **Add to Home screen**.

## Langkah 6 — Mulai dipakai

1. Tab **⚙️ 管理** → daftarkan pasien dengan「＋ ここに登録する」.
2. Tekan **＋ 記録を書く** untuk menulis catatan pertama.

---

## Kalau ada masalah

| Masalah | Solusi |
|---|---|
| HP/iPad tidak bisa membuka alamat | Pastikan Wi-Fi sama. Cek jendela hitam masih terbuka. Di Windows: Settings → Network & Internet → Wi-Fi → nama Wi-Fi → pilih **Private network**. Jalankan `setup-windows.bat` lagi sebagai administrator. |
| Alamat IP berubah setelah router restart | Buka jendela hitam server, alamat terbaru ditulis di sana (atau tab ⚙️ 管理). Agar tidak berubah lagi, minta orang yang mengurus router mengatur **IP tetap (DHCP reservation)** untuk komputer ini. |
| Muncul "Node.js belum terinstal" | Ulangi Langkah 1, lalu restart komputer. |
| Muncul "Port 3000 sudah dipakai" | Server sudah berjalan (misalnya otomatis saat Windows menyala). Cukup buka `http://localhost:3000`. |
| Muncul pesan error di jendela hitam | Pastikan `start.bat` berada di folder yang sama dengan `server.js` dan folder `public` (Langkah 2 no. 4–5). Kalau masih error, foto layar jendela hitam dan kirimkan. |

## Backup data

Semua data ada di folder **`C:\KaigoNikki\data`** (catatan, pasien, agenda, foto). Untuk backup atau pindah komputer, **salin folder `data`** ke flashdisk. Aplikasi juga membuat salinan harian otomatis di `data\backups`.

## Update ke versi baru

1. Tutup jendela hitam server.
2. Download ZIP terbaru (Langkah 2) dan extract.
3. Salin semua file baru ke `C:\KaigoNikki` dan timpa file lama, **kecuali folder `data`**: jangan dihapus atau ditimpa.
4. Jalankan lagi shortcut **Kaigo Nikki**.

## Berhenti memakai jalan-otomatis

Tekan `Windows + R`, ketik `shell:startup`, Enter, lalu hapus shortcut **Kaigo Nikki** di folder itu.
