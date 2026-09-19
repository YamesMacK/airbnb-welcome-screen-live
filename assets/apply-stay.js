'use strict';

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

function encodeStayPayload(obj) {
  var json = JSON.stringify(obj);
  var b64;
  if (typeof btoa === 'function') b64 = btoa(unescape(encodeURIComponent(json)));
  else b64 = Buffer.from(json, 'utf8').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeStayPayload(raw) {
  if (!raw || raw === '1') return null;
  try { return JSON.parse(raw); } catch (e) {}
  try { return JSON.parse(decodeURIComponent(raw)); } catch (e) {}
  var s = String(raw).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  try {
    var json = typeof atob === 'function'
      ? decodeURIComponent(escape(atob(s)))
      : Buffer.from(s, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch (e2) { return null; }
}

function stayPayloadFromLocation(search, hash) {
  function extract(src) {
    if (!src) return '';
    var s = String(src).replace(/^[?#]/, '');
    var fromParams = '';
    try { fromParams = new URLSearchParams(s).get('setStay') || ''; } catch (e) {}
    if (fromParams && fromParams !== '1') return fromParams;
    var idx = s.indexOf('setStay=');
    if (idx === -1) return '';
    var rest = s.slice(idx + 8);
    var amp = rest.indexOf('&');
    if (amp !== -1) rest = rest.slice(0, amp);
    try { return decodeURIComponent(rest); } catch (e2) { return rest; }
  }
  return decodeStayPayload(extract(search) || extract(hash));
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

if (typeof module !== 'undefined') {
  module.exports = {
    applyStay: applyStay,
    applyStayFromQuery: applyStayFromQuery,
    stayPayloadFromLocation: stayPayloadFromLocation,
    encodeStayPayload: encodeStayPayload,
    decodeStayPayload: decodeStayPayload
  };
}
