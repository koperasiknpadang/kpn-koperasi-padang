# Sistem Informasi Koperasi KPN Kejaksaan Negeri Padang

Aplikasi operasional koperasi berbasis web. Pencatatan rutin dilakukan langsung di aplikasi; Excel digunakan untuk ekspor laporan dan dapat disiapkan untuk migrasi historis terkontrol.

## Modul aplikasi
- Dashboard: anggota aktif, simpanan, pinjaman berjalan, saldo kas/bank, dan aktivitas.
- Anggota: tambah, ubah, aktif/nonaktif, serta riwayat keuangan anggota.
- Simpanan: simpanan pokok, wajib, sukarela; setoran dan penarikan dengan validasi saldo.
- Pinjaman: pengajuan, persetujuan/penolakan, pencairan, sumber Koperasi/Mandiri/BRI.
- Angsuran: angsuran rutin dan pelunasan dipercepat, pembaruan sisa pokok, pencegahan pembayaran ganda per periode.
- Kas: kas masuk/keluar dan buku kas.
- Laporan: jurnal umum, neraca saldo sederhana, ringkasan SHU sementara, ekspor Excel, dan cetak/PDF melalui browser.
- Periode: dibuat otomatis dari tanggal transaksi dan dapat ditutup untuk mengunci pencatatan.
- Ringkasan publik: hanya angka agregat yang diterbitkan administrator.

## Aturan perhitungan pinjaman
Bunga bawaan adalah 1% per bulan dari pokok awal (flat). Pokok angsuran dibagi menurut tenor; angsuran terakhir menyesuaikan sisa pokok. Tarif bunga dapat disesuaikan saat pengajuan. Pelunasan dipercepat menghentikan angsuran berikutnya; bunga pelunasan diisi sesuai kesepakatan yang berlaku.

Pinjaman bersumber KOPERASI memengaruhi kas dan jurnal koperasi. Pinjaman MANDIRI/BRI dicatat sebagai fasilitas pinjaman eksternal anggota dan tidak dicampurkan ke arus kas KPN.

## Prinsip pencatatan
- Setiap transaksi keuangan disimpan sebagai catatan baru (append-only), dilengkapi periode, tanggal, pembuat, dan audit log.
- Saldo simpanan diperbarui atomik bersama transaksi simpanan.
- Angsuran memakai ID deterministik per pinjaman/periode agar pembayaran ganda ditolak.
- Anggota tidak dihapus permanen; anggota keluar dinonaktifkan agar riwayat tetap tersedia.
- Periode yang sudah ditutup tidak menerima transaksi baru.
- Jurnal dibuat otomatis dari transaksi simpanan, pinjaman koperasi, angsuran koperasi, dan kas umum.
- Jangan memasukkan data operasional asli sebelum aturan Firestore baru berstatus aktif dan pengujian alur transaksi selesai.

## Teknologi
- React 19 + TypeScript + Vite
- Tailwind CSS
- Firebase Authentication (Email/Password)
- Cloud Firestore
- SheetJS untuk ekspor Excel
- Firebase Hosting melalui GitHub Actions dan Google Cloud Workload Identity Federation

## Firebase dan administrator
Project ID: `koperasi-kn-padang`

Aplikasi memeriksa dokumen `admins/{UID}` dengan:
- `role`: `super_admin` atau `admin`
- `active`: `true`

Dokumen administrator hanya dikelola pemilik proyek melalui Firebase Console. Jangan pernah menaruh password, service-account JSON, atau private key di GitHub atau kode aplikasi.

## Firestore Security Rules
File `firestore.rules` mencakup koleksi operasional baru dan penguncian periode. Workflow deployment mencoba menerbitkan Firestore Rules terlebih dahulu, baru kemudian Firebase Hosting. Service account OIDC harus memiliki izin Firebase Rules Admin selain izin Hosting yang sudah digunakan. Jika penerbitan rules gagal, deployment Hosting dihentikan agar aplikasi baru tidak berjalan dengan aturan database lama.

## Koleksi Firestore operasional
- `admins`: identitas dan hak akses administrator.
- `members`: master anggota dan saldo simpanan terproyeksi.
- `savings_transactions`: setoran dan penarikan simpanan.
- `loan_applications`: pengajuan dan keputusan pinjaman.
- `loans`: posisi pinjaman terkini.
- `installments`: pembayaran angsuran dan pelunasan.
- `cash_transactions`: buku kas masuk/keluar.
- `journal_entries`: jurnal debit/kredit otomatis.
- `periods`: periode bulanan dan status buka/tutup.
- `audit_logs`: jejak aktivitas administrator.
- `public_summaries`: ringkasan agregat yang boleh dibaca publik.

Koleksi `monthly_records` dan `loan_snapshots` dipertahankan sebagai koleksi legacy untuk migrasi terkontrol, bukan sumber data operasional aplikasi baru.

## Batasan rilis awal
Versi operasional ini menyediakan pencatatan transaksi inti, jurnal dasar, laporan, dan penguncian periode. Fitur yang masih memerlukan pengembangan/pengujian lanjutan sebelum dipakai sebagai pembukuan resmi meliputi pembatalan/reversal transaksi melalui UI, rekonsiliasi bank, bagan akun yang dapat dikonfigurasi, laporan neraca/SHU sesuai kebijakan koperasi, pemisahan kas dan rekening bank, persetujuan multi-level, backup/pemulihan otomatis, dan migrasi workbook historis. Pengujian transaksi nyata harus dilakukan dengan data uji terlebih dahulu.
