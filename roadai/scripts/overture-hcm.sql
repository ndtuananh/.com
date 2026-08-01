LOAD httpfs; SET s3_region='us-west-2';
CREATE OR REPLACE TABLE raw AS
SELECT names.primary AS ten, categories.primary AS nhom,
       round(bbox.ymin,5) AS lat, round(bbox.xmin,5) AS lng,
       coalesce(addresses[1].freeform,'') AS diachi, round(confidence,3) AS tincay
FROM read_parquet('s3://overturemaps-us-west-2/release/2026-07-22.0/theme=places/type=place/*.parquet')
WHERE bbox.xmin BETWEEN 106.55 AND 106.83 AND bbox.ymin BETWEEN 10.68 AND 10.89 AND names.primary IS NOT NULL;
COPY (
  SELECT DISTINCT ON (lower(ten), lat, lng) ten, nhom, lat, lng, diachi, tincay FROM raw
  WHERE nhom IN ('bar','pub','beer_bar','beer_garden','cocktail_bar','wine_bar','sports_bar','night_club',
                 'karaoke','brewery','brewpub','seafood_restaurant','barbecue_restaurant','hot_pot_restaurant')
     OR (regexp_matches(lower(ten), '(^|[ .,-])(nhậu|bia|beer|ốc|nướng|lẩu|hải sản|pub|karaoke|ktv|beerclub)([ .,-]|$)')
         AND nhom NOT IN ('pharmacy','real_estate','professional_services','barber','hotel','hostel',
                          'grocery_store','convenience_store','beauty_salon','hospital','school'))
  ORDER BY lower(ten), lat, lng, tincay DESC
) TO 'overture-hcm.json' (FORMAT JSON, ARRAY true);
