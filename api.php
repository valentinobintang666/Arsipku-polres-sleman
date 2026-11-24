<?php
declare(strict_types=1);

require_once __DIR__ . '/config.php';

header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');
header('Referrer-Policy: same-origin');
startSecureSession();

function respond(array $data, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function fail(string $message, int $status = 400): never
{
    respond(['error' => $message], $status);
}

function input(): array
{
    $contentType = strtolower((string) ($_SERVER['CONTENT_TYPE'] ?? ''));
    if (str_contains($contentType, 'application/json')) {
        $decoded = json_decode(file_get_contents('php://input'), true);
        if (!is_array($decoded)) {
            fail('Data yang dikirim tidak valid.');
        }
        return $decoded;
    }
    return $_POST;
}

function requireMethod(string $method): void
{
    if (strtoupper($_SERVER['REQUEST_METHOD'] ?? '') !== $method) {
        header('Allow: ' . $method);
        fail('Metode permintaan tidak didukung.', 405);
    }
}

function verifySameOrigin(): void
{
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin === '') {
        return;
    }
    $originHost = parse_url($origin, PHP_URL_HOST);
    $requestHost = parse_url('http://' . ($_SERVER['HTTP_HOST'] ?? ''), PHP_URL_HOST);
    $originPort = parse_url($origin, PHP_URL_PORT);
    $requestPort = parse_url('http://' . ($_SERVER['HTTP_HOST'] ?? ''), PHP_URL_PORT);
    if (
        !is_string($originHost) ||
        !is_string($requestHost) ||
        !hash_equals(strtolower($requestHost), strtolower($originHost)) ||
        ($originPort !== null && $requestPort !== null && $originPort !== $requestPort)
    ) {
        fail('Permintaan lintas situs ditolak.', 403);
    }
}

function currentUser(PDO $pdo): array
{
    $id = filter_var($_SESSION['user_id'] ?? null, FILTER_VALIDATE_INT);
    if (!$id) {
        fail('Sesi login telah berakhir. Silakan masuk kembali.', 401);
    }
    $statement = $pdo->prepare('SELECT id, username, name, role, active, photo_data, photo_type FROM users WHERE id = ?');
    $statement->execute([$id]);
    $user = $statement->fetch();
    if (!$user || !(bool) $user['active']) {
        session_unset();
        session_destroy();
        fail('Akun tidak aktif atau sesi login telah berakhir.', 401);
    }
    return $user;
}

function requireRole(array $user, array $roles): void
{
    if (!in_array($user['role'], $roles, true)) {
        fail('Anda tidak memiliki izin untuk melakukan tindakan ini.', 403);
    }
}

function textValue(array $data, string $key, int $maxLength, bool $required = true): string
{
    $value = trim((string) ($data[$key] ?? ''));
    if (($required && $value === '') || mb_strlen($value) > $maxLength) {
        fail($required ? 'Periksa kembali data yang wajib diisi.' : 'Ada data yang terlalu panjang.');
    }
    return $value;
}

function validDate(string $value): bool
{
    $date = DateTime::createFromFormat('!Y-m-d', $value);
    return $date instanceof DateTime && $date->format('Y-m-d') === $value;
}

function logActivity(PDO $pdo, array $user, array $letter, string $action, string $details = ''): void
{
    $statement = $pdo->prepare(
        'INSERT INTO activity_logs
            (letter_id, letter_type, letter_number, letter_subject, action, details, actor, actor_username, actor_role, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())'
    );
    $statement->execute([
        $letter['id'] ?? null,
        $letter['type'],
        $letter['number'],
        $letter['subject'],
        $action,
        $details,
        $user['name'],
        $user['username'],
        $user['role'],
    ]);
}

function getLetter(PDO $pdo, int $id, bool $lock = false): array
{
    $statement = $pdo->prepare('SELECT * FROM letters WHERE id = ?' . ($lock ? ' FOR UPDATE' : ''));
    $statement->execute([$id]);
    $letter = $statement->fetch();
    if (!$letter) {
        fail('Surat tidak ditemukan.', 404);
    }
    return $letter;
}

