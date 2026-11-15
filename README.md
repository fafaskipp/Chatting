# 📒 介護日記 8ユニット版 (Kaigo Nikki Multi-Unit)

Aplikasi web catatan harian untuk pekerjaan kaigo. Berjalan **offline** di satu komputer (server) dan bisa dibuka dari komputer/tablet/HP lain di jaringan Wi-Fi/LAN yang sama.

> **Proyek ini terpisah dari versi lama "1 server = 1 unit".** Di sini **1 server melayani 8 unit sekaligus**, dan catatan tiap unit disimpan **terpisah** (pasien, catatan, agenda, foto, tempat sampah, dan backup masing-masing). Satu unit tidak bisa melihat atau mengubah data unit lain, kecuali dengan membuka halaman unit itu.

## Login (10 akun)
Membuka aplikasi selalu ke **halaman login**: pilih tombol akun, lalu ketik password.

| Akun | ID | Password awal | Setelah login |
|---|---|---|---|
| 8 unit | `momo` `ume` `kaki` `biwa` `nashi` `yuzu` `mikan` `ringo` | sama dengan ID | langsung ke catatan unitnya |
| Nurse (看護師) | `nurse` | `nurse` | halaman semua unit |
| Care manager (ケアマネジャー, admin) | `care` | `care` | halaman semua unit |

**Password awal mudah ditebak — gantilah.** Aplikasi menampilkan pengingat kuning sampai diganti (minimal 4 karakter).

Hak akses (diperiksa di **server**, bukan hanya disembunyikan di layar):

| | Unit sendiri | Unit lain |
|---|---|---|
| Akun unit | semua: tulis, edit, hapus, pasien, agenda, pengaturan, tempat sampah | melihat tab 📅 日付・👤 利用者・🗓 予定 dan **hanya menambah catatan** (untuk shift malam). Nama penulis otomatis nama unitnya (mis. かきの木); tidak bisa mengedit/menghapus |
| Nurse / Care manager | — | melihat semua unit (termasuk 評価・まとめ), **menulis** catatan & agenda, **mengedit hanya tulisannya sendiri**, **tidak bisa menghapus apa pun** |

- Menghapus (catatan, agenda, pasien, tempat sampah), data pasien, dan pengaturan unit hanya milik **akun unit itu** — unit adalah pihak terkuat atas catatannya. Catatan yang ditulis nurse/care manager diberi tanda 🩺/📋 dan bisa dihapus oleh unit.
- Akun unit membuka unit lain lewat tombol 🏠 (semua unit) atau tombol unit sebelah di paling bawah 📅 日付. Saat melihat unit lain muncul pita biru "見るだけ" dan tombol tulis/edit/hapus hilang.
- **Ganti password sendiri:** akun unit di tab ⚙️ 管理 (kartu 🔑); nurse & care manager lewat tombol 🔑 アカウントの設定 di home.
- **Care manager** di halaman itu juga bisa mengganti nama dan mereset password ke-10 akun. Mereset password mengeluarkan akun itu dari semua perangkat.
- **Pop-up 🔔 ほかの人からの新しい記録:** saat membuka unitnya sendiri, staf unit melihat catatan baru yang ditulis nurse, care manager, atau unit lain di unit itu. 「✅ 確認しました」 menghilangkan pop-up untuk semua perangkat unit itu; 「あとで」 menundanya.
- Home nurse/care manager menampilkan **🔔 この1週間の大事なこと**: catatan ⭐ penting dan ⚠️ ヒヤリ・事故 dari semua unit selama **7 hari terakhir**, dikelompokkan per hari (hari ini paling atas, lalu kemarin, dst.), terbaru di atas dalam tiap hari, lengkap dengan nama penghuni dan penulis. Bisa disaring per unit. Hari tanpa catatan tetap ditampilkan agar terlihat urutannya.
- Masa login: akun unit 30 hari per perangkat; nurse/care manager 12 jam. 5 kali salah password → tunggu 1 menit.
- **Lupa password** (termasuk care manager): di komputer server `node tools/reset-password.js` (daftar akun), `node tools/reset-password.js care` (kembali ke password awal), atau `node tools/reset-password.js care passwordbaru`.
- Akun disimpan di `data/accounts.json` (password dalam bentuk hash scrypt), sesi di `data/sessions.json`.
- Catatan keamanan: login berjalan lewat HTTP di jaringan lokal, jadi password tidak terenkripsi di kabel/Wi-Fi kantor. Jangan buka server ini ke internet.

