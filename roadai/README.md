# 🛣️ RoadAI — Điều hướng thông minh cho tài xế Việt

Web app **chạy được ngay** (không cần backend, không cần API key) hiện thực triết lý cốt lõi của ý tưởng RoadAI/DriveVN: **không chỉ chọn đường ngắn nhất, mà chọn đường "nhanh thật" kiểu tài xế** — né camera phạt nguội, CSGT, ngập nước, kẹt xe, đường cấm giờ; cảnh báo bằng **giọng nói tiếng Việt**.

## Chạy thử (local)
Vì có Service Worker + gọi API, hãy chạy qua HTTP server (không mở bằng `file://`):

```bash
cd roadai
npx serve .        # hoặc: python -m http.server 8080
```
Mở http://localhost:3000 (hoặc cổng hiển thị). Cho phép quyền **Vị trí** để dùng GPS.

## Deploy (Vercel — như các app khác của bạn)
```bash
cd roadai
vercel            # deploy tĩnh, không cần cấu hình build
```

## 🇻🇳 Nguồn bản đồ: VietMap (khuyến nghị) hoặc OpenStreetMap
App có **lớp provider**: bấm ⚙️ (góc phải thanh tìm kiếm) → dán **VietMap API key** → tự chuyển toàn bộ sang VietMap; bỏ trống thì chạy OpenStreetMap (không cần key). Key lưu ở `localStorage`.

| Thành phần | Khi có key VietMap | Mặc định (không key) |
|---|---|---|
| Tile bản đồ | `maps.vietmap.vn/tm/{z}/{x}/{y}.png` | CARTO dark (OSM) |
| Tìm kiếm | Autocomplete v4 + Place v4 (địa chỉ VN chuẩn) | Nominatim |
| Định tuyến | Route v1.1 — **có `vehicle=motorcycle`** (xe máy thật!) | OSRM (`driving`) |

> Vì sao nên dùng VietMap: dữ liệu hẻm/đường mới/tên tiếng Việt tốt hơn OSM, và **routing riêng cho xe máy** — đúng lõi "đường tắt kiểu tài xế VN". Nếu VietMap lỗi (CORS/hết quota/tile hỏng), app **tự fallback** về OSM để không bao giờ chết.

### 2 cách bật VietMap
1. **Key phía client** (nhanh, để thử/local): bấm ⚙️ → dán key (lấy miễn phí ở maps.vietmap.vn). Key nằm ở trình duyệt.
2. **Proxy máy chủ (khuyến nghị production — giấu key)**: đặt biến môi trường trên Vercel rồi deploy:
   ```bash
   vercel env add VIETMAP_KEY     # dán key của bạn
   vercel --prod
   ```
   App tự gọi `/api/vietmap?path=...` (hàm [api/vietmap.js](api/vietmap.js) chèn key ở server). Lúc mở app sẽ dò `/api/vietmap?path=__status`; nếu server có key → **tự bật VietMap, không cần nhập gì**. Không có key → dùng OSM. Không bao giờ lộ key ra client.

## Tính năng đã có (dùng được ngay)
- 🗺️ Bản đồ VietMap 🇻🇳 hoặc OpenStreetMap (Leaflet) — chuyển trong ⚙️.
- 🔎 Tìm địa điểm tiếng Việt (Nominatim), 📍 GPS thật, đảo chiều đi/đến.
- 🏍️🚗📦🚕 Chọn loại xe — trọng số tính đường **khác nhau theo phương tiện**.
- 🧠 **Driver AI Scoring**: lấy nhiều tuyến từ OSRM rồi chấm điểm
  `cost = thời gian + quãng đường×w + phạt(camera, CSGT, ngập, kẹt, cấm) − thưởng đường tắt`.
  Chọn tuyến điểm tốt nhất, so sánh **"kiểu Google (nhanh nhất) vs RoadAI (né rủi ro)"**.
- 📷👮🚫🌊🚦 Lớp camera / CSGT / biển cấm / ngập / kẹt — bật tắt từng lớp.
- ➕ **Báo cáo cộng đồng**: thêm điểm tại vị trí GPS (hoặc chạm bản đồ), lưu `localStorage`;
  👍 xác nhận → **AI xác minh khi đủ 5 lượt**.
- 🔊 **Cảnh báo giọng nói khi dẫn đường**: "Còn 200 mét có camera tốc độ 60 km/h", rẽ trái/phải…
- 🧭 HUD dẫn đường: mũi tên, hướng dẫn kế tiếp, ETA & quãng đường còn lại.
- 👑 **Premium**: bảng giá **39k/tháng · 69k/quý · 99k/năm** + dùng thử 30 ngày (mở khoá AI đường tắt, Dashboard, offline…). Bản demo kích hoạt cục bộ; production nối App Store / Google Play.
- 📊 **Dashboard**: lịch sử chuyến, tổng km, tổng thời gian lái (lưu `localStorage`).
- 📲 **PWA**: cài như app, mở lại nhanh, vỏ app chạy offline.

