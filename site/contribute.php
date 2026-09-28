<?php
declare(strict_types=1);

header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
header('Cache-Control: no-store');

function fail(int $status, string $message): void {
    http_response_code($status);
    header('Content-Type: text/plain; charset=utf-8');
    echo $message, "\n";
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Allow: POST');
    fail(405, 'POST only.');
}

$type = $_SERVER['CONTENT_TYPE'] ?? '';
if (stripos($type, 'application/json') !== 0) {
    fail(415, 'Send JSON.');
}

$length = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
if ($length > 120000) {
    fail(413, 'That sweep is too large.');
}

$raw = file_get_contents('php://input', false, null, 0, 120001);
if ($raw === false || strlen($raw) > 120000) {
    fail(413, 'That sweep is too large.');
}

try {
    $body = json_decode($raw, true, 8, JSON_THROW_ON_ERROR);
} catch (Throwable $error) {
    fail(400, 'That sweep could not be read.');
}

if (!is_array($body) || array_is_list($body)) {
    fail(400, 'That sweep could not be read.');
}

$banned = [
    'html' => true,
    'snippet' => true,
    'cookie' => true,
    'authorization' => true,
    'token' => true,
    'password' => true,
    'email' => true,
    'secret' => true,
    'key' => true,
    'api_key' => true,
    'apikey' => true,
    'bearer' => true,
    'access_token' => true,
    'prompt' => true,
    'answer' => true,
];

$foundBanned = false;
$walk = function ($node) use (&$walk, $banned, &$foundBanned): void {
    if ($foundBanned) {
        return;
    }
    if (!is_array($node)) {
        return;
    }
    foreach ($node as $name => $value) {
        if (is_string($name) && isset($banned[strtolower($name)])) {
            $foundBanned = true;
            return;
        }
        if (is_array($value)) {
            $walk($value);
        }
    }
};
$walk($body);
if ($foundBanned) {
    fail(400, 'That sweep could not be saved.');
}

if (!isset($body['profiles']) || !is_array($body['profiles']) || array_is_list($body['profiles']) === false) {
    fail(400, 'That sweep could not be saved.');
}
if (count($body['profiles']) > 30) {
    fail(400, 'Too many profiles.');
}
if (count($body['profiles']) < 1) {
    fail(400, 'That sweep could not be saved.');
}

$allow = [
    'elonmusk' => true,
    'mayemusk' => true,
    'kimbalmusk' => true,
    'tesla' => true,
    'spacex' => true,
    'xai' => true,
    'neuralink' => true,
    'boringcompany' => true,
];

$fallbackWords = ['fuck', 'shit', 'bitch', 'asshole', 'bastard', 'damn', 'crap', 'dick', 'cock', 'pussy', 'cunt', 'slut', 'whore', 'nigger', 'nigga', 'faggot', 'fag', 'retard', 'retarded', 'spastic', 'chink', 'spic', 'kike', 'tranny', 'rape', 'rapist', 'nazi'];

function word_list(array $fallback): array {
    $path = __DIR__ . '/words.json';
    if (!is_file($path)) {
        return $fallback;
    }
    $decoded = json_decode((string) file_get_contents($path), true);
    if (!is_array($decoded) || !isset($decoded['words']) || !is_array($decoded['words'])) {
        return $fallback;
    }
    $words = [];
    foreach ($decoded['words'] as $word) {
        if (is_string($word) && $word !== '') {
            $words[] = strtolower($word);
        }
    }
    return $words ?: $fallback;
}

function fold_token(string $token): string {
    $token = strtolower($token);
    $token = strtr($token, ['0' => 'o', '1' => 'i', '3' => 'e', '4' => 'a', '5' => 's', '@' => 'a', '$' => 's']);
    $token = preg_replace('/[^a-z]/', '', $token) ?? '';
    return preg_replace('/([a-z])\1{2,}/', '$1', $token) ?? '';
}

function strip_words(string $text, array $blocked): string {
    $lookup = array_fill_keys($blocked, true);
    $parts = preg_split('/\s+/u', trim($text)) ?: [];
    $kept = [];
    foreach ($parts as $part) {
        if ($part === '') {
            continue;
        }
        $folded = fold_token($part);
        if ($folded !== '' && isset($lookup[$folded])) {
            continue;
        }
        $kept[] = $part;
    }
    $joined = trim(preg_replace('/\s+/u', ' ', implode(' ', $kept)) ?? '');
    return $joined;
}

