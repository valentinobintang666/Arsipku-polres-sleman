ARSIPKU — SISTEM PENGELOLAAN SURAT

KEBUTUHAN
- PHP 8.1 atau lebih baru dengan ekstensi PDO MySQL, Fileinfo, dan mbstring.
- MySQL 5.7+ atau MariaDB yang kompatibel.

MENJALANKAN DI LARAGON / XAMPP
1. Pastikan MySQL berjalan.
2. Buka terminal di folder yang berisi index.html.
3. Jalankan `php setup.php` satu kali untuk membuat database dan akun demo.
4. Jalankan `php -S 127.0.0.1:8080` dari folder yang sama.
5. Buka http://127.0.0.1:8080.

Laragon/XAMPP biasanya sudah menyertakan PHP dan MySQL. Bila perintah php tidak
dikenali, tambahkan folder PHP ke PATH atau jalankan php.exe dengan path lengkap.

KONFIGURASI DATABASE
Default lokal: host 127.0.0.1, port 3306, database arsipku, pengguna root,
kata sandi kosong. Atur kredensial sebelum menjalankan setup melalui environment:
ARSIPKU_DB_HOST, ARSIPKU_DB_PORT, ARSIPKU_DB_NAME, ARSIPKU_DB_USER,
ARSIPKU_DB_PASS.

Akun demo (kata sandi awal):
Admin   : admin / admin123
Pegawai : pegawai / pegawai123
Atasan  : atasan / atasan123

Segera reset semua kata sandi demo melalui menu Manajemen Pengguna sebelum
aplikasi digunakan sungguhan. Setup dapat dijalankan kembali tanpa menimpa
akun atau data yang sudah ada.

FITUR
- Dashboard dan pencarian surat.
- Pencatatan surat masuk dan surat keluar, termasuk lampiran.
- Alur persetujuan, penolakan, dan revisi surat.
- Arsip surat disetujui dan riwayat aktivitas.
- Manajemen akun, peran, status aktif, dan reset kata sandi.
- Backend PHP dengan sesi login, hash kata sandi, validasi peran di server,
  serta penyimpanan bersama di MySQL.

CATATAN
Jangan buka index.html langsung atau gunakan python -m http.server; browser
harus mengakses aplikasi melalui server PHP agar API dan sesi login berfungsi.
Data dari versi lama yang tersimpan di localStorage tidak otomatis dipindahkan
ke MySQL. Cadangkan data lama sebelum beralih ke versi backend ini.
Untuk penggunaan publik/produksi, gunakan HTTPS, kredensial database khusus
dengan hak akses terbatas, dan kebijakan backup database yang sesuai.