function letterPayload(array $row): array
{
    $history = json_decode((string) ($row['revision_history'] ?? '[]'), true);
    return [
        'id' => (int) $row['id'],
        'type' => $row['type'],
        'number' => $row['number'],
        'subject' => $row['subject'],
        'sender' => $row['sender'],
        'date' => $row['date'],
        'recipient' => $row['recipient'],
        'notes' => $row['notes'],
        'status' => $row['status'],
        'creator' => $row['creator'],
        'creatorUsername' => $row['creator_username'],
        'createdAt' => date(DATE_ATOM, strtotime($row['created_at'])),
        'decisionBy' => $row['decision_by'],
        'decidedAt' => $row['decided_at'] ? date(DATE_ATOM, strtotime($row['decided_at'])) : null,
        'approvedBy' => $row['approved_by'],
        'approvedAt' => $row['approved_at'] ? date(DATE_ATOM, strtotime($row['approved_at'])) : null,
        'revisionNote' => $row['revision_note'],
        'revisionRequestedBy' => $row['revision_requested_by'],
        'revisionRequestedAt' => $row['revision_requested_at'] ? date(DATE_ATOM, strtotime($row['revision_requested_at'])) : null,
        'resubmittedAt' => $row['resubmitted_at'] ? date(DATE_ATOM, strtotime($row['resubmitted_at'])) : null,
        'revisionHistory' => is_array($history) ? $history : [],
        'attachment' => $row['attachment_name'] ? [
            'name' => $row['attachment_name'],
            'type' => $row['attachment_type'],
            'url' => 'api.php?action=attachment&id=' . (int) $row['id'],
        ] : null,
    ];
}

function statePayload(PDO $pdo, array $user): array
{
    $where = '';
    $parameters = [];
    if ($user['role'] === 'pegawai') {
        $where = " WHERE creator_username = ? OR status = 'Disetujui'";
        $parameters[] = $user['username'];
    }
    $lettersQuery = $pdo->prepare('SELECT * FROM letters' . $where . ' ORDER BY id DESC');
    $lettersQuery->execute($parameters);
    $letters = array_map('letterPayload', $lettersQuery->fetchAll());

    $safeUser = [
        'username' => $user['username'],
        'name' => $user['name'],
        'role' => $user['role'],
        'active' => (bool) $user['active'],
        'photo' => $user['photo_data'] !== null
            ? 'data:' . $user['photo_type'] . ';base64,' . base64_encode($user['photo_data'])
            : '',
    ];
    $users = [];
    $activities = [];
    if ($user['role'] === 'admin') {
        $users = $pdo->query(
            'SELECT username, name, role, active, created_at AS createdAt
             FROM users ORDER BY username'
        )->fetchAll();
        foreach ($users as &$listedUser) {
            $listedUser['active'] = (bool) $listedUser['active'];
        }
        unset($listedUser);

        $activityRows = $pdo->query('SELECT * FROM activity_logs ORDER BY id DESC LIMIT 1000')->fetchAll();
        $activities = array_map(static function (array $row): array {
            return [
                'id' => (string) $row['id'],
                'letterId' => $row['letter_id'] === null ? null : (int) $row['letter_id'],
                'letterType' => $row['letter_type'],
                'letterNumber' => $row['letter_number'],
                'letterSubject' => $row['letter_subject'],
                'action' => $row['action'],
                'details' => $row['details'],
                'actor' => $row['actor'],
                'actorUsername' => $row['actor_username'],
                'actorRole' => $row['actor_role'],
                'at' => date(DATE_ATOM, strtotime($row['created_at'])),
            ];
        }, $activityRows);
    }

    return [
        'user' => $safeUser,
        'letters' => $letters,
        'users' => $users,
        'activityLogs' => $activities,
    ];
}

