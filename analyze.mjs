// Analyzes a single Shopee product URL: navigates with a real browser (same
// SHOPEE_COOKIES session as scraper.mjs) and reads Shopee's own internal PDP API
// response (/api/v4/pdp/get_pc) instead of scraping the DOM — it's the same data
// Shopee's own web app renders from, so prices/vouchers/rating are exact, not guessed.
// Anything we can't get from that API (flash-sale odds, price trend) is reported
// separately under "estimates" and never mixed into the real numbers.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync } from 'fs';

if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf-8').split('\n')) {
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key && !(key in process.env)) process.env[key] = value;
  }
}

const OUT = 'analysis.json';
const HISTORY_OUT = 'price-history.json';

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

// Shopee prices in this API are integers scaled by 100000 (e.g. 189000 VND -> 18900000000).
const money = v => (typeof v === 'number' && v >= 0 ? Math.round(v / 100000) : 0);
const formatVND = n => n.toLocaleString('vi-VN') + '₫';

function parseSoldDisplay(text) {
  if (!text) return null;
  const m = text.match(/([\d.,]+)\s*(k|tr)?/i);
  if (!m) return null;
  let n = parseFloat(m[1].replace(',', '.'));
  if (/k/i.test(m[2] || '')) n *= 1000;
  if (/tr/i.test(m[2] || '')) n *= 1000000;
  return Math.round(n);
}

function isValidShopeeUrl(url) {
  try {
    const u = new URL(url);
    return /(^|\.)shopee\.vn$/.test(u.hostname);
  } catch {
    return false;
  }
}

function loadHistory() {
  if (!existsSync(HISTORY_OUT)) return {};
  try { return JSON.parse(readFileSync(HISTORY_OUT, 'utf-8')); } catch { return {}; }
}

function updateHistory(key, entry) {
  const history = loadHistory();
  const list = history[key] || [];
  list.push(entry);
  history[key] = list.slice(-60); // cap growth, keep most recent 60 runs per product
  writeFileSync(HISTORY_OUT, JSON.stringify(history, null, 2) + '\n', 'utf-8');
  return history[key];
}

function computeDealScore(d) {
  let score = 0;

  const savingComponent = Math.round((Math.min(d.saving_percent, 60) / 60) * 45);
  score += savingComponent;

  let trustComponent = 0;
  if (d.shop.is_official) trustComponent += 10;
  if (d.shop.rating >= 4.7) trustComponent += 6;
  else if (d.shop.rating >= 4.3) trustComponent += 3;
  if (d.shop.response_rate >= 90) trustComponent += 4;
  else if (d.shop.response_rate >= 70) trustComponent += 2;
  score += trustComponent;

  let popularityComponent = 0;
  if (d.rating >= 4.5) popularityComponent += 8;
  else if (d.rating >= 4) popularityComponent += 4;
  if (d.sold_estimate >= 10000) popularityComponent += 7;
  else if (d.sold_estimate >= 1000) popularityComponent += 4;
  else if (d.sold_estimate >= 100) popularityComponent += 2;
  score += popularityComponent;

  let urgencyComponent = 0;
  if (d.hot_voucher) urgencyComponent += 10;
  if (d.gift_detected) urgencyComponent += 5;
  if (d.shipping_free) urgencyComponent += 5;
  score += urgencyComponent;

  return Math.min(100, Math.round(score));
}

function buildReasons(d) {
  const reason = [];
  reason.push(`Giảm ${d.saving_percent}% so với giá gốc (${formatVND(d.original_price)} → ${formatVND(d.final_price)})`);
  if (d.voucher_shop > 0) reason.push(`Đã áp voucher Shop, giảm thêm ${formatVND(d.voucher_shop)}`);
  if (d.voucher_shopee > 0) reason.push(`Đã áp voucher Shopee, giảm thêm ${formatVND(d.voucher_shopee)}`);
  if (d.shipping_free) reason.push('Miễn phí vận chuyển');
  else if (d.shipping_discount > 0) reason.push(`Giảm phí vận chuyển ${formatVND(d.shipping_discount)}`);
  if (d.hot_voucher) reason.push(`Voucher Shop đã dùng ${d.hot_voucher_percent}% lượt — sắp hết`);
  if (d.shop.is_official && d.shop.rating >= 4.5) reason.push(`Shop chính hãng/Mall, đánh giá ${d.shop.rating.toFixed(1)}/5`);
  if (d.rating && d.rating_count > 50) reason.push(`Sản phẩm đánh giá ${d.rating.toFixed(1)}/5 từ ${d.rating_count.toLocaleString('vi-VN')} lượt`);
  if (d.gift_detected) reason.push(`Có chương trình tặng kèm: ${d.gift_note}`);
  if (d.unlock_next_discount != null && d.unlock_next_discount > 0 && d.unlock_next_discount <= 100000) {
    reason.push(`Mua thêm ${formatVND(d.unlock_next_discount)} để mở khoá voucher Shop lớn hơn`);
  }
  return reason;
}

