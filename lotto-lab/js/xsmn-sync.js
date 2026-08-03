// ============================================================================
// js/xsmn-sync.js — NẠP DỮ LIỆU TỊNH TIẾN, CÓ ĐIỂM DỪNG, KHÔNG BAO GIỜ MẤT CÔNG.
//
// Ba thứ phải đúng để kho không bao giờ chết:
//
//   1. TIẾN TRƯỚC, LÙI SAU. Bắt kịp tới hôm nay là việc gấp; đào ngược quá khứ là việc
//      để dành. Trước đây chỉ có đào ngược, nên app đứt vài ngày là hổng vĩnh viễn —
//      trang chủ chỉ trả 7 ngày gần nhất, đứt quá 7 ngày là không cách nào tự vá.
//
//   2. LƯU TỪNG CHẶNG. Hàm serverless bị cắt ở 60s. Crawl 40 trang rồi mới lưu một lần
//      ở cuối nghĩa là chỉ cần chậm mạng một chút là mất trắng cả 40 trang, lần sau lại
//      bò từ đầu — kho không bao giờ lớn nổi. Ở đây cứ vài ngày mới là ghi kho một lần,
//      hết giờ thì phần đã ghi vẫn còn nguyên, lần chạy sau đi tiếp từ đó.
//
//   3. NHỚ CHỖ ĐÃ ĐỤNG TƯỜNG. Khi đào ngược tới giới hạn của nguồn, ghi nhận lại để
//      những lần sau khỏi phí thời gian đào lại vào chỗ trống.
// ============================================================================
import { fetchXSMNByDate } from './minhngoc.js';
import { mergeHistory, addDays } from './xsmn-store.js';

// Ngày hôm nay theo giờ Việt Nam (UTC+7) — mốc để biết kho còn cách bao xa.
export const todayICT = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
export const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);

// NGÀY SỚM NHẤT CÒN ĐƯỢC PHÉP CAM KẾT SỐ.
//
// Đài Miền Nam quay lúc ~16h15 và kết quả lên nguồn ~16h35 (giờ VN). Ghi số cho một kỳ
// ĐÃ QUAY thì không còn là dự báo nữa — đó là chép đáp án. Chuyện này không cần ai gian
// lận cũng xảy ra được: kho chậm 2 ngày ⇒ "ngày kế tiếp của kho" lại là một ngày trong
// quá khứ, mà bộ não thì đã học chính ngày đó rồi. Cam kết kiểu ấy chắc chắn trúng, và
// nó sẽ âm thầm thổi phồng mọi tỉ lệ trên trang chủ.
//
// Lấy mốc 16h00 cho chắc tay: trong khoảng 16h00–16h35 kết quả đang nhỏ giọt về, cứ coi
// như hôm nay đã đóng sổ.
const CUTOFF_HOUR_ICT = 16;
export function committableFrom() {
  const ict = new Date(Date.now() + 7 * 3600 * 1000);
  const today = ict.toISOString().slice(0, 10);
  return ict.getUTCHours() < CUTOFF_HOUR_ICT ? today : addDays(today, 1);
}

// Kho coi là TƯƠI khi đã có dữ liệu tới hôm qua. Kết quả hôm nay chỉ về sau ~16h35 giờ
// VN, nên trước giờ đó mà đòi có ngày hôm nay là đòi hỏi vô lý, không phải lỗi.
export function freshness(history) {
  const today = todayICT();
  const newest = history.length ? history[0].date : null;
  const behind = newest ? daysBetween(newest, today) : 9999;
  return { today, newest, daysBehind: behind, stale: behind > 1 };
}

// Đi TỚI: từ ngày mới nhất trong kho bò dần tới hôm nay. Mỗi trang theo ngày của nguồn
// trả về 7 ngày KẾT THÚC ở ngày được hỏi, nên mỗi lượt hỏi nhảy tối đa 7 ngày.
export async function syncForward(merged, { deadline, maxSteps = 12, onProgress } = {}) {
  const today = todayICT();
  let added = 0, steps = 0, done = false;
  for (; steps < maxSteps; steps++) {
    if (deadline && Date.now() > deadline) break;
    const newest = merged.length ? merged[0].date : addDays(today, -7);
    if (daysBetween(newest, today) <= 0) { done = true; break; }
    const jump = addDays(newest, 7);
    const ask = daysBetween(jump, today) < 0 ? today : jump; // không hỏi vượt hôm nay
    const page = await fetchXSMNByDate(ask);
    const m = mergeHistory(merged, page);
    if (m.added === 0) { done = true; break; }  // nguồn chưa có gì mới hơn ⇒ đã bắt kịp
    merged = m.merged; added += m.added;
    if (onProgress) await onProgress(merged, added);
  }
  return { merged, added, steps, done };
}

// Đi LÙI: đào sâu quá khứ để mẫu thống kê dày lên. Chịu được vài trang rỗng liên tiếp
// (lễ, trang hỏng) rồi mới kết luận đã chạm đáy nguồn.
export async function syncBackward(merged, { deadline, maxSteps = 40, onProgress, dryLimit = 3 } = {}) {
  let added = 0, dry = 0, steps = 0, exhausted = false;
  let cursor = merged.length ? merged[merged.length - 1].date : todayICT();
  for (; steps < maxSteps; steps++) {
    if (deadline && Date.now() > deadline) break;
    if (dry >= dryLimit) { exhausted = true; break; }
    const page = await fetchXSMNByDate(addDays(cursor, -1));
    const m = mergeHistory(merged, page);
    if (m.added === 0) { dry++; cursor = addDays(cursor, -7); continue; }
    dry = 0; merged = m.merged; added += m.added;
    cursor = merged[merged.length - 1].date;
    if (onProgress) await onProgress(merged, added);
  }
  return { merged, added, steps, exhausted };
}

// Gói ghi kho theo chặng: cứ đủ `every` ngày mới thì lưu một lần. Trả về hàm onProgress.
// Nhờ nó, hàm bị cắt giữa chừng vẫn giữ được phần lớn công đã làm.
export function checkpoint(save, every = 7) {
  let lastSaved = 0;
  return async (merged, added) => {
    if (added - lastSaved >= every) { lastSaved = added; await save(merged); }
  };
}
