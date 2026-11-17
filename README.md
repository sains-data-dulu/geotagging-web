# Geotagging Grid Sampel

Web untuk geotagging di lapangan. Peta menampilkan 99 grid (11 sampel × 9 sub-grid). Sampel 1–8 adalah sampel awal; sampel 9–11 adalah tambahan (`sampel_baru_split3x3.gpkg`).
Petugas berjalan ke grid, menekan **Tag di sini**, mengambil foto, lalu mengisi kuesioner.

Data yang direkam:
- latitude, longitude, akurasi GPS, dan ketinggian
- apakah titik berada di dalam grid, dan jaraknya ke grid
- foto, maksimal 6 per data
- jawaban kuesioner

Web ini sepenuhnya statis, jadi bisa di-hosting gratis di **GitHub Pages**.

## Isi folder

| File | Fungsi |
|---|---|
| `index.html` | Halaman tagging untuk petugas |
| `monitor.html` | Halaman monitoring, hanya untuk melihat, tanpa fitur tagging |
| `config.js` | URL Google Apps Script bersama, opsional |
| `css/style.css` | Tampilan |
| `js/app.js` | Logika aplikasi: peta, GPS, foto, kuesioner, data, ekspor, kirim |
| `js/zip.js` | Pembuat file ZIP untuk ekspor foto |
| `js/monitor.js` | Logika halaman monitoring |
| `data/grid.js` | Data 99 grid: sampel 1–8 dari `selected_sample_split3x3.gpkg`, sampel 9–11 dari `sampel_baru_split3x3.gpkg` |
| `vendor/leaflet/` | Library peta Leaflet 1.9.4 (disertakan, tanpa CDN) |
| `sw.js`, `manifest.webmanifest`, `icon.svg` | Agar bisa dipasang di layar utama HP dan tetap bisa dibuka saat sinyal lemah |
| `apps-script/Code.gs` | Opsional: penerima data ke Google Sheets |

## 1. Hosting di GitHub Pages

1. Buat repository baru di GitHub, misalnya `geotag-grid`. Repository boleh **Public**; GitHub Pages untuk repo private memerlukan akun berbayar.
2. Upload **semua isi folder ini**. Pastikan `index.html` berada di root repo, bukan di dalam subfolder.
   Caranya: **Add file → Upload files**, lalu drag seluruh isi folder.
3. Buka **Settings → Pages**. Pada *Source* pilih **Deploy from a branch**, branch `main`, folder `/ (root)`, lalu **Save**.
4. Setelah 1–2 menit, web tersedia di `https://<username>.github.io/geotag-grid/`.

GPS di browser **hanya berfungsi lewat HTTPS**. GitHub Pages sudah memakai HTTPS, jadi tidak perlu pengaturan tambahan.

## 2. Pemakaian di lapangan

1. Buka link di HP (Chrome/Safari), lalu **izinkan akses lokasi**.
2. Pertama kali dibuka, isi **Nama petugas** di Pengaturan (⚙︎).
3. *(Disarankan)* Pilih menu browser **Tambahkan ke layar utama** agar web bisa dibuka seperti aplikasi.
4. **Selagi masih ada sinyal**, geser dan zoom peta di sekitar lokasi grid. Tile peta yang pernah tampil akan disimpan, sehingga peta tetap terlihat saat sinyal di lapangan lemah.
5. Di lapangan:
   - Status di bawah peta menunjukkan Anda sedang berada di grid mana, atau grid terdekat dan jaraknya.
   - Untuk navigasi, ketuk sebuah grid lalu pilih **Arahkan (Google Maps)**.
   - Setelah berada di dalam grid, tekan **＋ Tag di sini**. Aplikasi otomatis mencari akurasi GPS terbaik selama beberapa detik, lalu memilih grid tempat Anda berdiri.
     Tekan **Ambil ulang lokasi** jika akurasinya masih kurang baik.
   - Tekan **Ambil foto** untuk membuka kamera. Foto otomatis diperkecil (sisi terpanjang 1600 px) dan diberi keterangan di bagian bawah: grid, koordinat, akurasi, waktu, dan nama petugas.
   - Isi kuesioner (pilihan berupa dropdown), lalu tekan **Simpan**.
