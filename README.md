# 📒 介護日記 (Kaigo Nikki)

Aplikasi web catatan harian untuk pekerjaan kaigo. Berjalan **offline** di satu komputer (server) dan bisa dibuka dari komputer/tablet/HP lain di jaringan Wi-Fi/LAN yang sama. Tampilan berbahasa Jepang.

## Fitur
- **📅 日付** — catatan per tanggal, yang terbaru paling atas. Tombol cepat 今日 / 昨日 / 1週間 / 1か月 / すべて dan ⭐ 重要だけ. Pilih tanggal, jenis, dan cari kata ada di「🔍 詳しく探す」.
- Daftar catatan tampil 50 per halaman, lanjutkan dengan「⬇ もっと見る」.
- **👤 利用者** — tekan tombol nama (atau ketik nama/ふりがな) → hanya catatan pasien itu yang tampil, plus memo pasien. Catatan ditampilkan per bulan; pindah bulan dengan ◀ 前の月 / 次の月 ▶.
- **⚙️ 管理** — nama unit/ruangan (🏠 ユニット・部屋の名前) yang tampil di bagian paling atas aplikasi dan di tab browser; kalau kosong tertulis 介護日記. Di bawahnya ada **🌙 となりのユニット（夜勤）**: isi nama dan alamat unit sebelah (misalnya `http://192.168.1.11:3000`; `http://` boleh tidak ditulis; hanya http/https yang diterima). Kalau alamat diisi, tombol「となりのユニットの記録を見る ▶」muncul di **paling bawah layar 📅 日付** (setelah semua catatan hari itu), dan membuka catatan unit sebelah di tab baru. Tombol 🔗 ひらいてみる dipakai untuk mengecek alamat. Dikosongkan = tombol tidak muncul. Lalu 10 枠 (slot) pasien. Tombol ✏️ 編集 untuk mengubah data, 🗑 削除 saat pasien keluar/meninggal: slot menjadi （空き） dan bisa langsung diisi pasien pengganti dengan「＋ ここに登録する」. Catatan pasien lama tidak tercampur dengan pasien baru.
- **🗓 予定** — kalender bulanan seperti Google Calendar, diisi langsung di aplikasi: tanggal, jam, isi agenda, pasien (atau 全体), ulangi (なし / 毎週 / 毎月, bisa sampai tanggal tertentu), dan memo. Ketuk tanggal untuk melihat atau menambah agenda hari itu. Agenda hari ini dan besok muncul sebagai pengingat 🔔 di atas tab 📅 日付, dan jumlah agenda hari ini tampil di tab 🗓.
- **📝 評価** — hanya menampilkan data (tanpa input): per bulan, setiap pasien beserta kejadian bulan itu — ⚠️ ヒヤリ・事故 dan ⭐ catatan penting — diambil otomatis dari catatan harian. Tombol「📖 この月の記録をすべて見る」untuk melihat semua catatan pasien bulan itu. Pindah bulan dengan ◀ 前の月 / 次の月 ▶. Bisa dicetak.
- **📊 まとめ** — rekap per bulan (semua pasien atau satu pasien): jumlah catatan, ヒヤリ・事故, catatan penting, jumlah per jenis dan per pasien, serta daftar catatan ⭐ 重要. Bisa dicetak.
- **🗑 ゴミ箱** — catatan, agenda, atau pasien yang dihapus masuk ke sini. Saat pasien dihapus, **semua data yang berhubungan dengan pasien itu** (catatan dan agenda, termasuk yang sebelumnya sudah dihapus satu per satu) dikumpulkan jadi satu bersama pasien; saat pasien dihapus permanen, semuanya ikut terhapus. Bisa dilihat (📖 記録を見る), dikembalikan (↩️ 元に戻す), atau dihapus permanen (完全に消す). Isi ゴミ箱 **terhapus otomatis setelah 30 hari**.
- Catatan berisi teks, **foto** (otomatis diperkecil agar ringan) dan video pendek (maks. 100MB), jenis catatan **bebas** (ketik sendiri atau pilih tombol: 食事・服薬・ヒヤリ・事故 dll.), penulis, tanda ⭐ 重要.
- **🖨 印刷・PDF** — mencetak daftar yang sedang tampil (pilih「PDFに保存」di jendela cetak untuk membuat PDF).
- Otomatis menampilkan catatan baru dari komputer lain (setiap 10 detik). Beberapa orang bisa menyimpan catatan bersamaan tanpa ada yang hilang.
- Menu tab memakai nama pendek dengan ikon, sama di semua ukuran layar. Di HP, menu pindah ke bawah layar agar mudah dijangkau jempol.
- Backup otomatis harian di `data/backups/` (30 hari terakhir).

