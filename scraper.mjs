// Scrapes shopee.vn/m/ma-giam-gia with a real headless browser (the page is a JS SPA,
// plain HTTP fetch returns an empty shell). Always writes debug.png so a failed/blocked
// run is diagnosable without needing a manual screenshot.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync } from 'fs';

// Local-only convenience: load .env (gitignored) so SHOPEE_COOKIES can be tested
// without ever pasting the cookie into a commit or into chat. GitHub Actions ignores
// this file and uses the SHOPEE_COOKIES repo secret instead.
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf-8').split('\n')) {
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key && !(key in process.env)) process.env[key] = value;
  }
}

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
  const percentMatch = text.match(/Giảm\s*(\d+)\s*%/i);
  const flatMatch = !percentMatch && text.match(/Giảm\s*([\d.,]+\s*k?\s*₫)/i);
  if (!percentMatch && !flatMatch) return null;

  const capMatch = text.match(/tối đa\s*([\d.,]+\s*k?\s*₫)/i);
  const minOrderMatch = text.match(/Đơn\s*Tối Thiểu\s*([\d.,]+\s*k?\s*₫)/i);
  const usageMatch = text.match(/Đã dùng\s*(\d+)\s*%/i);
  const isExpired = /Hết lượt/i.test(text);
  const prefixMatch = text.match(/^([A-ZÀ-Ỹ ]{2,24}?)Giảm/);
  const rule = classify(text);

  const discountLabel = percentMatch
    ? `Giảm ${percentMatch[1]}%${capMatch ? ` (Tối đa ${capMatch[1].replace(/\s+/g, '')})` : ''}`
    : `Giảm ${flatMatch[1].replace(/\s+/g, '')}`;
  const label = (prefixMatch && prefixMatch[1].trim()) || rule.label;

  return {
    type: rule.type,
    label,
    badge: rule.badge,
    title: discountLabel,
    discount: discountLabel,
    minOrder: minOrderMatch ? `Đơn tối thiểu ${minOrderMatch[1].replace(/\s+/g, '')}` : 'Xem chi tiết trên Shopee',
    condition: usageMatch ? `Đã dùng ${usageMatch[1]}%` : 'Xem điều kiện trên Shopee',
    validity: 'Xem HSD trên Shopee',
    status: isExpired ? 'expired' : 'active',
    hot: usageMatch ? Number(usageMatch[1]) >= 90 : false,
    tag: label,
    link: URL,
  };
}

// Shopee only shows vouchers to a logged-in session. SHOPEE_COOKIES holds the raw
// "Cookie:" request-header string copied from a logged-in browser (DevTools > Network
// > any shopee.vn request > Request Headers > Cookie). Passed in via GitHub Secrets —
// never hardcode it here or commit it.
function parseCookieHeader(raw) {
  if (!raw) return [];
  return raw.split(';').map(pair => {
    const idx = pair.indexOf('=');
    if (idx === -1) return null;
    const name = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (!name) return null;
    return { name, value, url: 'https://shopee.vn' };
  }).filter(Boolean);
}

async function scrape() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: 'vi-VN',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 2400 },
  });

  const cookies = parseCookieHeader(process.env.SHOPEE_COOKIES);
  if (cookies.length > 0) {
    await context.addCookies(cookies);
    console.log(`Loaded ${cookies.length} cookies from SHOPEE_COOKIES`);
  } else {
    console.log('No SHOPEE_COOKIES set — page will likely show the login wall');
  }

  const page = await context.newPage();

  let vouchers = [];
  let failureReason = null;
  try {
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(4000);

    const bodyText = await page.locator('body').innerText().catch(() => '');
    if (/chưa đăng nhập|Đăng nhập để tiếp tục/i.test(bodyText)) {
      failureReason = 'Cookie hết hạn hoặc thiếu — trang yêu cầu đăng nhập lại (SHOPEE_COOKIES cần cập nhật).';
    } else {
      // Voucher sections are lazy-mounted (and some virtualized/unmounted once off-
      // screen), so we extract at every scroll step instead of once at the end —
      // otherwise scrolling back up drops whatever was already rendered below.
      const extractCardTexts = () => page.evaluate(() => {
        const seeds = Array.from(document.querySelectorAll('body *')).filter(
          el => el.children.length === 0 && /giảm/i.test(el.textContent)
        );
        const results = new Set();
        for (const seed of seeds) {
          let node = seed;
          let best = null;
          for (let depth = 0; depth < 8 && node; depth++) {
            const text = node.textContent.trim();
            const looksComplete = /giảm/i.test(text) && /(điều kiện|lưu)/i.test(text);
            if (looksComplete && text.length > 20 && text.length < 300) {
              best = text;
              break; // smallest ancestor that already contains a full single card
            }
            node = node.parentElement;
          }
          if (best) results.add(best.replace(/\s+/g, ' ').trim());
        }
        return Array.from(results);
      });

      const allCardTexts = new Set();
      const collect = async () => {
        for (const t of await extractCardTexts()) allCardTexts.add(t);
      };

      await collect();
      let lastHeight = 0;
      for (let i = 0; i < 25; i++) {
        const height = await page.evaluate(() => document.body.scrollHeight);
        if (height === lastHeight) break;
        lastHeight = height;
        await page.evaluate(h => window.scrollTo(0, h), height);
        await page.waitForTimeout(1000);
        await collect();
      }

      const cardTexts = Array.from(allCardTexts);
      console.log(`Candidate card texts: ${cardTexts.length}`);
      if (cardTexts.length > 0) console.log(JSON.stringify(cardTexts.slice(0, 3), null, 2));

      vouchers = cardTexts.map(parseCard).filter(Boolean);
    }
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
        note: failureReason || `Lần chạy ${now} không tìm thấy voucher (có thể bị chặn/captcha) — giữ nguyên dữ liệu cũ. Xem debug.png trong workflow artifact để kiểm tra.`,
      };

  writeFileSync(OUT, JSON.stringify(output, null, 2) + '\n', 'utf-8');
  console.log(vouchers.length > 0
    ? `✅ Found ${vouchers.length} vouchers, wrote ${OUT}`
    : `⚠️ No vouchers found, kept previous data. Check debug.png.`);
}

scrape();
