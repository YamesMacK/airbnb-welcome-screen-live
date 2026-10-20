(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SSHDeviceState = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const PROPERTY_TIME_ZONE = 'America/Chicago';
  const KEY = 'ssh-device-config-v1';
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const HASH = /^[0-9a-f]{64}$/;
  const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  const commandKeys = ['protocol','operationId','deviceEpoch','expectedRevision','expiresAt','kind','payload'];
  const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
  const keys = (v, names) => plain(v) && Reflect.ownKeys(v).length === names.length && names.every(k => Object.prototype.hasOwnProperty.call(v,k) && 'value' in Object.getOwnPropertyDescriptor(v,k));
  const stamp = v => Number.isSafeInteger(v) && v >= 0;
  const uuid = v => typeof v === 'string' && UUID.test(v);
  const denseArray = v => Array.isArray(v)&&Reflect.ownKeys(v).length===v.length+1&&Array.from({length:v.length},(_,i)=>Object.getOwnPropertyDescriptor(v,String(i))).every(d=>d&&'value' in d);
  function validString(v,max,nonempty) {
    if (typeof v !== 'string' || (nonempty && !v.length) || [...v].length > max || /[\u0000-\u001f\u007f-\u009f]/.test(v)) return false;
    for(let i=0;i<v.length;i++){const c=v.charCodeAt(i);if(c>=0xd800&&c<=0xdbff){const d=v.charCodeAt(++i);if(!(d>=0xdc00&&d<=0xdfff))return false;}else if(c>=0xdc00&&c<=0xdfff)return false;}
    return true;
  }
  function parseCalendarDate(text) {
    if(typeof text!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(text))return null;
    const [year,month,day]=text.split('-').map(Number);
    const days=[31,year%4===0&&(year%100!==0||year%400===0)?29:28,31,30,31,30,31,31,30,31,30,31];
    return year>=2000&&year<=2099&&month>=1&&month<=12&&day>=1&&day<=days[month-1]?{year,month,day}:null;
  }
  function calendarParts(ms) {
    if(!stamp(ms))throw TypeError('Invalid clock');
    const parts=new Intl.DateTimeFormat('en-US',{timeZone:PROPERTY_TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(ms);
    return Object.fromEntries(parts.filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
  }
  function propertyDate(nowMs){const p=calendarParts(nowMs);return p.year+'-'+p.month+'-'+p.day;}
  function wakeInstant(date,time){
    const d=parseCalendarDate(date);if(!d||typeof time!=='string'||!TIME.test(time))return null;
    const [h,m]=time.split(':').map(Number), wall=Date.UTC(d.year,d.month-1,d.day,h,m), matches=[];
    // Chicago uses UTC-5/UTC-6 throughout the supported 2000..2099 calendar.
    for(const offset of [5,6]){const ms=wall+offset*3600000,p=calendarParts(ms);if(p.year+'-'+p.month+'-'+p.day===date&&p.hour+':'+p.minute===time)matches.push(ms);}
    return matches.length?Math.min(...matches):null;
  }
  function calendarDayDistance(fromDate,toDate){const a=parseCalendarDate(fromDate),b=parseCalendarDate(toDate);if(!a||!b)throw TypeError('Invalid calendar date');return (Date.UTC(b.year,b.month-1,b.day)-Date.UTC(a.year,a.month-1,a.day))/86400000;}
  function stay(v){return keys(v,['name','checkIn','checkOut','wake'])&&validString(v.name,120,true)&&parseCalendarDate(v.checkIn)&&parseCalendarDate(v.checkOut)&&v.checkIn<=v.checkOut&&typeof v.wake==='string'&&(v.wake===''||TIME.test(v.wake));}
  function stays(v){return Array.isArray(v)&&v.length<=100&&denseArray(v)&&v.every(stay);}
  function wifi(v){return keys(v,['ssid','password','encryption'])&&validString(v.ssid,128)&&validString(v.password,256)&&['WPA','WEP','nopass'].includes(v.encryption)&&(v.ssid!==''||v.password==='')&&(v.encryption!=='nopass'||v.password==='');}
  function safety(v){return keys(v,['address','hostName','hostPhone'])&&validString(v.address,500)&&validString(v.hostName,120)&&validString(v.hostPhone,80);}
  function guest(v){return keys(v,['name','checkIn','checkOut'])&&((v.name===''&&v.checkIn===''&&v.checkOut==='')||stay({...v,wake:''}));}
  function desired(v){return keys(v,['off'])&&v.off===true||keys(v,['date','time'])&&!!parseCalendarDate(v.date)&&typeof v.time==='string'&&TIME.test(v.time);}
  function checked(test,value,code){return test?{ok:true,value}:{ok:false,code};}
  function validateCommand(v){
    let valid=keys(v,commandKeys);
    if(valid)valid=v.protocol===2&&uuid(v.operationId)&&uuid(v.deviceEpoch)&&uuid(v.expectedRevision)&&(v.expiresAt===null||stamp(v.expiresAt));
    if(valid){const p=v.payload;switch(v.kind){
      case 'replace-stays':valid=keys(p,['stays'])&&stays(p.stays);break;
      case 'delete-all-stays':case 'clear-device':valid=keys(p,[]);break;
      case 'setup':valid=keys(p,['wifi','safety','stayEdit'])&&wifi(p.wifi)&&safety(p.safety)&&keys(p.stayEdit,['index','stay'])&&(p.stayEdit.index===null||Number.isSafeInteger(p.stayEdit.index)&&p.stayEdit.index>=0)&&(p.stayEdit.stay===null||stay(p.stayEdit.stay));break;
      default:valid=false;
    }}
    if(valid&&v.expiresAt===null&&!['replace-stays','delete-all-stays'].includes(v.kind))valid=false;
    return checked(valid,v,'INVALID_COMMAND');
  }
  function validateSubmission(v){
    if(!keys(v,commandKeys.concat('retry'))||typeof v.retry!=='boolean'||v.expiresAt!==null||!['replace-stays','delete-all-stays'].includes(v.kind))return {ok:false,code:'INVALID_SUBMISSION'};
    const c={};for(const k of commandKeys)c[k]=v[k];return checked(validateCommand(c).ok,v,'INVALID_SUBMISSION');
  }
  function commandFromSubmission(v,assignedExpiry){if(!validateSubmission(v).ok)throw TypeError('Invalid submission');const c={};for(const k of commandKeys)c[k]=k==='expiresAt'?assignedExpiry:v[k];if(!validateCommand(c).ok)throw TypeError('Invalid command');return c;}
  function canonicalJson(value){
    if(value===null||typeof value==='boolean')return JSON.stringify(value);
    if(typeof value==='string'){if(!validString(value,Number.MAX_SAFE_INTEGER))throw TypeError('Invalid string');return JSON.stringify(value);}
    if(typeof value==='number'){if(!Number.isSafeInteger(value))throw TypeError('Invalid integer');return JSON.stringify(value);}
    if(Array.isArray(value)){if(!denseArray(value))throw TypeError('Invalid array');return '['+value.map(v=>canonicalJson(v)).join(',')+']';}
    if(!plain(value))throw TypeError('Invalid object');
    const names=Reflect.ownKeys(value);if(names.some(k=>typeof k!=='string'||!('value' in Object.getOwnPropertyDescriptor(value,k))))throw TypeError('Invalid property');
    return '{'+names.sort().map(k=>canonicalJson(k)+':'+canonicalJson(value[k])).join(',')+'}';
  }
  function canonicalCommand(command){if(!validateCommand(command).ok)throw TypeError('Invalid command');return canonicalJson(command);}
  async function hashCommand(command,sha256Utf8){const result=await sha256Utf8(canonicalCommand(command));if(typeof result!=='string'||!HASH.test(result))throw TypeError('Invalid SHA-256');return result;}
  function receipt(v){
    return keys(v,['operationId','deviceEpoch','requestHash','expiresAt','outcome','reason','decidedAt','appliedRevision','currentRevision'])&&uuid(v.operationId)&&uuid(v.deviceEpoch)&&typeof v.requestHash==='string'&&HASH.test(v.requestHash)&&(v.expiresAt===null||stamp(v.expiresAt))&&stamp(v.decidedAt)&&uuid(v.currentRevision)&&
      (v.outcome==='committed'&&v.reason===''&&uuid(v.appliedRevision)&&v.appliedRevision===v.currentRevision||v.outcome==='conflict'&&['REVISION_CONFLICT','EPOCH_CONFLICT'].includes(v.reason)&&v.appliedRevision===null||v.outcome==='expired'&&v.expiresAt!==null&&v.reason==='COMMAND_EXPIRED'&&v.appliedRevision===null);
  }
  function acknowledgment(v){return keys(v,['deviceEpoch','operationId','requestHash'])&&uuid(v.deviceEpoch)&&uuid(v.operationId)&&typeof v.requestHash==='string'&&HASH.test(v.requestHash);}
  function approvedBase(value){try{const u=new URL(value);return typeof value==='string'&&u.href===value&&value.endsWith('/')&&!u.search&&!u.hash&&!u.username&&!u.password&&(u.protocol==='https:'||u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname));}catch(_){return false;}}
  function validateRecord(v){
    const names=['schema','deviceEpoch','revision','tombstone','wifi','safety','guest','stays','displaySelection','wake','receipts','pinnedOperationId','migration','lastRecovery','lastAcknowledgment'];
    let ok=keys(v,names)&&v.schema===2&&uuid(v.deviceEpoch)&&uuid(v.revision)&&typeof v.tombstone==='boolean'&&wifi(v.wifi)&&safety(v.safety)&&guest(v.guest)&&stays(v.stays);
    if(ok)ok=(v.displaySelection===null||Number.isInteger(v.displaySelection)&&v.displaySelection>=0&&v.displaySelection<v.stays.length)&&keys(v.wake,['mode','desired'])&&(['stays','legacy'].includes(v.wake.mode)&&desired(v.wake.desired)||v.wake.mode==='unmanaged'&&v.wake.desired===null);
    if(ok)ok=Array.isArray(v.receipts)&&v.receipts.length<=33&&denseArray(v.receipts)&&v.receipts.every(receipt)&&new Set(v.receipts.map(r=>r.operationId)).size===v.receipts.length&&(v.pinnedOperationId===null||uuid(v.pinnedOperationId)&&v.receipts.some(r=>r.operationId===v.pinnedOperationId))&&(v.receipts.length<=32||v.pinnedOperationId!==null);
    if(ok)ok=v.migration===null||keys(v.migration,['transferId','phase','peerBaseUrl','sourceRevision','stateDigest'])&&uuid(v.migration.transferId)&&['source-frozen','target-staged','retired'].includes(v.migration.phase)&&approvedBase(v.migration.peerBaseUrl)&&uuid(v.migration.sourceRevision)&&HASH.test(v.migration.stateDigest);
    if(ok)ok=v.lastRecovery===null||keys(v.lastRecovery,['recoveryId','previousRevision','newRevision'])&&Object.values(v.lastRecovery).every(uuid);
    if(ok)ok=v.lastAcknowledgment===null||acknowledgment(v.lastAcknowledgment)&&v.lastAcknowledgment.deviceEpoch===v.deviceEpoch;
    return checked(!!ok,v,'INVALID_RECORD');
  }
  const clone = value => JSON.parse(JSON.stringify(value));
  const emptyGuest = () => ({name:'',checkIn:'',checkOut:''});
  function activeIndex(rows,today){let selected=null;rows.forEach((row,i)=>{if(row.checkIn<=today&&row.checkOut>=today&&(selected===null||row.checkIn>=rows[selected].checkIn))selected=i;});return selected;}
  function matchingIndex(rows,previous,today,legacy){
    if(!previous||!previous.name)return null;
    const matches=[];rows.forEach((row,i)=>{if(row.name===previous.name&&(!today||row.checkOut>=today))matches.push(i);});
    const exact=matches.filter(i=>rows[i].checkIn===previous.checkIn&&rows[i].checkOut===previous.checkOut);
    if(exact.length===1||legacy&&exact.length>0)return exact[0];
    return matches.length===1?matches[0]:null;
  }
  function projection(record,now){const today=propertyDate(now),active=activeIndex(record.stays,today),i=active===null?record.displaySelection:active;const row=i===null?null:record.stays[i];return row&&row.checkOut>=today?{name:row.name,checkIn:row.checkIn,checkOut:row.checkOut}:emptyGuest();}
  function desiredFromStays(rows,now){
    let best=null;const p=calendarParts(now),wallNow=p.year+'-'+p.month+'-'+p.day+'T'+p.hour+':'+p.minute;
    for(const row of rows){if(!TIME.test(row.wake))continue;const at=wakeInstant(row.checkIn,row.wake),wall=row.checkIn+'T'+row.wake;
      // A future gap is an unfulfillable requested wake, not permission to silently disable it.
      if((at!==null&&at>now||at===null&&wall>wallNow)&&(!best||wall<best.wall))best={wall,date:row.checkIn,time:row.wake};
    }
    return best?{date:best.date,time:best.time}:{off:true};
  }
  function adaptLegacyRecord(input){
    const fail=field=>({ok:false,code:'LEGACY_OWNER_RESOLUTION',fieldPaths:[field]});
    if(!input||!uuid(input.deviceEpoch)||!uuid(input.revision)||!stamp(input.nowMs)||typeof input.rawDeviceConfig!=='string')return fail('deviceConfig');
    let old;try{old=JSON.parse(input.rawDeviceConfig);}catch(_){return fail('deviceConfig');}
    if(old&&old.schema===2){const result=validateRecord(old);return result.ok?{ok:true,record:old}:fail('deviceConfig');}
    if(!plain(old)||Object.keys(old).some(k=>!['guest','stays','wifi','safety'].includes(k)))return fail('deviceConfig');
    const defaults={guest:emptyGuest(),wifi:{ssid:'',password:'',encryption:'WPA'},safety:{address:'',hostName:'',hostPhone:''}};
    for(const k of Object.keys(defaults)){
      if(old[k]!==undefined&&(!plain(old[k])||Object.keys(old[k]).some(p=>!Object.hasOwn(defaults[k],p))))return fail(k);
      defaults[k]={...defaults[k],...old[k]};
    }
    if(!guest(defaults.guest)||!wifi(defaults.wifi)||!safety(defaults.safety))return fail('privateFields');
    let legacyWake=null;
    if(input.rawLegacyWake!==null&&input.rawLegacyWake!==undefined){try{legacyWake=JSON.parse(input.rawLegacyWake);}catch(_){return fail('legacyWake');}if(!desired(legacyWake))return fail('legacyWake');}
    const hasList=Object.hasOwn(old,'stays');let rows=hasList?old.stays:[];
    if(!hasList&&defaults.guest.name)rows=[{...defaults.guest,wake:legacyWake&&legacyWake.date===defaults.guest.checkIn?legacyWake.time:''}];
    if(!stays(rows))return fail('stays');
    const today=propertyDate(input.nowMs),active=activeIndex(rows,today),selection=active===null?matchingIndex(rows,defaults.guest,today,true):active;
    const record={schema:2,deviceEpoch:input.deviceEpoch,revision:input.revision,tombstone:false,...defaults,stays:clone(rows),displaySelection:selection,wake:hasList?{mode:'stays',desired:desiredFromStays(rows,input.nowMs)}:legacyWake?{mode:'legacy',desired:clone(legacyWake)}:{mode:'unmanaged',desired:null},receipts:[],pinnedOperationId:null,migration:null,lastRecovery:null,lastAcknowledgment:null};
    record.guest=projection(record,input.nowMs);
    return validateRecord(record).ok?{ok:true,record}:fail('deviceConfig');
  }
  // Synchronous SHA-256 is only for the public pure reducer. Commit hashes before queue entry.
  function digest(text){
    const bytes=new TextEncoder().encode(text),words=[],initial=[],constants=[];
    for(let n=2;constants.length<64;n++){let prime=true;for(let p=2;p*p<=n;p++)if(n%p===0){prime=false;break;}if(prime){if(initial.length<8)initial.push((Math.sqrt(n)%1)*4294967296|0);constants.push((Math.cbrt(n)%1)*4294967296|0);}}
    for(let i=0;i<bytes.length;i++)words[i>>2]=(words[i>>2]||0)|(bytes[i]<<(24-(i%4)*8));
    words[bytes.length>>2]=(words[bytes.length>>2]||0)|(128<<(24-(bytes.length%4)*8));
    const size=((bytes.length+9+63)>>6)*16;words[size-2]=Math.floor(bytes.length*8/4294967296);words[size-1]=bytes.length*8;
    const rotate=(x,n)=>(x>>>n)|(x<<(32-n));let state=initial;
    for(let start=0;start<size;start+=16){const w=[];let [a,b,c,d,e,f,g,h]=state;for(let j=0;j<64;j++){
      if(j<16)w[j]=words[start+j]|0;else {const x=w[j-15],y=w[j-2];w[j]=((rotate(x,7)^rotate(x,18)^(x>>>3))+w[j-16]+(rotate(y,17)^rotate(y,19)^(y>>>10))+w[j-7])|0;}
      const t1=(h+(rotate(e,6)^rotate(e,11)^rotate(e,25))+((e&f)^(~e&g))+constants[j]+w[j])|0,t2=((rotate(a,2)^rotate(a,13)^rotate(a,22))+((a&b)^(a&c)^(b&c)))|0;
      h=g;g=f;f=e;e=(d+t1)|0;d=c;c=b;b=a;a=(t1+t2)|0;
    }state=state.map((x,i)=>(x+[a,b,c,d,e,f,g,h][i])|0);}
    return state.map(v=>(v>>>0).toString(16).padStart(8,'0')).join('');
  }
  function retainReceipts(record){const latest=record.receipts.slice(-32),pinned=record.receipts.find(r=>r.operationId===record.pinnedOperationId);if(pinned&&!latest.includes(pinned))latest.unshift(pinned);record.receipts=latest;}
  function reduceCommand(record,command,options){
    if(!validateRecord(record).ok||!validateCommand(command).ok||!stamp(options.now)||!uuid(options.nextRevision))throw TypeError('Invalid reducer input');
    const next=clone(record),now=options.now,hash=options.requestHash===undefined?digest(canonicalCommand(command)):options.requestHash;
    if(!HASH.test(hash))throw TypeError('Invalid digest');
    let outcome='committed',reason='';
    if(command.deviceEpoch!==record.deviceEpoch){outcome='conflict';reason='EPOCH_CONFLICT';}
    else if(command.expectedRevision!==record.revision){outcome='conflict';reason='REVISION_CONFLICT';}
    else if(command.expiresAt!==null&&now>=command.expiresAt){outcome='expired';reason='COMMAND_EXPIRED';}
    if(outcome==='committed'){
      switch(command.kind){
        case 'replace-stays':{const selected=record.displaySelection===null?null:record.stays[record.displaySelection];next.stays=clone(command.payload.stays);next.displaySelection=matchingIndex(next.stays,selected,null,false);break;}
        case 'delete-all-stays':next.stays=[];next.displaySelection=null;break;
        case 'clear-device':next.stays=[];next.displaySelection=null;next.wifi={ssid:'',password:'',encryption:'WPA'};next.safety={address:'',hostName:'',hostPhone:''};next.tombstone=true;break;
        case 'setup':{
          const edit=command.payload.stayEdit;
          if(edit.index!==null&&edit.index>=next.stays.length)throw TypeError('Invalid stay index');
          next.wifi=clone(command.payload.wifi);next.safety=clone(command.payload.safety);next.tombstone=false;
          if(edit.index===null&&edit.stay!==null){if(next.stays.length>=100)throw TypeError('Too many stays');next.stays.push(clone(edit.stay));next.displaySelection=next.stays.length-1;}
          else if(edit.index!==null&&edit.stay!==null){next.stays[edit.index]=clone(edit.stay);next.displaySelection=edit.index;}
          else if(edit.index!==null){next.stays.splice(edit.index,1);if(next.displaySelection===edit.index)next.displaySelection=null;else if(next.displaySelection>edit.index)next.displaySelection--;}
          break;
        }
      }
      next.guest=projection(next,now);next.wake={mode:'stays',desired:desiredFromStays(next.stays,now)};next.revision=options.nextRevision;
    }
    const result={operationId:command.operationId,deviceEpoch:command.deviceEpoch,requestHash:hash,expiresAt:command.expiresAt,outcome,reason,decidedAt:now,appliedRevision:outcome==='committed'?next.revision:null,currentRevision:next.revision};
    next.receipts.push(result);retainReceipts(next);return {nextRecord:next,receipt:result};
  }
  function reduceReconciliation(record,{now,nextRevision}){
    if(!validateRecord(record).ok||!stamp(now)||!uuid(nextRevision))throw TypeError('Invalid reconciliation input');
    const next=clone(record),today=propertyDate(now),selection=record.displaySelection;next.stays=[];next.displaySelection=null;
    record.stays.forEach((row,i)=>{if(row.checkOut>=today){if(i===selection)next.displaySelection=next.stays.length;next.stays.push(clone(row));}});
    next.guest=projection(next,now);if(next.wake.mode==='stays')next.wake.desired=desiredFromStays(next.stays,now);
    const changed=canonicalJson(next)!==canonicalJson(record);if(changed)next.revision=nextRevision;
    return {nextRecord:next,changed,effectiveGuest:clone(next.guest)};
  }
  const transient=(operationId,outcome,code)=>({operationId,outcome,code});
  const dataField=(value,key)=>{const d=value&&typeof value==='object'?Object.getOwnPropertyDescriptor(value,key):null;return d&&'value' in d?d.value:undefined;};
  function authorityMatches(io,record,mode='active',transferId=null){
    try{const a=io.authority();return keys(a,['protocol','deviceEpoch','mode','baseUrl','transferId'])&&a.protocol===2&&a.deviceEpoch===record.deviceEpoch&&a.mode===mode&&a.baseUrl===io.baseUrl&&approvedBase(a.baseUrl)&&a.transferId===transferId&&record.migration===null;}catch(_){return false;}
  }
  function readRecord(io){const raw=io.storage.getItem(KEY);if(typeof raw!=='string')throw TypeError('Missing authority');const record=JSON.parse(raw);if(!validateRecord(record).ok)throw TypeError('Invalid authority');return record;}
  function writeRecord(io,record){
    if(!validateRecord(record).ok)return {ok:false,outcome:'storage-error',code:'INVALID_RECORD'};
    const raw=JSON.stringify(record);
    try{io.storage.setItem(KEY,raw);}catch(_){return {ok:false,outcome:'storage-error',code:'STORAGE_WRITE_FAILED'};}
    try{if(io.storage.getItem(KEY)!==raw)return {ok:false,outcome:'unconfirmed',code:'READBACK_MISMATCH'};}catch(_){return {ok:false,outcome:'unconfirmed',code:'READBACK_FAILED'};}
    return {ok:true};
  }
  async function commitDeviceChange(input,io){
    const id=dataField(input,'operationId');let command,requestHash,bytes;
    try{bytes=canonicalCommand(input);command=JSON.parse(bytes);requestHash=await hashCommand(command,io.sha256Utf8);}catch(_){return transient(id,'invalid','INVALID_COMMAND');}
    return io.withTransaction(id,()=>{
      let record;try{record=readRecord(io);}catch(_){return transient(id,'read-only','INVALID_AUTHORITY');}
      if(!authorityMatches(io,record))return transient(id,'read-only','AUTHORITY_MISMATCH');
      const prior=record.receipts.find(r=>r.operationId===id);
      if(prior)return prior.requestHash===requestHash?clone(prior):transient(id,'invalid','OPERATION_ID_REUSED');
      if(record.lastAcknowledgment&&record.lastAcknowledgment.operationId===id)return transient(id,'not-applied',record.lastAcknowledgment.requestHash===requestHash?'ALREADY_ACKNOWLEDGED':'OPERATION_ID_REUSED');
      let remote=false;
      try{const envelope=io.remoteCommand();remote=keys(envelope,['command','requestHash'])&&envelope.requestHash===requestHash&&canonicalCommand(envelope.command)===bytes;}catch(_){return transient(id,'read-only','MAILBOX_UNREADABLE');}
      if(command.expiresAt===null&&!remote)return transient(id,'invalid','REMOTE_COMMAND_REQUIRED');
      // Managed guest authority permits only the coordinator mailbox to change
      // stays. Private Wi-Fi/contact setup can still use the local transaction.
      if(io.managedGuests&&io.managedGuests()&&!remote&&!(command.kind==='setup'&&command.payload.stayEdit.index===null&&command.payload.stayEdit.stay===null))return transient(id,'read-only','HOST_GUEST_AUTHORITY');
      if(record.pinnedOperationId!==null&&record.pinnedOperationId!==id&&remote)return transient(id,'not-applied','MAILBOX_BUSY');
      let reduced;
      try{reduced=reduceCommand(record,command,{now:io.now(),nextRevision:io.newRevision(),requestHash});}catch(_){return transient(id,'invalid','INVALID_CHANGE');}
      // This is the final synchronous decision before the single write; no asynchronous work is permitted here.
      const finalNow=io.now();
      if(command.expiresAt!==null&&finalNow>=command.expiresAt&&reduced.receipt.outcome==='committed')reduced=reduceCommand(record,command,{now:finalNow,nextRevision:reduced.nextRecord.revision,requestHash});
      if(remote){reduced.nextRecord.pinnedOperationId=id;retainReceipts(reduced.nextRecord);}
      const saved=writeRecord(io,reduced.nextRecord);return saved.ok?reduced.receipt:transient(id,saved.outcome,saved.code);
    });
  }
  async function acknowledgeReceipt(input,io){
    if(!keys(input,['protocol','deviceEpoch','operationId','requestHash'])||input.protocol!==2||!acknowledgment({deviceEpoch:input.deviceEpoch,operationId:input.operationId,requestHash:input.requestHash}))return {acknowledged:false,code:'INVALID_ACK'};
    const ack=clone(input),identity={deviceEpoch:ack.deviceEpoch,operationId:ack.operationId,requestHash:ack.requestHash},success={acknowledged:true,...identity};
    return io.withTransaction(ack.operationId,()=>{
      let record;try{record=readRecord(io);}catch(_){return {acknowledged:false,code:'INVALID_AUTHORITY'};}
      if(!authorityMatches(io,record)||ack.deviceEpoch!==record.deviceEpoch)return {acknowledged:false,code:'AUTHORITY_MISMATCH'};
      if(record.lastAcknowledgment&&canonicalJson(record.lastAcknowledgment)===canonicalJson(identity))return success;
      const savedReceipt=record.receipts.find(r=>r.operationId===ack.operationId&&r.deviceEpoch===ack.deviceEpoch&&r.requestHash===ack.requestHash);
      if(!savedReceipt||record.pinnedOperationId!==ack.operationId)return {acknowledged:false,code:'ACK_MISMATCH'};
      const next=clone(record);next.pinnedOperationId=null;next.lastAcknowledgment=identity;retainReceipts(next);
      const saved=writeRecord(io,next);return saved.ok?success:{acknowledged:false,...identity,outcome:saved.outcome,code:saved.code};
    });
  }
  const documentOwner={mode:null,baseUrl:null,jobs:[],running:false};
  function createBrowserIO({fully,baseUrl,writerMode='single-document'}){
    if(!['single-document','web-locks'].includes(writerMode)||!approvedBase(baseUrl))throw TypeError('Invalid writer configuration');
    const here=new URL(globalThis.location.href),base=new URL(baseUrl);
    if(here.origin!==base.origin||!here.pathname.startsWith(base.pathname))throw TypeError('Writer origin mismatch');
    if(documentOwner.mode===null){documentOwner.mode=writerMode;documentOwner.baseUrl=baseUrl;}
    const compatible=documentOwner.mode===writerMode&&documentOwner.baseUrl===baseUrl;
    const io={fully,baseUrl,writerMode,storage:globalThis.localStorage,now:()=>Date.now(),newRevision:()=>globalThis.crypto.randomUUID(),
      sha256Utf8:async text=>Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join(''),
      managedGuests(){try{const a=JSON.parse(fully.getStringSetting('sshActiveOriginV2'));return keys(a,['protocol','deviceEpoch','mode','baseUrl','transferId'])&&a.protocol===2&&uuid(a.deviceEpoch)&&a.mode==='managed'&&a.baseUrl===baseUrl&&uuid(a.transferId)?a:null;}catch(_){return null;}},
      authority(){try{const managed=io.managedGuests();if(managed)return {...managed,mode:'active',transferId:null};const a=JSON.parse(fully.getStringSetting('sshActiveOriginV2'));return keys(a,['protocol','deviceEpoch','mode','baseUrl','transferId'])&&a.protocol===2&&uuid(a.deviceEpoch)&&['active','holding'].includes(a.mode)&&a.baseUrl===baseUrl&&(a.mode==='active'?a.transferId===null:uuid(a.transferId))?a:null;}catch(_){return null;}},
      remoteCommand(){const raw=fully.getStringSetting('sshStayCommandV2');if(!raw)return null;const envelope=JSON.parse(raw);if(!keys(envelope,['command','requestHash'])||!validateCommand(envelope.command).ok||!HASH.test(envelope.requestHash))throw TypeError('Invalid mailbox');return envelope;},
      readRecord:()=>readRecord(io),writeRecord:record=>writeRecord(io,record),checkAuthority:(record,mode='active',transferId=null)=>authorityMatches(io,record,mode,transferId),
      withTransaction(operationId,callback){
        if(typeof callback!=='function'||callback.constructor.name==='AsyncFunction')throw TypeError('Transaction callback must be synchronous');
        if(!compatible)return Promise.resolve(transient(operationId,'read-only','WRITER_MODE_MISMATCH'));
        if(writerMode==='web-locks'&&!(globalThis.navigator&&globalThis.navigator.locks&&typeof globalThis.navigator.locks.request==='function'))return Promise.resolve(transient(operationId,'read-only','LOCKS_UNAVAILABLE'));
        return new Promise((resolve,reject)=>{
          const job={operationId,callback,resolve,reject,entered:false,canceled:false,deadline:globalThis.performance.now()+2000,controller:writerMode==='web-locks'?new AbortController():null};
          job.timer=setTimeout(()=>{if(job.entered||job.canceled)return;job.canceled=true;const index=documentOwner.jobs.indexOf(job);if(index>=0)documentOwner.jobs.splice(index,1);if(job.controller)job.controller.abort();resolve(transient(operationId,'not-applied','LOCK_TIMEOUT'));},2000);
          documentOwner.jobs.push(job);Promise.resolve().then(pump);
        });
      }
    };
    function pump(){
      if(documentOwner.running)return;const job=documentOwner.jobs.shift();if(!job)return;
      if(job.canceled){pump();return;}documentOwner.running=true;
      const enter=()=>{
        if(job.canceled||globalThis.performance.now()>=job.deadline){job.canceled=true;clearTimeout(job.timer);return transient(job.operationId,'not-applied','LOCK_TIMEOUT');}
        job.entered=true;clearTimeout(job.timer);const result=job.callback();if(result&&typeof result.then==='function')throw TypeError('Transaction callback must be synchronous');return result;
      };
      let work;
      try{work=writerMode==='web-locks'?globalThis.navigator.locks.request(KEY+':write',{mode:'exclusive',signal:job.controller.signal},enter):enter();}
      catch(error){work=Promise.reject(error);}
      Promise.resolve(work).then(value=>job.resolve(value),error=>{if(job.canceled)job.resolve(transient(job.operationId,'not-applied','LOCK_TIMEOUT'));else if(!job.entered)job.resolve(transient(job.operationId,'read-only','LOCKS_UNAVAILABLE'));else job.reject(error);}).finally(()=>{clearTimeout(job.timer);documentOwner.running=false;pump();});
    }
    return io;
  }
  async function recoverDeviceState(input,io){
    const release=keys(input,['protocol','recoveryId','deviceEpoch','expiresAt','releasePin','expectedRevision','expectedDigest'])&&input.releasePin===true&&uuid(input.expectedRevision)&&typeof input.expectedDigest==='string'&&HASH.test(input.expectedDigest);
    if((!release&&!keys(input,['protocol','recoveryId','deviceEpoch','expiresAt']))||input.protocol!==2||!uuid(input.recoveryId)||!uuid(input.deviceEpoch)||!stamp(input.expiresAt))return transient(dataField(input,'recoveryId'),'invalid','INVALID_RECOVERY');
    const request=clone(input);
    return io.withTransaction(request.recoveryId,()=>{
      let record;try{record=readRecord(io);}catch(_){return transient(request.recoveryId,'read-only','INVALID_AUTHORITY');}
      if(record.deviceEpoch!==request.deviceEpoch||!authorityMatches(io,record,'holding',request.recoveryId))return transient(request.recoveryId,'read-only','AUTHORITY_MISMATCH');
      if(release){
        if(io.now()>=request.expiresAt)return transient(request.recoveryId,'not-applied','COMMAND_EXPIRED');
        const actualDigest=digest(canonicalJson({deviceEpoch:record.deviceEpoch,revision:record.revision,stays:record.stays}));
        if(!record.lastRecovery||record.lastRecovery.recoveryId!==request.recoveryId||record.revision!==request.expectedRevision||actualDigest!==request.expectedDigest)return transient(request.recoveryId,'not-applied','RECOVERY_MISMATCH');
        if(record.pinnedOperationId!==null){
          const next=clone(record);next.pinnedOperationId=null;retainReceipts(next);
          // Hashing and retention work must not carry an expired owner lease into a write.
          if(io.now()>=request.expiresAt)return transient(request.recoveryId,'not-applied','COMMAND_EXPIRED');
          const saved=writeRecord(io,next);if(!saved.ok)return transient(request.recoveryId,saved.outcome,saved.code);record=next;
        }
      }
      if(!record.lastRecovery||record.lastRecovery.recoveryId!==request.recoveryId){
        if(io.now()>=request.expiresAt)return transient(request.recoveryId,'not-applied','COMMAND_EXPIRED');
        const next=clone(record);next.revision=io.newRevision();next.lastRecovery={recoveryId:request.recoveryId,previousRevision:record.revision,newRevision:next.revision};
        if(io.now()>=request.expiresAt)return transient(request.recoveryId,'not-applied','COMMAND_EXPIRED');
        const saved=writeRecord(io,next);if(!saved.ok)return transient(request.recoveryId,saved.outcome,saved.code);record=next;
      }
      const state={deviceEpoch:record.deviceEpoch,revision:record.revision,stays:clone(record.stays)};
      return {recoveryId:request.recoveryId,...state,receipt:clone(record.lastRecovery),stateDigest:digest(canonicalJson(state))};
    });
  }
  return Object.freeze({PROPERTY_TIME_ZONE, parseCalendarDate, propertyDate,
    wakeInstant, calendarDayDistance, adaptLegacyRecord, validateRecord,
    validateCommand, validateSubmission, commandFromSubmission, canonicalJson,
    canonicalCommand, hashCommand, reduceCommand, reduceReconciliation,
    commitDeviceChange, acknowledgeReceipt, createBrowserIO, recoverDeviceState});
});