## 🍺 Driver Radar — Bạn Uống Tôi Lái (mới)
Mở bằng nút **🍺** trên thanh tìm kiếm, hoặc vào thẳng **`/kiem-cuoc`**. Radar AI cho **tài xế lái hộ (Bạn Uống Tôi Lái)** khắp **TP.HCM**: mở lên là biết **TỐI NAY ĐỨNG ĐÂU** — không phải đi tìm. Đưa bạn tới **phố nhậu / bar / karaoke sắp có khách say cần về**, đúng **GIỜ VÀNG tan quán**, tính **lãi/giờ đã trừ chi phí quay về**, và **Google Maps dẫn đường** tận nơi.

**Toạ độ điểm lấy từ OpenStreetMap thật.** Phủ toàn HCM (Q1 Bùi Viện, Q4 Vĩnh Khánh, Bình Thạnh Phạm Văn Đồng/D2, Phú Nhuận Phan Xích Long, Q3, Q7 PMH, Q10, Thủ Đức Thảo Điền…) với **lõi dày ở Khu Tên Lửa — Bình Tân** (sân của tài xế: Đường Tên Lửa, Aeon, Kinh Dương Vương, Bến xe Miền Tây, An Lạc…).

- 🅿️ **ĐIỂM CHỜ TỐI ƯU** (khác biệt lớn nhất): thay vì chỉ báo 1 quán, AI tính **vị trí đứng giữa một CỤM quán** (bán kính đi bộ ~750m) để tiếp cận nhiều cơ hội nhất, đỡ chạy vòng — kèm nút **🧭 Đứng ở đây** mở Google Maps.
- 🧭 **Google Maps dẫn đường** thật cho ⭐ điểm tốt nhất và từng quán (không cần API key).
- 🎯 **Hiệu quả THẬT của bạn**: Dashboard tổng hợp **Top quận & Top khung giờ** bạn “mát tay” nhất từ nhật ký cuốc đã ghi.

Điểm khác biệt so với xe ôm/taxi (đã mô hình hoá đúng):
- Cầu = **khách say cần lái hộ**, tập trung ở phố nhậu/beer club/bar/karaoke, và **trễ hơn giờ nhậu ~2–3 tiếng** → đỉnh vào **22:30–01:00** (đứng đúng chỗ lúc 20:00 ≠ lúc 23:30).
- Chi phí lớn nhất là **QUAY VỀ**: chở khách về nhà (có thể xa) rồi phải quay lại vùng nhậu — app trừ thẳng vào lãi.
- Bối cảnh đêm: **cuối tuần / ngày lương / cận Tết / đêm có bóng đá** → cầu tăng vọt (chỉnh ở ⚙️).

Chạy 100% ở trình duyệt bằng **bộ mô phỏng thời gian thực** (không backend, không key) để dùng ngay:
- 🗺️ **Live heatmap** các điểm nhậu **Khu Tên Lửa — Bình Tân** & lân cận (Đường Tên Lửa, Aeon Bình Tân, Kinh Dương Vương, Vành Đai Trong, Bến xe Miền Tây, An Lạc, Tỉnh Lộ 10, Lê Văn Quới…), phân tầng 🟢🟡🟠🔴, **🔥 AI gợi ý** + **⭐ điểm đứng chờ tốt nhất cho bạn**.
- 🧠 **Chấm điểm tổng hợp**: cầu khách say (λ 15′), ETA thực, mật độ tài xế lái hộ, ít cạnh tranh, sắp tan quán, **lãi/giờ** (đã trừ chi phí tới điểm + quay về), **độ tin cậy ±%** suy từ phương sai thật.
- 🍺 **Chỉ báo GIỜ VÀNG** khi khách bắt đầu tan quán; **⚠️ khuyên nghỉ** khi ngoài giờ vàng cầu quá thấp (không đẩy bạn chạy rỗng vô ích).
- 🔀 **Smart Repositioning**: “Di chuyển 650m tới Vĩnh Khánh — khả năng có khách cao hơn, tới nơi ~2 phút, ít cạnh tranh.”
- 📈 **Học liên tục**: đối chiếu *dự báo vs thực tế* → logistic SGD + **tự dịch trọng số** (hiệp phương sai thật, tự thích nghi). Đo bằng **Brier Skill Score** (thắng dự báo “tỉ lệ nền”), không phải con số “accuracy” ảo. Bấm **⏩ Tua nhanh** để xem tăng.
- 👤 **Digital Twin** (lưu `localStorage`): nhớ nhóm quán & khung giờ bạn hiệu quả nhất. **🎖️ Driver Score** để phân tích, không phải tiêu chí phân công.
- 📊 **Trung tâm điều phối**: thu nhập đêm nay, dự báo khách 15/30/60′, Top điểm đứng chờ, cung/cầu, kỹ năng dự báo.
- 🕛 **Đếm ngược giờ tan quán**: mỗi điểm có giờ đóng cửa riêng; cầu lái hộ **spike quanh giờ tan** (khách ra về cùng lúc) → AI báo “**còn 20′ nữa quán X tan → tới ngay**”.
- 📝 **Ghi cuốc thật** (nút *Ghi cuốc*): sau khi đứng chờ, bấm **Có khách / Chưa có** + tiền cuốc → **Digital Twin học GU THẬT của bạn** (không phải mô phỏng), lưu `localStorage`. Đây là cầu nối lên dữ liệu thật.
- 🔗 **Chuỗi cuốc**: sau khi trả khách ở xa, AI tự đưa bạn tới chỗ trả khách rồi **gợi ý điểm nhậu gần đó để bắt tiếp**, khỏi chạy rỗng quay về.
- 🧭 Nút **🧭 Google Maps** mở dẫn đường thật tới ⭐ điểm / điểm chờ tối ưu.

