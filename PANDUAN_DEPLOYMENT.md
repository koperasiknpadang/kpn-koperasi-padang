# Panduan aktivasi Google Cloud OIDC untuk Firebase Hosting

Panduan ini menggunakan Workload Identity Federation (OIDC). GitHub Actions memperoleh kredensial sementara dari Google Cloud; tidak ada file JSON service-account key yang disimpan di GitHub.

## Identitas proyek
- GitHub repository: `koperasiknpadang/kpn-koperasi-padang`
- Firebase / Google Cloud project ID: `koperasi-kn-padang`
- Firebase Hosting target: default site proyek

## 1. Pastikan Firebase Hosting aktif
1. Buka Firebase Console: https://console.firebase.google.com/project/koperasi-kn-padang/hosting
2. Jika diminta, klik Get started dan selesaikan aktivasi Hosting.
3. Pastikan Hosting site default sudah tersedia.

## 2. Buat service account khusus deploy
1. Buka Google Cloud Service Accounts: https://console.cloud.google.com/iam-admin/serviceaccounts?project=koperasi-kn-padang
2. Pastikan project yang aktif adalah `koperasi-kn-padang`.
3. Klik Create service account.
4. Nama: `github-hosting-deployer`.
5. Berikan role **Firebase Hosting Admin** (`roles/firebasehosting.admin`).
6. Selesaikan pembuatan. Salin alamat email service account yang berakhiran `.iam.gserviceaccount.com`; alamat ini bukan password atau private key.

Jangan membuat atau mengunduh JSON key. Service account ini hanya untuk deployment Hosting dan tidak boleh diberi Owner/Editor.

## 3. Aktifkan Workload Identity Federation
1. Buka Workload Identity Pools: https://console.cloud.google.com/iam-admin/workload-identity-pools?project=koperasi-kn-padang
2. Pilih project `koperasi-kn-padang` dan klik Create pool.
3. Pool name: `github-actions-pool`. Pool ID: `github-actions-pool`.
4. Pada provider, pilih OpenID Connect (OIDC).
5. Provider name: `github-actions-provider`. Provider ID: `github-actions-provider`.
6. Issuer URL: `https://token.actions.githubusercontent.com`.
7. Audience: pilih Default audience.
8. Attribute mapping:
   - `google.subject` = `assertion.sub`
   - `attribute.repository` = `assertion.repository`
9. Attribute condition (batasi hanya repository ini):
   `assertion.repository == 'koperasiknpadang/kpn-koperasi-padang'`
10. Simpan provider.

Jika Console menampilkan pilihan membuat pool dan provider dalam satu wizard, gunakan nilai yang sama di atas.

## 4. Izinkan repository memakai service account
Di detail service account `github-hosting-deployer`:
1. Buka tab Permissions / Grant access (atau Manage access).
2. Tambahkan principal dari Workload Identity Pool dengan format:
   `principalSet://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/github-actions-pool/attribute.repository/koperasiknpadang/kpn-koperasi-padang`
3. Ganti `PROJECT_NUMBER` dengan **Project number** numerik Google Cloud, bukan project ID.
4. Berikan role **Workload Identity User** (`roles/iam.workloadIdentityUser`).
5. Simpan.

Project number dapat dilihat di Google Cloud Console → Home / Project settings. Jangan menebaknya.

## 5. Salin provider resource name
Buka Workload Identity Pools → `github-actions-pool` → provider `github-actions-provider`. Salin **Provider resource name** lengkap. Bentuknya:
`projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/github-actions-pool/providers/github-actions-provider`

Pastikan menggunakan project number numerik pada bagian awal.

## 6. Tambahkan dua GitHub Actions variables
1. Buka https://github.com/koperasiknpadang/kpn-koperasi-padang/settings/variables/actions
2. Klik New repository variable dan buat:
   - Name: `GCP_WORKLOAD_IDENTITY_PROVIDER`
   - Value: Provider resource name lengkap dari langkah 5.
3. Buat variable kedua:
   - Name: `GCP_SERVICE_ACCOUNT`
   - Value: alamat email service account `github-hosting-deployer` dari langkah 2.
4. Simpan keduanya.

Ini adalah Variables, bukan Secrets. Tidak ada kredensial rahasia jangka panjang yang disimpan.

## 7. Jalankan deploy
Workflow `.github/workflows/firebase-hosting.yml` sudah diperbarui agar:
- menjalankan build terlebih dahulu;
- meminta token OIDC hanya pada job deployment;
- memakai provider dan service account dari dua repository variables;
- menjalankan Firebase CLI untuk deploy Hosting saja, bukan Firestore Rules;
- melewati deploy jika variabel belum diisi.

Buka tab Actions: https://github.com/koperasiknpadang/kpn-koperasi-padang/actions
Setelah dua variables disimpan, jalankan ulang workflow terakhir (Re-run all jobs), atau buat commit baru ke branch `main`.

Jika gagal, buka detail job dan salin pesan error (hapus informasi sensitif bila ada) untuk diperiksa. Jangan pernah mengirim token, private key, atau file kredensial.

Setelah job deploy sukses, uji:
https://koperasi-kn-padang.web.app

## Catatan keamanan
- Jangan memberikan role Owner atau Editor kepada service account deploy.
- Jangan menyimpan file JSON service account di repository, GitHub Variables, chat, atau folder publik.
- Workflow ini hanya menjalankan deployment dari branch `main`. Jangan mengubahnya agar deploy dari pull request/fork.
- Pastikan Firestore Security Rules sudah dipublikasikan secara terpisah sebelum mengimpor data asli.
