/* RoadAI — cấu hình thanh toán.
   Điền thông tin ngân hàng để app TỰ TẠO QR VietQR (đúng số tiền + nội dung đối soát),
   hoặc dùng ảnh QR tĩnh của bạn qua qrImage. Sửa xong deploy lại là có hiệu lực. */
window.ROADAI_PAY = {
  // ---- Cách 1 (khuyên dùng): VietQR động ----
  bankId: '',        // mã NH VietQR. Ví dụ: 970422=MB, 970436=Vietcombank, 970407=Techcombank, 970416=ACB, 970418=BIDV, 970432=VPBank, 970423=TPBank
  accountNo: '',     // số tài khoản
  accountName: '',   // tên chủ TK (IN HOA, không dấu)
  bankName: '',      // tên hiển thị, ví dụ 'MB Bank'
  // ---- Cách 2: ảnh QR tĩnh (nếu không dùng VietQR động) ----
  qrImage: '',       // ví dụ 'assets/payment-qr.png'
  // tên shop hiển thị trong hướng dẫn
  contact: 'RoadAI',
};