## 📱 QR code untuk membuka di perangkat lain
Tekan **📒 介護日記 📱** di home atau halaman login, atau **nama unit** di bar biru halaman unit. Pop-up QR code muncul dan bisa dipindai kamera HP/tablet.
- Kalau aplikasi dibuka di komputer server (`localhost`), QR otomatis memakai **alamat jaringan** (mis. `http://192.168.1.10:3000`), bukan localhost. Kalau ada lebih dari satu jaringan, alamat bisa dipilih.
- QR dari halaman unit langsung membuka unit itu (`/u/kaki/`); perangkat baru akan diminta login dulu.
- Dibuat offline dengan `public/vendor/qrcode.js` (qrcode-generator, MIT). Ada tombol 📋 untuk menyalin alamat.
- HP harus tersambung ke Wi-Fi yang sama.

## Cara kerja 8 unit
- Buka `http://ALAMAT-IP:3000` → muncul **halaman pilih unit** (8 tombol buah: モモの木・うめの木・かきの木・びわの木・なしの木・ゆずの木・みかん・りんご) dengan jumlah catatan hari ini.
- Tekan satu unit → masuk ke `http://ALAMAT-IP:3000/u/ume/` (alamat tiap unit tetap, boleh dibuat shortcut / ikon layar utama di HP & iPad unit itu).
- Tombol 🏠 di kiri atas kembali ke pilihan unit.
- **Shift malam (1 petugas, 2 unit):** di ⚙️ 管理 pilih **unit sebelah** dari daftar → tombol 「…の記録を見る ▶」 muncul di paling bawah layar 📅 日付. Tidak perlu lagi mengetik alamat.
- Bahasa (日本語 / Indonesia / English) dipilih sekali per perangkat dan berlaku untuk semua unit.
- Daftar dan nama unit ada di **`units.json`** (id = huruf kecil/angka untuk alamat; name = nama tampil; color & shape = gambar buah). Mengganti nama di ⚙️ 管理 juga mengubah nama di halaman pilih unit. Untuk menambah/mengurangi unit, ubah `units.json` lalu restart server.
- Data: `data/units/<id>/` (`db.json`, `uploads/`, `backups/`). Backup harian otomatis 30 hari per unit.
- Satu penerjemah offline dipakai bersama oleh semua unit.
- **Memindahkan data dari versi lama** (tiap unit sebelumnya punya server sendiri): hentikan server baru, lalu `node tools/import-unit.js D:\kaigo-lama\data ume` (folder `data` lama → id unit). Ulangi untuk tiap unit. Folder lama tidak diubah.


