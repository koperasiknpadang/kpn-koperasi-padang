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
