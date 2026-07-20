// Web Worker cho MODULE 06 (Monte Carlo) — chạy hàng trăm nghìn mô phỏng ngoài
// luồng UI để giao diện không bị đứng. Nhận {feat-lite, options}, trả top-K.
import { monteCarlo, buildFeatures } from './engine.js';

self.onmessage = (e) => {
  const { draws, cfg, options } = e.data;
  try {
    // Xây lại feature trong worker (kèm ma trận cặp) để tự chứa.
    const feat = buildFeatures(draws, cfg, { pairs: true, recentWindow: 60 });
    const t0 = performance.now();
    const res = monteCarlo(feat, options);
    res.ms = Math.round(performance.now() - t0);
    self.postMessage({ ok: true, res });
  } catch (err) {
    self.postMessage({ ok: false, error: String(err && err.message || err) });
  }
};
