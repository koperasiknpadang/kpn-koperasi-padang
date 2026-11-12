# Panduan Aktivasi dan Deploy KPN Koperasi

Panduan ini ditujukan untuk menyelesaikan konfigurasi dari browser. Tidak perlu mengedit source code atau menggunakan VS Code.

## Data proyek
- GitHub: https://github.com/koperasiknpadang/kpn-koperasi-padang
- Firebase project ID: `koperasi-kn-padang`
- Firebase Hosting default domain setelah site dibuat: `https://koperasi-kn-padang.web.app`
- Email administrator yang dipakai: `koperasiknpadang@gmail.com`

## A. Aktifkan Firebase Authentication
1. Buka https://console.firebase.google.com/
2. Pilih project `koperasi-kn-padang`.
3. Buka Build → Authentication → Get started.
4. Buka tab Sign-in method.
5. Aktifkan Email/Password dan simpan.
6. Buka tab Users dan pastikan akun administrator yang dibuat sebelumnya ada. Catat UID akun tersebut; UID harus cocok dengan Document ID pada `admins`.

## B. Pastikan dokumen Super Admin
Di Build → Firestore Database → Data, pastikan dokumen berikut sudah ada:
- Collection: `admins`
- Document ID: UID akun administrator dari Authentication
- Field `role`: string `super_admin`
- Field `active`: boolean `true`

Jangan membuat dokumen admin dengan Auto-ID. Jangan mengirim password atau private key ke siapa pun.

## C. Terapkan Firestore Security Rules
1. Buka https://console.firebase.google.com/project/koperasi-kn-padang/firestore
2. Pilih tab Rules.
3. Buka file `firestore.rules` di repository GitHub ini.
4. Salin seluruh isi file tersebut.
5. Ganti isi editor Rules di Firebase Console dengan isi file dari repository.
6. Klik Publish.

Aturan tersebut:
- Membolehkan publik membaca hanya `public_summaries`.
- Menutup data anggota, pinjaman, periode, dan transaksi dari publik.
- Memeriksa dokumen admin aktif berdasarkan UID.
- Membuat snapshot bulanan tidak dapat diubah setelah disimpan.
- Mengunci periode setelah statusnya `published`.

Jangan gunakan aturan `allow read, write: if true` di database produksi.

## D. Aktifkan Firebase Hosting
1. Buka Firebase Console project `koperasi-kn-padang`.
2. Pilih Build → Hosting.
3. Jika belum diaktifkan, klik Get started dan selesaikan pembuatan Hosting site.
4. Pastikan default site tersedia.

## E. Buat kredensial deployment khusus
Jangan memakai file Service Account Admin SDK yang terlalu luas jika tidak diperlukan. Buat service account khusus untuk GitHub Actions:

1. Buka Google Cloud Console → IAM & Admin → Service Accounts:
   https://console.cloud.google.com/iam-admin/serviceaccounts?project=koperasi-kn-padang
2. Klik Create service account.
3. Nama contoh: `github-hosting-deployer`.
4. Berikan peran:
   - Firebase Hosting Admin (`roles/firebasehosting.admin`)
   - API Keys Viewer (`roles/serviceusage.apiKeysViewer`) bila diperlukan untuk deployment melalui CLI.
5. Selesaikan pembuatan service account.
6. Buka service account tersebut → Keys → Add key → Create new key → JSON.
7. Unduh file JSON. File ini bersifat rahasia.

## F. Simpan JSON sebagai GitHub Secret
1. Buka https://github.com/koperasiknpadang/kpn-koperasi-padang
2. Pilih Settings → Secrets and variables → Actions.
3. Klik New repository secret.
4. Isi Name persis:
   `FIREBASE_SERVICE_ACCOUNT_KOPERASI_KN_PADANG`
5. Buka file JSON service account yang diunduh, salin seluruh isinya, dan tempel ke Secret value.
6. Klik Add secret.
7. Hapus file JSON dari folder Downloads setelah memastikan secret tersimpan. Jangan pernah menaruh file JSON di repository, membagikannya lewat chat, atau mengunggahnya ke tempat publik.