function clip(string $text, int $max): string {
    if (function_exists('mb_substr')) {
        return mb_substr($text, 0, $max, 'UTF-8');
    }
    return substr($text, 0, $max);
}

function drop_long_tokens(string $text): string {
    return preg_replace('/[A-Za-z0-9_\-]{20,}/', '', $text) ?? '';
}

function clean_name(string $text, array $blocked): string {
    $text = drop_long_tokens($text);
    $text = strip_words($text, $blocked);
    $text = preg_replace("/[^\\p{L}\\p{N} '\\-]/u", '', $text) ?? '';
    $text = trim(preg_replace('/\s+/u', ' ', $text) ?? '');
    $text = trim(clip($text, 32));
    return $text === '' ? 'A visitor' : $text;
}

function clean_note(string $text, array $blocked): string {
    $text = drop_long_tokens($text);
    $text = strip_words($text, $blocked);
    $text = preg_replace("/[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F]/", '', $text) ?? '';
    $text = trim(preg_replace('/\s+/u', ' ', $text) ?? '');
    return trim(clip($text, 140));
}

function clean_handle(string $value): string {
    $text = trim($value);
    if (str_contains($text, '/')) {
        $text = explode('/', trim($text, '/'))[0];
        $text = explode('?', $text)[0];
    }
    $text = ltrim($text, '@');
    return preg_match('/^[A-Za-z0-9_]{1,15}$/', $text) === 1 ? $text : '';
}

function limited_distance(string $left, string $right, int $limit = 1): int {
    if ($left === $right) {
        return 0;
    }
    $n = strlen($left);
    $m = strlen($right);
    if (abs($n - $m) > $limit) {
        return $limit + 1;
    }
    $prev = range(0, $m);
    for ($i = 1; $i <= $n; $i++) {
        $cur = [$i];
        $rowMin = $i;
        $ca = $left[$i - 1];
        for ($j = 1; $j <= $m; $j++) {
            $ins = $cur[$j - 1] + 1;
            $del = $prev[$j] + 1;
            $sub = $prev[$j - 1] + ($ca !== $right[$j - 1] ? 1 : 0);
            $best = $sub < $ins ? $sub : $ins;
            if ($del < $best) {
                $best = $del;
            }
            $cur[] = $best;
            if ($best < $rowMin) {
                $rowMin = $best;
            }
        }
        if ($rowMin > $limit) {
            return $limit + 1;
        }
        $prev = $cur;
    }
    return $prev[$m];
}

function parse_day($value): ?DateTimeImmutable {
    if (!is_string($value) || preg_match('/^(\d{4})-(\d{2})-(\d{2})/', $value, $match) !== 1) {
        return null;
    }
    $day = DateTimeImmutable::createFromFormat('!Y-m-d', $match[1] . '-' . $match[2] . '-' . $match[3], new DateTimeZone('UTC'));
    $errors = DateTimeImmutable::getLastErrors();
    if (!$day || ($errors && (($errors['warning_count'] ?? 0) > 0 || ($errors['error_count'] ?? 0) > 0))) {
        return null;
    }
    return $day;
}

function companies(string $bio): array {
    $text = strtolower($bio);
    $marks = [
        'tesla' => ['tesla'],
        'spacex' => ['spacex', 'space x'],
        'xai' => ['xai', 'x.ai'],
        'neuralink' => ['neuralink'],
        'boring' => ['boring company', 'the boring company'],
    ];
    $found = [];
    foreach ($marks as $name => $needles) {
        foreach ($needles as $needle) {
            if (str_contains($text, $needle)) {
                $found[] = $name;
                break;
            }
        }
    }
    return $found;
}

function number_or_null($value): ?float {
    if (is_int($value) || is_float($value)) {
        return (float) $value;
    }
    if (is_string($value) && is_numeric($value)) {
        return (float) $value;
    }
    return null;
}

