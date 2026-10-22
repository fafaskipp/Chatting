# 📒 介護日記 (Kaigo Nikki)

Aplikasi web catatan harian untuk pekerjaan kaigo. Berjalan **offline** di satu komputer (server) dan bisa dibuka dari komputer/tablet/HP lain di jaringan Wi-Fi/LAN yang sama. Tampilan berbahasa Jepang.

## Fitur
- **📅 日付で見る** — catatan per tanggal, yang terbaru paling atas. Filter: 今日 / 昨日 / 1週間 / 1か月 / すべて, pilih tanggal, cari kata, ⭐ 重要だけ.
- **👤 利用者で見る** — tekan tombol nama (atau ketik nama/ふりがな) → hanya catatan pasien itu yang tampil, plus memo pasien.
- **⚙️ 利用者の管理** — 10 枠 (slot) pasien. Tombol ✏️ 編集 untuk mengubah data, 🗑 削除 saat pasien keluar/meninggal: slot menjadi （空き） dan bisa langsung diisi pasien pengganti dengan「＋ ここに登録する」. Catatan pasien lama tidak tercampur dengan pasien baru.
- **🗑 ゴミ箱** — catatan atau pasien yang dihapus masuk ke sini (pasien beserta semua catatannya). Bisa dilihat (📖 記録を見る), dikembalikan (↩️ 元に戻す), atau dihapus permanen (完全に消す / ゴミ箱を空にする).
- Catatan berisi teks, **foto dan video** (maks. 500MB per file), jenis catatan **bebas** (ketik sendiri atau pilih tombol: 食事・服薬・事故・ケガ dll.), penulis, tanda ⭐ 重要.
- **🖨 印刷・PDF** — mencetak daftar yang sedang tampil (pilih「PDFに保存」di jendela cetak untuk membuat PDF).
- **📊 Excelで保存** — menyimpan daftar yang sedang tampil sebagai file CSV yang bisa dibuka langsung di Excel.
- Otomatis menampilkan catatan baru dari komputer lain (setiap 10 detik).
- Backup otomatis harian di `data/backups/` (30 hari terakhir).

## Cara memakai
1. Instal **Node.js** (versi 18 ke atas) dari https://nodejs.org/ di komputer server. Setelah itu tidak perlu internet, dan tidak perlu `npm install`.
2. Windows: klik dua kali **`start.bat`**. Mac/Linux: jalankan `./start.sh`.
3. Di jendela hitam akan muncul alamat, misalnya `http://192.168.1.10:3000`. Buka alamat itu di browser komputer/HP lain yang tersambung ke Wi-Fi yang sama. Alamat ini juga terlihat di bawah tab ⚙️ 利用者の管理.
4. Jangan tutup jendela server selama aplikasi dipakai.
5. Agar server otomatis jalan setelah komputer restart (komputer 24 jam): tekan `Win + R`, ketik `shell:startup`, lalu taruh shortcut `start.bat` di folder yang terbuka.

> Jika komputer lain tidak bisa membuka, izinkan Node.js di Windows Firewall (jaringan Private).
> Sebaiknya atur IP komputer server menjadi tetap (static IP) di router agar alamat tidak berubah.

## Data
Semua data ada di folder **`data/`** (`db.json` + `uploads/` untuk foto/video). Untuk backup atau pindah komputer, cukup salin folder `data/`.

Port, lokasi data, dan jumlah slot bisa diganti: `PORT=8080 DATA_DIR=D:\kaigo-data SLOTS=12 node server.js`.

> Catatan: di Jepang catatan kaigo biasanya wajib disimpan beberapa tahun (umumnya 2–5 tahun). Sebaiknya jangan langsung 「完全に消す」 data pasien yang sudah keluar/meninggal — biarkan di ゴミ箱 atau cetak/ekspor dulu.
