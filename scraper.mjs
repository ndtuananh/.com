// Scrapes shopee.vn/m/ma-giam-gia with a real headless browser (the page is a JS SPA,
// plain HTTP fetch returns an empty shell). Always writes debug.png so a failed/blocked
// run is diagnosable without needing a manual screenshot.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync } from 'fs';

const URL = 'https://shopee.vn/m/ma-giam-gia';
const OUT = 'vouchers.json';

const TYPE_RULES = [
  { type: 'freeship', label: 'Mã Vận Chuyển', badge: '🚚', test: t => /freeship|vận chuyển|ship/i.test(t) },
  { type: 'vip', label: 'Shopee VIP', badge: '⭐', test: t => /vip/i.test(t) },
  { type: 'new', label: 'Shopee', badge: '🎁', test: t => /khách mới|khách hàng mới/i.test(t) },
  { type: 'discount', label: 'Shopee Xử Lý', badge: '⚡', test: () => true },
];

function classify(text) {
  return TYPE_RULES.find(r => r.test(text));
}

function parseCard(text) {
  const discountMatch = text.match(/Giảm(?:\s*(?:tối đa)?)\s*[\d.,]+\s*[%₫đĐ]/i) || text.match(/[\d.,]+%/);
  const minOrderMatch = text.match(/Đơn\s*(?:tối thiểu)?\s*[\d.,]*\s*[₫đĐ]/i);
  const validityMatch = text.match(/HSD[^\n]*|Có hiệu lực[^\n]*|hết hạn[^\n]*/i);
  if (!discountMatch) return null;
  const rule = classify(text);
  return {
    type: rule.type,
    label: rule.label,
    badge: rule.badge,
    title: discountMatch[0].trim(),
    discount: discountMatch[0].trim(),
    minOrder: (minOrderMatch && minOrderMatch[0].trim()) || 'Xem chi tiết trên Shopee',
    condition: 'Xem điều kiện trên Shopee',
    validity: (validityMatch && validityMatch[0].trim()) || 'Xem HSD trên Shopee',
    status: 'active',
    hot: false,
    tag: rule.type === 'new' ? 'Khách hàng mới' : rule.label,
    link: URL,
  };
}

async function scrape() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: 'vi-VN',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 2400 },
  });
  const page = await context.newPage();

  let vouchers = [];
  try {
    await page.goto(URL, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForTimeout(3000);

    const candidateSelectors = [
      '[class*="voucher" i]',
      '[class*="Voucher" i]',
      '[data-testid*="voucher" i]',
    ];

    let cardTexts = [];
    for (const sel of candidateSelectors) {
      const els = await page.locator(sel).all();
      for (const el of els) {
        const t = (await el.innerText().catch(() => '')).trim();
        if (t && /Giảm|%/.test(t) && t.length < 600) cardTexts.push(t);
      }
      if (cardTexts.length) break;
    }

    cardTexts = [...new Set(cardTexts)];
    vouchers = cardTexts.map(parseCard).filter(Boolean);
  } catch (err) {
    console.error('Scrape error:', err.message);
  } finally {
    await page.screenshot({ path: 'debug.png', fullPage: true }).catch(() => {});
    await browser.close();
  }

  const now = new Date().toISOString();
  const previous = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf-8')) : { vouchers: [] };

  const output = vouchers.length > 0
    ? {
        lastUpdated: now,
        lastChecked: now,
        source: URL,
        note: `Lấy tự động bằng trình duyệt headless lúc ${now}.`,
        vouchers: vouchers.map((v, i) => ({ id: i + 1, ...v, color: '#ee4d2d' })),
      }
    : {
        ...previous,
        lastChecked: now,
        note: `Lần chạy ${now} không tìm thấy voucher (có thể bị chặn/captcha) — giữ nguyên dữ liệu cũ. Xem debug.png trong workflow artifact để kiểm tra.`,
      };

  writeFileSync(OUT, JSON.stringify(output, null, 2) + '\n', 'utf-8');
  console.log(vouchers.length > 0
    ? `✅ Found ${vouchers.length} vouchers, wrote ${OUT}`
    : `⚠️ No vouchers found, kept previous data. Check debug.png.`);
}

scrape();
