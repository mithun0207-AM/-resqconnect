import { createClient } from '@supabase/supabase-js';
import './style.css';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const configured = Boolean(SUPABASE_URL && SUPABASE_KEY &&
  !SUPABASE_URL.includes('YOUR-PROJECT') && !SUPABASE_KEY.includes('YOUR_SUPABASE'));

const supabase = configured ? createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  realtime: { params: { eventsPerSecond: 5 } }
}) : null;

let session = null;
let profile = null;
let incidents = [];
let volunteers = [];
let currentPage = 'home';
let channel = null;
let toastTimer;

const app = document.querySelector('#app');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dateText = value => new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
const statusClass = value => String(value || '').toLowerCase().replaceAll(' ','-');
const isAdmin = () => profile?.role === 'admin';

function toast(message, error=false) {
  let node = document.querySelector('.toast');
  if (!node) { node = document.createElement('div'); node.className='toast'; document.body.append(node); }
  node.textContent = message; node.classList.toggle('error', error); node.classList.add('show');
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>node.classList.remove('show'),3800);
}
function initials(name='Member') { return name.split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase(); }

function renderSetup() {
  app.innerHTML = `<main class="setup-wrap"><section class="setup-card"><div class="brand"><span class="brand-mark">R</span><span>ResQ<span>Connect</span></span></div><p class="eyebrow">SETUP REQUIRED</p><h1>Connect your secure project backend.</h1><p>ResQConnect uses Supabase for authentication, database storage and live incident updates. Add your own project URL and public anon/publishable key to a local <code>.env</code> file.</p><ol><li>Create a Supabase project.</li><li>Run the SQL in <code>supabase/migrations/001_init.sql</code>.</li><li>Copy the project URL and anon/publishable key into <code>.env</code>.</li><li>Restart the Vite server.</li></ol><div class="notice">Never put a Supabase <b>service_role</b> key in frontend code. This app must use only the public anon/publishable key with the supplied Row Level Security policies enabled.</div><a class="btn primary" href="https://supabase.com/dashboard" target="_blank" rel="noreferrer">Open Supabase dashboard ↗</a></section></main>`;
}

function renderAuth(mode='login') {
  const register = mode === 'register';
  app.innerHTML = `<main class="auth-layout"><section class="auth-art"><a class="brand inverse" href="#"><span class="brand-mark">R</span><span>ResQ<span>Connect</span></span></a><div class="art-copy"><p class="eyebrow">COMMUNITY SUPPORT NETWORK</p><h1>People helping<br><em>people.</em></h1><p>Report a non-life-threatening community issue, offer help, and follow verified updates in one shared space.</p><div class="safety-mini">For immediate danger, call your local emergency services. ResQConnect is not an emergency dispatch service.</div></div></section><section class="auth-form-wrap"><form class="auth-form" id="authForm"><p class="eyebrow">${register?'JOIN THE NETWORK':'WELCOME BACK'}</p><h2>${register?'Create your account':'Sign in'}</h2><p class="muted">${register?'Create an account to report an issue or offer community support.':'Sign in to access your community response workspace.'}</p>${register?`<label>Full name<input name="full_name" required maxlength="70" autocomplete="name" placeholder="Your name"></label>`:''}<label>Email address<input name="email" type="email" required autocomplete="email" placeholder="you@example.com"></label><label>Password<input name="password" type="password" required minlength="8" autocomplete="${register?'new-password':'current-password'}" placeholder="At least 8 characters"></label>${register?`<label>I want to<select name="role"><option value="citizen">Report community issues</option><option value="volunteer">Offer volunteer support</option></select></label>`:''}<button class="btn primary full" type="submit">${register?'Create account':'Sign in'} →</button><p class="switch-auth">${register?'Already have an account?':'New to ResQConnect?'} <button type="button" class="text-btn" id="switchAuth">${register?'Sign in':'Create account'}</button></p><p class="auth-message" id="authMessage" role="status"></p></form></section></main>`;
  document.querySelector('#switchAuth').onclick=()=>renderAuth(register?'login':'register');
  document.querySelector('#authForm').onsubmit=async e=>{
    e.preventDefault(); const data=Object.fromEntries(new FormData(e.currentTarget)); const msg=document.querySelector('#authMessage');
    const submit=e.currentTarget.querySelector('button[type=submit]'); submit.disabled=true; msg.textContent='Please wait…';
    try {
      if(register){
        const {data:result,error}=await supabase.auth.signUp({email:data.email,password:data.password,options:{data:{full_name:data.full_name,requested_role:data.role}}});
        if(error) throw error;
        if(!result.session){msg.textContent='Account created. Check your email to confirm, then sign in.';submit.disabled=false;return;}
      } else {
        const {error}=await supabase.auth.signInWithPassword({email:data.email,password:data.password}); if(error) throw error;
      }
      await boot();
    } catch(err){msg.textContent=err.message;submit.disabled=false;}
  };
}

