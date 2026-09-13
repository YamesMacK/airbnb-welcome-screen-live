'use strict';

/* Merge guest fields into Shield localStorage JSON. Never drop wifi/safety. */
function applyStay(raw, name, checkIn, checkOut) {
  var d = {};
  if (raw) {
    try { d = JSON.parse(raw); } catch (e) { return { error: 'malformed' }; }
  }
  if (!d || typeof d !== 'object') d = {};
  if (!d.guest || typeof d.guest !== 'object') d.guest = {};
  d.guest.name = name;
  d.guest.checkIn = checkIn;
  d.guest.checkOut = checkOut;
  return { next: JSON.stringify(d) };
}

function stayPayloadFromLocation(search, hash) {
  var raw = '';
  if (search) {
    raw = new URLSearchParams(String(search).replace(/^\?/, '')).get('setStay') || '';
  }
  if ((!raw || raw === '1') && hash) {
    var h = String(hash).replace(/^#/, '');
    raw = new URLSearchParams(h).get('setStay') || '';
  }
  if (!raw || raw === '1') return null;
  try { return JSON.parse(raw); } catch (e) {
    try { return JSON.parse(decodeURIComponent(raw)); } catch (e2) { return null; }
  }
}

function applyStayFromQuery(search, rawStorage, hash) {
  var payload = stayPayloadFromLocation(search, hash);
  if (!payload || typeof payload !== 'object') return { applied: false };
  if (payload.clear) {
    var cleared = applyStay(rawStorage, '', '', '');
    if (cleared.error) return { applied: false, error: cleared.error };
    return { applied: true, next: cleared.next };
  }
  var name = String(payload.n || payload.name || '').trim();
  var checkIn = String(payload.in || payload.checkIn || '').trim();
  var checkOut = String(payload.out || payload.checkOut || '').trim();
  if (!(name && checkIn && checkOut)) return { applied: false, error: 'incomplete' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkIn) || !/^\d{4}-\d{2}-\d{2}$/.test(checkOut)) {
    return { applied: false, error: 'dates' };
  }
  if (checkIn > checkOut) return { applied: false, error: 'order' };
  var result = applyStay(rawStorage, name, checkIn, checkOut);
  if (result.error) return { applied: false, error: result.error };
  return { applied: true, next: result.next };
}

if (typeof module !== 'undefined') module.exports = { applyStay, applyStayFromQuery, stayPayloadFromLocation };
