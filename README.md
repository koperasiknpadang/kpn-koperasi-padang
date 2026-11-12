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
Konfigurasi Web Firebase berada di `src/firebase.ts`. Firebase Web API key bukan password atau service-account key. Keamanan data tetap wajib ditegakkan melalui Authentication dan Firestore Security Rules.

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

**Penting:** keberadaan file `firestore.rules` di GitHub tidak berarti aturan tersebut sudah diterbitkan di Firebase. Publikasikan dan uji aturan di Firebase Console sebelum memasukkan data asli.

## Menjalankan lokal (opsional)
1. Pasang Node.js 24.12 atau lebih baru.
2. Jalankan `npm install`.
3. Jalankan `npm run dev`.
4. Buka alamat lokal yang ditampilkan Vite.

## Deploy otomatis ke Firebase Hosting
Deployment menggunakan Google Cloud Workload Identity Federation (OIDC). GitHub Actions memperoleh kredensial sementara; tidak perlu membuat atau menyimpan service-account JSON key.

Ikuti langkah lengkap di [PANDUAN_DEPLOYMENT.md](./PANDUAN_DEPLOYMENT.md). Ringkasnya:
1. Aktifkan Firebase Hosting.
2. Buat service account khusus deployment dengan izin minimum.
3. Konfigurasikan Workload Identity Pool dan OIDC provider untuk repository ini.
4. Tambahkan dua GitHub Actions repository variables: `GCP_WORKLOAD_IDENTITY_PROVIDER` dan `GCP_SERVICE_ACCOUNT`.
5. Jalankan ulang workflow pada tab Actions.

Workflow saat ini hanya menerbitkan Firebase Hosting; workflow tidak menerbitkan Firestore Security Rules. Deploy belum dianggap berhasil sampai langkah Firebase Hosting benar-benar selesai dengan status sukses. Jangan mengunggah service-account JSON, private key, password, atau data anggota ke repository maupun GitHub.

## Alur data Excel
Menu Impor Excel membaca tiga sheet: `Pot. Koperasi`, `MANDIRI`, dan `BRI`. Baris data dimulai dari baris 6; baris yang diproses harus memiliki nomor pada kolom A dan nama anggota pada kolom B.

Importer menyimpan snapshot bulanan ke `monthly_records` dan memperbarui data anggota/pinjaman. Impor pertama-tama ditampilkan sebagai pratinjau. Periksa periode, jumlah baris, dan angka sebelum menyimpan.

**Penting:** buka workbook di Microsoft Excel, lakukan Calculate/Recalculate, lalu Save sebelum mengimpor agar hasil formula tersimpan. Aplikasi tidak menghitung ulang formula Excel. Angsuran, bunga, sisa pinjaman, dan nomor angsuran tetap harus diperiksa dan disetujui pengelola; aplikasi tidak menaikkan nomor angsuran secara otomatis.

## Struktur Firestore
- `admins/{uid}`: peran dan status administrator.
- `members/{memberId}`: master anggota.
- `loans/{loanId}`: posisi pinjaman terkini per anggota dan sumber.
- `loan_snapshots/{snapshotId}`: arsip rincian pinjaman per periode (tidak dapat diubah setelah dibuat).
- `periods/{YYYY-MM}`: periode bulanan dan status.
- `monthly_records/{recordId}`: snapshot potongan/transaksi per anggota, sumber, dan periode.
- `public_summaries/current`: ringkasan agregat yang boleh dibaca publik.
- `audit_logs/{logId}`: catatan aktivitas impor/publikasi.

Jangan mengunggah workbook asli, data anggota, password, private key, atau service-account JSON ke repository publik.
