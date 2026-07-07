<?php
// Приём заявок с формы сайта и пересылка в Telegram. Лежит на Reg.ru (тот же домен, https).
header('Content-Type: application/json; charset=utf-8');

// ЗАПОЛНИТЬ перед деплоем на конкретный сайт: либо через переменные окружения хостинга
// (SetEnv в .htaccess / панель хостинга), либо — если хостинг не даёт env — заменить
// плейсхолдер буквально. НЕ коммитить сюда реальные значения.
$TOKEN = getenv('TELEGRAM_BOT_TOKEN') ?: 'YOUR_TELEGRAM_BOT_TOKEN';
$CHAT  = getenv('TELEGRAM_CHAT_ID') ?: 'YOUR_TELEGRAM_CHAT_ID';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['ok' => false]);
    exit;
}

$raw = file_get_contents('php://input');
$d = json_decode($raw, true);
if (!is_array($d)) {
    http_response_code(400);
    echo json_encode(['ok' => false]);
    exit;
}

// honeypot
if (!empty($d['company'])) {
    echo json_encode(['ok' => true]);
    exit;
}

function e($s) { return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8'); }

$lines = ['🟢 <b>Новая заявка с сайта</b>'];
if (!empty($d['name']))    $lines[] = '👤 ' . e($d['name']);
if (!empty($d['contact'])) $lines[] = '📞 ' . e($d['contact']);
if (!empty($d['message'])) $lines[] = '💬 ' . e($d['message']);
if (!empty($d['source']))  $lines[] = '📍 ' . e($d['source']);
if (!empty($d['page']))    $lines[] = '🔗 ' . e($d['page']);
$text = implode("\n", $lines);

$ch = curl_init("https://api.telegram.org/bot{$TOKEN}/sendMessage");
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 15,
    CURLOPT_POSTFIELDS => http_build_query([
        'chat_id' => $CHAT,
        'text' => $text,
        'parse_mode' => 'HTML',
        'disable_web_page_preview' => 'true',
    ]),
]);
$res = curl_exec($ch);
$code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($code >= 200 && $code < 300) {
    echo json_encode(['ok' => true]);
} else {
    http_response_code(502);
    echo json_encode(['ok' => false]);
}
