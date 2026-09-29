'use strict';
// A name as the shelf compares it: "Three Dollar Bill, Yall$" and "THREE DOLLAR BILL Y'ALL$" are the same album.
const sameName = (s) => { const low = String(s || '').toLowerCase(); return low.replace(/[^\p{L}\p{N}]+/gu, '') || low.trim(); };
module.exports = { sameName };
