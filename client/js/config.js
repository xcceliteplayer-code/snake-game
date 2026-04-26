/* ═══════════════════════════════════════════════════════
   UNO x RYZEN — CONFIG.JS
   Ganti SERVER_URL dengan URL Railway/Render kamu!
   Contoh: 'https://uno-ryzen.up.railway.app'
═══════════════════════════════════════════════════════ */
'use strict';

const UNO_CONFIG = {
  // ← GANTI INI dengan URL server kamu setelah deploy ke Railway/Render
  // Kalau main lokal, biarkan null (auto-detect)
  SERVER_URL: null,

  // Fallback: auto-detect dari window.location
  getServerUrl() {
    if (this.SERVER_URL) return this.SERVER_URL;
    // Kalau buka dari file:// atau localhost → pakai localhost:3000
    const { hostname, protocol } = window.location;
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '') {
      return 'http://localhost:3000';
    }
    // Kalau dari GitHub Pages → harus set SERVER_URL manual di atas
    console.warn('[UNO] SERVER_URL belum diset! Set di js/config.js');
    return 'http://localhost:3000';
  }
};

// Freeze biar ga bisa diubah dari luar
Object.freeze(UNO_CONFIG);
