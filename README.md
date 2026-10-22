# 📒 介護日記 (Kaigo Nikki)

Aplikasi web catatan harian untuk pekerjaan kaigo. Berjalan **offline** di satu komputer (server) dan bisa dibuka dari komputer/tablet/HP lain di jaringan Wi-Fi/LAN yang sama. Tampilan berbahasa Jepang.

## Fitur
- **📅 日付で見る** — catatan per tanggal, yang terbaru paling atas. Filter: 今日 / 昨日 / 1週間 / 1か月 / すべて, pilih tanggal, cari kata, ⭐ 重要だけ.
- **👤 利用者で見る** — tekan tombol nama (atau ketik nama/ふりがな) → hanya catatan pasien itu yang tampil, plus memo pasien.
- **⚙️ 利用者の登録** — tambah/ubah/hapus pasien (nama, ふりがな, nomor kamar, memo).
- Catatan berisi teks, **foto dan video** (maks. 500MB per file), jenis (食事・排泄・服薬・転倒 dll.), penulis, tanda ⭐ 重要.
- Otomatis menampilkan catatan baru dari komputer lain (setiap 10 detik).
- Backup otomatis harian di `data/backups/` (30 hari terakhir).

## Cara memakai
1. Instal **Node.js** (versi 18 ke atas) dari https://nodejs.org/ di komputer server. Setelah itu tidak perlu internet, dan tidak perlu `npm install`.
2. Windows: klik dua kali **`start.bat`**. Mac/Linux: jalankan `./start.sh`.
3. Di jendela hitam akan muncul alamat, misalnya `http://192.168.1.10:3000`. Buka alamat itu di browser komputer/HP lain yang tersambung ke Wi-Fi yang sama. Alamat ini juga terlihat di bawah tab ⚙️ 利用者の登録.
4. Jangan tutup jendela server selama aplikasi dipakai.

> Jika komputer lain tidak bisa membuka, izinkan Node.js di Windows Firewall (jaringan Private).
> Sebaiknya atur IP komputer server menjadi tetap (static IP) di router agar alamat tidak berubah.

## Data
Semua data ada di folder **`data/`** (`db.json` + `uploads/` untuk foto/video). Untuk backup atau pindah komputer, cukup salin folder `data/`.

Port dan lokasi data bisa diganti: `PORT=8080 DATA_DIR=D:\kaigo-data node server.js`.
