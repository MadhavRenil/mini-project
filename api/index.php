<?php
/**
 * PHP API proxy to AI Travel Planner backend.
 * Forwards requests to Node server and returns JSON. Run Node server on port 3003.
 * Usage: POST/GET to this file with same path as /api/* (e.g. api/travel/plan).
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
  http_response_code(204);
  exit;
}

$base = 'http://127.0.0.1:3003';
$path = isset($_GET['path']) ? trim($_GET['path'], '/') : '';
if ($path === '') {
  echo json_encode(['error' => 'Missing path (e.g. path=auth/login)']);
  exit(400);
}

$url = $base . '/api/' . $path;
$method = $_SERVER['REQUEST_METHOD'];

$opts = [
  'http' => [
    'method' => $method,
    'header' => "Content-Type: application/json\r\n",
    'ignore_errors' => true
  ]
];

if ($method === 'POST' || $method === 'PUT') {
  $body = file_get_contents('php://input');
  $opts['http']['content'] = $body ?: '{}';
}

// Forward cookies for session
$cookie = isset($_SERVER['HTTP_COOKIE']) ? $_SERVER['HTTP_COOKIE'] : '';
if ($cookie !== '') {
  $opts['http']['header'] .= "Cookie: $cookie\r\n";
}

$ctx = stream_context_create($opts);
$response = @file_get_contents($url, false, $ctx);

if ($response === false) {
  http_response_code(502);
  echo json_encode(['error' => 'Backend unreachable. Start Node server: npm start']);
  exit;
}

$code = 200;
if (isset($http_response_header[0]) && preg_match('/ (\d+)/', $http_response_header[0], $m)) {
  $code = (int) $m[1];
}
http_response_code($code);
echo $response;

