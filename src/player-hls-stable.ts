import Hls from "hls.js";

export type HlsConfigPartial = Partial<Hls.OptionalConfig>;

const DEFAULT_CFG: HlsConfigPartial = {
  debug: false,
  enableWorker: true,
  maxBufferLength: 60,
  maxBufferSize: 60 * 1000 * 1000,
  maxBufferHole: 0.7,
  liveSyncDurationCount: 3,
  liveMaxLatencyDurationCount: 6,
  fragLoadingTimeOut: 20000,
  fragLoadingMaxRetry: 6,
  maxFragLookUpTolerance: 0.2,
  nudgeOffset: 0.1,
  nudgeMaxRetry: 3,
  backBufferLength: 30,
};

export function createHlsInstance(mediaEl: HTMLVideoElement, cfg: HlsConfigPartial = {}): Hls {
  const config = Object.assign({}, DEFAULT_CFG, cfg);
  const hls = new Hls(config);
  let fragErrorCount = 0;

  hls.on(Hls.Events.ERROR, (_ev, data: any) => {
    const { type, details, fatal } = data;
    if (config.debug) console.debug("[hls] error:", type, details, fatal, data);

    if (!fatal) return;

    if (details === Hls.ErrorDetails.FRAG_LOAD_ERROR || details === Hls.ErrorDetails.FRAG_LOAD_TIMEOUT) {
      fragErrorCount++;
      const maxRetry = (config.fragLoadingMaxRetry as number) || 6;
      if (fragErrorCount <= maxRetry) {
        const baseDelay = (config.fragLoadingRetryDelay as number) || 500;
        const delay = Math.round(baseDelay * Math.pow(1.5, fragErrorCount - 1));
        setTimeout(() => {
          try { hls.startLoad(); } catch {}
        }, delay);
        return;
      }
    }

    try {
      hls.recoverMediaError();
      fragErrorCount = 0;
    } catch {
      try { hls.destroy(); } catch {}
    }
  });

  hls.on(Hls.Events.FRAG_LOADED, () => { fragErrorCount = 0; });
  hls.attachMedia(mediaEl);
  return hls;
}

export async function swapStream(opts: {
  mediaEl: HTMLVideoElement;
  oldHls?: Hls | null;
  newUrl: string;
  config?: HlsConfigPartial;
  readyTimeoutMs?: number;
}): Promise<Hls> {
  const { mediaEl, oldHls, newUrl, config, readyTimeoutMs = 5000 } = opts;
  const newHls = createHlsInstance(mediaEl, config);

  try {
    const check = await fetch(newUrl, { method: "GET", mode: "cors" });
    if (config?.debug && !check.ok) console.warn("[hls] manifest check", check.status);
  } catch {}

  newHls.loadSource(newUrl);

  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => { if (done) return; done = true; cleanup(); resolve(); };
    const cleanup = () => {
      newHls.off(Hls.Events.FRAG_LOADED, finish);
      newHls.off(Hls.Events.ERROR, finish);
    };
    newHls.on(Hls.Events.FRAG_LOADED, finish);
    newHls.on(Hls.Events.ERROR, finish);
    setTimeout(finish, readyTimeoutMs);
  });

  if (oldHls) {
    try { oldHls.detachMedia(); } catch {}
    try { oldHls.destroy(); } catch {}
  }

  try { if (mediaEl.paused) void mediaEl.play(); } catch {}
  return newHls;
}