> **Nâng cấp Google (khi có API key):** để có **nền Google Maps**, **giờ mở/đóng cửa – ảnh – rating – số điện thoại thật** và **tự cập nhật quán mới**, cần bật **Google Maps JavaScript API + Places API** (có tính phí, nên proxy key qua `/api/`). Kiến trúc hiện tại tách sẵn lớp dữ liệu để cắm vào: dẫn đường đã dùng Google Maps, phần POI/ảnh/rating là phần chờ key. Chưa có key thì app vẫn chạy đầy đủ bằng OpenStreetMap + dữ liệu điểm thật + nhật ký của bạn.

### Cách dùng thực tế mỗi đêm
1. Tối mở app (mở ban ngày sẽ *xem trước 22:00*), bật **Nhận khách**, cho phép **GPS**.
2. Nhìn **⭐ điểm đứng chờ tốt nhất** + lý do (gần / ít cạnh tranh / **sắp tan quán** / khách về xa → cuốc to). Bấm **🧭 Chỉ đường** để tới.
3. Tới nơi → thẻ chuyển sang **ghi kết quả**: **✅ Có khách** (nhập tiền) hoặc **❌ Chưa có**. AI học ngay.
4. Có khách & trả ở xa → làm theo **🔗 Chuỗi cuốc** để bắt cuốc kế bên, đỡ chạy rỗng.
5. Vài đêm sau, **Digital Twin** thuộc gu bạn → gợi ý ngày càng đúng khu & giờ bạn “mát tay”.

> Số liệu hiện là **mô hình tiên nghiệm (SIM)** theo quy luật nghề lái hộ. **Hướng dữ liệu thật**: (1) điểm quán từ nguồn POI bản đồ (amenity=bar/pub/nhà hàng), (2) **nhật ký cuốc do tài xế ghi** (crowdsource) + lịch sử của chính bạn (Digital Twin), (3) tín hiệu bối cảnh (lịch bóng đá, ngày lương, lễ/Tết, thời tiết). Giữ nguyên lõi chấm điểm/kinh tế/học trong `js/positioning.js`.

> ⚖️ **An toàn & pháp lý:** dịch vụ giúp người đã uống rượu bia **KHÔNG tự lái xe** — đúng tinh thần Nghị định 100. App không khuyến khích uống rượu bia.

## Kiến trúc file
```
roadai/
├── index.html                # UI chỉ đường + nạp Leaflet (có nút 🍺 mở AI Lái Hộ)
├── kiem-cuoc.html            # 🍺 AI Lái Hộ — màn định vị điểm đứng chờ khách say
├── css/style.css             # giao diện tối, kính mờ, mobile-first
├── css/positioning.css       # style riêng cho module lái hộ (kế thừa tokens)
├── js/data.js                # dữ liệu mẫu camera/CSGT/ngập… (HCM, HN, ĐN)
├── js/app.js                 # map, geocode, GPS, routing OSRM, scoring, voice, reports
├── js/positioning.js         # engine lái hộ: cầu khách say, cung, lãi/giờ, quay về, học liên tục, Digital Twin
├── manifest.webmanifest, sw.js, icon.svg
└── vercel.json
```

## Giới hạn của bản demo (và hướng nâng lên production)
| Bản demo hiện tại | Production (theo spec 6 sprint) |
|---|---|
| VietMap API (key client) hoặc OSRM public demo | Proxy VietMap key qua backend, hoặc tự host **GraphHopper/Valhalla** + PostGIS |
| Dữ liệu camera/CSGT là seed + cộng đồng (localStorage) | Backend NestJS/Go + Postgres/Redis, đồng bộ nguồn hợp pháp |
| Chấm điểm bằng heuristic trọng số | AI Engine (Claude/Gemini) học lịch sử di chuyển, xác minh báo cáo |
| Giọng nói Web Speech API | Voice Engine + offline TTS trong app Flutter |
| Web PWA | App **Flutter** iOS/Android, đăng nhập, Premium, dashboard |

> Toàn bộ logic scoring/analyze/proximity trong `js/app.js` là nền để port thẳng sang backend/AI engine ở các sprint sau — giá trị cạnh tranh (đường tắt + né rủi ro theo phương tiện) đã chạy được để demo và thu người dùng đầu tiên.

## Lưu ý pháp lý & an toàn
Dữ liệu camera/CSGT chỉ mang tính hỗ trợ, khuyến khích lái xe **đúng luật, đúng tốc độ**.
Không thao tác điện thoại khi đang lái — dùng chế độ giọng nói và gắn giá đỡ.