async function loadProfile() {
  const {data,error}=await supabase.from('profiles').select('id,full_name,role,created_at').eq('id',session.user.id).single();
  if(error) throw error; profile=data;
}
async function loadData() {
  const [i,v]=await Promise.all([
    supabase.from('incidents').select('*').order('created_at',{ascending:false}).limit(100),
    supabase.from('volunteer_profiles').select('id,user_id,display_name,skills,service_area,availability,created_at').order('created_at',{ascending:false}).limit(100)
  ]);
  if(i.error) throw i.error; if(v.error) throw v.error;
  incidents=i.data||[]; volunteers=v.data||[];
}
function subscribeRealtime() {
  if(channel) supabase.removeChannel(channel);
  channel=supabase.channel('resqconnect-live')
    .on('postgres_changes',{event:'*',schema:'public',table:'incidents'},async()=>{await refreshData(); if(currentPage==='home'||currentPage==='incidents'||currentPage==='admin') renderPage();})
    .on('postgres_changes',{event:'*',schema:'public',table:'volunteer_profiles'},async()=>{await refreshData(); if(currentPage==='volunteers') renderPage();})
    .subscribe();
}
async function refreshData() {
  const [i,v]=await Promise.all([supabase.from('incidents').select('*').order('created_at',{ascending:false}).limit(100),supabase.from('volunteer_profiles').select('*').order('created_at',{ascending:false}).limit(100)]);
  if(!i.error) incidents=i.data||[]; if(!v.error) volunteers=v.data||[];
}