function score_profile(array $profile, array $allow, DateTimeImmutable $today): ?array {
    $handle = clean_handle((string) ($profile['username'] ?? ''));
    if ($handle === '') {
        return null;
    }
    $folded = strtolower($handle);
    if ($folded === 'elonmusk' || isset($allow[$folded])) {
        return null;
    }
    $bioSeen = array_key_exists('description', $profile);
    $bio = '';
    if ($bioSeen && is_string($profile['description'])) {
        $bio = trim(clip($profile['description'], 500));
    }
    $safe = ['parody', 'fan account', 'fan page', 'not affiliated', 'not the real', 'not elon', 'satire', 'commentary account'];
    if ($bioSeen) {
        $lowerBio = strtolower($bio);
        foreach ($safe as $phrase) {
            if (str_contains($lowerBio, $phrase)) {
                return null;
            }
        }
    }
    $signals = [];
    if ($folded !== 'elonmusk' && limited_distance($folded, 'elonmusk', 1) === 1) {
        $signals[] = 'handle_one_off';
    }
    $created = parse_day($profile['created_at'] ?? null);
    if ($created) {
        $days = (int) round(($today->getTimestamp() - $created->getTimestamp()) / 86400);
        if ($days < 90) {
            $signals[] = 'young_account';
        }
    }
    $metrics = is_array($profile['public_metrics'] ?? null) ? $profile['public_metrics'] : [];
    $followers = number_or_null($metrics['followers_count'] ?? null);
    $following = number_or_null($metrics['following_count'] ?? null);
    if ($followers !== null && $following !== null && $followers > 0 && ($following <= 0 || ($followers / $following) > 3)) {
        $signals[] = 'follower_ratio';
    }
    if ($bioSeen && $bio === '') {
        $signals[] = 'empty_bio';
    }
    $avatarSeen = array_key_exists('profile_image_url', $profile);
    $avatar = $avatarSeen && is_string($profile['profile_image_url']) ? strtolower($profile['profile_image_url']) : '';
    if ($avatarSeen && str_contains($avatar, 'default_profile')) {
        $signals[] = 'default_avatar';
    }
    if ($bioSeen) {
        $names = companies($bio);
        $three = in_array('tesla', $names, true) && in_array('spacex', $names, true) && in_array('xai', $names, true);
        if ($three) {
            $signals[] = 'three_companies';
        } elseif (count($names) >= 2) {
            $signals[] = 'multi_company';
        }
    }
    $weights = [
        'handle_one_off' => 4,
        'young_account' => 2,
        'follower_ratio' => 1,
        'empty_bio' => 1,
        'default_avatar' => 2,
        'multi_company' => 2,
        'three_companies' => 3,
    ];
    $total = 0;
    foreach ($signals as $signal) {
        $total += $weights[$signal];
    }
    if ($total < 4) {
        return null;
    }
    $activity = 'unknown';
    if ($created) {
        $days = (int) round(($today->getTimestamp() - $created->getTimestamp()) / 86400);
        $activity = $days < 90 ? 'active' : 'dormant';
    }
    return [
        'handle' => $handle,
        'score' => $total,
        'activity' => $activity,
        'signals' => $signals,
    ];
}

$words = word_list($fallbackWords);
$name = clean_name(is_string($body['name'] ?? null) ? $body['name'] : '', $words);
$note = clean_note(is_string($body['note'] ?? null) ? $body['note'] : '', $words);
$knownTerms = ['elon' => true, 'musk' => true, 'maye' => true];
$termSet = [];
if (isset($body['terms']) && is_array($body['terms'])) {
    foreach ($body['terms'] as $term) {
        if (is_string($term)) {
            $foldedTerm = strtolower($term);
            if (isset($knownTerms[$foldedTerm])) {
                $termSet[$foldedTerm] = true;
            }
        }
    }
}
$terms = [];
foreach (['elon', 'musk', 'maye'] as $term) {
    if (isset($termSet[$term])) {
        $terms[] = $term;
    }
}

$today = new DateTimeImmutable('today', new DateTimeZone('UTC'));
$scored = [];
foreach ($body['profiles'] as $profile) {
    if (!is_array($profile)) {
        fail(400, 'That sweep could not be saved.');
    }
    $row = score_profile($profile, $allow, $today);
    if ($row) {
        $scored[] = $row;
    }
}

