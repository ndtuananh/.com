// POST /api/extract  { image: "<base64 không kèm prefix>", media_type: "image/jpeg" }
// → gọi Google Gemini (bản MIỄN PHÍ), trả JSON theo schema (mục 4 của SKILL). Key ẩn phía server.

const API_KEY = process.env.GEMINI_API_KEY || '';
// Danh sách model theo thứ tự ưu tiên; model chính lỗi/quá tải/bị khóa → tự nhảy sang cái kế.
const MODELS = (process.env.GEMINI_MODEL || 'gemini-3-flash-preview,gemini-flash-latest,gemini-2.5-flash-lite')
  .split(',').map(s => s.trim()).filter(Boolean);

const SYSTEM_PROMPT = `Bạn là công cụ OCR chuyên đọc PHIẾU CẮT trong nhà máy kết cấu thép, để lập Lệnh Sản Xuất.
Ảnh đầu vào thuộc MỘT trong hai loại. Bạn phải TỰ phân loại rồi áp đúng quy tắc.

LOẠI 1 — "printed_table": phiếu in dạng bảng có 2 cột "String" và "Instances".
  • Cột "String"  → trường "code" (TÊN CHI TIẾT).
  • Cột "Instances" → trường "qty" (số lượng, số nguyên).
  • Lấy HẾT các dòng dữ liệu, ĐÚNG THỨ TỰ xuất hiện từ trên xuống.
  • Các dòng phía trên bảng (LSX, DVGC, MÁY, và các số viết tay lem/gạch xóa) KHÔNG đưa vào items → cho vào "ignored_lines".

LOẠI 2 — "handwritten_list": ghi chú viết tay dạng "MÃ = SỐ" trên tấm tôn/thép.
  • Một dòng CHỈ được coi là dữ liệu (đưa vào items) KHI VÀ CHỈ KHI: có dấu "=", VÀ phần bên phải dấu "=" là MỘT SỐ NGUYÊN THUẦN (không chữ cái, không dấu chấm thập phân).
      Hợp lệ: "SS576=1", "SS1-1=3"  → code="SS576" qty=1 ; code="SS1-1" qty=3.
  • Dòng KHÔNG thỏa (vế phải có chữ/dấu chấm như "CT=VIOLA.200"; hoặc không có "=" như "U-250X90", "HM-201", "NN-AH9", "1017") → KHÔNG đưa vào items → cho vào "ignored_lines".
  • Vế trái dấu "=" (đã bỏ khoảng trắng) → "code". Vế phải → "qty".

QUY TẮC ĐỘ TIN CẬY (áp cho CẢ HAI loại):
  • Chữ viết tay dễ đọc nhầm: 4/A, 1/7, 0/6, 8/B, dấu gạch nối bị nhòe.
  • Bất kỳ ký tự nào bạn KHÔNG CHẮC CHẮN (mờ, chồng nét, gạch xóa, số/chữ dễ lẫn) → đặt "confidence":"low" cho item đó. Chắc chắn → "high".
  • TUYỆT ĐỐI không bịa số. Nếu không đọc được thì để confidence "low" và đoán tốt nhất có thể.

CHỈ TRẢ VỀ MỘT KHỐI JSON HỢP LỆ, KHÔNG kèm giải thích, KHÔNG kèm markdown fence. Schema:
{
  "source_type": "printed_table" | "handwritten_list",
  "items": [ { "code": string, "qty": integer, "confidence": "high" | "low" } ],
  "ignored_lines": [ string ],
  "meta_hint": { "lsx": string, "dvgc": string }
}
Nếu không có lsx/dvgc thì để chuỗi rỗng.`;

function safeParse(text) {
  if (!text) return null;
  let t = String(text).trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try { return JSON.parse(t); } catch (_) {}
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (_) {} }
  return null;
}

function normalize(data) {
  const out = {
    source_type: data.source_type === 'handwritten_list' ? 'handwritten_list' : 'printed_table',
    items: [],
    ignored_lines: Array.isArray(data.ignored_lines) ? data.ignored_lines.map(String).slice(0, 200) : [],
    meta_hint: {
      lsx: String((data.meta_hint && data.meta_hint.lsx) || '').trim(),
      dvgc: String((data.meta_hint && data.meta_hint.dvgc) || '').trim()
    }
  };
  const items = Array.isArray(data.items) ? data.items : [];
  for (const it of items) {
    const code = String((it && it.code) != null ? it.code : '').trim();
    const qty = Number.parseInt(it && it.qty, 10);
    if (!code) continue;
    out.items.push({
      code,
      qty: Number.isFinite(qty) ? qty : 0,
      confidence: it && it.confidence === 'low' ? 'low' : 'high'
    });
  }
  return out;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  if (!API_KEY) return res.status(200).json({ ok: false, error: 'Chưa cấu hình GEMINI_API_KEY trên Vercel.' });

  try {
    const body = req.body && typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');
    const image = String(body.image || body.base64 || '').replace(/^data:[^,]*,/, '').trim();
    const media_type = /^image\/(jpeg|png|webp|heic|heif)$/.test(body.media_type) ? body.media_type : 'image/jpeg';
    if (!image) return res.status(400).json({ ok: false, error: 'Thiếu ảnh.' });

    const reqBody = JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{
        role: 'user',
        parts: [
          { inline_data: { mime_type: media_type, data: image } },
          { text: 'Đọc phiếu cắt trong ảnh và trả JSON đúng schema. Chỉ JSON.' }
        ]
      }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json', maxOutputTokens: 8192 }
    });

    // Lỗi "tạm thời/nên đổi model": quá tải, hết quota, model bị khóa/không còn.
    const isRetryable = (status, msg) =>
      status === 429 || status === 500 || status === 503 ||
      /high demand|overloaded|quota|rate.?limit|no longer available|not found|unavailable/i.test(msg || '');

    let lastErr = 'Không gọi được model nào.';
    for (const model of MODELS) {
      const url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
        encodeURIComponent(model) + ':generateContent';
      let r, j;
      try {
        r = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': API_KEY },
          body: reqBody
        });
        j = await r.json().catch(() => null);
      } catch (netErr) {
        lastErr = 'Lỗi mạng: ' + String((netErr && netErr.message) || netErr);
        continue; // thử model kế
      }

      if (!r.ok || !j) {
        const msg = (j && j.error && j.error.message) || ('HTTP ' + r.status);
        lastErr = 'Lỗi gọi Gemini (' + model + '): ' + String(msg).slice(0, 200);
        if (isRetryable(r.status, msg)) continue; // đổi model
        return res.status(200).json({ ok: false, error: lastErr }); // lỗi thật (vd ảnh hỏng) → dừng
      }
      if (j.promptFeedback && j.promptFeedback.blockReason) {
        return res.status(200).json({ ok: false, error: 'Ảnh bị Gemini chặn (' + j.promptFeedback.blockReason + '). Thử ảnh khác.' });
      }

      const cand = (j.candidates && j.candidates[0]) || null;
      const text = cand && cand.content && Array.isArray(cand.content.parts)
        ? cand.content.parts.map(p => p.text || '').join('\n') : '';
      const parsed = safeParse(text);
      if (!parsed) { lastErr = 'Model ' + model + ' trả JSON không hợp lệ.'; continue; }

      return res.status(200).json({ ok: true, model, ...normalize(parsed) });
    }

    return res.status(200).json({ ok: false, error: lastErr + ' Đã thử: ' + MODELS.join(', ') + '.' });
  } catch (e) {
    return res.status(200).json({ ok: false, error: String((e && e.message) || e) });
  }
}
