// In-memory protection only. The existing issue saver owns uploads and persistence.
export function initIssueDraft(){
  const form=document.getElementById('issueForm'),dialog=document.getElementById('issueLeaveDialog'),message=document.getElementById('issueLeaveMessage');
  const buttons=[...dialog.querySelectorAll('[data-issue-leave]')];
  let baseline=window.issueDraftSnapshot(),pending=false,working=false,unloadActive=false,lastField=null,decision=null;
  const snapshot=()=>JSON.stringify(window.issueDraftSnapshot());
  const dirty=()=>snapshot()!==JSON.stringify(baseline);
  function issueBeforeUnload(event){if(dirty()){event.preventDefault();event.returnValue='';}}
  function sync(){
    const changed=dirty();form.dataset.dirty=String(changed);
    if(changed!==unloadActive){window[changed?'addEventListener':'removeEventListener']('beforeunload',issueBeforeUnload);unloadActive=changed;}
    return changed;
  }
  function clean(){baseline=window.issueDraftSnapshot();sync();}
  form.addEventListener('focusin',event=>{lastField=event.target;});
  form.addEventListener('input',sync);form.addEventListener('change',sync);
  function run(action){
    if(pending||window.issueDraftBusy())return false;
    if(!sync()){
      pending=true;
      try{const result=action();if(result?.then)return result.finally(()=>{pending=false;sync();});pending=false;sync();return result;}
      catch(error){pending=false;sync();throw error;}
    }
    pending=true;
    const field=lastField?.isConnected?lastField:document.activeElement,position={x:scrollX,y:scrollY,start:field?.selectionStart,end:field?.selectionEnd};
    const restorePosition=()=>{if(field?.isConnected){field.focus({preventScroll:true});if(typeof position.start==='number'&&field.setSelectionRange)field.setSelectionRange(position.start,position.end);}scrollTo({left:position.x,top:position.y,behavior:'instant'});};
    message.textContent='';message.hidden=true;buttons.forEach(button=>button.disabled=false);
    dialog.showModal();document.getElementById('issueLeaveContinue').focus({preventScroll:true});
    return new Promise(resolve=>{
      const finish=result=>{decision=null;dialog.close();pending=false;working=false;sync();if(result===false)restorePosition();resolve(result);};
      decision=async choice=>{
        if(working)return;
        if(choice==='continue'){finish(false);return;}
        working=true;buttons.forEach(button=>button.disabled=true);dialog.setAttribute('aria-busy','true');
        try{
          if(choice==='save'){
            message.hidden=false;message.textContent='저장 중입니다…';
            if(!await window.submitIssueForm({stay:true})){
              message.textContent=document.getElementById('issueFeedback').textContent||'입력 내용과 사진을 확인한 뒤 다시 시도하세요.';
              working=false;buttons.forEach(button=>button.disabled=false);document.getElementById('issueLeaveContinue').focus();return;
            }
          }else await window.restoreIssueDraft(baseline);
          dialog.close();const result=await action();finish(result===false?false:true);
        }catch(error){if(!dialog.open){finish(false);window.showToast(error.message);}else{message.hidden=false;message.textContent=error.message;working=false;buttons.forEach(button=>button.disabled=false);}}
        finally{dialog.setAttribute('aria-busy',String(working));}
      };
    });
  }
  for(const button of buttons)button.onclick=()=>void decision?.(button.dataset.issueLeave);
  dialog.addEventListener('cancel',event=>{event.preventDefault();void decision?.('continue');});
  dialog.addEventListener('keydown',event=>{if(event.key==='Escape')event.stopPropagation();});
  window.HpmIssueDraft={run,clean,sync,isDirty:dirty,isPending:()=>pending,beforeUnloadActive:()=>unloadActive};
  clean();
}
