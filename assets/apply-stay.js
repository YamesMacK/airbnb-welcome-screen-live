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

var TV_WAKE_KEY = 'ssh-tv-wake-v1';
var WAKE_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
var STAY_DATE = /^\d{4}-\d{2}-\d{2}$/;

function checkInWakeTime(label) {
  var s = String(label == null ? '' : label).trim();
  if (WAKE_TIME.test(s)) return s;
  var m = /^(\d{1,2})(?::([0-5]\d))?\s*([ap])\.?m\.?$/i.exec(s);
  if (!m) return '';
  var h = Number(m[1]);
  if (h < 1 || h > 12) return '';
  h = h % 12 + (m[3].toLowerCase() === 'p' ? 12 : 0);
  return (h < 10 ? '0' : '') + h + ':' + (m[2] || '00');
}

// Undefined means the phone page predates auto-on, so the Shield's wake is left as it was.
function wakeFromPayload(payload, checkIn) {
  if (!('wake' in payload)) return undefined;
  var time = String(payload.wake || '');
  if (!checkIn || !WAKE_TIME.test(time)) return { off: true };
  return { date: checkIn, time: time };
}

function wakeMoment(ymd, time) {
  var p = ymd.split('-');
  var t = time.split(':');
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), Number(t[0]), Number(t[1]));
}

// Fully repeats each entry weekly (dayOfWeek 1 = Sunday) and treats a time already past today as
// next week. So the wake is armed only within six calendar days of check-in and removed once that
// moment has passed. A null result means no auto-on choice has reached this device yet.
function tvWakeSchedule(record, now) {
  if (!record || typeof record !== 'object') return null;
  if (record.off || !STAY_DATE.test(record.date || '') || !WAKE_TIME.test(record.time || '')) return '[]';
  var wakeAt = wakeMoment(record.date, record.time);
  if (!(now < wakeAt)) return '[]';
  var day = new Date(wakeAt.getFullYear(), wakeAt.getMonth(), wakeAt.getDate());
  var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (Math.round((day - today) / 86400000) > 6) return '[]';
  return JSON.stringify([{ wakeupTime: record.time, dayOfWeek: day.getDay() + 1 }]);
}

function saveTvWake(storage, wake) {
  if (!wake || typeof wake !== 'object') return false;
  try { storage.setItem(TV_WAKE_KEY, JSON.stringify(wake)); return true; } catch (e) { return false; }
}

// A stay change that carries no auto-on choice (?setup, Clear device data, an older phone page)
// keeps this device's choice: an armed wake follows the new check-in, and no stay means no wake.
// A device that has never received a choice stays unmanaged.
function followStayWake(storage, checkIn) {
  var raw;
  try { raw = storage.getItem(TV_WAKE_KEY); } catch (e) { return false; }
  if (raw == null) return false;
  var record = null;
  try { record = JSON.parse(raw); } catch (e) {}
  var armed = record && typeof record === 'object' && !record.off && WAKE_TIME.test(record.time || '');
  return saveTvWake(storage, armed && STAY_DATE.test(checkIn || '') ? { date: checkIn, time: record.time } : { off: true });
}

function recordStayWake(storage, result) {
  if (!result || !result.applied) return false;
  return result.wake ? saveTvWake(storage, result.wake) : followStayWake(storage, result.checkIn || '');
}

function syncTvWake(fully, storage, now) {
  if (!fully || typeof fully.getStringSetting !== 'function' || typeof fully.setStringSetting !== 'function') {
    return 'unavailable';
  }
  try {
    var raw = storage.getItem(TV_WAKE_KEY);
    if (raw == null) return 'unmanaged';
    var record;
    try { record = JSON.parse(raw); } catch (e) { record = { off: true }; }
    var want = tvWakeSchedule(record, now) || '[]';
    var have = String(fully.getStringSetting('sleepSchedule') || '');
    if (have === want || (want === '[]' && !have)) return 'unchanged';
    fully.setStringSetting('sleepSchedule', want);
    return 'set';
  } catch (e) {
    return 'error';
  }
}

function describeTvWake(checkIn, time, enabled, now) {
  if (!enabled) return { state: 'off', text: 'Auto-on is off. Saving removes any scheduled TV wake.' };
  if (!WAKE_TIME.test(time || '')) return { state: 'incomplete', text: 'Enter the check-in time, or turn auto-on off.' };
  var h = Number(time.slice(0, 2));
  var clock = (h % 12 || 12) + time.slice(2) + (h < 12 ? ' AM' : ' PM');
  if (!STAY_DATE.test(checkIn || '')) {
    return { state: 'pending', text: 'The TV turns on by itself at ' + clock + ' on the check-in day and stays on until the guest turns it off.' };
  }
  var wakeAt = wakeMoment(checkIn, time);
  if (!(now < wakeAt)) {
    return { state: 'passed', text: 'That check-in time has already passed, so the TV will not turn itself on for this stay.' };
  }
  if (tvWakeSchedule({ date: checkIn, time: time }, now) === '[]') {
    return { state: 'later', text: 'Check-in is more than 6 days away. The TV can only set its wake 6 days ahead, so save this stay again within 6 days of check-in.' };
  }
  var label = wakeAt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return { state: 'armed', text: 'The TV will turn on at ' + clock + ' on ' + label + ' and stay on until the guest turns it off.' };
}

function applyStayFromQuery(search, rawStorage, hash) {
  var payload = stayPayloadFromLocation(search, hash);
  if (!payload || typeof payload !== 'object') return { applied: false };
  if (payload.clear) {
    var cleared = applyStay(rawStorage, '', '', '');
    if (cleared.error) return { applied: false, error: cleared.error };
    return { applied: true, next: cleared.next, checkIn: '', wake: wakeFromPayload(payload, '') };
  }
  var name = String(payload.n || payload.name || '').trim();
  var checkIn = String(payload.in || payload.checkIn || '').trim();
  var checkOut = String(payload.out || payload.checkOut || '').trim();
  if (!(name && checkIn && checkOut)) return { applied: false, error: 'incomplete' };
  if (!STAY_DATE.test(checkIn) || !STAY_DATE.test(checkOut)) {
    return { applied: false, error: 'dates' };
  }
  if (checkIn > checkOut) return { applied: false, error: 'order' };
  var result = applyStay(rawStorage, name, checkIn, checkOut);
  if (result.error) return { applied: false, error: result.error };
  return { applied: true, next: result.next, checkIn: checkIn, wake: wakeFromPayload(payload, checkIn) };
}

if (typeof module !== 'undefined') {
  module.exports = {
    applyStay: applyStay,
    applyStayFromQuery: applyStayFromQuery,
    stayPayloadFromLocation: stayPayloadFromLocation,
    encodeStayPayload: encodeStayPayload,
    decodeStayPayload: decodeStayPayload,
    checkInWakeTime: checkInWakeTime,
    tvWakeSchedule: tvWakeSchedule,
    saveTvWake: saveTvWake,
    syncTvWake: syncTvWake,
    describeTvWake: describeTvWake,
    followStayWake: followStayWake,
    recordStayWake: recordStayWake,
    TV_WAKE_KEY: TV_WAKE_KEY
  };
}
