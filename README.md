# KPN Koperasi Kejaksaan Negeri Padang

Panduan aktivasi Firebase, keamanan, dan deployment melalui browser: [PANDUAN_DEPLOYMENT.md](./PANDUAN_DEPLOYMENT.md).

Aplikasi web koperasi dengan dashboard publik berisi ringkasan agregat dan area pengelola yang dilindungi Firebase Authentication + Cloud Firestore.

## Teknologi
- React + TypeScript + Vite
- Tailwind CSS
- Firebase Authentication (Email/Password)
- Cloud Firestore
- SheetJS untuk membaca workbook Excel
- Firebase Hosting melalui GitHub Actions

## Konfigurasi Firebase
Konfigurasi Web Firebase berada di `src/firebase.ts`. Firebase Web API key bukan password atau service-account key. Keamanan data tetap wajib ditegakkan melalui Firestore Security Rules.

Pastikan project ID adalah `koperasi-kn-padang` dan aktifkan:
1. Authentication → Sign-in method → Email/Password.
2. Cloud Firestore Database.
3. Firebase Hosting.

## Membuat Super Admin pertama
Buat akun melalui Firebase Authentication, kemudian di Firestore buat dokumen:
- Collection: `admins`
- Document ID: UID akun administrator
- `role`: string `super_admin`
- `active`: boolean `true`

Aplikasi hanya menerima akun yang UID-nya memiliki dokumen aktif tersebut. Dokumen admin tidak dapat dibuat atau diubah dari browser aplikasi; kelola langsung melalui Firebase Console oleh pemilik proyek.

## Firestore Security Rules
Salin isi `firestore.rules` ke Firebase Console → Firestore Database → Rules, lalu klik Publish. Aturan ini mengizinkan publik membaca hanya `public_summaries`; koleksi anggota, pinjaman, periode, dan transaksi hanya dapat diakses administrator aktif.

## Menjalankan lokal (opsional)
1. Pasang Node.js 24.12 atau lebih baru.
2. Jalankan `npm install`.
3. Jalankan `npm run dev`.
4. Buka alamat lokal yang ditampilkan Vite.

## Deploy otomatis ke Firebase Hosting
GitHub Actions akan membangun dan menerbitkan aplikasi setiap ada push ke branch `main`.

Di GitHub repository:
1. Buka Settings → Secrets and variables → Actions.
2. Tambahkan repository secret bernama `FIREBASE_SERVICE_ACCOUNT_KOPERASI_KN_PADANG`.
3. Isi secret dengan JSON service account yang dibuat di Google Cloud/Firebase untuk deployment. Berikan izin minimum yang diperlukan untuk Firebase Hosting. Jangan pernah menaruh JSON ini di repository.
4. Pastikan GitHub Actions diaktifkan.

Project ID sudah ditetapkan di workflow: `koperasi-kn-padang`.

## Alur data Excel
Menu Impor Excel membaca tiga sheet: `Pot. Koperasi`, `MANDIRI`, dan `BRI`. Baris data dimulai dari baris 6; baris yang diproses harus memiliki nomor pada kolom A dan nama anggota pada kolom B.

Importer menyimpan snapshot bulanan ke `monthly_records` dan memperbarui data anggota/pinjaman. Impor pertama-tama ditampilkan sebagai pratinjau. Periksa periode, jumlah baris, dan angka sebelum menyimpan.

**Penting:** buka workbook di Microsoft Excel, lakukan Calculate/Recalculate, lalu Save sebelum mengimpor agar hasil formula tersimpan. Aplikasi tidak menghitung ulang formula Excel. Angsuran, bunga, sisa pinjaman, dan nomor angsuran tetap harus diperiksa dan disetujui pengelola; aplikasi tidak menaikkan nomor angsuran secara otomatis.

## Struktur Firestore
- `admins/{uid}`: peran dan status administrator.
- `members/{memberId}`: master anggota.
- `loans/{loanId}`: posisi pinjaman terkini per anggota dan sumber.\n- `loan_snapshots/{snapshotId}`: arsip rincian pinjaman per periode (tidak dapat diubah setelah dibuat).
- `periods/{YYYY-MM}`: periode bulanan dan status.
- `monthly_records/{recordId}`: snapshot potongan/transaksi per anggota, sumber, dan periode.
- `public_summaries/current`: ringkasan agregat yang boleh dibaca publik.
- `audit_logs/{logId}`: catatan aktivitas impor/publikasi.

Jangan mengunggah workbook asli, data anggota, password, private key, atau service-account JSON ke repository publik.
