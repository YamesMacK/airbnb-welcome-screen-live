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

// Fully authenticates and dispatches on the query string. Without type=json its
// response is the Remote Admin settings document. getScreenshot must stay a raw PNG.
function fullyCommandUrl(host, password, cmd, extra) {
  var params = new URLSearchParams();
  params.set('cmd', cmd);
  params.set('password', password == null ? '' : String(password));
  if (cmd !== 'getScreenshot') params.set('type', 'json');
  if (extra) {
    Object.keys(extra).forEach(function(k) {
      if (extra[k] != null && extra[k] !== '') params.set(k, String(extra[k]));
    });
  }
  return String(host || '').replace(/\/$/, '') + '/?' + params.toString();
}

// After a long sleep, Android TV's home screen comes up in front of Fully for up to about 6 s, and
// Fully reloads its start page on screen-on and again when it returns to the front. A picture taken
// in that window is a blank page, and a stay loaded in it is thrown away. So wake, pull Fully
// forward once the home screen has taken its turn, and send nothing else until the window has
// passed. openUrl(cmd, extra, win) reuses the wake pop-up when given one. A blocked pop-up must not
// fall through to the empty picture.
var TV_FOREGROUND_DELAY_MS = 3000;
var TV_PICTURE_DELAY_MS = 9000;
var TV_STAY_DELAY_MS = 8000;
var TV_STAY_PAINT_MS = 4000;
// The ready step is scheduled only after toForeground has been sent. A phone
// that slept through both delays used to run them back to back.
function wakeTv(openUrl, later, now, readyMs, ready) {
  var win = openUrl('screenOn', { t: String(now()) });
  if (!win || win.closed) return false;
  var gap = readyMs - TV_FOREGROUND_DELAY_MS;
  if (!(gap > 0)) gap = TV_FOREGROUND_DELAY_MS;
  later(TV_FOREGROUND_DELAY_MS, function () {
    openUrl('toForeground', { t: String(now()) }, win);
    later(gap, function () { ready(win); });
  });
  return true;
}

function claimTvSequence(sequence) {
  if (!sequence || sequence.busy) return false;
  sequence.busy = true;
  return true;
}

function releaseTvSequence(sequence) {
  if (sequence) sequence.busy = false;
}

function closeQuietly(win) {
  try { if (win && typeof win.close === 'function') win.close(); } catch (e) {}
}

function openTvPicture(openUrl, later, now) {
  return wakeTv(openUrl, later, now, TV_PICTURE_DELAY_MS, function (win) {
    closeQuietly(win);
    openUrl('getScreenshot', { t: String(now()) });
  });
}

function sendStayThenPicture(openUrl, later, now, stayUrl) {
  return wakeTv(openUrl, later, now, TV_STAY_DELAY_MS, function (win) {
    openUrl('loadURL', { url: stayUrl, t: String(now()) }, win);
    later(TV_STAY_PAINT_MS, function () {
      closeQuietly(win);
      openUrl('getScreenshot', { t: String(now()) });
    });
  });
}

var DEVICE_CONFIG_KEY = 'ssh-device-config-v1';

function ymd(now) {
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
}

function copyRecord(config) {
  var next = {};
  if (config && typeof config === 'object') {
    Object.keys(config).forEach(function(k) { next[k] = config[k]; });
  }
  return next;
}

function parseStore(raw) {
  if (!raw) return {};
  try {
    var parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed;
  } catch (e) { return null; }
}

function cleanStayRow(row) {
  if (!row || typeof row !== 'object') return { error: 'incomplete' };
  var name = String(row.n != null ? row.n : (row.name != null ? row.name : '')).trim();
  var checkIn = String(row.in != null ? row.in : (row.checkIn != null ? row.checkIn : '')).trim();
  var checkOut = String(row.out != null ? row.out : (row.checkOut != null ? row.checkOut : '')).trim();
  var wakeSource = ('w' in row) ? row.w : (('wake' in row) ? row.wake : '');
  var wakeText = String(wakeSource == null ? '' : wakeSource).trim();
  var wake = '';
  if (wakeText && wakeText !== 'off') {
    wake = checkInWakeTime(wakeText);
    if (!wake) return { error: 'wake' };
  }
  if (!(name && checkIn && checkOut)) return { error: 'incomplete' };
  if (!STAY_DATE.test(checkIn) || !STAY_DATE.test(checkOut)) return { error: 'dates' };
  if (checkIn > checkOut) return { error: 'order' };
  if (name.length > 100) name = name.slice(0, 100);
  return { name: name, checkIn: checkIn, checkOut: checkOut, wake: wake };
}

