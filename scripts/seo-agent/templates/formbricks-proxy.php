<?php
// First-party прокси Formbricks: SDK грузится и общается через сам сайт (https, без mixed-content,
// обход адблока). appUrl SDK = https://<site>/fb → все вызовы идут на /fb/* → сюда → на VPS.
// Кладётся как <site>/fb.php; в .htaccess: RewriteRule ^fb/(.*)$ /fb.php?path=$1 [L,QSA]
$UPSTREAM = 'http://YOUR_VPS_IP:3013';
$path = isset($_GET['path']) ? $_GET['path'] : '';
$path = '/' . ltrim($path, '/');
// сохранить прочие query-параметры (кроме служебного path)
$qs = $_GET; unset($qs['path']);
$query = http_build_query($qs);
$url = $UPSTREAM . $path . ($query ? '?' . $query : '');

$method = $_SERVER['REQUEST_METHOD'];
$ch = curl_init($url);
$headers = ['User-Agent: ' . (isset($_SERVER['HTTP_USER_AGENT']) ? $_SERVER['HTTP_USER_AGENT'] : ''),
            'X-Forwarded-For: ' . (isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : '')];
if (isset($_SERVER['CONTENT_TYPE'])) $headers[] = 'Content-Type: ' . $_SERVER['CONTENT_TYPE'];
curl_setopt_array($ch, [
  CURLOPT_CUSTOMREQUEST => $method,
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_HEADER => true,
  CURLOPT_TIMEOUT => 12,
  CURLOPT_HTTPHEADER => $headers,
]);
if ($method === 'POST' || $method === 'PUT' || $method === 'PATCH') {
  curl_setopt($ch, CURLOPT_POSTFIELDS, file_get_contents('php://input'));
}
$resp = curl_exec($ch);
$code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$hsize = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
$ctype = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
curl_close($ch);

http_response_code($code ? $code : 502);
if ($ctype) header('Content-Type: ' . $ctype);
echo $resp !== false ? substr($resp, $hsize) : '';