## Fitur
- **📅 日付** — catatan per tanggal, yang terbaru paling atas. Tombol cepat 今日 / 昨日 / 1週間 / 1か月 / すべて dan ⭐ 重要だけ. Pilih tanggal, jenis, dan cari kata ada di「🔍 詳しく探す」.
- Daftar catatan tampil 50 per halaman, lanjutkan dengan「⬇ もっと見る」.
- **👤 利用者** — tekan tombol nama (atau ketik nama/ふりがな) → hanya catatan pasien itu yang tampil, plus memo pasien. Catatan ditampilkan per bulan; pindah bulan dengan ◀ 前の月 / 次の月 ▶.
- **⚙️ 管理** — nama unit/ruangan (🏠 ユニット・部屋の名前) yang tampil di bagian paling atas aplikasi dan di tab browser; kalau kosong tertulis 介護日記. Di bawahnya ada **🌙 となりのユニット（夜勤）**: isi nama dan alamat unit sebelah (misalnya `http://192.168.1.11:3000`; `http://` boleh tidak ditulis; hanya http/https yang diterima). Kalau alamat diisi, tombol「となりのユニットの記録を見る ▶」muncul di **paling bawah layar 📅 日付** (setelah semua catatan hari itu), dan membuka catatan unit sebelah di tab baru. Tombol 🔗 ひらいてみる dipakai untuk mengecek alamat. Dikosongkan = tombol tidak muncul. Lalu 10 枠 (slot) pasien. Tombol ✏️ 編集 untuk mengubah data, 🗑 削除 saat pasien keluar/meninggal: slot menjadi （空き） dan bisa langsung diisi pasien pengganti dengan「＋ ここに登録する」. Catatan pasien lama tidak tercampur dengan pasien baru.
- **🌐 Bahasa** — tombol 🌐 di pojok kanan atas: 日本語 (default) / Bahasa Indonesia / English. Pilihan disimpan per perangkat (localStorage), tanpa internet. Karena penyimpanan browser per alamat, setiap alamat unit perlu dipilih sekali di tiap perangkat; tombol unit sebelah membawa pilihan bahasa otomatis (`?lang=`). Kategori disimpan dalam bahasa Jepang di data, jadi hitungan dan deteksi insiden tetap sama di semua bahasa. Kamus ada di `public/lang/{ja,id,en}.js`; cek kelengkapan setelah mengedit dengan `node tools/check-lang.js`. Terjemahan Indonesia/Inggris sebaiknya dikoreksi penutur asli. Bahasa tidak lagi dipilih otomatis dari bahasa browser; default selalu Jepang sampai dipilih. Panduan/manual PDF dan halaman launcher masih bahasa Jepang.
- **🤖 Terjemahan otomatis offline (opsional)** — staf menulis catatan/agenda dalam **bahasa Jepang**; server menerjemahkannya di latar belakang ke Indonesia dan Inggris dengan model NLLB-200 distilled 600M (int8) lewat CTranslate2. Semuanya jalan di PC unit **tanpa internet** dan tanpa data keluar. Sudah diuji dengan model asli: sekitar 5 detik untuk beberapa kalimat di CPU biasa, memakai RAM sekitar 1–2 GB.
  - Catatan asli selalu tampil; terjemahan tampil di atasnya dengan label 🤖 saat bahasa aplikasi bukan Jepang. Hasil disimpan di `db.json` (field `tr`), tidak diterjemahkan ulang; kalau teks diedit, dibuat ulang. Catatan 60 hari terakhir yang sudah ada diterjemahkan otomatis saat pertama aktif.
  - **Kamus istilah perawatan** `translator/glossary.json` (≈80 istilah: 褥瘡, 失禁, 排便, 誤嚥, ヒヤリハット, 転倒, 傾眠 …). Model mentah sering salah besar untuk istilah ini (misalnya 褥瘡 → "I don't have a shell", 徘徊 → "frog"), jadi istilah dilindungi dan diganti terjemahan baku. Bisa ditambah/diubah dengan editor teks (format: `"言葉": {"en": "...", "id": "..."}`); berlaku tanpa restart.
  - **Pasang sekali (butuh internet ±600 MB hanya untuk ini):** instal Python 3.10+ (centang "Add python.exe to PATH"), klik dua kali `translator\setup-translator.bat`, lalu jalankan `start.bat` seperti biasa — server menjalankan penerjemah sendiri. Unduhan bisa dilanjutkan kalau terputus. Tanpa pemasangan, aplikasi tetap normal (hanya Jepang). Status terlihat di tab ⚙️ 管理.
  - **PC tanpa internet sama sekali:** di PC yang punya internet, instal Python lalu klik dua kali `translator\make-offline-bundle.bat` (mengunduh folder `wheels` + `model`). Zip seluruh proyek **tanpa** folder `venv` dan `data`, lalu bawa zip + installer Node.js + installer Python (versi **sama** dengan PC pertama, mis. 3.12) ke PC tujuan. Di sana instal keduanya, unzip, dan klik `translator\setup-translator.bat` — tanpa internet pun jalan. Folder `venv` jangan dibawa (tidak bisa dipindah antar komputer).
  - Env: `KAIGO_TRANSLATE=off` mematikan, `TRANSLATOR_PORT`, `TRANSLATOR_URL`, `KAIGO_PYTHON`.
  - **Batas kualitas:** ini terjemahan mesin untuk membantu memahami isi, bukan pengganti konfirmasi. Bahasa Jepang sering menghilangkan subjek, sehingga hasil bisa berbunyi "I ate…" / "Aku makan…" padahal maksudnya penghuni; tata bahasa kadang janggal. Nama orang/obat di luar kamus bisa salah. Untuk kejadian penting (jatuh, salah obat, demam) tetap konfirmasi langsung.
- **🗓 予定** — kalender bulanan seperti Google Calendar, diisi langsung di aplikasi: tanggal, jam, isi agenda, pasien (atau 全体), ulangi (なし / 毎週 / 毎月, bisa sampai tanggal tertentu), dan memo. Ketuk tanggal untuk melihat atau menambah agenda hari itu. Agenda hari ini dan besok muncul sebagai pengingat 🔔 di atas tab 📅 日付, dan jumlah agenda hari ini tampil di tab 🗓.
- **📝 評価** — hanya menampilkan data (tanpa input): per bulan, setiap pasien beserta kejadian bulan itu — ⚠️ ヒヤリ・事故 dan ⭐ catatan penting — diambil otomatis dari catatan harian. Tombol「📖 この月の記録をすべて見る」untuk melihat semua catatan pasien bulan itu. Pindah bulan dengan ◀ 前の月 / 次の月 ▶. Bisa dicetak.
- **📊 まとめ** — rekap per bulan (semua pasien atau satu pasien): jumlah catatan, ヒヤリ・事故, catatan penting, jumlah per jenis dan per pasien, serta daftar catatan ⭐ 重要. Bisa dicetak.
- **🗑 ゴミ箱** — catatan, agenda, atau pasien yang dihapus masuk ke sini. Saat pasien dihapus, **semua data yang berhubungan dengan pasien itu** (catatan dan agenda, termasuk yang sebelumnya sudah dihapus satu per satu) dikumpulkan jadi satu bersama pasien; saat pasien dihapus permanen, semuanya ikut terhapus. Bisa dilihat (📖 記録を見る), dikembalikan (↩️ 元に戻す), atau dihapus permanen (完全に消す). Isi ゴミ箱 **terhapus otomatis setelah 30 hari**.
- Catatan berisi teks, **foto** (otomatis diperkecil agar ringan) dan video pendek (maks. 100MB), jenis catatan **bebas** (ketik sendiri atau pilih tombol: 食事・服薬・ヒヤリ・事故 dll.), penulis, tanda ⭐ 重要.
- **🖨 印刷・PDF** — mencetak daftar yang sedang tampil (pilih「PDFに保存」di jendela cetak untuk membuat PDF).
- Otomatis menampilkan catatan baru dari komputer lain (setiap 10 detik). Beberapa orang bisa menyimpan catatan bersamaan tanpa ada yang hilang.
- Menu tab memakai nama pendek dengan ikon, sama di semua ukuran layar. Di HP, menu pindah ke bawah layar agar mudah dijangkau jempol.