function cleanStayList(rows) {
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var row = cleanStayRow(rows[i]);
    if (row.error) return row;
    out.push(row);
  }
  return out;
}

function guestFields(stay) {
  if (!stay || !stay.name) return { name: '', checkIn: '', checkOut: '' };
  return { name: stay.name, checkIn: stay.checkIn, checkOut: stay.checkOut };
}

function sameGuest(a, b) {
  a = a || {};
  b = b || {};
  return String(a.name || '') === String(b.name || '') &&
    String(a.checkIn || '') === String(b.checkIn || '') &&
    String(a.checkOut || '') === String(b.checkOut || '');
}

// A stay that includes today is on screen, and a later check-in wins a shared day.
// A guest already stored for a future arrival stays up until that row is edited or
// its checkout morning removes it. A gap after a finished stay does not promote
// the next arrival early.
function displayedStay(stays, today, previous) {
  var active = [];
  stays.forEach(function(stay) {
    if (stay.checkIn <= today && stay.checkOut >= today) active.push(stay);
  });
  if (active.length) {
    active.sort(function(a, b) {
      if (a.checkIn < b.checkIn) return -1;
      if (a.checkIn > b.checkIn) return 1;
      return 0;
    });
    return active[active.length - 1];
  }
  var previousName = previous && previous.name ? String(previous.name) : '';
  if (!previousName) return null;
  var named = [];
  stays.forEach(function(stay) {
    if (stay.name === previousName && stay.checkOut >= today) named.push(stay);
  });
  if (named.length === 1) return named[0];
  for (var i = 0; i < named.length; i++) {
    if (named[i].checkIn === previous.checkIn && named[i].checkOut === previous.checkOut) return named[i];
  }
  return null;
}

function wakeFromStays(stays, now) {
  var best = null;
  stays.forEach(function(stay) {
    if (!WAKE_TIME.test(stay.wake || '')) return;
    var at = wakeMoment(stay.checkIn, stay.wake);
    if (!(now < at)) return;
    if (!best || at < best.at) best = { at: at, date: stay.checkIn, time: stay.wake };
  });
  return best ? { date: best.date, time: best.time } : { off: true };
}

function sameWake(record, next) {
  if (!next) return true;
  if (next.off) return !!(record && record.off);
  return !!(record && !record.off && record.date === next.date && record.time === next.time);
}

function parseWake(raw) {
  if (raw == null) return undefined;
  try {
    var record = JSON.parse(raw);
    return record && typeof record === 'object' ? record : { off: true };
  } catch (e) { return { off: true }; }
}

function settleStoredStay(raw, wakeRaw, now) {
  var config = parseStore(raw);
  if (config === null) return { writeConfig: false, writeWake: false };
  var clock = now instanceof Date ? now : new Date();
  var today = ymd(clock);
  var wakeRecord = parseWake(wakeRaw);
  if (!Array.isArray(config.stays)) {
    var guest = config.guest && typeof config.guest === 'object' ? config.guest : {};
    var checkOut = String(guest.checkOut || '');
    if (STAY_DATE.test(checkOut) && checkOut < today && (guest.name || guest.checkIn || guest.checkOut)) {
      var cleared = copyRecord(config);
      cleared.guest = { name: '', checkIn: '', checkOut: '' };
      return { writeConfig: true, configNext: JSON.stringify(cleared), writeWake: false, wake: wakeRecord };
    }
    return { writeConfig: false, writeWake: false, wake: wakeRecord };
  }
  var cleaned = cleanStayList(config.stays);
  if (cleaned.error) return { writeConfig: false, writeWake: false, wake: wakeRecord };
  var kept = cleaned.filter(function(stay) { return stay.checkOut >= today; });
  var previous = config.guest && typeof config.guest === 'object' ? config.guest : {};
  var wake = wakeFromStays(kept, clock);
  var guestNext = guestFields(displayedStay(kept, today, previous));
  var writeConfig = JSON.stringify(config.stays) !== JSON.stringify(kept) || !sameGuest(previous, guestNext);
  var writeWake = wakeRaw == null ? !wake.off : !sameWake(wakeRecord, wake);
  var configNext = raw;
  if (writeConfig) {
    var next = copyRecord(config);
    next.guest = guestNext;
    next.stays = kept;
    configNext = JSON.stringify(next);
  }
  return { writeConfig: writeConfig, configNext: configNext, writeWake: writeWake, wake: wake };
}

