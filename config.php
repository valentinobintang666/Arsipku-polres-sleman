<?php
declare(strict_types=1);

function databaseConfig(): array
{
    return [
        'host' => getenv('ARSIPKU_DB_HOST') ?: '127.0.0.1',
        'port' => getenv('ARSIPKU_DB_PORT') ?: '3306',
        'name' => getenv('ARSIPKU_DB_NAME') ?: 'arsipku',
        'user' => getenv('ARSIPKU_DB_USER') ?: 'root',
        'password' => getenv('ARSIPKU_DB_PASS') ?: '',
    ];
}

function database(): PDO
{
    static $connection;
    if ($connection instanceof PDO) {
        return $connection;
    }

    $config = databaseConfig();
    $dsn = sprintf(
        'mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4',
        $config['host'],
        $config['port'],
        $config['name']
    );
    $connection = new PDO($dsn, $config['user'], $config['password'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);

    return $connection;
}

function startSecureSession(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }

    session_set_cookie_params([
        'httponly' => true,
        'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
        'samesite' => 'Strict',
        'path' => '/',
    ]);
    session_start();
}