6. Tampilan di peta:
   - **Batas sampel**: kotak oranye tebal dengan label *Sampel N x/9*. Label menunjukkan berapa sub-grid yang sudah di-tag. Kotak berubah hijau jika kesembilan sub-grid sudah di-tag. Ketuk label untuk zoom ke sampel itu.
   - **Sub-grid 3×3**: garis putus-putus putih berarti belum di-tag, isian hijau berarti sudah di-tag, dan kuning berarti grid yang sedang dipilih.
   - **Titik tagging**: ungu jika berada di dalam grid, oranye jika di luar grid. Ketuk titik untuk melihat foto dan jawaban kuesioner, atau untuk mengubah datanya.
   - Tombol lapisan (ikon tumpukan) dipakai untuk mengganti peta satelit/jalan dan untuk menyalakan atau mematikan ketiga lapisan di atas.
   - Tombol **Sampel** (ikon grid) membuka daftar semua sampel. Setiap sampel menampilkan mini-grid 3×3 berisi sub-grid yang sudah di-tag, progres, jumlah titik, dan jaraknya dari posisi Anda. Ketuk salah satu sampel untuk menuju ke sana.

Aturan konsistensi otomatis pada kuesioner:
- Jika **Jenis lahan = Bukan Sawah**, *Fase tumbuh* dan *Pola penanaman* otomatis diisi **Bukan Sawah**.
- Jika jenis lahan adalah salah satu jenis sawah, pilihan *Bukan Sawah* pada kedua pertanyaan tersebut dinonaktifkan.

Aplikasi akan meminta konfirmasi sebelum menyimpan jika:
- titik berada di luar grid yang dipilih, atau
- akurasi GPS lebih buruk dari 3× batas akurasi (batas default 10 m, bisa diubah di Pengaturan), atau
- belum ada foto.

## 3. Data tersimpan di mana?

Data disimpan **di HP masing-masing** (penyimpanan browser), sehingga tetap aman walau offline atau aplikasi ditutup.
Data isian disimpan di localStorage, sedangkan foto disimpan di IndexedDB.
Dari menu **Data** (ikon daftar), data bisa dilihat, diubah, dihapus, dan diekspor:

- **ZIP + foto**: berisi `data.csv`, `data.geojson`, dan folder `foto/`. Nama setiap foto tercantum di kolom `foto`.
- **CSV**: untuk dibuka di Excel/Google Sheets.
- **GeoJSON**: untuk dibuka di QGIS sebagai layer titik.

> ⚠️ Jangan *Clear browsing data* / hapus data situs sebelum data diekspor atau dikirim.

## 4. (Opsional) Kirim otomatis ke Google Sheets

Dengan cara ini data semua petugas terkumpul di satu spreadsheet, dan fotonya terkumpul di folder Google Drive **Geotag Grid - Foto**. Folder ini dibuat otomatis, dan link setiap foto masuk ke kolom `foto_url`.

1. Buat Google Spreadsheet baru, lalu buka **Extensions → Apps Script**.
2. Hapus isi editor, lalu tempel isi `apps-script/Code.gs`. Simpan.
3. Klik **Deploy → New deployment**. Pada ikon ⚙︎ pilih tipe **Web app**, lalu atur:
   - *Execute as*: **Me**
   - *Who has access*: **Anyone**
4. Klik **Deploy** dan izinkan aksesnya, termasuk akses Google Drive untuk menyimpan foto. Salin **Web app URL**, yang berakhiran `/exec`.
5. Di aplikasi, buka **⚙︎ Pengaturan** dan tempel URL tersebut di kolom *URL Google Apps Script*.

Setelah itu:
- Setiap kali menyimpan data, aplikasi langsung mencoba mengirim jika ada internet.
- Data yang belum terkirim ditandai *belum terkirim*, dan bisa dikirim ulang lewat **☁︎ Kirim ke Google Sheets**. Aplikasi juga mengirim ulang otomatis saat internet kembali.
- Pengiriman ulang dan data yang diubah tidak menimbulkan baris dobel, karena setiap data punya `uuid`.
- Foto yang sudah terkirim tidak di-upload ulang.