function shownGuest(raw) {
  var config = parseStore(raw);
  if (!config || !config.guest || typeof config.guest !== 'object') {
    return { name: '', checkIn: '', checkOut: '' };
  }
  return {
    name: String(config.guest.name || ''),
    checkIn: String(config.guest.checkIn || ''),
    checkOut: String(config.guest.checkOut || '')
  };
}

function reconcileDeviceStay(storage, fully, now) {
  var clock = now instanceof Date ? now : new Date();
  var raw = null;
  var wakeRaw = null;
  try { raw = storage.getItem(DEVICE_CONFIG_KEY); } catch (e) {
    return { status: 'error', guestChanged: false, guest: null };
  }
  try { wakeRaw = storage.getItem(TV_WAKE_KEY); } catch (e) {}
  var before = shownGuest(raw);
  var settled = settleStoredStay(raw, wakeRaw, clock);
  if (settled && settled.writeConfig && settled.configNext != null) {
    try { storage.setItem(DEVICE_CONFIG_KEY, settled.configNext); } catch (e) {}
  }
  if (settled && settled.writeWake && settled.wake) saveTvWake(storage, settled.wake);
  var afterRaw = raw;
  try { afterRaw = storage.getItem(DEVICE_CONFIG_KEY); } catch (e) {}
  var guest = shownGuest(afterRaw);
  var status = syncTvWake(fully, storage, clock);
  try { publishStaySummary(fully, storage); } catch (e) {}
  return {
    status: status,
    guestChanged: !sameGuest(before, guest),
    guest: guest
  };
}

function staySummaryRows(config, wakeRaw) {
  if (config && Array.isArray(config.stays)) {
    var cleaned = cleanStayList(config.stays);
    if (!cleaned.error) {
      return cleaned.map(function(stay) {
        return { name: stay.name, checkIn: stay.checkIn, checkOut: stay.checkOut, wake: stay.wake || '' };
      });
    }
  }
  var guest = config && config.guest && typeof config.guest === 'object' ? config.guest : {};
  var name = String(guest.name || '').trim();
  var checkIn = String(guest.checkIn || '').trim();
  var checkOut = String(guest.checkOut || '').trim();
  if (!(name || checkIn || checkOut)) return [];
  var wake = '';
  var record = parseWake(wakeRaw);
  if (record && !record.off && WAKE_TIME.test(record.time || '') && (!record.date || record.date === checkIn)) {
    wake = record.time;
  }
  return [{ name: name, checkIn: checkIn, checkOut: checkOut, wake: wake }];
}

function publishStaySummary(fully, storage) {
  if (!fully || typeof fully.setStringSetting !== 'function') return 'unavailable';
  var raw = null;
  var wakeRaw = null;
  try { raw = storage.getItem(DEVICE_CONFIG_KEY); } catch (e) { return 'error'; }
  try { wakeRaw = storage.getItem(TV_WAKE_KEY); } catch (e) {}
  var want = JSON.stringify(staySummaryRows(parseStore(raw) || {}, wakeRaw));
  try {
    var have = '';
    if (typeof fully.getStringSetting === 'function') {
      try { have = String(fully.getStringSetting('sshStayList') || ''); } catch (e) { have = ''; }
    }
    if (have === want) return 'unchanged';
    fully.setStringSetting('sshStayList', want);
    return 'set';
  } catch (e) {
    return 'error';
  }
}

function deviceRecord(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  var guest = raw.guest && typeof raw.guest === 'object' ? raw.guest : {};
  var wifi = raw.wifi && typeof raw.wifi === 'object' ? raw.wifi : {};
  var safety = raw.safety && typeof raw.safety === 'object' ? raw.safety : {};
  var rec = {
    guest: { name: guest.name, checkIn: guest.checkIn, checkOut: guest.checkOut },
    wifi: { ssid: wifi.ssid, password: wifi.password, encryption: wifi.encryption },
    safety: { address: safety.address, hostName: safety.hostName, hostPhone: safety.hostPhone }
  };
  if (Array.isArray(raw.stays)) rec.stays = raw.stays;
  return rec;
}