## Cara memakai

👉 **Panduan lengkap langkah demi langkah untuk Windows: [SETUP-WINDOWS.md](SETUP-WINDOWS.md)** (termasuk `setup-windows.bat` untuk firewall, jalan otomatis, dan shortcut Desktop).

Ringkasnya:
1. Instal **Node.js** (versi 18 ke atas) dari https://nodejs.org/ di komputer server. Setelah itu tidak perlu internet, dan tidak perlu `npm install`.
2. Windows: klik dua kali **`start.bat`**. Mac/Linux: jalankan `./start.sh`.
3. Di jendela hitam akan muncul alamat, misalnya `http://192.168.1.10:3000`. Buka alamat itu di browser komputer/HP lain yang tersambung ke Wi-Fi yang sama. Alamat ini juga terlihat di bawah tab ⚙️ 管理.
4. Jangan tutup jendela server selama aplikasi dipakai.
5. Agar server otomatis jalan setelah komputer restart (komputer 24 jam): tekan `Win + R`, ketik `shell:startup`, lalu taruh shortcut `start.bat` di folder yang terbuka.

> Jika komputer lain tidak bisa membuka, izinkan Node.js di Windows Firewall (jaringan Private).
> Sebaiknya atur IP komputer server menjadi tetap (static IP) di router agar alamat tidak berubah.

## Data
Semua data ada di folder **`data/`** (`db.json` + `uploads/` untuk foto/video). Untuk backup atau pindah komputer, cukup salin folder `data/`.

Port, lokasi data, dan jumlah slot bisa diganti: `PORT=8080 DATA_DIR=D:\kaigo-data SLOTS=12 node server.js`.

> Catatan: data pasien yang dihapus akan hilang permanen 30 hari kemudian. Kalau masih ingin menyimpan catatannya, kembalikan dulu pasiennya (↩️ 元に戻す), lalu cetak.

## Versi demo (iPad / tanpa server)
`node demo/build.js` membuat `demo/kaigo-demo.html`: satu file yang berjalan langsung di browser tanpa server, berisi contoh data. Data hanya tersimpan di browser perangkat itu. Cetak dan berbagi antar-perangkat tidak tersedia di versi demo.

## Halaman pilih unit (`launcher/index.html`)
Halaman sederhana dengan 8 tombol unit (モモの木・うめの木・かきの木・びわの木・なしの木・ゆずの木・みかん・りんご) yang membuka 介護日記 masing-masing unit.
- Tab **🍎 ひらく**: tekan tombol unit → 介護日記 unit itu terbuka di tab baru.
- Tab **⚙️ リンク設定**: isi alamat tiap unit (misalnya `http://192.168.1.10:3000`; `http://` boleh tidak ditulis). Tersimpan otomatis di perangkat itu. Untuk menyalin pengaturan ke perangkat lain, pakai kode di bagian「📲 ほかの端末にも同じ設定を入れる」.
- Cara membuka: klik dua kali file `launcher/index.html` di komputer, **atau** buka `http://ALAMAT-IP:3000/launcher` dari server 介護日記 unit mana pun (cara ini yang paling mudah untuk iPad/HP).
- Kalau ingin alamat sudah terisi di semua perangkat tanpa input, isi `url: ''` di bagian `UNITS` di dalam file itu.

## Panduan untuk staf (`docs/`)
- `docs/guide-ja.pdf` — **panduan A4 dua halaman dalam bahasa Jepang** (pengenalan + cara pakai + aturan bersama). Cetak dan tempel di dekat komputer unit. Isi kolom alamat dan nama penanggung jawab dengan pulpen.
- `docs/guide-ja.html` — file yang sama dalam bentuk HTML (buka di browser, cetak dengan Ctrl+P / pilih「PDFに保存」).
- `docs/manual-ja.pdf` — **manual cara pakai 20 halaman dengan huruf besar, untuk orang yang belum biasa memakai komputer**. Satu halaman satu tindakan, screenshot diberi tanda merah dan nomor「ここを押す」, ada halaman「こまったとき」dan「やくそく」. Cetak A4, jilid, dan taruh di dekat komputer. Isi kolom nama unit, orang yang bisa ditanya, dan kontak di sampul dan halaman terakhir. Sebelum dipakai, pasang ikon 介護日記 di tiap perangkat (SETUP-WINDOWS.md → Langkah 5b).
- `docs/manual-ja.html` — isi yang sama dalam bentuk HTML.

