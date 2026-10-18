(function(root,factory){
  'use strict';
  const api=factory(typeof module==='object'&&module.exports?require('./device-state.js'):root.SSHDeviceState);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.SSHUpdateState=api;
})(typeof window!=='undefined'?window:globalThis,function(D){
  'use strict';
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const digest=/^[0-9a-f]{64}$/;
  const copy=value=>JSON.parse(JSON.stringify(value));
  const exact=(value,keys)=>value&&Object.getPrototypeOf(value)===Object.prototype&&
    Object.keys(value).sort().join(',')===keys.slice().sort().join(',');
  const timestamp=value=>Number.isSafeInteger(value)&&value>=0;
  const isUuid=value=>typeof value==='string'&&uuid.test(value);
  function validReceipt(r){
    if(!exact(r,['operationId','deviceEpoch','requestHash','expiresAt','outcome','reason','decidedAt','appliedRevision','currentRevision']))return false;
    if(!isUuid(r.operationId)||!isUuid(r.deviceEpoch)||!digest.test(r.requestHash)||
      !(r.expiresAt===null||timestamp(r.expiresAt))||!timestamp(r.decidedAt)||!isUuid(r.currentRevision))return false;
    if(r.outcome==='committed')return r.reason===''&&isUuid(r.appliedRevision)&&r.appliedRevision===r.currentRevision;
    if(r.appliedRevision!==null)return false;
    return r.outcome==='conflict'?['REVISION_CONFLICT','EPOCH_CONFLICT'].includes(r.reason):
      r.outcome==='expired'&&r.reason==='COMMAND_EXPIRED'&&r.expiresAt!==null;
  }
  function validPending(p){
    return p===null||(exact(p,['operationId','requestHash','expiresAt','statusUri','code'])&&
      isUuid(p.operationId)&&digest.test(p.requestHash)&&p.expiresAt===null&&
      p.statusUri==='/ssh-stays/operations/'+p.operationId&&['PENDING','UNCONFIRMED'].includes(p.code));
  }
  function validateSnapshot(s){
    try {
      if(!exact(s,['protocol','deviceEpoch','revision','publishedAt','stays','receipts','readOnly','wake','pending'])&&
        !exact(s,['protocol','deviceEpoch','revision','publishedAt','stays','receipts','readOnly','wake']))return {ok:false};
      if(s.protocol!==2||!isUuid(s.deviceEpoch)||!isUuid(s.revision)||!timestamp(s.publishedAt)||typeof s.readOnly!=='boolean'||
        !Array.isArray(s.receipts)||s.receipts.length>33||!s.receipts.every(validReceipt)||new Set(s.receipts.map(r=>r.operationId)).size!==s.receipts.length)return {ok:false};
      const c={protocol:2,operationId:s.revision,deviceEpoch:s.deviceEpoch,expectedRevision:s.revision,
        expiresAt:0,kind:'replace-stays',payload:{stays:s.stays}};
      if(!D.validateCommand(c).ok||!validPending(s.pending===undefined?null:s.pending))return {ok:false};
      const w=s.wake;
      if(!exact(w,['revision','state','desired','detail'])||w.revision!==s.revision||typeof w.detail!=='string'||w.detail.length>500||/[\u0000-\u001f\u007f]/.test(w.detail)||
        !['off','setting-verified','deferred','unconfirmed','error'].includes(w.state))return {ok:false};
      if(w.desired!==null&&!(exact(w.desired,['off'])&&w.desired.off===true)&&
        !(exact(w.desired,['date','time'])&&D.parseCalendarDate(w.desired.date)&&/^([01]\d|2[0-3]):[0-5]\d$/.test(w.desired.time)))return {ok:false};
      return {ok:true,value:{...copy(s),pending:s.pending===undefined?null:copy(s.pending)}};
    }catch(_){return {ok:false};}
  }
  function initialState(){return {phase:'loading',generation:0,confirmed:null,draft:[],baseline:null,operation:null,unknownReview:null,message:''};}
  function unknownResolutionMatches(state,body){
    const op=state.operation,r=body&&body.resolution,checked=validateSnapshot(body&&body.snapshot);
    return !!(op&&(op.request||op.admission==='accepted')&&body.code==='UNKNOWN_PRE_RECOVERY'&&body.operationId===op.operationId&&
      body.acceptance==='unknown'&&body.outcome==='unknown'&&(!Object.hasOwn(body,'requestHash')||body.requestHash===op.requestHash)&&
      exact(r,['protocol','operationId','deviceEpoch','recoveryId','barrierRevision'])&&r.protocol===2&&
      r.operationId===op.operationId&&r.deviceEpoch===op.deviceEpoch&&isUuid(r.recoveryId)&&isUuid(r.barrierRevision)&&
      checked.ok&&!checked.value.readOnly&&!checked.value.pending&&checked.value.deviceEpoch===r.deviceEpoch&&
      (!op.request||(r.barrierRevision!==op.request.expectedRevision&&checked.value.revision!==op.request.expectedRevision)));
  }
  function receiptMatches(state,r){
    const op=state.operation;
    return !!(op&&validReceipt(r)&&r.operationId===op.operationId&&r.requestHash===op.requestHash&&
      r.expiresAt===op.expiresAt&&r.deviceEpoch===(op.deviceEpoch||(op.request?op.request.deviceEpoch:state.baseline&&state.baseline.deviceEpoch)));
  }
  function resultMessage(r,snapshot){
    if(!snapshot)return 'Stays saved; automatic TV wake could not be confirmed';
    if(snapshot.revision!==r.appliedRevision)return 'Your change was saved; a later change is now on the TV';
    const w=snapshot.wake;
    if(w.revision!==r.appliedRevision||['unconfirmed','error'].includes(w.state))return 'Stays saved; automatic TV wake could not be confirmed';
    if(w.state==='deferred')return 'Saved; wake is deferred until the welcome page runs within six days';
    return 'Stays saved';
  }
  function transition(state,event){
    const s=state||initialState(),e=event||{};
    if(e.generation!==undefined&&e.generation!==s.generation)return s;
    const op=s.operation;
    if(e.operationId&&op&&e.operationId!==op.operationId)return s;
    if(e.requestHash&&op&&e.requestHash!==op.requestHash)return s;
    switch(e.type){
      case 'READ_START':
      case 'PAGE_SHOW':
        return {...s,generation:s.generation+1,unknownReview:null,phase:op?(s.phase==='read-only'?'read-only':'verifying'):
          ['dirty','conflict','read-only'].includes(s.phase)?s.phase:'loading'};
      case 'READ_OK': {
        const checked=validateSnapshot(e.snapshot);
        if(!checked.ok)return {...s,phase:op?s.phase:'read-only',message:'The TV snapshot is unreadable. Editing is disabled.'};
        const snapshot=checked.value;
        let operation=op;
        const keepDraft=!!op||!!s.baseline&&['dirty','conflict','read-only','unconfirmed'].includes(s.phase);
        if(!operation&&snapshot.pending)operation={...snapshot.pending,deviceEpoch:snapshot.deviceEpoch,request:null,submitted:!keepDraft,admission:'accepted'};
        const epochChanged=!!s.baseline&&snapshot.deviceEpoch!==s.baseline.deviceEpoch;
        const baseline=keepDraft?s.baseline:{deviceEpoch:snapshot.deviceEpoch,revision:snapshot.revision};
        return {...s,confirmed:snapshot,baseline,operation,draft:keepDraft?s.draft:copy(snapshot.stays),
          phase:snapshot.readOnly||(epochChanged&&keepDraft)?'read-only':operation?(s.phase==='unconfirmed'?'unconfirmed':'pending'):keepDraft?s.phase:'ready',
          message:snapshot.readOnly?'The TV is read-only. Owner resolution is required.':
            epochChanged&&keepDraft?'The TV identity changed. Review it before reapplying this draft.':operation?'Queued; waiting for the TV to confirm':keepDraft?s.message:''};
      }
      case 'READ_FAILED':
        return {...s,phase:['read-only','unconfirmed','conflict'].includes(s.phase)?s.phase:op?(op.admission==='accepted'?'pending':s.phase):s.phase==='dirty'?'dirty':'error',
          message:e.exhausted?'Automatic retry stopped':e.message||'The TV snapshot could not be read. Retry when ready.'};
      case 'EDIT':
        if(op||!s.confirmed||s.confirmed.readOnly||!['ready','dirty','confirmed','error'].includes(s.phase))throw new Error('Editing is locked until the outstanding operation or review is resolved');
        return {...s,phase:'dirty',draft:copy(e.draft),message:''};
      case 'SUBMIT': {
        if(op)throw new Error('An unresolved operation must be reconciled first');
        if(!['ready','dirty','confirmed'].includes(s.phase)||!s.confirmed||s.confirmed.readOnly||s.confirmed.pending||!s.baseline)
          throw new Error('Read and review the current snapshot before saving');
        const request=e.request;
        if(!exact(request,['protocol','operationId','deviceEpoch','expectedRevision','kind','payload'])||
          request.deviceEpoch!==s.baseline.deviceEpoch||request.expectedRevision!==s.baseline.revision||
          !D.validateSubmission({...request,retry:false,expiresAt:null}).ok||!digest.test(e.requestHash))throw new Error('Invalid submission');
        return {...s,phase:'sending',operation:{operationId:request.operationId,deviceEpoch:request.deviceEpoch,request:copy(request),requestHash:e.requestHash,
          expiresAt:null,statusUri:'/ssh-stays/operations/'+request.operationId,submitted:true,admission:'unknown'},message:'Sending the update'};
      }
      case 'ADMITTED':
        if(!op||e.operationId!==op.operationId||e.requestHash!==op.requestHash||e.expiresAt!==op.expiresAt||
          e.statusUri!=='/ssh-stays/operations/'+op.operationId)return s;
        return {...s,phase:['read-only','unconfirmed'].includes(s.phase)?s.phase:'pending',operation:{...op,admission:'accepted',statusUri:e.statusUri},message:'Queued; waiting for the TV to confirm'};
      case 'PENDING':
        if(!op)return s;
        return {...s,phase:['read-only','unconfirmed'].includes(s.phase)?s.phase:'pending',message:'Queued; waiting for the TV to confirm'};
      case 'UNCONFIRMED':
        if(!op)return s;
        return {...s,phase:s.phase==='read-only'?'read-only':'unconfirmed',message:'The update could not be confirmed. Retry checks the same update.'};
      case 'TIMEOUT':
        if(!op)return {...s,phase:s.phase==='dirty'?'dirty':'error',message:'Automatic retry stopped'};
        return {...s,phase:['read-only','unconfirmed'].includes(s.phase)?s.phase:op.admission==='accepted'?'pending':'verifying',
          message:op.admission==='accepted'?'Queued; waiting for the TV to confirm. Automatic retry stopped.':'The update could not be confirmed. Automatic retry stopped.'};
      case 'BUSY':
        if(!op)return {...s,message:'Another update is waiting for the TV. Your draft is preserved.'};
        if(e.admitted===false&&e.operationId===op.operationId&&op.admission==='unknown'&&s.phase==='sending')
          return {...s,phase:'error',operation:{...op,admission:'rejected'},message:e.code==='STORE_WRITE_FAILED'?'The gateway could not store this update. It was not admitted. Retry keeps the same draft and operation.':'Another update is waiting for the TV. Your draft is preserved. Retry when it finishes.'};
        return {...s,message:'The TV has another pending update. This update still needs reconciliation.'};
      case 'NOT_APPLIED':
        return op?{...s,phase:['read-only','unconfirmed'].includes(s.phase)?s.phase:op.admission==='accepted'?'pending':s.phase,message:'The TV was busy. Retry checks this same update.'}:s;
      case 'UNKNOWN_OUTCOME':
        if(!unknownResolutionMatches(s,e.body))return s;
        return {...s,phase:'unknown-review',confirmed:validateSnapshot(e.body.snapshot).value,unknownReview:copy(e.body.resolution),
          message:'Owner recovery is complete. The previous update outcome is still unknown. Compare the current TV list with your preserved draft.'};
      case 'ACKNOWLEDGE_UNKNOWN':
        if(s.phase!=='unknown-review'||!s.unknownReview||!unknownResolutionMatches(s,{code:'UNKNOWN_PRE_RECOVERY',operationId:op&&op.operationId,acceptance:'unknown',outcome:'unknown',resolution:s.unknownReview,snapshot:s.confirmed}))
          throw new Error('Completed recovery and current-state review are required');
        return {...s,phase:'conflict',operation:null,unknownReview:null,
          message:'The previous update outcome remains unknown. Review the current stays, then explicitly reapply and save any edits you still intend.'};
      case 'RECOVERY_REQUIRED':
        return {...s,phase:'read-only',confirmed:null,unknownReview:null,message:'Owner resolution is required. Your draft and pending update are preserved.'};
      case 'EPOCH_CONFLICT':
        if(e.receipt&&receiptMatches(s,e.receipt)&&e.receipt.outcome==='conflict'&&e.receipt.reason==='EPOCH_CONFLICT')
          return {...s,phase:'read-only',operation:null,confirmed:null,message:'The TV identity changed. Review the current TV before reapplying your draft.'};
        return {...s,phase:'read-only',confirmed:null,message:'The TV identity changed. Your pending update must be reconciled.'};
      case 'CONFLICT':
      case 'EXPIRED':
      case 'RECEIPT': {
        if(!receiptMatches(s,e.receipt))return s;
        const r=e.receipt;
        if(e.type==='RECEIPT'&&r.outcome!=='committed'||e.type==='CONFLICT'&&(r.outcome!=='conflict'||r.reason!=='REVISION_CONFLICT')||
          e.type==='EXPIRED'&&r.outcome!=='expired')return s;
        const checked=validateSnapshot(e.snapshot),snapshot=checked.ok?checked.value:null;
        if(r.outcome!=='committed')return {...s,phase:'conflict',operation:null,confirmed:snapshot,
          message:r.outcome==='expired'?'This update expired. Review the current TV before making a new save.':'The TV changed since this draft was opened. Review the current stays, then reapply your intended edits.'};
        if(!snapshot||snapshot.readOnly||snapshot.deviceEpoch!==r.deviceEpoch||snapshot.pending)
          return {...s,phase:'read-only',operation:null,confirmed:snapshot,draft:s.draft,
            message:resultMessage(r,snapshot)+'. Read and review the current TV before editing again.'};
        if(op.submitted===false)return {...s,phase:'conflict',operation:null,confirmed:snapshot,
          message:'The queued update was saved. Your separate draft is preserved. Review the current stays before reapplying it.'};
        return {...s,phase:'confirmed',operation:null,confirmed:snapshot||s.confirmed,draft:snapshot?copy(snapshot.stays):s.draft,
          baseline:snapshot?{deviceEpoch:snapshot.deviceEpoch,revision:snapshot.revision}:s.baseline,message:resultMessage(r,snapshot)};
      }
      case 'REAPPLY':
        if(op||!s.confirmed||s.confirmed.readOnly||s.confirmed.pending||!['conflict','read-only'].includes(s.phase))throw new Error('Current snapshot review is required');
        return {...s,phase:'dirty',baseline:{deviceEpoch:s.confirmed.deviceEpoch,revision:s.confirmed.revision},message:'Draft reapplied. Review it and save explicitly.'};
      case 'RETRY':
        return {...s,generation:s.generation+1,unknownReview:null,phase:s.phase==='read-only'?'read-only':op?'verifying':['dirty','conflict'].includes(s.phase)?s.phase:'loading',message:op?'Checking the same update':'Retrying the TV snapshot'};
      default: throw new Error('Unknown updater event');
    }
  }
  return Object.freeze({initialState,transition,validateSnapshot,receiptMatches});
});
