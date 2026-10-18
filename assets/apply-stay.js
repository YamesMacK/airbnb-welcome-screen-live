'use strict';
var State = typeof module === 'object' && module.exports ? require('./device-state.js') : SSHDeviceState;
var WAKE_TIME=/^(?:[01]\d|2[0-3]):[0-5]\d$/;
var STAY_DATE=/^\d{4}-\d{2}-\d{2}$/;
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
    return { state: 'later', text: 'Check-in is more than 6 days away. The welcome page must run again within 6 days of check-in to set the weekly schedule.' };
  }
  var label = wakeAt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return { state: 'eligible', text: 'The requested TV wake is ' + clock + ' on ' + label + '. Setting and physical wake require device verification.' };
}

function describeStayOverlap(rows) {
  var stays = [];
  (rows || []).forEach(function(row) {
    var checkIn = String(row.checkIn || '');
    var checkOut = String(row.checkOut || '');
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

function wakeMoment(date,time){var ms=State.wakeInstant(date,time);return ms===null?new Date(NaN):new Date(ms);}
function scheduleIntent(desired,now){
  if(!desired)return {state:'unconfirmed',schedule:null,detail:'No managed wake choice has been enrolled.'};
  if(desired.off)return {state:'off',schedule:'[]',detail:''};
  var at=State.wakeInstant(desired.date,desired.time);
  if(at===null)return {state:'error',schedule:null,detail:'This local time cannot be represented in America/Chicago.'};
  if(at<=now)return {state:'off',schedule:'[]',detail:''};
  if(State.calendarDayDistance(State.propertyDate(now),desired.date)>6)return {state:'deferred',schedule:'[]',detail:'Beyond six days. This page must run again within six days of arrival to set the weekly schedule.'};
  var d=State.parseCalendarDate(desired.date);
  return {state:'setting-verified',schedule:JSON.stringify([{wakeupTime:desired.time,dayOfWeek:new Date(Date.UTC(d.year,d.month-1,d.day)).getUTCDay()+1}]),detail:'Setting readback only; physical wake is unverified and this page must run to prevent weekly repetition.'};
}
function tvWakeSchedule(desired,now){return scheduleIntent(desired,Number(now)).schedule;}
function writeSetting(fully,key,value){
  if(!fully||typeof fully.getStringSetting!=='function'||typeof fully.setStringSetting!=='function')return false;
  try{
    var raw=JSON.stringify(value);
    if(fully.getStringSetting(key)!==raw)fully.setStringSetting(key,raw);
    return fully.getStringSetting(key)===raw;
  }catch(_){return false;}
}
function applyWake(record,io){
  var desired=record.wake.desired,intent=scheduleIntent(desired,io.now());
  var result={revision:record.revision,state:intent.state,desired:desired,detail:intent.detail};
  if(intent.schedule===null)return result;
  if(!io.fully||typeof io.fully.getStringSetting!=='function'||typeof io.fully.setStringSetting!=='function')return {...result,state:'unconfirmed',detail:'Native setting bridge is unavailable.'};
  try{
    if(!io.checkAuthority(record))return {...result,state:'unconfirmed',detail:'Device is read-only.'};
    if(io.fully.getStringSetting('sleepSchedule')!==intent.schedule)io.fully.setStringSetting('sleepSchedule',intent.schedule);
    if(io.fully.getStringSetting('sleepSchedule')!==intent.schedule)return {...result,state:'error',detail:'Native setting readback did not match.'};
    return result;
  }catch(_){return {...result,state:'error',detail:'Native setting could not be verified.'};}
}
function publishStaySummary(record,wakeStatus,fully,now,readOnly){
  if(!State.validateRecord(record).ok||!wakeStatus||wakeStatus.revision!==record.revision||!['off','setting-verified','deferred','unconfirmed','error'].includes(wakeStatus.state))return {state:'error',revision:record&&record.revision};
  var snapshot={protocol:2,deviceEpoch:record.deviceEpoch,revision:record.revision,publishedAt:now,stays:record.stays,receipts:record.receipts,readOnly:!!readOnly,wake:wakeStatus};
  try{return {state:writeSetting(fully,'sshStayStateV2',snapshot)?'verified':'error',revision:record.revision};}
  catch(_){return {state:'error',revision:record.revision};}
}
async function reconcileDeviceStay(io){
  var fallback={effectiveGuest:{name:'',checkIn:'',checkOut:''},revision:null,persistenceStatus:'read-only',wakeStatus:null,publicationStatus:{state:'error',revision:null}};
  try{
    var result=await io.withTransaction('reconciliation',function(){
      var record;
      try{record=io.readRecord();}catch(_){
        // Legacy authority can still be displayed read-only before explicit enrollment.
        var adapted=State.adaptLegacyRecord({rawDeviceConfig:io.storage.getItem('ssh-device-config-v1'),rawLegacyWake:io.storage.getItem('ssh-tv-wake-v1'),nowMs:io.now(),deviceEpoch:'11111111-1111-4111-8111-111111111111',revision:'22222222-2222-4222-8222-222222222222'});
        if(adapted.ok)return {...fallback,effectiveGuest:State.reduceReconciliation(adapted.record,{now:io.now(),nextRevision:adapted.record.revision}).effectiveGuest};
        return fallback;
      }
      if(!State.validateRecord(record).ok)return fallback;
      var reduced=State.reduceReconciliation(record,{now:io.now(),nextRevision:io.newRevision()});
      var answer={...fallback,effectiveGuest:reduced.effectiveGuest,revision:record.revision};
      if(!io.checkAuthority(record))return answer;
      if(reduced.changed){
        var saved=io.writeRecord(reduced.nextRecord);
        if(!saved.ok)return {...answer,persistenceStatus:saved.outcome==='unconfirmed'?'unconfirmed':'error'};
        record=reduced.nextRecord;
      }
      // No asynchronous work between this fresh authority check and native effects/publication.
      if(!io.checkAuthority(record))return answer;
      var wake=applyWake(record,io);
      var publication=publishStaySummary(record,wake,io.fully,io.now(),false);
      return {effectiveGuest:reduced.effectiveGuest,revision:record.revision,persistenceStatus:'committed',wakeStatus:wake,publicationStatus:publication};
    });
    return result&&result.effectiveGuest?result:fallback;
  }catch(_){return fallback;}
}
function obsoleteStayLink(search,hash){
  var all=String(search||'')+'&'+String(hash||'');
  return /(?:^|[?&#])(?:setStay|guest|name|checkIn|checkOut|n|in|out|clear|stays|wake)(?:=|&|$)/i.test(all);
}
function opaqueHints(search,hash){
  if(obsoleteStayLink(search,hash))return null;
  var params=new URLSearchParams(search||''),next=new URLSearchParams();
  ['op','ack','owner'].forEach(function(key){var v=params.get(key);if(v&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v))next.set(key,v);});
  return next.toString();
}
function mailboxValue(fully,key){var raw=fully&&fully.getStringSetting(key);return raw?JSON.parse(raw):null;}
async function publishDeviceResult(io,key,value,ownerId){
  if(!['sshStayAckResultV2','sshStayResultV2','sshDeviceRecoveryResultV2','sshDeviceEnrollmentResultV2'].includes(key))return 'error';
  try{var publication=await io.withTransaction(value.operationId||ownerId||'publication',function(){
    var record=io.readRecord();
    if(!State.validateRecord(record).ok||!io.checkAuthority(record,ownerId?'holding':'active',ownerId||null))return 'error';
    if(ownerId&&(value.deviceEpoch!==record.deviceEpoch||value.revision!==record.revision))return 'error';
    return writeSetting(io.fully,key,value)?'verified':'error';
  });return publication==='verified'?'verified':'error';}catch(_){return 'error';}
}
async function processDeviceMailboxes(io){
  var result={outcome:'idle'};
  try{
    var ack=mailboxValue(io.fully,'sshStayAckV2');
    if(ack){var acknowledged=await State.acknowledgeReceipt(ack,io);result=acknowledged;
      if(acknowledged.acknowledged)result.publicationStatus=await publishDeviceResult(io,'sshStayAckResultV2',{protocol:2,...acknowledged});
    }
    var envelope=io.remoteCommand();
    if(envelope){
      var command=envelope.command;
      if(Object.keys(envelope).sort().join(',')!=='command,requestHash'||!State.validateCommand(command).ok||await State.hashCommand(command,io.sha256Utf8)!==envelope.requestHash)return {outcome:'invalid',code:'INVALID_MAILBOX'};
      var receipt=await State.commitDeviceChange(command,io);
      result={protocol:2,deviceEpoch:command.deviceEpoch,requestHash:envelope.requestHash,...receipt};
      result.publicationStatus=await publishDeviceResult(io,'sshStayResultV2',result);
    }
  }catch(_){return {outcome:'unconfirmed',code:'MAILBOX_UNAVAILABLE'};}
  return result;
}
async function enrollDevice(request,io){
  var invalid={outcome:'read-only',code:'ENROLLMENT_REQUIRES_OWNER'};
  var uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  if(!request||Object.keys(request).sort().join(',')!=='deviceEpoch,enrollmentId,expectedSourceDigest,expiresAt,protocol,revision'||request.protocol!==2||![request.enrollmentId,request.deviceEpoch,request.revision].every(v=>typeof v==='string'&&uuid.test(v))||!/^[0-9a-f]{64}$/.test(request.expectedSourceDigest)||!Number.isSafeInteger(request.expiresAt)||request.expiresAt<0)return invalid;
  request=JSON.parse(JSON.stringify(request));
  try{
    var raw=io.storage.getItem('ssh-device-config-v1'),wake=io.storage.getItem('ssh-tv-wake-v1');
    if(typeof raw!=='string')return invalid;
    var sourceDigest=await io.sha256Utf8(raw),parsed=JSON.parse(raw);
    var resumed=State.validateRecord(parsed).ok&&parsed.deviceEpoch===request.deviceEpoch&&parsed.revision===request.revision;
    if(!resumed&&sourceDigest!==request.expectedSourceDigest)return invalid;
    if(parsed.schema===2&&!resumed)return invalid;
    var adapted=resumed?{ok:true,record:parsed}:State.adaptLegacyRecord({rawDeviceConfig:raw,rawLegacyWake:wake,nowMs:io.now(),deviceEpoch:request.deviceEpoch,revision:request.revision});
    if(!adapted.ok)return invalid;
    var record=adapted.record,publicState={deviceEpoch:record.deviceEpoch,revision:record.revision,stays:record.stays};
    var stateDigest=await io.sha256Utf8(State.canonicalJson(publicState));
    return await io.withTransaction(request.enrollmentId,function(){
      if(io.now()>=request.expiresAt||!io.checkAuthority(record,'holding',request.enrollmentId)||io.storage.getItem('ssh-device-config-v1')!==raw||io.storage.getItem('ssh-tv-wake-v1')!==wake)return invalid;
      if(!resumed){var saved=io.writeRecord(record);if(!saved.ok)return {outcome:saved.outcome,code:'ENROLLMENT_WRITE_FAILED'};}
      return {protocol:2,enrollmentId:request.enrollmentId,...publicState,sourceDigest:request.expectedSourceDigest,stateDigest:stateDigest};
    });
  }catch(_){return invalid;}
}
async function processOwnerMailbox(io,ownerId){
  if(!ownerId)return null;
  try{
    var recovery=mailboxValue(io.fully,'sshDeviceRecoveryV2');
    if(recovery&&recovery.recoveryId===ownerId){var core=await State.recoverDeviceState(recovery,io);if(!core.revision)return core;
      var recovered={protocol:2,...core,currentRevision:core.revision};
      if(recovery.releasePin===true)recovered.released=true;
      await publishOwnerSnapshot(io,ownerId);
      return {...recovered,publicationStatus:await publishDeviceResult(io,'sshDeviceRecoveryResultV2',recovered,ownerId)};
    }
    var enrollment=mailboxValue(io.fully,'sshDeviceEnrollmentV2');
    if(enrollment&&enrollment.enrollmentId===ownerId){var result=await enrollDevice(enrollment,io);if(!result.revision)return result;
      await publishOwnerSnapshot(io,ownerId);
      return {...result,publicationStatus:await publishDeviceResult(io,'sshDeviceEnrollmentResultV2',result,ownerId)};
    }
  }catch(_){return {outcome:'unconfirmed',code:'OWNER_MAILBOX_UNAVAILABLE'};}
  return null;
}
if(typeof module==='object'&&module.exports)module.exports={checkInWakeTime,tvWakeSchedule,describeTvWake,describeStayOverlap,describeRowWake,reconcileDeviceStay,publishStaySummary,processDeviceMailboxes,processOwnerMailbox,enrollDevice,obsoleteStayLink,opaqueHints};

async function publishOwnerSnapshot(io,ownerId){
  return io.withTransaction(ownerId,function(){
    var record=io.readRecord();
    if(!io.checkAuthority(record,'holding',ownerId))return {state:'error'};
    return publishStaySummary(record,{revision:record.revision,state:'unconfirmed',desired:record.wake.desired,detail:'Owner verification in progress; native setting has not been changed.'},io.fully,io.now(),true);
  });
}
