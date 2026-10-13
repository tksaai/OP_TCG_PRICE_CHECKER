import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const CURL_MAX_BUFFER = 32 * 1024 * 1024;

export const BROWSER_HEADERS = Object.freeze({
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'accept-language': 'ja,en-US;q=0.9,en;q=0.8',
});

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

function shouldUseCurlFallback(error) {
  const status = Number(error?.status || 0);
  return status === 403 || status === 429 || status >= 500 || status === 0;
}

export async function fetchWithCurl(url, headers = BROWSER_HEADERS) {
  const curlCommand = process.platform === 'win32' ? 'curl.exe' : 'curl';
  const args = [
    '--fail',
    '--silent',
    '--show-error',
    '--location',
    '--compressed',
    '--max-time',
    '90',
  ];

  for (const [name, value] of Object.entries(headers)) {
    args.push('--header', `${name}: ${value}`);
  }
  args.push(url);

  const { stdout } = await execFileAsync(curlCommand, args, {
    encoding: 'utf8',
    maxBuffer: CURL_MAX_BUFFER,
    windowsHide: true,
  });
  return stdout;
}

// GitHub Actions では一部ショップが Node.js の fetch だけを 403 にすることがある。
// 通常は fetch を使い、アクセス拒否・一時障害・通信失敗時だけ別HTTP実装の curl へ退避する。
export async function fetchText(url, options = {}) {
  const headers = { ...BROWSER_HEADERS, ...(options.headers || {}) };
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const curlImpl = options.curlImpl || fetchWithCurl;
  let primaryError;

  try {
    const response = await fetchImpl(url, { headers, redirect: 'follow' });
    if (response.ok) return await response.text();

    primaryError = new Error(`${response.status} ${response.statusText}`.trim());
    primaryError.status = response.status;
  } catch (error) {
    primaryError = error;
  }

  if (options.allowCurlFallback === false || !shouldUseCurlFallback(primaryError)) {
    throw primaryError;
  }

  try {
    return await curlImpl(url, headers);
  } catch (curlError) {
    throw new Error(
      `${messageOf(primaryError)}; curl fallback failed: ${messageOf(curlError)}`,
      { cause: curlError },
    );
  }
}