function shell(content) {
  app.innerHTML=`<div class="app-shell"><aside class="sidebar" id="sidebar"><a class="brand inverse" href="#" data-page="home"><span class="brand-mark">R</span><span>ResQ<span>Connect</span><small>COMMUNITY RESPONSE</small></span></a><p class="side-label">WORKSPACE</p><nav>${[['home','▦','Overview'],['report','＋','Report an issue'],['incidents','◉','Incident board'],['volunteers','♧','Volunteer directory'],...(isAdmin()?[['admin','▥','Admin review']]:[])].map(([p,ic,t])=>`<button class="nav-link ${currentPage===p?'active':''}" data-page="${p}"><span>${ic}</span>${t}</button>`).join('')}</nav><div class="side-bottom"><div class="privacy-card"><i></i><b>Community workspace</b><p>Share only the information needed to coordinate support.</p></div><button class="nav-link" id="signOut"><span>↪</span> Sign out</button></div><small class="side-foot">RESQCONNECT · COMMUNITY MVP</small></aside><main class="main"><header class="topbar"><button class="mobile-menu" id="menu">☰</button><div><div class="crumb">Workspace / <b>${({home:'Overview',report:'Report an issue',incidents:'Incident board',volunteers:'Volunteers',admin:'Admin review'})[currentPage]}</b></div><small>${esc(profile.full_name)} · ${esc(profile.role)}</small></div><span class="live-label"><i></i> LIVE UPDATES</span><span class="user-chip">${esc(initials(profile.full_name))}</span></header><div class="content">${content}</div><footer class="footer">Community coordination prototype · Not an emergency service · <b>Call local emergency services for immediate danger.</b></footer></main></div>`;
  document.querySelectorAll('[data-page]').forEach(b=>b.addEventListener('click',e=>{e.preventDefault();go(b.dataset.page)}));
  document.querySelector('#signOut').onclick=async()=>{await supabase.auth.signOut();session=null;profile=null;renderAuth('login')};
  document.querySelector('#menu').onclick=()=>document.querySelector('#sidebar').classList.toggle('open');
}
function stat(label,value,desc,icon){return `<article class="stat"><div class="stat-head">${label}<span>${icon}</span></div><strong>${value}</strong><small>${desc}</small></article>`}
function incidentCard(x,admin=false){
  const own=x.reporter_id===session.user.id;
  const canUpdate=own||isAdmin();
  return `<article class="incident-card"><div class="card-top"><span class="tag">${esc(x.category)}</span><span class="priority ${esc(x.priority)}">${esc(x.priority)} priority</span></div><h3>${esc(x.title)}</h3><p>${esc(x.description)}</p><div class="incident-meta">⌖ ${esc(x.area)} · ${dateText(x.created_at)}</div><div class="card-bottom"><span class="status ${statusClass(x.status)}">${esc(x.status)}</span>${canUpdate?`<select class="status-change" data-id="${x.id}" aria-label="Update status"><option ${x.status==='Open'?'selected':''}>Open</option><option ${x.status==='In progress'?'selected':''}>In progress</option><option ${x.status==='Resolved'?'selected':''}>Resolved</option><option ${x.status==='Cancelled'?'selected':''}>Cancelled</option></select>`:`<span class="muted tiny">Community report</span>`}</div></article>`;
}
function homePage(){
 const open=incidents.filter(x=>['Open','In progress'].includes(x.status)).length;
 return `<section class="welcome"><div><p class="eyebrow">COMMUNITY RESPONSE NETWORK</p><h1>Welcome, ${esc(profile.full_name.split(' ')[0])}.</h1><p class="muted">See local community reports and coordinate safe, practical support.</p></div><button class="btn primary" data-go="report">＋ Report an issue</button></section><div class="stats-grid">${stat('COMMUNITY REPORTS',incidents.length,'Visible reports','◉')}${stat('NEEDING ATTENTION',open,'Open or in progress','⚑')}${stat('VOLUNTEERS',volunteers.length,'Registered volunteer profiles','♧')}${stat('RESOLVED',incidents.filter(x=>x.status==='Resolved').length,'Marked resolved','✓')}</div><div class="home-grid"><section class="panel"><div class="panel-heading"><div><h2>Recent community reports</h2><p>Updates appear automatically while you are online.</p></div><button class="link-btn" data-go="incidents">View all →</button></div><div class="report-list">${incidents.slice(0,5).map(x=>`<div class="report-row"><span class="report-icon">●</span><div><b>${esc(x.title)}</b><small>${esc(x.area)} · ${dateText(x.created_at)}</small></div><span class="status ${statusClass(x.status)}">${esc(x.status)}</span></div>`).join('')||'<p class="empty">No reports yet. You can submit the first community report.</p>'}</div></section><section class="panel"><div class="panel-heading"><div><h2>How ResQConnect works</h2><p>Simple, accountable community coordination.</p></div></div><div class="steps"><div><b>01</b><span><strong>Report</strong><small>Share a clear description and general area.</small></span></div><div><b>02</b><span><strong>Review</strong><small>Coordinators review reports before action.</small></span></div><div><b>03</b><span><strong>Coordinate</strong><small>Volunteers can offer appropriate support.</small></span></div><div><b>04</b><span><strong>Update</strong><small>Keep the community informed of status.</small></span></div></div></section></div><div class="safety-banner"><b>Safety first</b><span>Do not use this website for life-threatening emergencies. It does not dispatch responders or guarantee help. Contact official emergency services immediately when urgent assistance is needed.</span></div>`;
}
function reportPage(){return `<div class="page-title"><p class="eyebrow">SHARE A COMMUNITY ISSUE</p><h1>Report an issue</h1><p class="muted">Use this for non-life-threatening community support needs only.</p></div><div class="form-grid-layout"><form class="panel form-panel" id="reportForm"><label>Report title *<input name="title" required maxlength="90" placeholder="e.g. Fallen tree blocking a footpath"></label><div class="two-fields"><label>Category *<select name="category" required><option value="">Select category</option><option>Road / public obstruction</option><option>Community cleanup</option><option>Food / essential supplies</option><option>Accessibility support</option><option>Weather-related community issue</option><option>Other non-emergency</option></select></label><label>Priority *<select name="priority" required><option value="Low">Low</option><option value="Medium">Medium</option><option value="High">High</option></select></label></div><label>General area / landmark *<input name="area" required maxlength="120" placeholder="Neighbourhood or public landmark; avoid home addresses"></label><label>Description *<textarea name="description" required maxlength="700" rows="5" placeholder="What happened? What kind of non-emergency help is needed? Do not include phone numbers, medical records or other sensitive details."></textarea></label><label class="check-label"><input type="checkbox" name="consent" required> I confirm this is not a life-threatening emergency and I have not included sensitive personal information.</label><button class="btn primary" type="submit">Submit community report →</button><p class="form-message" id="reportMessage"></p></form><aside class="panel guidance"><h2>Before submitting</h2><ul><li>Use a general public area, not a private home address.</li><li>Do not post names, phone numbers, health details or photos of people.</li><li>Reports may be visible to signed-in members.</li><li>Do not approach hazards or put yourself at risk.</li></ul><div class="urgent"><b>Immediate danger?</b><p>Do not wait for a website response. Call your local emergency services.</p></div></aside></div>`}
function incidentsPage(){return `<div class="page-title"><p class="eyebrow">COMMUNITY WORK QUEUE</p><h1>Incident board</h1><p class="muted">Signed-in members can see approved community reports. Status changes are shared live.</p></div><div class="board-tools"><input id="searchReports" placeholder="Search title, category or area"><select id="filterStatus"><option>All statuses</option><option>Open</option><option>In progress</option><option>Resolved</option><option>Cancelled</option></select></div><div class="cards" id="incidentCards">${incidents.map(x=>incidentCard(x)).join('')||'<div class="panel empty">No reports available.</div>'}</div>`}
function volunteersPage(){return `<div class="page-title"><p class="eyebrow">OFFER COMMUNITY SUPPORT</p><h1>Volunteer directory</h1><p class="muted">Profiles are visible to signed-in members. Share only information you are comfortable making public.</p></div><div class="form-grid-layout"><form class="panel form-panel" id="volunteerForm"><h2>${volunteers.some(v=>v.user_id===session.user.id)?'Update your volunteer profile':'Create a volunteer profile'}</h2><label>Display name *<input name="display_name" required maxlength="70" value="${esc(volunteers.find(v=>v.user_id===session.user.id)?.display_name||profile.full_name)}"></label><label>Skills / support you can offer *<input name="skills" required maxlength="140" placeholder="e.g. translation, food distribution, tutoring"></label><label>General service area *<input name="service_area" required maxlength="100" placeholder="Neighbourhood or broad area"></label><label>Availability<select name="availability"><option>Available</option><option>Unavailable</option></select></label><button class="btn primary" type="submit">Save volunteer profile →</button><p class="form-message" id="volunteerMessage"></p></form><section class="panel"><h2>Community volunteers</h2><p class="muted">Only opted-in profiles are shown.</p><div class="volunteer-list">${volunteers.map(v=>`<div class="volunteer-row"><span class="avatar">${esc(initials(v.display_name))}</span><div><b>${esc(v.display_name)}</b><small>${esc(v.skills)} · ${esc(v.service_area)}</small></div><span class="status ${v.availability==='Available'?'resolved':'cancelled'}">${esc(v.availability)}</span></div>`).join('')||'<p class="empty">No volunteer profiles yet.</p>'}</div></section></div>`}
function adminPage(){if(!isAdmin())return `<div class="panel empty">Admin access is restricted.</div>`;return `<div class="page-title"><p class="eyebrow">MODERATION WORKSPACE</p><h1>Admin review</h1><p class="muted">Review community reports and update their status. Admin role must be assigned securely in the database by the project owner.</p></div><div class="cards">${incidents.map(x=>incidentCard(x,true)).join('')||'<div class="panel empty">No reports to review.</div>'}</div>`}