$dir = __DIR__;
if (!is_writable($dir)) {
    fail(500, 'The ledger could not be saved.');
}

$ledgerPath = $dir . '/ledger.json';
$lockPath = $dir . '/ledger.lock';
$limitPath = $dir . '/ledger.limit';
$lock = fopen($lockPath, 'c');
if ($lock === false) {
    fail(500, 'The ledger could not be saved.');
}
if (!flock($lock, LOCK_EX)) {
    fclose($lock);
    fail(500, 'The ledger could not be saved.');
}

$address = $_SERVER['REMOTE_ADDR'] ?? '';
if ($address !== '' && is_writable($dir)) {
    $limit = [];
    if (is_file($limitPath)) {
        $decodedLimit = json_decode((string) file_get_contents($limitPath), true);
        if (is_array($decodedLimit)) {
            $limit = $decodedLimit;
        }
    }
    $now = time();
    $fresh = [];
    foreach ($limit as $hash => $seen) {
        if (is_string($hash) && is_int($seen) && ($now - $seen) < 120) {
            $fresh[$hash] = $seen;
        }
    }
    $hash = hash('sha256', $address);
    if (isset($fresh[$hash]) && ($now - $fresh[$hash]) < 30) {
        file_put_contents($limitPath, json_encode($fresh), LOCK_EX);
        flock($lock, LOCK_UN);
        fclose($lock);
        fail(429, 'Wait a moment before another sweep.');
    }
    $fresh[$hash] = $now;
    file_put_contents($limitPath, json_encode($fresh), LOCK_EX);
}

$doc = ['updated_at' => null, 'donors' => [], 'handles' => []];
if (is_file($ledgerPath)) {
    $decodedLedger = json_decode((string) file_get_contents($ledgerPath), true);
    if (!is_array($decodedLedger) || !isset($decodedLedger['donors'], $decodedLedger['handles']) || !is_array($decodedLedger['donors']) || !is_array($decodedLedger['handles'])) {
        flock($lock, LOCK_UN);
        fclose($lock);
        fail(500, 'The ledger could not be saved.');
    }
    $doc = $decodedLedger;
}

if (count($doc['donors']) >= 500) {
    flock($lock, LOCK_UN);
    fclose($lock);
    fail(429, 'The ledger is full for now.');
}

$known = [];
foreach ($doc['handles'] as $existing) {
    if (is_array($existing) && isset($existing['handle']) && is_string($existing['handle'])) {
        $known[strtolower($existing['handle'])] = true;
    }
}

$nowIso = gmdate('Y-m-d\TH:i:s\Z');
$added = 0;
foreach ($scored as $row) {
    $key = strtolower($row['handle']);
    if (isset($known[$key])) {
        continue;
    }
    if (count($doc['handles']) >= 2000) {
        break;
    }
    $known[$key] = true;
    $doc['handles'][] = [
        'handle' => $row['handle'],
        'score' => $row['score'],
        'activity' => $row['activity'],
        'signals' => $row['signals'],
        'added_at' => $nowIso,
    ];
    $added++;
}

$profiles = count($body['profiles']);
$doc['donors'][] = [
    'name' => $name,
    'note' => $note,
    'at' => $nowIso,
    'profiles' => $profiles,
    'usd' => $profiles / 100,
    'added' => $added,
    'terms' => $terms,
];
$doc['updated_at'] = $nowIso;

$json = json_encode($doc, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
if ($json === false) {
    flock($lock, LOCK_UN);
    fclose($lock);
    fail(500, 'The ledger could not be saved.');
}
$tmp = $ledgerPath . '.tmp';
if (file_put_contents($tmp, $json . "\n", LOCK_EX) === false || !rename($tmp, $ledgerPath)) {
    flock($lock, LOCK_UN);
    fclose($lock);
    fail(500, 'The ledger could not be saved.');
}

flock($lock, LOCK_UN);
fclose($lock);

header('Content-Type: application/json; charset=utf-8');
echo json_encode([
    'ok' => true,
    'profiles' => $profiles,
    'usd' => $profiles / 100,
    'added' => $added,
    'name' => $name,
    'note' => $note,
], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