## G. Jalankan deployment
Workflow sudah tersedia di:
`.github/workflows/firebase-hosting.yml`

Workflow akan:
1. Menginstal dependensi.
2. Menjalankan pemeriksaan TypeScript dan build Vite.
3. Jika secret sudah tersedia, deploy ke Firebase Hosting live.
4. Jika secret belum tersedia, deployment dilewati dan hasil build tetap dapat diperiksa.

Buka tab Actions di GitHub:
https://github.com/koperasiknpadang/kpn-koperasi-padang/actions

Setelah secret disimpan, pilih workflow terbaru dan klik Re-run all jobs bila tidak ada push baru. Pastikan job berstatus sukses. Setelah deployment sukses, buka:
`https://koperasi-kn-padang.web.app`

## H. Masuk dan impor workbook
1. Buka website Hosting.
2. Klik Masuk Pengelola.
3. Masuk dengan akun Firebase Authentication administrator. Password hanya dimasukkan pada form login website, tidak disimpan di GitHub.
4. Buka menu Impor Excel.
5. Pilih workbook dari komputer. File asli dibaca di browser; file Excel tidak diunggah ke GitHub.
6. Periksa periode dan pratinjau. Workbook KPN menggunakan sheet:
   - `Pot. Koperasi`: rekap konsolidasi potongan/simpanan bulanan.
   - `MANDIRI`: rincian pinjaman Mandiri.
   - `BRI`: rincian pinjaman BRI.
7. Importer memeriksa kesesuaian nama dan rekonsiliasi nilai antara sheet konsolidasi dan rincian bank. Jika ada peringatan `STOP:`, tombol simpan akan dinonaktifkan sampai workbook diperbaiki.
8. Sebelum mengimpor, buka workbook di Excel, tekan Ctrl+Alt+F9, lalu Save agar hasil formula terbaru tersimpan.
9. Klik Simpan sebagai draft. Periksa data anggota, pinjaman, total potongan, dan sisa pinjaman.
10. Setelah diverifikasi, buka menu Periode dan klik Publikasikan ringkasan. Hanya angka agregat yang dipublikasikan.

## I. Proses bulan berikutnya
1. Buat salinan workbook bulan sebelumnya; jangan menimpa file arsip bulan sebelumnya.
2. Perbarui tanggal periode pada sel A2 sesuai bulan baru.
3. Periksa baris anggota dan sumber pinjaman; jangan menaikkan nomor angsuran secara otomatis tanpa memastikan pembayaran benar-benar terjadi.
4. Tekan Ctrl+Alt+F9, Save, lalu unggah workbook baru melalui menu Impor Excel.
5. Setiap periode memiliki ID `YYYY-MM`. Periode yang sudah ada tidak dapat diimpor ulang dengan ID yang sama.
6. Periode yang telah dipublikasikan dan snapshot transaksi disimpan sebagai arsip dan dikunci oleh Security Rules.

## J. Batasan versi awal
Versi awal ini sudah menyediakan dashboard publik agregat, login pengelola, daftar anggota, daftar pinjaman, daftar periode, impor Excel dengan pratinjau/rekonsiliasi, dan publikasi ringkasan. Fitur pengubahan transaksi satu per satu, pembuatan pinjaman manual, ekspor laporan khusus, dan kalkulasi bunga/angsuran otomatis belum diaktifkan. Nilai formula mengikuti hasil workbook yang telah disimpan dan harus diverifikasi pengelola.

## Keamanan
- Repository ini bersifat publik: jangan masukkan data anggota, nominal perorangan, workbook asli, password, token, atau file JSON service account.
- Firebase Web config yang dipakai aplikasi adalah konfigurasi client. Keamanan data tetap bergantung pada Firebase Authentication dan Firestore Security Rules.
- Jika ada kesalahan akses, periksa tab Firestore Rules dan GitHub Actions; jangan melonggarkan aturan menjadi akses publik.