function uploadedAttachment(): array
{
    if (!isset($_FILES['attachment']) || $_FILES['attachment']['error'] === UPLOAD_ERR_NO_FILE) {
        return [null, null, null];
    }
    $file = $_FILES['attachment'];
    if ($file['error'] !== UPLOAD_ERR_OK || !is_uploaded_file($file['tmp_name'])) {
        fail('Lampiran gagal diunggah.');
    }
    if ($file['size'] > 1572864) {
        fail('Ukuran lampiran maksimal 1,5 MB.');
    }
    $finfo = new finfo(FILEINFO_MIME_TYPE);
    $mime = $finfo->file($file['tmp_name']);
    $allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    if (!in_array($mime, $allowed, true)) {
        fail('Lampiran harus berupa PDF, JPG, PNG, atau WebP.');
    }
    $contents = file_get_contents($file['tmp_name']);
    if ($contents === false) {
        fail('Lampiran tidak dapat dibaca.');
    }
    $name = preg_replace('/[\x00-\x1F\x7F]/u', '', basename((string) $file['name']));
    return [mb_substr($name, 0, 255), $mime, $contents];
}

function adminTarget(PDO $pdo, string $username, bool $lock = false): array
{
    $statement = $pdo->prepare('SELECT id, username, name, role, active FROM users WHERE username = ?' . ($lock ? ' FOR UPDATE' : ''));
    $statement->execute([$username]);
    $target = $statement->fetch();
    if (!$target) {
        fail('Pengguna tidak ditemukan.', 404);
    }
    return $target;
}