## Cara memakai

👉 **Panduan lengkap langkah demi langkah untuk Windows: [SETUP-WINDOWS.md](SETUP-WINDOWS.md)** (termasuk `setup-windows.bat` untuk firewall, jalan otomatis, dan shortcut Desktop).

Ringkasnya:
1. Instal **Node.js** (versi 18 ke atas) dari https://nodejs.org/ di komputer server. Setelah itu tidak perlu internet, dan tidak perlu `npm install`.
2. Windows: klik dua kali **`start.bat`**. Mac/Linux: jalankan `./start.sh`. Penerjemah di Linux/Mac: `./translator/setup-translator.sh` (sekali saja).
3. Di jendela hitam akan muncul alamat, misalnya `http://192.168.1.10:3000`. Buka alamat itu di browser komputer/HP lain yang tersambung ke Wi-Fi yang sama. Alamat ini juga terlihat di bawah tab ⚙️ 管理.
4. Jangan tutup jendela server selama aplikasi dipakai.
5. Agar server otomatis jalan setelah komputer restart (komputer 24 jam): tekan `Win + R`, ketik `shell:startup`, lalu taruh shortcut `start.bat` di folder yang terbuka.

> Jika komputer lain tidak bisa membuka, izinkan Node.js di Windows Firewall (jaringan Private).
> Sebaiknya atur IP komputer server menjadi tetap (static IP) di router agar alamat tidak berubah.

## Data
Semua data ada di folder **`data/`** (satu subfolder per unit di `data/units/`). Untuk backup atau pindah komputer, cukup salin folder `data/`.

Port, lokasi data, dan jumlah slot bisa diganti: `PORT=8080 DATA_DIR=D:\kaigo-data SLOTS=12 node server.js`.

> Catatan: data pasien yang dihapus akan hilang permanen 30 hari kemudian. Kalau masih ingin menyimpan catatannya, kembalikan dulu pasiennya (↩️ 元に戻す), lalu cetak.

## Data demo untuk mengecek sistem
Saat server menyala, di terminal lain: `node tools/seed-demo.js` (atau `--url http://ALAMAT:3000`). Skrip login sebagai tiap akun unit dengan password awal; kalau sudah diganti, tambahkan `--passwords kaki=xxxx,ume=yyyy`. Mengisi 8 unit: 5 pasien, ±50 catatan 7 hari terakhir (termasuk jatuh/ヒヤリハット, catatan penting, istilah perawatan untuk uji penerjemah), agenda, dan 3 foto contoh per unit; pasangan unit sebelah juga diatur. Unit yang sudah berisi dilewati (tambah `--force` untuk menambah lagi). Mengulang dari nol: hentikan server lalu hapus folder `data/`.

## Panduan untuk staf (`docs/`)
- `docs/manual-ja.pdf` — panduan cetak A4 22 halaman dalam bahasa Jepang, huruf besar, satu langkah per halaman, dengan foto layar versi 8 unit: login, menulis, melihat, agenda, hapus & tempat sampah, pop-up 🔔, shift malam (unit sebelah), home, nurse/care manager, ganti password, furigana & bahasa, tabel hak akses, dan こまったとき. `docs/manual-ja.html` adalah versi yang bisa dibuka di browser.
- Sampul punya kolom untuk nama unit dan ID login. Password jangan ditulis di panduan.

## Catatan
- Versi demo (iPad) ada di proyek lama dan belum dipindah ke sini.
- Cek kelengkapan kamus bahasa: `node tools/check-lang.js`.
