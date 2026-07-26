<?php
// First-party прокси конфига GrowthBook (features JSON) → HTTPS без mixed-content.
$UP = 'http://YOUR_VPS_IP:3100/api/features/YOUR_SDK_CLIENT_KEY';
$ch = curl_init($UP);
curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 8]);
$j = curl_exec($ch); $code = curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: public, max-age=120');
echo ($j !== false && $code === 200) ? $j : '{"features":{}}';
