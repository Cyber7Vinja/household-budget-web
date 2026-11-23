(()=>{'use strict';
const $=s=>document.querySelector(s);
const note=$('#authNote'), errorBox=$('#authError'), fields=$('#loginFields'), membership=$('#householdFields');
let client=null, busy=false;
const fail=(text)=>{errorBox.textContent=text||''};
const setNote=text=>{note.textContent=text};
function working(value){busy=value;for(const b of document.querySelectorAll('#authScreen button'))b.disabled=value}
function showEntry(){window.showLogin?.();fields.hidden=false;membership.hidden=true}
function showHousehold(email){window.showLogin?.();fields.hidden=true;membership.hidden=false;setNote('Signed in as '+email+'. Create a new household or join one with an invitation code.');}
async function loadBudget(){
 if(!client)return;
 const {data:{user},error:authError}=await client.auth.getUser();
 if(authError||!user){showEntry();return}
 working(true);fail('');
 try{
  const member=await client.from('household_members').select('household_id,role').eq('user_id',user.id).maybeSingle();
  if(member.error)throw Error(member.error.message);
  if(!member.data){showHousehold(user.email||'household member');return}
  const result=await client.from('budgets').select('revision,state').eq('household_id',member.data.household_id).single();
  if(result.error)throw Error(result.error.message);
  window.showBudget({household:member.data.household_id,role:member.data.role,state:result.data.state,remoteRevision:result.data.revision,email:user.email||''});
 }catch(err){window.showLogin?.();setNote('We could not open your private household budget.');fail(err.message||'Something went wrong.');}
 finally{working(false)}
}
window.loadHouseholdBudget=loadBudget;
async function signin(e){e.preventDefault();if(!client)return;working(true);fail('');try{
  const email=$('#loginEmail').value.trim(), password=$('#loginPassword').value;
  if(!email||password.length<12)throw Error('Enter a valid email and a password of at least 12 characters.');
  const {error}=await client.auth.signInWithPassword({email,password});
  if(error)throw Error(error.message);
  await loadBudget();
 }catch(err){fail(err.message||'Sign-in failed.')}finally{working(false)}}
async function signup(){if(!client)return;working(true);fail('');try{
  const email=$('#loginEmail').value.trim(),password=$('#loginPassword').value;
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||password.length<12)throw Error('Enter a valid email and a password of at least 12 characters.');
  const {data,error}=await client.auth.signUp({email,password,options:{emailRedirectTo:location.origin}});
  if(error)throw Error(error.message);
  if(data.session){await loadBudget();return}
  setNote('Account request submitted. Check your email for a verification link, then sign in.');
 }catch(err){fail(err.message||'Could not create an account.')}finally{working(false)}}
async function createHousehold(){if(!client)return;working(true);fail('');try{
 const {error}=await client.rpc('create_household');
 if(error)throw Error(error.message);
 await loadBudget();
 }catch(err){fail(err.message||'Could not create household.')}finally{working(false)}}
async function joinHousehold(){if(!client)return;working(true);fail('');try{
 const code=$('#joinInvite').value.trim();if(code.length<20)throw Error('Paste a valid private invitation code.');
 const {error}=await client.rpc('redeem_invite',{invite_code:code});
 if(error)throw Error(error.message);
 $('#joinInvite').value='';await loadBudget();
 }catch(err){fail(err.message||'Could not join household.')}finally{working(false)}}
$('#authForm').addEventListener('submit',signin);
$('#signin').addEventListener('click',signin);
$('#signup').addEventListener('click',signup);
$('#createHousehold').addEventListener('click',createHousehold);
$('#redeemInvite').addEventListener('click',joinHousehold);
$('#gateLogout').addEventListener('click',()=>client?.auth.signOut());
const cfg=window.BUDGET_CONFIG||{};
if(!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(cfg.url||'')||!cfg.anonKey){
 fields.hidden=true; membership.hidden=true;
 setNote('Private database connection is not configured yet. The financial dashboard is intentionally unavailable until the administrator finishes setup.');
 fail('Setup incomplete — no budgeting information is publicly accessible.');
 return;
}
if(!window.supabase?.createClient){fields.hidden=true;setNote('Secure login component is unavailable. Reload or try another browser.');return}
client=window.supabase.createClient(cfg.url,cfg.anonKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
window.budgetDB=client;
client.auth.onAuthStateChange((event)=>{
 if(event==='SIGNED_OUT'){showEntry();setNote('Sign in to see your private household budget.');fail('')}
 if(event==='SIGNED_IN'||event==='INITIAL_SESSION'){Promise.resolve().then(()=>loadBudget())}
});
})();