Jika Apps Script sudah pernah dipasang dari versi sebelumnya, ganti kodenya dengan `Code.gs` yang baru, lalu pilih **Deploy → Manage deployments → Edit → Version: New version**. Cara ini membuat URL `/exec` tetap sama.

Siapa pun yang memegang URL `/exec` dapat mengirim data ke sheet tersebut, jadi bagikan URL itu hanya kepada petugas.

### Isi URL sekali untuk semua petugas (opsional)

Daripada menempelkan URL di setiap HP, URL bisa diisi sekali di file `config.js`:

```js
window.CONFIG = { APPS_SCRIPT_URL: "https://script.google.com/macros/s/…/exec" };
```

Setelah file ini di-upload ke GitHub, halaman tagging dan halaman monitoring otomatis memakai URL tersebut.

## 5. Halaman monitoring

Halaman monitoring dibuka di `https://<username>.github.io/geotag-grid/monitor.html`.
Halaman ini hanya untuk memantau; tidak ada tombol tagging.

Yang ditampilkan:
- Peta berisi grid, batas sampel, dan titik tagging dari **semua petugas**. Data diambil dari Google Sheets.
- Ringkasan: jumlah titik, sub-grid yang sudah di-tag, sampel yang selesai, jumlah petugas, dan persentase progres.
- Filter per petugas.
- Daftar sampel dengan mini-grid 3×3 dan waktu tagging terakhir. Ketuk sampel untuk zoom ke sana.
- Daftar tagging terbaru. Ketuk salah satunya untuk melihat jawaban kuesioner dan link fotonya di Google Drive.
- Data dimuat ulang otomatis setiap 1 menit. Intervalnya bisa diubah di ⚙︎, atau tekan tombol ⟳ untuk memuat ulang manual.

Tampilannya menyesuaikan perangkat. Di laptop, panel berada di kiri. Di HP, panel berada di bawah dan bisa ditarik/diketuk untuk dibuka.

Halaman monitoring membutuhkan Google Sheets (bagian 4) dengan **Code.gs versi terbaru**, karena halaman ini membaca data melalui URL yang sama (`…/exec?action=data`).
Jika URL belum diisi, halaman hanya menampilkan grid dan data yang tersimpan di perangkat yang membukanya.

Siapa pun yang memegang URL `/exec` dapat **membaca** seluruh isi sheet lewat halaman ini, jadi bagikan URL hanya kepada tim.
Foto di Drive tetap mengikuti izin folder Drive Anda. Pemantau yang belum diberi akses ke folder **Geotag Grid - Foto** perlu dibagikan akses folder tersebut agar bisa membuka link foto.

## 6. Kolom data

`uuid, id_sub, id_polygon_asal, sub_posisi, petugas, waktu, latitude, longitude, akurasi_m, altitude_m, di_dalam_grid, jarak_ke_grid_m, jenis_tanaman, jenis_lahan, fase_tumbuh, topografi, pola_tanam, catatan, jumlah_foto, foto, dibuat, diubah`

Di Google Sheets ada tambahan kolom `foto_url` dan `diterima_server`.

- `waktu`: waktu saat lokasi GPS diambil (zona waktu HP).
- `akurasi_m`: radius akurasi GPS dalam meter, sesuai laporan HP.
- `jarak_ke_grid_m`: bernilai 0 jika titik berada di dalam grid.

## 7. Mengganti grid

Jika ingin memakai grid lain, buat ulang `data/grid.js` dari GPKG/GeoJSON (EPSG:4326). Isinya `window.GRID = <FeatureCollection>`.
Setiap feature wajib memiliki properti `id_sub`, `id_polygon_asal`, dan `sub_posisi`. Properti `jenis_sampel` bersifat opsional; jika ada, nilainya ditampilkan di daftar sampel.

`id_sub` harus unik. Jika menambah sampel baru, lanjutkan nomornya (misalnya sampel berikutnya = 12, dengan `id_sub` `12_11` … `12_33`). Jangan memakai ulang nomor sampel yang sudah ada, karena data tagging dicocokkan berdasarkan `id_sub`.

Setiap kali `data/grid.js` diganti, naikkan juga angka `?v=` pada `index.html` dan `monitor.html` (misalnya `?v=2.4` → `?v=2.5`). Tanpa itu, browser petugas bisa tetap memakai grid lama.