async function analyze(url) {
  if (!isValidShopeeUrl(url)) {
    throw new Error('URL không hợp lệ — cần là link trên shopee.vn (vd: https://shopee.vn/ten-san-pham-i.123.456)');
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: 'vi-VN',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 2400 },
  });
  const cookies = parseCookieHeader(process.env.SHOPEE_COOKIES);
  if (cookies.length > 0) await context.addCookies(cookies);

  const page = await context.newPage();
  let captured = null;
  page.on('response', async (res) => {
    if (res.url().includes('/api/v4/pdp/get_pc') && !captured) {
      try { captured = await res.json(); } catch { /* not JSON, ignore */ }
    }
  });

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(5000);
  } finally {
    await page.screenshot({ path: 'analyze-debug.png', fullPage: false }).catch(() => {});
    await browser.close();
  }

  if (!captured || captured.error || !captured.data) {
    throw new Error(
      'Không lấy được dữ liệu sản phẩm — link có thể sai, sản phẩm đã bị gỡ, hoặc phiên đăng nhập ' +
      '(SHOPEE_COOKIES) đã hết hạn. Xem analyze-debug.png để kiểm tra.'
    );
  }

  const d = captured.data;
  const item = d.item;
  const price = d.product_price;
  const breakdown = (d.price_breakdown && d.price_breakdown.discount_breakdown) || [];
  const review = d.product_review || {};
  const shop = d.shop_detailed || {};
  const shipping = d.product_shipping || {};
  const coinInfo = d.coin_info || {};

  const original_price = money(price?.price_before_discount?.single_value) || money(price?.price?.single_value);
  const sale_price = money(price?.price?.single_value);

  let voucher_shop = 0, voucher_shopee = 0;
  for (const b of breakdown) {
    if (b.shop_voucher) voucher_shop += money(b.discount_amount);
    else if (b.platform_voucher || b.ads_voucher) voucher_shopee += money(b.discount_amount);
  }

  // Per-channel promo discounts (e.g. express/Hỏa Tốc) vary wildly by shipping method
  // and don't represent a general freeship voucher — reporting the max across channels
  // produced nonsense (a "shipping discount" bigger than the item price). We only trust
  // the boolean free-shipping-program flag, not a fabricated VND amount.
  const shipping_free = shipping?.free_shipping?.has_fss === true;
  const shipping_discount = 0;

  const coinValues = (coinInfo.coin_earn_items || []).map(c => c.coin_earn || 0);
  const coins = Math.max(0, ...coinValues, 0);
  const coins_detected = coins > 0 || !!coinInfo.coin_earn_label;

  const giftLabel = (price?.labels || []).find(l => l.promotion_id && /quà|gift|tặng/i.test(l.text || ''));
  const gift_detected = !!giftLabel;
  const gift_note = giftLabel ? giftLabel.text : null;

  const final_price = Math.max(0, sale_price - voucher_shop - voucher_shopee - shipping_discount);
  const saving_money = Math.max(0, original_price - final_price);
  const saving_percent = original_price > 0 ? Math.round((saving_money / original_price) * 100) : 0;

  const rating = review.rating_star ?? item.item_rating?.rating_star ?? null;
  const rating_count = review.total_rating_count ?? null;
  const sold_display = review.historical_sold_display || review.sold_count_display || null;
  const sold_estimate = parseSoldDisplay(sold_display);

  const shopVoucherList = d.shop_vouchers || [];
  const appliedShopCode = breakdown.find(b => b.shop_voucher)?.shop_voucher?.min_spend != null
    ? (d.product_price?.final_price_info?.final_price_vouchers?.shop_voucher?.voucher_code)
    : null;
  const hotEntry = shopVoucherList.find(v => (v.percentage_used ?? 0) >= 90);
  const hot_voucher = !!hotEntry;
  const hot_voucher_percent = hotEntry ? hotEntry.percentage_used : null;

  const nextTier = shopVoucherList
    .filter(v => v.voucher_code !== appliedShopCode)
    .map(v => ({ ...v, min_spend_vnd: money(v.min_spend) }))
    .filter(v => v.min_spend_vnd > sale_price)
    .sort((a, b) => a.min_spend_vnd - b.min_spend_vnd)[0];
  const unlock_next_discount = nextTier ? nextTier.min_spend_vnd - sale_price : null;
  const unlock_next_discount_note = nextTier
    ? `Mua từ ${formatVND(nextTier.min_spend_vnd)} để dùng voucher "${nextTier.voucher_code}"`
    : null;

  const computed = {
    original_price, sale_price, voucher_shop, voucher_shopee,
    shipping_free, shipping_discount, coins, gift_detected, gift_note,
    final_price, saving_money, saving_percent, rating, rating_count, sold_estimate,
    hot_voucher, hot_voucher_percent, unlock_next_discount,
    shop: {
      is_official: !!shop.is_official_shop,
      rating: shop.rating_star ?? 0,
      response_rate: shop.response_rate ?? 0,
    },
  };
  const deal_score = computeDealScore(computed);
  const recommendation = deal_score >= 72 ? 'BUY_NOW' : deal_score >= 45 ? 'WAIT' : 'NOT_GOOD';
  const reason = buildReasons(computed);

  // Real (not simulated) price history: every run appends a data point for this
  // exact item, so trend/lowest-seen become genuine once run a few times — no
  // fabricated 60-day chart on the very first run.
  const historyKey = `${item.shop_id}_${item.item_id}`;
  const history = updateHistory(historyKey, { t: new Date().toISOString(), sale_price, final_price });
  const lowest_price_tracked = Math.min(...history.map(h => h.final_price));
  let price_trend;
  if (history.length < 2) {
    price_trend = 'Chưa đủ dữ liệu lịch sử — chạy lại analyze.mjs vào lần khác để bắt đầu theo dõi xu hướng giá thật.';
  } else {
    const first = history[0].final_price;
    const diff = final_price - first;
    price_trend = diff === 0
      ? `Giá không đổi so với ${history.length} lần theo dõi gần nhất.`
      : `Giá ${diff < 0 ? 'giảm' : 'tăng'} ${Math.abs(Math.round((diff / first) * 100))}% so với lần theo dõi đầu tiên (${history.length} lần đã ghi nhận).`;
  }

  let flash_sale_note;
  if (d.flash_sale) {
    flash_sale_note = 'Đang nằm trong chương trình Flash Sale của Shopee.';
  } else if (saving_percent >= 30) {
    flash_sale_note = 'Ước tính: mức giảm khá sâu, có thể đây đã là giá khuyến mãi — không phát hiện Flash Sale đang chạy.';
  } else {
    flash_sale_note = 'Không phát hiện chương trình Flash Sale đang diễn ra cho sản phẩm này.';
  }

  return {
    product_name: item.title,
    url,
    scraped_at: new Date().toISOString(),
    shop_name: shop.name || null,
    shop: {
      is_official: !!shop.is_official_shop,
      rating: shop.rating_star ?? null,
      response_rate: shop.response_rate ?? null,
      follower_count: shop.follower_count ?? null,
    },
    original_price,
    sale_price,
    shopee_discount_percent: price?.discount ?? null,
    voucher_shop,
    voucher_shopee,
    shipping_discount,
    shipping_free,
    coins,
    coins_detected,
    gift_detected,
    gift_note,
    final_price,
    saving_money,
    saving_percent,
    rating,
    rating_count,
    sold_display,
    sold_estimate,
    unlock_next_discount,
    unlock_next_discount_note,
    deal_score,
    recommendation,
    reason,
    estimates: {
      note: 'Các mục dưới đây là ước tính/suy luận từ dữ liệu hiện có — KHÔNG phải số liệu chính thức từ Shopee.',
      flash_sale: flash_sale_note,
      price_trend,
      price_history_points: history.length,
      lowest_price_tracked,
    },
  };
}

const url = process.argv[2];
if (!url) {
  console.error('Cách dùng: node analyze.mjs "<link sản phẩm Shopee>"');
  process.exit(1);
}

try {
  const result = await analyze(url);
  writeFileSync(OUT, JSON.stringify(result, null, 2) + '\n', 'utf-8');
  console.log(JSON.stringify(result, null, 2));
  console.log(`\n✅ Đã ghi ${OUT} — mở analyze.html để xem dashboard.`);
} catch (err) {
  console.error(`❌ ${err.message}`);
  process.exit(1);
}