function editDisplayedStay(config, nextGuest, now) {
  var clock = now instanceof Date ? now : new Date();
  var guest = {
    name: String(nextGuest && nextGuest.name || '').trim(),
    checkIn: String(nextGuest && nextGuest.checkIn || '').trim(),
    checkOut: String(nextGuest && nextGuest.checkOut || '').trim()
  };
  if (!config || !Array.isArray(config.stays)) return { stays: null, guest: guest, wake: null };
  var cleaned = cleanStayList(config.stays);
  if (cleaned.error) cleaned = [];
  var previous = config.guest && typeof config.guest === 'object' ? config.guest : {};
  var idx = -1;
  for (var i = 0; i < cleaned.length; i++) {
    if (cleaned[i].name === String(previous.name || '') &&
        cleaned[i].checkIn === String(previous.checkIn || '') &&
        cleaned[i].checkOut === String(previous.checkOut || '')) idx = i;
  }
  if (!guest.name) {
    if (idx >= 0) cleaned.splice(idx, 1);
  } else if (idx >= 0) {
    cleaned[idx] = { name: guest.name, checkIn: guest.checkIn, checkOut: guest.checkOut, wake: cleaned[idx].wake || '' };
  } else {
    cleaned.push({ name: guest.name, checkIn: guest.checkIn, checkOut: guest.checkOut, wake: '' });
  }
  var current = displayedStay(cleaned, ymd(clock), guest.name ? guest : previous);
  return { stays: cleaned, guest: guestFields(current), wake: wakeFromStays(cleaned, clock) };
}

function stayListPayload(rows) {
  return {
    stays: (rows || []).map(function(row) {
      return { n: row.name, in: row.checkIn, out: row.checkOut, w: row.wake || '' };
    })
  };
}

function describeStayOverlap(rows) {
  var stays = [];
  (rows || []).forEach(function(row) {
    var checkIn = String(row.checkIn || row.in || '');
    var checkOut = String(row.checkOut || row.out || '');
    if (STAY_DATE.test(checkIn) && STAY_DATE.test(checkOut) && checkIn <= checkOut) {
      stays.push({ checkIn: checkIn, checkOut: checkOut });
    }
  });
  for (var i = 0; i < stays.length; i++) {
    for (var j = i + 1; j < stays.length; j++) {
      if (stays[i].checkIn <= stays[j].checkOut && stays[j].checkIn <= stays[i].checkOut) {
        return 'Two stays share a day. On a shared day the TV shows the stay with the later check-in.';
      }
    }
  }
  return '';
}

function describeRowWake(checkIn, time, now) {
  if (!time) return { state: 'off', text: 'No auto-on. This stay will not turn the TV on by itself.' };
  return describeTvWake(checkIn, time, true, now);
}

function dropStayList(rawNext) {
  var stored = JSON.parse(rawNext);
  if (stored.stays) delete stored.stays;
  return JSON.stringify(stored);
}

function applyStayFromQuery(search, rawStorage, hash, now) {
  var payload = stayPayloadFromLocation(search, hash);
  if (!payload || typeof payload !== 'object') return { applied: false };
  var clock = now instanceof Date ? now : new Date();
  if (payload.clear) {
    var cleared = applyStay(rawStorage, '', '', '');
    if (cleared.error) return { applied: false, error: cleared.error };
    return { applied: true, next: dropStayList(cleared.next), checkIn: '', wake: wakeFromPayload(payload, '') };
  }
  if (Array.isArray(payload.stays)) {
    if (!payload.stays.length) return { applied: false, error: 'incomplete' };
    var cleaned = cleanStayList(payload.stays);
    if (cleaned.error) return { applied: false, error: cleaned.error };
    var store = parseStore(rawStorage);
    if (store === null) return { applied: false, error: 'malformed' };
    var previous = store.guest && typeof store.guest === 'object' ? store.guest : {};
    var next = copyRecord(store);
    next.guest = guestFields(displayedStay(cleaned, ymd(clock), previous));
    next.stays = cleaned;
    return { applied: true, next: JSON.stringify(next), checkIn: next.guest.checkIn || '', wake: wakeFromStays(cleaned, clock) };
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
  return { applied: true, next: dropStayList(result.next), checkIn: checkIn, wake: wakeFromPayload(payload, checkIn) };
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
    fullyCommandUrl: fullyCommandUrl,
    openTvPicture: openTvPicture,
    sendStayThenPicture: sendStayThenPicture,
    claimTvSequence: claimTvSequence,
    releaseTvSequence: releaseTvSequence,
    reconcileDeviceStay: reconcileDeviceStay,
    settleStoredStay: settleStoredStay,
    deviceRecord: deviceRecord,
    editDisplayedStay: editDisplayedStay,
    stayListPayload: stayListPayload,
    describeStayOverlap: describeStayOverlap,
    describeRowWake: describeRowWake,
    TV_FOREGROUND_DELAY_MS: TV_FOREGROUND_DELAY_MS,
    TV_PICTURE_DELAY_MS: TV_PICTURE_DELAY_MS,
    TV_STAY_DELAY_MS: TV_STAY_DELAY_MS,
    TV_STAY_PAINT_MS: TV_STAY_PAINT_MS,
    TV_WAKE_KEY: TV_WAKE_KEY
  };
}
