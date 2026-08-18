(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PwaUpdate = api;

  if (root.document && root.navigator?.serviceWorker) {
    const start = () => api.init(root);
    if (root.document.readyState === 'loading') {
      root.document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
      start();
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const AUTO_UPDATE_DELAY_MS = 8000;
  const CHECK_INTERVAL_MS = 10 * 60 * 1000;
  const TRACKED_ASSETS = [
    'index.html',
    'search-utils.js',
    'pwa-update.js',
    'manifest.webmanifest',
    'data/cards.json',
    'data/card-details.json',
  ];

  function responseVersion(response) {
    if (!response?.ok) return '';
    const etag = response.headers.get('etag') || '';
    const modified = response.headers.get('last-modified') || '';
    const length = response.headers.get('content-length') || '';
    return [etag, modified, length].filter(Boolean).join('|');
  }

  async function fetchVersionSignature(fetchImpl, baseUrl) {
    const entries = await Promise.all(
      TRACKED_ASSETS.map(async (asset) => {
        try {
          const url = new URL(asset, baseUrl).href;
          const response = await fetchImpl(url, { method: 'HEAD', cache: 'no-store' });
          const version = responseVersion(response);
          return version ? `${asset}:${version}` : '';
        } catch {
          return '';
        }
      })
    );
    const available = entries.filter(Boolean);
    return available.length ? available.join('\n') : null;
  }

  function signaturesDiffer(previous, current) {
    return Boolean(previous && current && previous !== current);
  }

  function init(win) {
    const doc = win.document;
    const toast = doc.getElementById('pwa-update-toast');
    const message = toast?.querySelector('.pwa-update-message span');
    const applyButton = doc.getElementById('pwa-update-apply');
    const dismissButton = doc.getElementById('pwa-update-dismiss');
    if (!toast || !message || !applyButton || !dismissButton) return null;

    let registration = null;
    let baselineSignature = null;
    let updateQueued = false;
    let deferred = false;
    let refreshing = false;
    let autoUpdateTimer = null;
    let countdownTimer = null;

    function clearUpdateTimers() {
      if (autoUpdateTimer) win.clearTimeout(autoUpdateTimer);
      if (countdownTimer) win.clearInterval(countdownTimer);
      autoUpdateTimer = null;
      countdownTimer = null;
    }

    function renderCountdown(seconds) {
      message.textContent = `${seconds}秒後に自動更新します。所持枚数とお気に入りは保持されます。`;
    }

    async function waitForInstalled(worker, timeoutMs = 5000) {
      if (!worker || worker.state === 'installed' || worker.state === 'activated') return;
      await new Promise((resolve) => {
        const timeout = win.setTimeout(resolve, timeoutMs);
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' || worker.state === 'activated' || worker.state === 'redundant') {
            win.clearTimeout(timeout);
            resolve();
          }
        });
      });
    }

    async function applyUpdate() {
      if (refreshing) return;
      clearUpdateTimers();
      refreshing = true;
      applyButton.disabled = true;
      applyButton.textContent = '更新中…';
      message.textContent = '新しいバージョンへ切り替えています。';

      try {
        await registration?.update();
        if (!registration?.waiting && registration?.installing) {
          await waitForInstalled(registration.installing);
        }
        if (registration?.waiting) {
          registration.waiting.postMessage({ type: 'SKIP_WAITING' });
          return;
        }
      } catch (error) {
        console.warn('Service Workerの更新確認に失敗しました。再読み込みします。', error);
      }
      win.location.reload();
    }

    function announceUpdate() {
      if (deferred || updateQueued) return;
      updateQueued = true;
      toast.hidden = false;
      let seconds = Math.ceil(AUTO_UPDATE_DELAY_MS / 1000);
      renderCountdown(seconds);
      countdownTimer = win.setInterval(() => {
        seconds -= 1;
        if (seconds > 0) renderCountdown(seconds);
      }, 1000);
      autoUpdateTimer = win.setTimeout(applyUpdate, AUTO_UPDATE_DELAY_MS);
    }

    function deferUpdate() {
      deferred = true;
      updateQueued = false;
      clearUpdateTimers();
      toast.hidden = true;
    }

    function watchRegistration(nextRegistration) {
      registration = nextRegistration;
      if (registration.waiting && win.navigator.serviceWorker.controller) announceUpdate();
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && win.navigator.serviceWorker.controller) announceUpdate();
        });
      });
    }

    async function checkTrackedAssets() {
      const signature = await fetchVersionSignature(win.fetch.bind(win), win.location.href);
      if (!signature) return;
      if (baselineSignature == null) {
        baselineSignature = signature;
        return;
      }
      if (signaturesDiffer(baselineSignature, signature)) announceUpdate();
    }

    async function requestUpdateCheck() {
      await Promise.allSettled([registration?.update(), checkTrackedAssets()]);
    }

    applyButton.addEventListener('click', applyUpdate);
    dismissButton.addEventListener('click', deferUpdate);
    win.navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) win.location.reload();
    });
    win.navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'APP_UPDATE_AVAILABLE') announceUpdate();
    });

    win.navigator.serviceWorker
      .register('./service-worker.js', { scope: './', updateViaCache: 'none' })
      .then((nextRegistration) => {
        watchRegistration(nextRegistration);
        checkTrackedAssets();
        win.setInterval(requestUpdateCheck, CHECK_INTERVAL_MS);
        win.addEventListener('focus', requestUpdateCheck);
        win.addEventListener('online', requestUpdateCheck);
        doc.addEventListener('visibilitychange', () => {
          if (doc.visibilityState === 'visible') requestUpdateCheck();
        });
      })
      .catch((error) => console.warn('PWAを開始できませんでした。', error));

    return { announceUpdate, applyUpdate, deferUpdate, requestUpdateCheck };
  }

  return {
    AUTO_UPDATE_DELAY_MS,
    CHECK_INTERVAL_MS,
    TRACKED_ASSETS,
    responseVersion,
    fetchVersionSignature,
    signaturesDiffer,
    init,
  };
});
