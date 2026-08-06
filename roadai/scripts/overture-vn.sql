/* RoadAI · Driver Radar — RÚT QUÁN CẢ NƯỚC TỪ OVERTURE MAPS.
   ─────────────────────────────────────────────────────────────────────────────
   VÌ SAO CẦN (anh Long 06/08/2026): "đi địa điểm mới không nạp dữ liệu quán vào
   được nữa". Bản cũ chỉ có quán TP.HCM, mà OpenStreetMap thì ở tỉnh gần như
   trống trơn — thử Overpass quanh Biên Hoà bán kính 4km: 0 quán, mà chờ mất 69
   giây. Muốn tài xế chạy tới đâu cũng có quán để canh thì phải có sẵn dữ liệu
   cả nước, không thể hỏi trực tiếp lúc đang chạy.

   Overture Maps: dữ liệu mở, giấy phép CDLA-Permissive 2.0 → ĐƯỢC PHÉP hiển thị
   và phát hành lại (khác Google Places). Cả Việt Nam có 2,19 triệu địa điểm,
   trong đó ~57.500 quán thuộc nhóm khách hay say.

   TỈA BỚT NGAY TRONG SQL: mỗi ô lưới 0,01° (~1,1km) chỉ giữ 8 quán mạnh nhất.
   Tài xế đứng một chỗ chỉ cần biết ~40 chỗ quanh mình trong 4km — giữ hết 57.500
   quán chỉ làm file nặng chứ không giúp thêm được gì.

   CÁCH CHẠY (cần DuckDB CLI, không cần key):
     duckdb -c ".read scripts/overture-vn.sql"     → sinh overture-vn.json
     node scripts/tron-vn.mjs overture-vn.json     → sinh api/_quanvn.js
   Bản phát hành Overture ra hằng tháng: đổi ngày ở dòng read_parquet rồi chạy lại.
   ───────────────────────────────────────────────────────────────────────────── */
LOAD httpfs; SET s3_region='us-west-2';

CREATE OR REPLACE TABLE raw AS
SELECT names.primary                          AS ten,
       categories.primary                     AS nhom,
       round(bbox.ymin, 5)                    AS lat,
       round(bbox.xmin, 5)                    AS lng,
       coalesce(addresses[1].freeform, '')    AS diachi,
       coalesce(addresses[1].locality, '')    AS xa,
       coalesce(addresses[1].region, '')      AS tinh,
       round(confidence, 3)                   AS tincay
FROM read_parquet('s3://overturemaps-us-west-2/release/2026-07-22.0/theme=places/type=place/*.parquet')
WHERE bbox.xmin BETWEEN 102.0 AND 110.0        -- toàn lãnh thổ đất liền Việt Nam
  AND bbox.ymin BETWEEN 8.0 AND 23.6
  AND names.primary IS NOT NULL;

CREATE OR REPLACE TABLE loc AS
SELECT *,
  CASE
    WHEN nhom IN ('night_club','beer_bar','beer_garden','brewery','brewpub')       THEN 'beerclub'
    WHEN nhom IN ('bar','pub','cocktail_bar','wine_bar','sports_bar')              THEN 'bar'
    WHEN nhom = 'karaoke'                                                          THEN 'karaoke'
    WHEN nhom IN ('seafood_restaurant','barbecue_restaurant','hot_pot_restaurant') THEN 'phonhau'
    WHEN regexp_matches(lower(ten), '(^|[ .,-])(nhậu|bia|beer|ốc|nướng|lẩu|hải sản|beerclub)([ .,-]|$)') THEN 'phonhau'
    WHEN regexp_matches(lower(ten), '(^|[ .,-])(karaoke|ktv)([ .,-]|$)')           THEN 'karaoke'
    WHEN regexp_matches(lower(ten), '(^|[ .,-])(pub)([ .,-]|$)')                   THEN 'bar'
    ELSE 'nhahang'
  END AS cat
FROM raw
WHERE tincay >= 0.45
  AND length(ten) BETWEEN 3 AND 46                       -- tên dài bất thường = Overture dính 2-3 quán vào nhau
  AND length(ten) - length(replace(ten, ' - ', '')) <= 3  -- (mỗi ' - ' bớt đúng 3 ký tự) → tối đa 1 dấu
  AND length(trim(diachi)) >= 5                          -- không có địa chỉ tử tế thì đừng dẫn tài xế tới
  -- Overture xếp cả công ty bán/cho thuê thiết bị karaoke vào nhóm 'karaoke' → không phải chỗ khách ngồi uống
  AND NOT regexp_matches(lower(ten), '(công ty|cty|tnhh|cổ phần|cho thuê|cung cấp|nội thất|thiết bị|âm thanh|sửa chữa|lắp đặt|showroom|đại lý|vật liệu|xây dựng|vận tải|in ấn|quảng cáo|spa|massage|nhà nghỉ|khách sạn|hotel|motel|homestay|resort)');

COPY (
  SELECT ten, cat, lat, lng, diachi, xa, tinh, tincay FROM (
    SELECT *, row_number() OVER (
        PARTITION BY round(lat / 0.01), round(lng / 0.01)          -- ô lưới ~1,1 km
        ORDER BY CASE cat WHEN 'phonhau' THEN 3 WHEN 'beerclub' THEN 3 WHEN 'bar' THEN 2.4 ELSE 2.2 END * tincay DESC,
                 ten
      ) AS hang
    FROM loc
    WHERE cat <> 'nhahang'                                          -- nhà hàng thường: khách ít gọi lái hộ
      AND NOT (cat = 'phonhau' AND regexp_matches(lower(ten), 'cà phê|cafe|coffee|trà sữa|bánh|cơm tấm|phở|bún|xôi|chay'))
  ) WHERE hang <= 8
  ORDER BY lat, lng, ten
) TO 'overture-vn.json' (FORMAT JSON, ARRAY true);

SELECT cat, count(*) AS so FROM loc WHERE cat <> 'nhahang' GROUP BY cat ORDER BY so DESC;
