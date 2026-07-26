<?php
// First-party прокси Umami: трекер грузится с самого сайта (https, cookieless), обходит адблок/ITP.
// /api/u.php?p=script → отдаёт трекер-скрипт Umami; /api/send (rewrite → ?p=send) → шлёт событие.
// Апстрим — Umami на VPS. Клиентский IP/UA прокидываются для корректной гео/уникальности.
$UPSTREAM = 'http://YOUR_VPS_IP:3011';
$p = isset($_GET['p']) ? $_GET['p'] : '';

if ($p === 'script') {
  $ch = curl_init($UPSTREAM . '/script.js');
  curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 8]);
  $js = curl_exec($ch);
  $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
  curl_close($ch);
  header('Content-Type: application/javascript; charset=utf-8');
  header('Cache-Control: public, max-age=86400');
  if ($js !== false && $code === 200) echo $js;
  exit;
}

if ($p === 'send') {
  $body = file_get_contents('php://input');
  $ch = curl_init($UPSTREAM . '/api/send');
  curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => $body,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 8,
    CURLOPT_HTTPHEADER => [
      'Content-Type: application/json',
      'User-Agent: ' . (isset($_SERVER['HTTP_USER_AGENT']) ? $_SERVER['HTTP_USER_AGENT'] : ''),
      'X-Forwarded-For: ' . (isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : ''),
    ],
  ]);
  $resp = curl_exec($ch);
  $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
  curl_close($ch);
  http_response_code($code ? $code : 502);
  header('Content-Type: text/plain; charset=utf-8');
  echo $resp !== false ? $resp : '';
  exit;
}

http_response_code(404);
