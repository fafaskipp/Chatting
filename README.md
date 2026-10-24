# 📒 介護日記 (Kaigo Nikki)

Aplikasi web catatan harian untuk pekerjaan kaigo. Berjalan **offline** di satu komputer (server) dan bisa dibuka dari komputer/tablet/HP lain di jaringan Wi-Fi/LAN yang sama. Tampilan berbahasa Jepang.

## Fitur
- **📅 日付で見る** — catatan per tanggal, yang terbaru paling atas. Tombol cepat 今日 / 昨日 / 1週間 / 1か月 / すべて dan ⭐ 重要だけ. Pilih tanggal, jenis, dan cari kata ada di「🔍 詳しく探す」.
- Daftar catatan tampil 50 per halaman, lanjutkan dengan「⬇ もっと見る」.
- **👤 利用者で見る** — tekan tombol nama (atau ketik nama/ふりがな) → hanya catatan pasien itu yang tampil, plus memo pasien.
- **⚙️ 利用者の管理** — 10 枠 (slot) pasien. Tombol ✏️ 編集 untuk mengubah data, 🗑 削除 saat pasien keluar/meninggal: slot menjadi （空き） dan bisa langsung diisi pasien pengganti dengan「＋ ここに登録する」. Catatan pasien lama tidak tercampur dengan pasien baru.
- **📊 年間まとめ** — rekap per tahun (semua pasien atau satu pasien): jumlah catatan per bulan, per jenis, per pasien, dan daftar catatan ⭐ 重要. Bisa dicetak.
- **🗑 ゴミ箱** — catatan atau pasien yang dihapus masuk ke sini (pasien beserta semua catatannya). Bisa dilihat (📖 記録を見る), dikembalikan (↩️ 元に戻す), atau dihapus permanen (完全に消す). Isi ゴミ箱 **terhapus otomatis setelah 30 hari**.
- Catatan berisi teks, **foto** (otomatis diperkecil agar ringan) dan video pendek (maks. 100MB), jenis catatan **bebas** (ketik sendiri atau pilih tombol: 食事・服薬・ヒヤリ・事故 dll.), penulis, tanda ⭐ 重要.
- **🖨 印刷・PDF** — mencetak daftar yang sedang tampil (pilih「PDFに保存」di jendela cetak untuk membuat PDF).
- **📊 Excelで保存** — menyimpan daftar yang sedang tampil sebagai file CSV yang bisa dibuka langsung di Excel.
- Otomatis menampilkan catatan baru dari komputer lain (setiap 10 detik). Beberapa orang bisa menyimpan catatan bersamaan tanpa ada yang hilang.
- Tampilan HP: menu tab pindah ke bawah layar seperti aplikasi HP.
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

> Catatan: data pasien yang dihapus akan hilang permanen 30 hari kemudian. Kalau masih ingin menyimpan catatannya, kembalikan dulu pasiennya (↩️ 元に戻す), lalu cetak atau simpan ke Excel.

## Versi demo (iPad / tanpa server)
`node demo/build.js` membuat `demo/kaigo-demo.html`: satu file yang berjalan langsung di browser tanpa server, berisi contoh data. Data hanya tersimpan di browser perangkat itu. Cetak, Excel, dan berbagi antar-perangkat tidak tersedia di versi demo.
