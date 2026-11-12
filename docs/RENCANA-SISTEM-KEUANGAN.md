# Rencana Pengembangan Sistem Keuangan Koperasi KPN Padang

## Tujuan

Aplikasi menjadi sistem operasional keuangan koperasi. Excel hanya dipakai untuk migrasi data historis/awal dan ekspor laporan bila diperlukan, bukan untuk pencatatan rutin.

## Prinsip yang tidak boleh dilanggar

1. Data transaksi menjadi sumber kebenaran (single source of truth); dashboard dan laporan dihitung dari transaksi, bukan angka yang diketik ulang.
2. Setiap transaksi memiliki tanggal, periode, nomor referensi, jenis, nominal, anggota terkait bila relevan, pembuat, status, dan jejak audit.
3. Transaksi yang sudah disahkan tidak dihapus diam-diam. Koreksi dilakukan melalui pembatalan/reversal dan transaksi pengganti.
4. Data anggota yang memiliki riwayat transaksi tidak dihapus permanen; gunakan status nonaktif/keluar.
5. Periode harus berasal dari tanggal transaksi/periode yang tervalidasi. Tidak boleh ada fallback diam-diam ke bulan tertentu.
6. Data pribadi dan rincian keuangan hanya untuk administrator/petugas berwenang. Publik hanya menerima ringkasan agregat yang disetujui.
7. Setiap perubahan saldo harus dapat ditelusuri ke transaksi sumber.

## Modul sasaran

### 1. Master anggota
- Tambah, lihat detail, ubah, aktif/nonaktifkan anggota.
- Nomor anggota unik, identitas dan kontak sesuai kebutuhan koperasi.
- Riwayat simpanan, pinjaman, angsuran, dan transaksi per anggota.
- Mencegah penghapusan permanen bila sudah ada transaksi.

### 2. Simpanan
- Jenis simpanan pokok, wajib, dan sukarela.
- Setoran, penarikan yang disetujui, koreksi melalui reversal.
- Saldo per jenis dan buku besar per anggota.
- Validasi aturan simpanan koperasi sebelum transaksi disahkan.

### 3. Pinjaman
- Pengajuan, pemeriksaan, persetujuan/penolakan, pencairan.
- Pokok, bunga, metode perhitungan, tenor, jadwal angsuran.
- Status aktif, lunas, ditolak, dan dibatalkan.
- Snapshot saldo untuk laporan historis; saldo berjalan dihitung dari transaksi.

### 4. Angsuran
- Penerimaan pembayaran dan alokasi pokok/bunga/denda bila berlaku.
- Jadwal jatuh tempo, tunggakan, pelunasan dipercepat.
- Mencegah pembayaran ganda dan pembayaran melebihi kewajiban tanpa persetujuan.

### 5. Kas dan akuntansi
- Kas masuk/keluar, akun kas/bank, kategori biaya dan pendapatan.
- Buku kas, jurnal, buku besar, neraca saldo, laporan aktivitas/SHU.
- Rekonsiliasi saldo akun dengan transaksi sumber.

### 6. Periode dan pelaporan
- Buka/tutup periode, kunci periode yang telah ditutup.
- Laporan bulanan dan tahunan dari data transaksi.
- Ekspor PDF/Excel sebagai keluaran laporan, bukan sumber pencatatan.
- Proses tutup buku dan pembukaan saldo periode berikutnya yang dapat diaudit.

### 7. Tata kelola
- Peran terpisah (super admin, pengelola, pemeriksa/penyetuju, kasir) sesuai kebijakan koperasi.
- Persetujuan berjenjang untuk transaksi tertentu.
- Audit log, backup, pemulihan, dan pengujian aturan akses.

## Rencana pelaksanaan

### Tahap 0 — Audit dan pengamanan fondasi
- Inventarisasi koleksi Firestore, aturan keamanan, proses impor, dan struktur data saat ini.
- Perbaiki deteksi periode: tanggal sumber harus eksplisit, tervalidasi, dan dikonfirmasi sebelum penyimpanan.
- Pastikan data historis tidak tertimpa saat migrasi.
- Tetapkan model transaksi dan strategi migrasi dari koleksi lama.

### Tahap 1 — Master anggota
- CRUD anggota lengkap dengan validasi dan nonaktifkan, bukan hapus permanen.
- Profil anggota dan halaman riwayat keuangan.
- Audit log untuk setiap perubahan.

### Tahap 2 — Mesin transaksi simpanan dan kas
- Form transaksi langsung di aplikasi.
- Nomor transaksi unik, validasi, persetujuan, pembatalan/reversal.
- Saldo otomatis dari transaksi yang disahkan.

### Tahap 3 — Pinjaman dan angsuran
- Pengajuan sampai pencairan.
- Jadwal dan kalkulasi angsuran yang dapat diuji.
- Pembayaran, alokasi, tunggakan, dan pelunasan.

