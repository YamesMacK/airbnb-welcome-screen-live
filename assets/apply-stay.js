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

function applyStayFromQuery(search, rawStorage) {
  var q = typeof search === 'string'
    ? new URLSearchParams(search.charAt(0) === '?' ? search.slice(1) : search)
    : search;
  if (!q || !q.has('setStay')) return { applied: false };
  var name = String(q.get('n') || '').trim();
  var checkIn = String(q.get('in') || '').trim();
  var checkOut = String(q.get('out') || '').trim();
  var hasStay = !!(name || checkIn || checkOut);
  if (hasStay && !(name && checkIn && checkOut)) return { applied: false, error: 'incomplete' };
  if (hasStay) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(checkIn) || !/^\d{4}-\d{2}-\d{2}$/.test(checkOut)) {
      return { applied: false, error: 'dates' };
    }
    if (checkIn > checkOut) return { applied: false, error: 'order' };
  }
  var result = applyStay(rawStorage, name, checkIn, checkOut);
  if (result.error) return { applied: false, error: result.error };
  return { applied: true, next: result.next };
}

if (typeof module !== 'undefined') module.exports = { applyStay, applyStayFromQuery };
