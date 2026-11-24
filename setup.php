<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require_once __DIR__ . '/config.php';

try {
    $config = databaseConfig();
    $server = new PDO(
        sprintf('mysql:host=%s;port=%s;charset=utf8mb4', $config['host'], $config['port']),
        $config['user'],
        $config['password'],
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
    );
    $databaseName = $config['name'];
    if (!preg_match('/^[A-Za-z0-9_]+$/', $databaseName)) {
        throw new RuntimeException('Nama database hanya boleh berisi huruf, angka, dan garis bawah.');
    }
    $server->exec("CREATE DATABASE IF NOT EXISTS `$databaseName` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
    $pdo = database();

    $schema = [
        "CREATE TABLE IF NOT EXISTS users (
            id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            username VARCHAR(40) NOT NULL UNIQUE,
            name VARCHAR(80) NOT NULL,
            role VARCHAR(16) NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            active TINYINT(1) NOT NULL DEFAULT 1,
            photo_data MEDIUMBLOB NULL,
            photo_type VARCHAR(40) NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX users_role_active (role, active)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS letters (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            type VARCHAR(8) NOT NULL,
            number VARCHAR(120) NOT NULL,
            subject VARCHAR(200) NOT NULL,
            sender VARCHAR(160) NOT NULL,
            date DATE NOT NULL,
            recipient VARCHAR(160) NOT NULL,
            notes TEXT NOT NULL,
            status VARCHAR(32) NOT NULL,
            creator VARCHAR(80) NOT NULL,
            creator_username VARCHAR(40) NOT NULL,
            created_at DATETIME NOT NULL,
            decision_by VARCHAR(80) NULL,
            decided_at DATETIME NULL,
            approved_by VARCHAR(80) NULL,
            approved_at DATETIME NULL,
            revision_note TEXT NULL,
            revision_requested_by VARCHAR(80) NULL,
            revision_requested_at DATETIME NULL,
            resubmitted_at DATETIME NULL,
            revision_history LONGTEXT NOT NULL,
            attachment_name VARCHAR(255) NULL,
            attachment_type VARCHAR(80) NULL,
            attachment_data MEDIUMBLOB NULL,
            created_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX letters_status_created (status, created_at),
            INDEX letters_owner (creator_username),
            INDEX letters_type_date (type, date),
            UNIQUE KEY letters_type_number (type, number)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS activity_logs (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            letter_id BIGINT UNSIGNED NULL,
            letter_type VARCHAR(8) NOT NULL,
            letter_number VARCHAR(120) NOT NULL,
            letter_subject VARCHAR(200) NOT NULL,
            action VARCHAR(100) NOT NULL,
            details VARCHAR(500) NOT NULL DEFAULT '',
            actor VARCHAR(80) NOT NULL,
            actor_username VARCHAR(40) NOT NULL,
            actor_role VARCHAR(16) NOT NULL,
            created_at DATETIME NOT NULL,
            INDEX activity_created (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS setup_metadata (
            setting_key VARCHAR(64) NOT NULL PRIMARY KEY,
            setting_value VARCHAR(255) NOT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
    ];
    foreach ($schema as $statement) {
        $pdo->exec($statement);
    }

    $seedUsers = [
        ['admin', 'Administrator', 'admin', 'admin123'],
        ['pegawai', 'Pegawai', 'pegawai', 'pegawai123'],
        ['atasan', 'Kepala Instansi', 'atasan', 'atasan123'],
    ];
    $userInsert = $pdo->prepare(
        'INSERT IGNORE INTO users (username, name, role, password_hash) VALUES (?, ?, ?, ?)'
    );
    foreach ($seedUsers as [$username, $name, $role, $password]) {
        $userInsert->execute([$username, $name, $role, password_hash($password, PASSWORD_DEFAULT)]);
    }

    $seedStatus = $pdo->query(
        "SELECT setting_value FROM setup_metadata WHERE setting_key = 'demo_letters_seeded'"
    )->fetchColumn();
    if ($seedStatus === false) {
        $count = (int) $pdo->query('SELECT COUNT(*) FROM letters')->fetchColumn();
        if ($count === 0) {
            $letterInsert = $pdo->prepare(
                'INSERT INTO letters
                    (type, number, subject, sender, date, recipient, notes, status, creator,
                     creator_username, created_at, revision_history)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)'
            );
            $seedLetters = [
                ['Masuk', '045/UND/IX/2026', 'Undangan Rapat Koordinasi', 'Dinas Komunikasi', '2026-10-30', 'Bagian Umum', 'Rapat koordinasi lintas bagian.', 'Disetujui', 'Administrator', 'admin'],
                ['Keluar', '012/ADM/X/2026', 'Permohonan Data', 'Bagian Administrasi', '2026-11-01', 'Dinas Terkait', 'Permohonan data kegiatan.', 'Menunggu Persetujuan', 'Pegawai', 'pegawai'],
                ['Masuk', '088/EXT/X/2026', 'Pemberitahuan Pemeliharaan Sistem', 'Unit Teknologi Informasi', '2026-11-02', 'Seluruh Bagian', 'Informasi pemeliharaan sistem.', 'Menunggu Persetujuan', 'Administrator', 'admin'],
            ];
            foreach ($seedLetters as $letter) {
                $letterInsert->execute([...$letter, '[]']);
            }
        }
        $pdo->exec(
            "INSERT INTO setup_metadata (setting_key, setting_value) VALUES ('demo_letters_seeded', '1')"
        );
    }

    fwrite(STDOUT, "Database ArsipKu siap. Akun demo:\n");
    fwrite(STDOUT, "  admin / admin123\n  pegawai / pegawai123\n  atasan / atasan123\n");
    fwrite(STDOUT, "Segera ganti semua kata sandi demo sebelum aplikasi digunakan sungguhan.\n");
} catch (Throwable $error) {
    fwrite(STDERR, "Setup gagal: " . $error->getMessage() . PHP_EOL);
    exit(1);
}