### Tahap 4 — Laporan dan tutup buku
- Buku kas, rekap simpanan, pinjaman, angsuran, dan laporan keuangan.
- Penguncian periode dan audit rekonsiliasi.

### Tahap 5 — Migrasi, pengujian, dan peluncuran
- Impor historis hanya setelah pemetaan dan rekonsiliasi disetujui.
- Uji skenario normal, batas, pembatalan, akses tidak sah, dan pemulihan.
- Rilis bertahap; jangan mengganti alur kerja berjalan sebelum hasil uji dan backup diverifikasi.

## Catatan kondisi aplikasi saat ini

Implementasi saat ini masih berpusat pada impor workbook bulanan ke koleksi `monthly_records`, `loan_snapshots`, dan `periods`. Tampilan anggota masih berupa daftar baca-saja. Model ini belum cukup untuk menjadi buku besar transaksi operasional. Pengembangan berikutnya harus membangun transaksi sebagai sumber data utama dan menyediakan migrasi yang aman dari data impor lama.


## Aturan bisnis yang harus diterapkan pada rekap

### Periode A2 dan nomor cicilan

- Sel A2 pada ketiga sheet adalah tanggal acuan periode. Contoh `01/11/2026` berarti periode **November 2026**, bukan periode tanggal harian.
- ID periode disimpan dalam format `YYYY-MM` (contoh `2026-11`) agar urutan bulan konsisten.
- Kolom **Ke** adalah urutan angsuran pinjaman anggota. Jika periode sebelumnya tercatat Ke-2 dan pinjaman masih aktif pada periode berikutnya, sistem menyiapkan Ke-3. Nomor tidak boleh bertambah dua kali akibat impor ulang atau refresh.
- Kenaikan nomor hanya terjadi pada periode bulanan baru ketika angsuran benar-benar jatuh tempo/dibukukan. Periode yang sama tidak boleh menaikkan nomor lagi.
- Jika sisa pokok menjadi nol setelah pelunasan, status pinjaman menjadi **Lunas** dan tidak dibuatkan angsuran berikutnya. Pelunasan dipercepat dicatat sebagai transaksi tersendiri dengan tanggal, jumlah pokok, bunga yang disepakati, dan referensi.
- Jika anggota keluar/berhenti, status anggota menjadi **Nonaktif**. Riwayat simpanan, pinjaman, angsuran, dan kewajiban tetap disimpan; status nonaktif tidak otomatis menghapus atau menghapuskan utang.
- Anggota baru dibuat sebagai data anggota baru dengan tanggal mulai/bergabung dan status aktif. Anggota baru tidak boleh ditambahkan ke periode sebelum tanggal bergabung tanpa koreksi yang diaudit.
- Rekap harus memperlihatkan status anggota (Aktif/Nonaktif/Baru), status pinjaman (Aktif/Lunas), bank/sumber pinjaman, nomor Ke, angsuran pokok, bunga, total angsuran, sisa pokok, serta catatan perubahan pada periode berjalan.

### Bunga pinjaman

- Ketentuan yang disampaikan pengelola: **bunga 1%**.
- Angka 1% dicatat sebagai ketentuan yang perlu dikonfirmasi metode hitungnya sebelum diterapkan pada perhitungan otomatis. Jangan menganggap sendiri apakah 1% per bulan, per tahun, dari pokok awal, atau dari sisa pokok.
- Sebelum modul pinjaman diaktifkan, pengelola harus mengonfirmasi dasar pengenaan bunga, periode hitung, pembulatan, dan perlakuan bunga pada pelunasan dipercepat.
- Nilai bunga hasil impor tetap dipertahankan sebagai data historis; sistem tidak boleh menghitung ulang dan mengubah data historis tanpa proses rekonsiliasi.

### Bentuk rekap yang mudah dipahami

Rekap bulanan dirancang dengan bagian:
1. **Ringkasan anggota:** anggota awal, anggota baru, anggota nonaktif/keluar, dan anggota aktif akhir periode.
2. **Simpanan:** saldo awal, setoran per jenis, penarikan/koreksi yang disetujui, dan saldo akhir.
3. **Pinjaman per anggota:** sumber pinjaman, pokok awal, Ke saat ini, pokok dibayar, bunga, total angsuran, sisa pokok, dan status.
4. **Perubahan periode:** pinjaman baru dicairkan, angsuran rutin, pelunasan dipercepat, anggota masuk/keluar, dan koreksi.
5. **Kontrol total:** jumlah data anggota, jumlah pinjaman aktif/lunas, total potongan, total bunga, dan rekonsiliasi terhadap sheet utama Pot. Koperasi.

Tampilan rekap menggunakan istilah sehari-hari dan menjelaskan bahwa sheet Pot. Koperasi merupakan poros/konsolidasi, sedangkan MANDIRI dan BRI hanya rincian sumber pinjaman. Nilai pinjaman tidak boleh dijumlahkan dua kali.
