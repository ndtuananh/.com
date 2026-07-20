// ============================================================================
// api/subscribe.js — đăng ký thiết bị nhận Web Push.
//   GET  → trả VAPID public key để client tạo subscription.
//   POST → lưu subscription vào Vercel Blob (subs/<hash>.json) để cron đẩy push.
//   DELETE → huỷ đăng ký (khi tắt thông báo).
// ============================================================================
import { put, del, list } from '@vercel/blob';
import webpush from 'web-push';
import crypto from 'crypto';

const hashOf = (endpoint) => crypto.createHash('sha1').update(String(endpoint)).digest('hex');

export default async function handler(req, res) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;

  if (req.method === 'GET') {
    res.status(200).json({ publicKey: process.env.VAPID_PUBLIC || '' });
    return;
  }

  if (!token) { res.status(500).json({ error: 'Blob store chưa cấu hình' }); return; }

  try {
    // body có thể là object (đã parse) hoặc string
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    const sub = body && (body.subscription || body);
    if (!sub || !sub.endpoint) { res.status(400).json({ error: 'Thiếu subscription.endpoint' }); return; }
    const name = `subs/${hashOf(sub.endpoint)}.json`;

    if (req.method === 'DELETE') {
      const l = await list({ token, prefix: name });
      for (const b of l.blobs) await del(b.url, { token });
      res.status(200).json({ ok: true, removed: true });
      return;
    }

    // POST — lưu/ghi đè subscription
    await put(name, JSON.stringify({ sub, ua: req.headers['user-agent'] || '', at: new Date().toISOString() }), {
      access: 'public', token, addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json',
    });

    // Gửi ngay 1 push chào mừng để anh thấy thông báo hiện trên điện thoại → xác nhận đã hoạt động.
    let welcomed = false;
    const pub = process.env.VAPID_PUBLIC, priv = process.env.VAPID_PRIVATE;
    if (pub && priv) {
      try {
        webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@lotto-lab', pub, priv);
        await webpush.sendNotification(sub, JSON.stringify({
          title: '✅ Đã bật báo trúng!', tag: 'lotto-welcome',
          body: 'Khi bộ số gợi ý trúng giải, điện thoại sẽ tự thông báo — kể cả khi đóng app.',
        }));
        welcomed = true;
      } catch { /* endpoint có thể trễ lần đầu, không sao */ }
    }
    res.status(200).json({ ok: true, welcomed });
  } catch (e) {
    res.status(500).json({ error: 'subscribe failed', detail: String(e.message || e) });
  }
}