function renderPage(){
 const pages={home:homePage,report:reportPage,incidents:incidentsPage,volunteers:volunteersPage,admin:adminPage};
 shell(pages[currentPage]()); bindPage();
}
function go(page){currentPage=page;renderPage()}
function bindPage(){
 document.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>go(b.dataset.go));
 const reportForm=document.querySelector('#reportForm');
 if(reportForm)reportForm.onsubmit=async e=>{
   e.preventDefault();const d=Object.fromEntries(new FormData(reportForm));
   const btn=reportForm.querySelector('button[type=submit]');btn.disabled=true;
   try{const {error}=await supabase.from('incidents').insert({reporter_id:session.user.id,title:d.title,category:d.category,priority:d.priority,area:d.area,description:d.description,status:'Open'});if(error)throw error;toast('Report submitted. It is now visible to signed-in members.');await refreshData();go('incidents');}
   catch(err){document.querySelector('#reportMessage').textContent=err.message;btn.disabled=false;}
 };
 const vf=document.querySelector('#volunteerForm');
 if(vf)vf.onsubmit=async e=>{
   e.preventDefault();const d=Object.fromEntries(new FormData(vf));
   try{const {error}=await supabase.from('volunteer_profiles').upsert({user_id:session.user.id,display_name:d.display_name,skills:d.skills,service_area:d.service_area,availability:d.availability},{onConflict:'user_id'});if(error)throw error;toast('Volunteer profile saved.');await refreshData();go('volunteers');}
   catch(err){document.querySelector('#volunteerMessage').textContent=err.message;}
 };
 const search=document.querySelector('#searchReports'),filter=document.querySelector('#filterStatus');
 const update=()=>{if(!search||!filter)return;const q=search.value.toLowerCase(),s=filter.value;const arr=incidents.filter(x=>(s==='All statuses'||x.status===s)&&[x.title,x.category,x.area].join(' ').toLowerCase().includes(q));document.querySelector('#incidentCards').innerHTML=arr.map(x=>incidentCard(x)).join('')||'<div class="panel empty">No matching reports.</div>';bindStatus();};
 if(search)search.oninput=update;if(filter)filter.onchange=update;bindStatus();
}
function bindStatus(){
 document.querySelectorAll('.status-change').forEach(sel=>sel.onchange=async()=>{
   const id=sel.dataset.id,value=sel.value;sel.disabled=true;
   try{const {error}=await supabase.from('incidents').update({status:value}).eq('id',id);if(error)throw error;await refreshData();renderPage();toast('Incident status updated for everyone online.');}
   catch(err){toast(err.message,true);sel.disabled=false;}
 });
}
async function boot(){
 if(!configured){renderSetup();return;}
 const {data:{session:s},error}=await supabase.auth.getSession();if(error)throw error;session=s;
 if(!session){renderAuth('login');return;}
 try{await loadProfile();await loadData();subscribeRealtime();renderPage();}
 catch(err){app.innerHTML=`<main class="setup-wrap"><section class="setup-card"><h1>Could not load your workspace</h1><p>${esc(err.message)}</p><p>Check that the SQL migration has been run and that your Supabase Row Level Security policies are enabled.</p><button class="btn primary" onclick="location.reload()">Retry</button></section></main>`;}
}
if(configured){
 supabase.auth.onAuthStateChange((_event,newSession)=>{if(newSession?.user.id!==session?.user.id){session=newSession;setTimeout(()=>boot(),0)}else if(!newSession){session=null;profile=null;renderAuth('login')}});
}
boot().catch(err=>{app.innerHTML=`<main class="setup-wrap"><section class="setup-card"><h1>Startup error</h1><p>${esc(err.message)}</p></section></main>`});