try {
    $pdo = database();
    $action = (string) ($_GET['action'] ?? '');
    $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');

    if ($method !== 'GET') {
        verifySameOrigin();
    }

    if ($action === 'state') {
        requireMethod('GET');
        if (!isset($_SESSION['user_id'])) {
            respond(['authenticated' => false]);
        }
        $user = currentUser($pdo);
        respond(['authenticated' => true] + statePayload($pdo, $user));
    }

    if ($action === 'login') {
        requireMethod('POST');
        $data = input();
        $username = trim((string) ($data['username'] ?? ''));
        $password = (string) ($data['password'] ?? '');
        $selectedRole = (string) ($data['role'] ?? '');
        $statement = $pdo->prepare('SELECT id, username, role, password_hash, active FROM users WHERE username = ?');
        $statement->execute([$username]);
        $account = $statement->fetch();
        if (
            !$account ||
            !(bool) $account['active'] ||
            !password_verify($password, $account['password_hash']) ||
            ($account['role'] !== 'admin' && $account['role'] !== $selectedRole)
        ) {
            fail('Nama pengguna, kata sandi, atau peran tidak sesuai.', 401);
        }
        session_regenerate_id(true);
        $_SESSION['user_id'] = (int) $account['id'];
        respond(['ok' => true]);
    }

    if ($action === 'logout') {
        requireMethod('POST');
        session_unset();
        session_destroy();
        respond(['ok' => true]);
    }

    if ($action === 'attachment') {
        requireMethod('GET');
        $user = currentUser($pdo);
        $id = filter_var($_GET['id'] ?? null, FILTER_VALIDATE_INT);
        if (!$id) {
            fail('Lampiran tidak ditemukan.', 404);
        }
        $letter = getLetter($pdo, (int) $id);
        if ($user['role'] === 'pegawai' && $letter['creator_username'] !== $user['username'] && $letter['status'] !== 'Disetujui') {
            fail('Anda tidak memiliki akses ke lampiran ini.', 403);
        }
        if ($letter['attachment_data'] === null) {
            fail('Lampiran tidak ditemukan.', 404);
        }
        header('Content-Type: ' . $letter['attachment_type']);
        header('Content-Length: ' . strlen($letter['attachment_data']));
        header("Content-Disposition: attachment; filename*=UTF-8''" . rawurlencode($letter['attachment_name']));
        echo $letter['attachment_data'];
        exit;
    }

    requireMethod('POST');
    $user = currentUser($pdo);
    $data = input();

    switch ($action) {
        case 'letter-create': {
            requireRole($user, ['admin', 'pegawai']);
            $type = (string) ($data['type'] ?? '');
            if (!in_array($type, ['Masuk', 'Keluar'], true)) {
                fail('Jenis surat tidak valid.');
            }
            $number = textValue($data, 'number', 120);
            $subject = textValue($data, 'subject', 200);
            $sender = textValue($data, 'sender', 160);
            $recipient = textValue($data, 'recipient', 160);
            $date = textValue($data, 'date', 10);
            if (!validDate($date)) {
                fail('Tanggal surat tidak valid.');
            }
            $notes = textValue($data, 'notes', 5000, false);
            [$attachmentName, $attachmentType, $attachmentData] = uploadedAttachment();
            $insert = $pdo->prepare(
                'INSERT INTO letters
                    (type, number, subject, sender, date, recipient, notes, status, creator, creator_username,
                     created_at, revision_history, attachment_name, attachment_type, attachment_data)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?)'
            );
            $pdo->beginTransaction();
            try {
                $insert->execute([
                    $type, $number, $subject, $sender, $date, $recipient, $notes,
                    'Menunggu Persetujuan', $user['name'], $user['username'], '[]',
                    $attachmentName, $attachmentType, $attachmentData,
                ]);
            } catch (PDOException $error) {
                if ($error->getCode() === '23000') {
                    $pdo->rollBack();
                    fail('Nomor surat tersebut sudah tercatat untuk jenis surat ini.', 409);
                }
                throw $error;
            }
            $letter = getLetter($pdo, (int) $pdo->lastInsertId());
            logActivity($pdo, $user, $letter, 'Menambahkan surat', 'Surat dicatat dan diajukan untuk persetujuan.');
            $pdo->commit();
            respond(['ok' => true], 201);
        }

        case 'letter-decision': {
            requireRole($user, ['atasan']);
            $id = filter_var($data['id'] ?? null, FILTER_VALIDATE_INT);
            $status = (string) ($data['status'] ?? '');
            if (!$id || !in_array($status, ['Disetujui', 'Ditolak'], true)) {
                fail('Keputusan persetujuan tidak valid.');
            }
            $pdo->beginTransaction();
            $letter = getLetter($pdo, (int) $id, true);
            if ($letter['status'] !== 'Menunggu Persetujuan') {
                $pdo->rollBack();
                fail('Surat ini tidak lagi menunggu persetujuan.', 409);
            }
            $update = $pdo->prepare(
                'UPDATE letters SET status = ?, decision_by = ?, decided_at = NOW(), approved_by = ?, approved_at = ? WHERE id = ?'
            );
            $update->execute([
                $status, $user['name'],
                $status === 'Disetujui' ? $user['name'] : null,
                $status === 'Disetujui' ? date('Y-m-d H:i:s') : null,
                $id,
            ]);
            $letter['status'] = $status;
            logActivity($pdo, $user, $letter, $status === 'Disetujui' ? 'Menyetujui surat' : 'Menolak surat', 'Surat ' . strtolower($status) . '.');
            $pdo->commit();
            respond(['ok' => true]);
        }

        case 'letter-revision': {
            requireRole($user, ['atasan']);
            $id = filter_var($data['id'] ?? null, FILTER_VALIDATE_INT);
            $note = textValue($data, 'revisionNote', 1000);
            if (!$id || mb_strlen($note) < 5) {
                fail('Catatan revisi minimal 5 karakter.');
            }
            $pdo->beginTransaction();
            $letter = getLetter($pdo, (int) $id, true);
            if ($letter['status'] !== 'Menunggu Persetujuan') {
                $pdo->rollBack();
                fail('Surat ini tidak lagi menunggu persetujuan.', 409);
            }
            $history = json_decode((string) $letter['revision_history'], true);
            $history = is_array($history) ? $history : [];
            $requestedAt = date(DATE_ATOM);
            $history[] = ['action' => 'Dikembalikan untuk revisi', 'by' => $user['name'], 'date' => $requestedAt, 'note' => $note];
            $update = $pdo->prepare(
                'UPDATE letters SET status = ?, revision_note = ?, revision_requested_by = ?, revision_requested_at = NOW(), revision_history = ? WHERE id = ?'
            );
            $update->execute(['Perlu Revisi', $note, $user['name'], json_encode($history, JSON_UNESCAPED_UNICODE), $id]);
            $letter['status'] = 'Perlu Revisi';
            logActivity($pdo, $user, $letter, 'Mengembalikan surat untuk revisi', 'Surat dikembalikan kepada pembuat untuk diperbaiki.');
            $pdo->commit();
            respond(['ok' => true]);
        }

        case 'letter-resubmit': {
            requireRole($user, ['pegawai']);
            $id = filter_var($data['id'] ?? null, FILTER_VALIDATE_INT);
            if (!$id) {
                fail('Surat tidak ditemukan.', 404);
            }
            $subject = textValue($data, 'subject', 200);
            $sender = textValue($data, 'sender', 160);
            $recipient = textValue($data, 'recipient', 160);
            $date = textValue($data, 'date', 10);
            if (!validDate($date)) {
                fail('Tanggal surat tidak valid.');
            }
            $notes = textValue($data, 'notes', 5000, false);
            $pdo->beginTransaction();
            $letter = getLetter($pdo, (int) $id, true);
            if ($letter['creator_username'] !== $user['username'] || $letter['status'] !== 'Perlu Revisi') {
                $pdo->rollBack();
                fail('Surat ini tidak tersedia untuk revisi.', 403);
            }
            $history = json_decode((string) $letter['revision_history'], true);
            $history = is_array($history) ? $history : [];
            $resubmittedAt = date(DATE_ATOM);
            $history[] = ['action' => 'Diperbaiki dan dikirim ulang', 'by' => $user['name'], 'date' => $resubmittedAt];
            $update = $pdo->prepare(
                'UPDATE letters SET subject = ?, sender = ?, recipient = ?, date = ?, notes = ?, status = ?,
                    resubmitted_at = NOW(), revision_note = NULL, revision_history = ? WHERE id = ?'
            );
            $update->execute([$subject, $sender, $recipient, $date, $notes, 'Menunggu Persetujuan', json_encode($history, JSON_UNESCAPED_UNICODE), $id]);
            $letter['status'] = 'Menunggu Persetujuan';
            $letter['subject'] = $subject;
            logActivity($pdo, $user, $letter, 'Mengedit surat', 'Surat diperbaiki dan diajukan kembali.');
            $pdo->commit();
            respond(['ok' => true]);
        }

        case 'letter-delete': {
            requireRole($user, ['admin', 'atasan']);
            $id = filter_var($data['id'] ?? null, FILTER_VALIDATE_INT);
            if (!$id) {
                fail('Surat tidak ditemukan.', 404);
            }
            $pdo->beginTransaction();
            $letter = getLetter($pdo, (int) $id);
            logActivity($pdo, $user, $letter, 'Menghapus surat', 'Surat dihapus dari arsip.');
            $delete = $pdo->prepare('DELETE FROM letters WHERE id = ?');
            $delete->execute([$id]);
            $pdo->commit();
            respond(['ok' => true]);
        }

        case 'profile-update': {
            $name = textValue($data, 'name', 80);
            $photoData = null;
            $photoType = null;
            $photo = (string) ($data['photo'] ?? '');
            if ($photo !== '') {
                if (!preg_match('#^data:image/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$#', $photo, $match)) {
                    fail('Format foto profil tidak valid.');
                }
                $photoData = base64_decode($match[2], true);
                if ($photoData === false || strlen($photoData) > 3145728) {
                    fail('Ukuran foto profil maksimal 3 MB.');
                }
                $finfo = new finfo(FILEINFO_MIME_TYPE);
                $photoType = $finfo->buffer($photoData);
                if (!in_array($photoType, ['image/jpeg', 'image/png', 'image/webp'], true)) {
                    fail('Foto profil harus JPG, PNG, atau WebP.');
                }
            }
            $update = $pdo->prepare(
                'UPDATE users SET name = ?, photo_data = ?, photo_type = ? WHERE id = ?'
            );
            $update->execute([$name, $photoData, $photoType, $user['id']]);
            respond(['ok' => true]);
        }

        case 'user-create': {
            requireRole($user, ['admin']);
            $username = textValue($data, 'username', 40);
            if (!preg_match('/^[A-Za-z0-9._-]+$/', $username)) {
                fail('Nama pengguna hanya boleh berisi huruf, angka, titik, _ atau -.');
            }
            $name = textValue($data, 'name', 80);
            $password = (string) ($data['password'] ?? '');
            $role = (string) ($data['role'] ?? '');
            if (mb_strlen($password) < 8 || !in_array($role, ['admin', 'pegawai', 'atasan'], true)) {
                fail('Kata sandi minimal 8 karakter dan peran harus valid.');
            }
            $insert = $pdo->prepare('INSERT INTO users (username, name, role, password_hash) VALUES (?, ?, ?, ?)');
            try {
                $insert->execute([$username, $name, $role, password_hash($password, PASSWORD_DEFAULT)]);
            } catch (PDOException $error) {
                if ($error->getCode() === '23000') {
                    fail('Nama pengguna sudah digunakan.', 409);
                }
                throw $error;
            }
            respond(['ok' => true], 201);
        }

        case 'user-update': {
            requireRole($user, ['admin']);
            $username = textValue($data, 'username', 40);
            $target = adminTarget($pdo, $username);
            $name = textValue($data, 'name', 80);
            $role = $target['role'];
            if ($target['username'] !== $user['username']) {
                $role = (string) ($data['role'] ?? '');
                if (!in_array($role, ['admin', 'pegawai', 'atasan'], true)) {
                    fail('Peran pengguna tidak valid.');
                }
            }
            $update = $pdo->prepare('UPDATE users SET name = ?, role = ? WHERE id = ?');
            $update->execute([$name, $role, $target['id']]);
            respond(['ok' => true]);
        }

        case 'user-suspension': {
            requireRole($user, ['admin']);
            $username = textValue($data, 'username', 40);
            if ($username === $user['username']) {
                fail('Akun yang sedang digunakan tidak dapat ditangguhkan.');
            }
            $pdo->beginTransaction();
            $target = adminTarget($pdo, $username, true);
            $active = !(bool) $target['active'];
            if (!$active && $target['role'] === 'admin') {
                $activeAdmins = count($pdo->query("SELECT id FROM users WHERE role = 'admin' AND active = 1 FOR UPDATE")->fetchAll());
                if ($activeAdmins <= 1) {
                    $pdo->rollBack();
                    fail('Tidak dapat menangguhkan satu-satunya akun admin aktif.', 409);
                }
            }
            $update = $pdo->prepare('UPDATE users SET active = ? WHERE id = ?');
            $update->execute([$active ? 1 : 0, $target['id']]);
            $pdo->commit();
            respond(['ok' => true]);
        }

        case 'user-password': {
            requireRole($user, ['admin']);
            $username = textValue($data, 'username', 40);
            $password = (string) ($data['password'] ?? '');
            if (mb_strlen($password) < 8) {
                fail('Kata sandi minimal 8 karakter.');
            }
            $target = adminTarget($pdo, $username);
            $update = $pdo->prepare('UPDATE users SET password_hash = ? WHERE id = ?');
            $update->execute([password_hash($password, PASSWORD_DEFAULT), $target['id']]);
            respond(['ok' => true]);
        }

        case 'user-delete': {
            requireRole($user, ['admin']);
            $username = textValue($data, 'username', 40);
            if ($username === $user['username']) {
                fail('Akun yang sedang digunakan tidak dapat dihapus.');
            }
            $pdo->beginTransaction();
            $target = adminTarget($pdo, $username, true);
            if ($target['role'] === 'admin' && (bool) $target['active']) {
                $activeAdmins = count($pdo->query("SELECT id FROM users WHERE role = 'admin' AND active = 1 FOR UPDATE")->fetchAll());
                if ($activeAdmins <= 1) {
                    $pdo->rollBack();
                    fail('Tidak dapat menghapus satu-satunya akun admin aktif.', 409);
                }
            }
            $delete = $pdo->prepare('DELETE FROM users WHERE id = ?');
            $delete->execute([$target['id']]);
            $pdo->commit();
            respond(['ok' => true]);
        }

        default:
            fail('Endpoint tidak ditemukan.', 404);
    }
} catch (Throwable $error) {
    if (isset($pdo) && $pdo instanceof PDO && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    error_log((string) $error);
    respond(['error' => 'Terjadi kesalahan pada server. Periksa konfigurasi dan log PHP.'], 500);
}
