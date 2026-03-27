'use strict';
const App={
_data:null,_loading:false,
async loadData(){
  if(this._data)return this._data;
  if(this._loading)return new Promise(r=>setTimeout(()=>r(this.loadData()),60));
  this._loading=true;
  try{const resp=await fetch('data/subjects.json');if(!resp.ok)throw new Error('HTTP '+resp.status);this._data=await resp.json();}
  catch(e){console.warn('Data load failed:',e.message);this._data={subjects:[]};}
  this._loading=false;this._mergeAdminData();return this._data;
},
_mergeAdminData(){
  if(!this._data)return;
  
  // NEW: Load unified CMS data
  const cmsData = this._parseLS('vm_app_data', {subjects: [], teachers: [], content: {}});
  
  // Merge subjects from CMS
  if(cmsData.subjects?.length){
    cmsData.subjects.forEach(cs=>{
      if(!this._data.subjects.find(s=>s.id===cs.id)){
        this._data.subjects.push({
          id:cs.id||this._slug(cs.name),
          name:cs.name,
          nameHi:'',
          icon:cs.icon||'📖',
          description:cs.desc||'',
          chapters:cs.chapters||[],
          gradient:`linear-gradient(135deg,${cs.color||'#6C63FF'},#4F46E5)`,
          glow:'rgba(108,99,255,.1)',
          bg:'rgba(108,99,255,.07)',
          border:'rgba(108,99,255,.2)',
          color:cs.color||'#6C63FF'
        });
      }
    });
  }
  
  // Merge lesson-level content from CMS
  Object.entries(cmsData.content || {}).forEach(([lessonId, content]) => {
    const [sid, cid, lid] = lessonId.split('::');
    const subject = this._data.subjects.find(s => s.id === sid);
    const chapter = subject?.chapters?.find(c => c.id === cid);
    const lesson = chapter?.lessons?.find(l => l.id === lid);
    
    if(lesson && content){
      // Add videos to lesson
      if(content.videos?.length && !lesson.videos){
        lesson.videos = content.videos;
      }
      
      // Add notes to chapter (support PDF and Drive types)
      if(content.notes?.length && !chapter.notes){
        chapter.notes = content.notes.map(note => ({
          ...note,
          // Handle different note types
          content: note.text || note.pdf?.base64 || note.driveUrl,
          type: note.type || 'text',
          pdfName: note.pdf?.name,
          driveId: note.driveId
        }));
      }
      
      // Add quiz to chapter (support PDF and Drive types)
      if(content.quiz?.length && !chapter.quiz){
        chapter.quiz = content.quiz.map(quiz => ({
          ...quiz,
          // Handle different quiz types
          questions: quiz.questions || [{
            question: `Quiz PDF: ${quiz.pdf?.name || 'Google Drive Quiz'}`,
            options: ['View PDF', 'Back'],
            correctAnswer: 0,
            type: 'pdf'
          }],
          type: quiz.type || 'text',
          pdfName: quiz.pdf?.name,
          driveId: quiz.driveId
        }));
      }
    }
  });
  
  // Backward compatibility with old overrides system
  const ov=this._parseLS('vm_overrides',{});
  const ad=this._parseLS('vm_admin_data',{subjects:[],quiz:[],pdfs:[],ncertTopics:[],announcements:[],teachers:[],animations:[],images:[],activities:[]});
  this._data.subjects.forEach(s=>{
    s.chapters.forEach(ch=>{
      const key=`${s.id}::${ch.id}`,o=ov[key];if(!o)return;
      if(o.videoId&&ch.lessons?.length)ch.lessons[0].videoId=o.videoId;
      if(o.lesson0Title&&ch.lessons?.length)ch.lessons[0].title=o.lesson0Title;
      if(o.extraLessons?.length)ch.lessons=[...(ch.lessons||[]),...o.extraLessons];
      if(o.adminNote)ch._adminNote=o.adminNote;
      if(o.extraTopics?.length)ch.ncertTopics=[...(ch.ncertTopics||[]),...o.extraTopics];
      if(o.extraQuiz?.length)ch.quiz=[...(ch.quiz||[]),...o.extraQuiz];
      if(o.replaceQuiz?.length)ch.quiz=o.replaceQuiz;
      if(o.extraAnimations?.length)ch.animations=[...(ch.animations||[]),...o.extraAnimations];
      if(o.extraImages?.length)ch.images=[...(ch.images||[]),...o.extraImages];
      if(o.extraActivities?.length)ch.activities=[...(ch.activities||[]),...o.extraActivities];
    });
  });
  (ad.subjects||[]).forEach(cs=>{
    if(!this._data.subjects.find(s=>s.id===cs.id)){
      this._data.subjects.push({id:cs.id||this._slug(cs.name),name:cs.name,nameHi:'',icon:cs.icon||'📖',description:cs.desc||'',chapters:cs.chapters||[],gradient:`linear-gradient(135deg,${cs.color||'#6C63FF'},#4F46E5)`,glow:'rgba(108,99,255,.1)',bg:'rgba(108,99,255,.07)',border:'rgba(108,99,255,.2)',color:cs.color||'#6C63FF'});
    }
  });
},
saveOverride(sid,cid,patch){const ov=this._parseLS('vm_overrides',{});const key=`${sid}::${cid}`;ov[key]={...(ov[key]||{}),...patch};this._saveLS('vm_overrides',ov);this._data=null;},
getOverride(sid,cid){return(this._parseLS('vm_overrides',{}))[`${sid}::${cid}`]||{};},
_parseLS(k,def){try{return JSON.parse(localStorage.getItem(k)||'null')??def;}catch{return def;}},
_saveLS(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch{}},
_slug(s){return(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');},
getSubject(id){return(this._data?.subjects||[]).find(s=>s.id===id)||null;},
getChapter(sid,cid){return(this.getSubject(sid)?.chapters||[]).find(c=>c.id===cid)||null;},
getParam(k){return new URLSearchParams(location.search).get(k);},

// ====================================
// REAL-TIME SYNC FOR STUDENT APP
// ====================================

// Listen for real-time updates from admin
initRealTimeSync(){
  // Listen for storage events from admin
  window.addEventListener('storage', (e) => {
    if (e.key === 'vm_live_updates' && e.newValue) {
      const updates = JSON.parse(e.newValue);
      const latestUpdate = updates[updates.length - 1];
      if (latestUpdate) {
        this.handleAdminUpdate(latestUpdate);
      }
    }
  });
  
  // Check for pending updates on load
  const updates = JSON.parse(localStorage.getItem('vm_live_updates') || '[]');
  if (updates.length > 0) {
    const latestUpdate = updates[updates.length - 1];
    this.handleAdminUpdate(latestUpdate);
  }
},

// Handle admin updates
handleAdminUpdate(update){
  console.log('🔄 Student app received update:', update.type);
  
  // Show notification
  this.showUpdateNotification(`New ${update.type} available!`);
  
  // Clear data cache to force refresh
  this._data = null;
  
  // If currently viewing relevant content, refresh
  const currentPath = window.location.pathname;
  if (currentPath.includes('dashboard.html')) {
    // Refresh dashboard
    setTimeout(() => {
      this.initPage('dashboard');
    }, 1000);
  } else if (currentPath.includes('subject.html') || currentPath.includes('chapter.html')) {
    // Refresh current page
    setTimeout(() => {
      location.reload();
    }, 1000);
  }
},

// Show update notification to student
showUpdateNotification(message){
  const notification = document.createElement('div');
  notification.className = 'update-notification student-notification';
  notification.innerHTML = `
    <div class="notification-content">
      <span class="notification-icon">✨</span>
      <span class="notification-text">${message}</span>
      <button class="notification-close" onclick="this.parentElement.parentElement.remove()">×</button>
    </div>
  `;
  
  document.body.appendChild(notification);
  
  // Auto-remove after 4 seconds
  setTimeout(() => {
    if (notification.parentElement) {
      notification.remove();
    }
  }, 4000);
},
getProfile(){return this._parseLS('vm_profile',null);},
saveProfile(p){this._saveLS('vm_profile',p);},
hasProfile(){const p=this.getProfile();return!!(p?.name);},
showOnboarding(cb){
  const el=document.createElement('div');el.className='wall-overlay';el.id='obOverlay';
  let step=0,selSubj='',obName='',role='student';
  const subs=[{id:'mathematics',icon:'📐',name:'Mathematics'},{id:'science',icon:'🔬',name:'Science'},{id:'social-science',icon:'🌍',name:'Social Science'},{id:'english',icon:'📚',name:'English'}];
  const render=()=>{
    if(step===0){
      el.innerHTML=`<div class="wall-card ob-step">
        <span class="wall-icon">✨</span>
        <div class="wall-title">Welcome to Class 10Edu</div>
        <div class="wall-sub">Choose your role — we’ll personalise the experience.</div>
        <div class="ob-option${role==='student'?' picked':''}" data-role="student"><span class="ob-icon">🎓</span><span class="ob-label">Student</span><span class="ob-check">${role==='student'?'✓':''}</span></div>
        <div class="ob-option${role==='teacher'?' picked':''}" data-role="teacher"><span class="ob-icon">👨‍🏫</span><span class="ob-label">Teacher</span><span class="ob-check">${role==='teacher'?'✓':''}</span></div>
        <button class="btn btn-b" id="obR1" style="width:100%;justify-content:center;margin-top:12px">Continue →</button>
      </div>`;
      el.querySelectorAll('.ob-option').forEach(o=>o.addEventListener('click',()=>{role=o.dataset.role;render();}));
      el.querySelector('#obR1').addEventListener('click',()=>{step=1;render();});
      return;
    }
    if(step===1){
      el.innerHTML=`<div class="wall-card ob-step">
        <span class="wall-icon">👋</span>
        <div class="wall-title">Let’s set you up</div>
        <div class="wall-sub">Quick setup — 10 seconds.</div>
        <div class="fg"><label>Your Name</label><input class="fc" id="obName" placeholder="e.g. Arjun Sharma" maxlength="40" autocomplete="given-name" autofocus></div>
        <button class="btn btn-b" id="obN1" style="width:100%;justify-content:center;margin-top:4px">Continue →</button>
      </div>`;
      const inp=el.querySelector('#obName');
      setTimeout(()=>inp?.focus(),100);
      el.querySelector('#obN1').addEventListener('click',()=>{
        const v=VidyaSec.sanitize((inp?.value||'').trim());
        if(!v){inp?.focus();return;}
        obName=v;step=2;render();
      });
      inp?.addEventListener('keydown',e=>{if(e.key==='Enter')el.querySelector('#obN1')?.click();});
    } else {
      el.innerHTML=`<div class="wall-card ob-step">
        <span class="wall-icon">📚</span>
        <div class="wall-title">Hi, ${VidyaSec.sanitize(obName)}!</div>
        <div class="wall-sub">Pick your favourite subject — we'll show it first on your dashboard.</div>
        ${subs.map(s=>`<div class="ob-option${selSubj===s.id?' picked':''}" data-id="${s.id}"><span class="ob-icon">${s.icon}</span><span class="ob-label">${s.name}</span><span class="ob-check">${selSubj===s.id?'✓':''}</span></div>`).join('')}
        <button class="btn btn-b" id="obDone" style="width:100%;justify-content:center;margin-top:12px"${selSubj?'':' disabled'}>Start Learning →</button>
      </div>`;
      el.querySelectorAll('.ob-option').forEach(o=>o.addEventListener('click',()=>{selSubj=o.dataset.id;render();}));
      el.querySelector('#obDone')?.addEventListener('click',()=>{
        this.saveProfile({role,name:obName,favourite:selSubj,joinedAt:Date.now()});
        el.style.opacity='0';el.style.transition='opacity .3s';
        setTimeout(()=>{el.remove();if(cb)cb();},300);
      });
    }
  };
  document.body.appendChild(el);render();
},
/* Progress */
getProgress(){return this._parseLS('vm_prog',{});},
saveProgress(p){this._saveLS('vm_prog',p);},
_ep(p,sid){if(!p[sid])p[sid]={done:[],scores:{},last:null,watched:[]};},
markDone(sid,cid){const p=this.getProgress();this._ep(p,sid);if(!p[sid].done.includes(cid)){p[sid].done.push(cid);this.saveProgress(p);this.updateStreak();this.addPoints(15,'Chapter completed');this.checkAchievements();}},
saveScore(sid,cid,score,total){const p=this.getProgress();this._ep(p,sid);p[sid].scores[cid]={score,total,pct:Math.round(score/total*100),ts:Date.now()};this.saveProgress(p);const points=score>=total?30:score>=total*0.7?20:10;this.addPoints(points,`Quiz: ${score}/${total}`);this.checkAchievements();},
setLast(sid,cid,title){const p=this.getProgress();this._ep(p,sid);p[sid].last={cid,title,ts:Date.now()};this.saveProgress(p);},
markWatched(sid,cid,lid){if(!lid)return;const p=this.getProgress();this._ep(p,sid);const k=`${cid}::${lid}`;if(!p[sid].watched.includes(k)){p[sid].watched.push(k);this.saveProgress(p);this.addPoints(10,'Video lesson watched');this.checkAchievements();}},
getSubjPct(sid,subj){const p=this.getProgress()[sid]||{};return subj.chapters.length?Math.round(((p.done||[]).length/subj.chapters.length)*100):0;},
getBookmarks(){return this._parseLS('vm_bm',[]);},
toggleBookmark(s,c){const bm=this.getBookmarks(),k=`${s}::${c}`,i=bm.indexOf(k);if(i>=0)bm.splice(i,1);else bm.push(k);this._saveLS('vm_bm',bm);return i<0;},
isBookmarked(s,c){return this.getBookmarks().includes(`${s}::${c}`);},
updateStreak(){const today=new Date().toDateString(),last=localStorage.getItem('vm_sdate');let s=parseInt(localStorage.getItem('vm_streak')||'0');if(last!==today){s=(last===new Date(Date.now()-86400000).toDateString())?s+1:1;localStorage.setItem('vm_streak',s);localStorage.setItem('vm_sdate',today);}},

/* Gamification System */
getGamification(){return this._parseLS('vm_gamification',{points:0,level:1,badges:[],streak:0,lastStudyDate:null,studyTime:{},achievements:{firstLesson:false,weekStreak:false,quizMaster:false,dedicated:false,speedLearner:false}});},
saveGamification(g){this._saveLS('vm_gamification',g);},
addPoints(points,reason=''){const g=this.getGamification();g.points+=points;g.level=Math.floor(g.points/500)+1;this.saveGamification(g);this.showPointsAnimation(points,reason);this.checkAchievements();},
awardBadge(badgeId){const g=this.getGamification();if(!g.badges.includes(badgeId)){g.badges.push(badgeId);this.saveGamification(g);this.showBadgeAnimation(badgeId);return true;}return false;},
checkAchievements(){const g=this.getGamification();const p=this.getProgress();

// First Lesson Achievement
if(!g.achievements.firstLesson){const hasDoneLesson=Object.values(p).some(sp=>sp.done&&sp.done.length>0);if(hasDoneLesson){g.achievements.firstLesson=true;this.awardBadge('first-steps');}}

// Week Streak Achievement
if(!g.achievements.weekStreak&&g.streak>=7){g.achievements.weekStreak=true;this.awardBadge('on-fire');}

// Quiz Master Achievement
if(!g.achievements.quizMaster){let highScores=0;Object.values(p).forEach(sp=>{if(sp.scores)Object.values(sp.scores).forEach(s=>{if(s.pct>=90)highScores++;});});if(highScores>=5){g.achievements.quizMaster=true;this.awardBadge('quiz-master');}}

// Dedicated Achievement
if(!g.achievements.dedicated){Object.values(p).forEach(sp=>{if(sp.done&&sp.done.length>=sp.totalChapters){g.achievements.dedicated=true;this.awardBadge('dedicated');}});}

this.saveGamification(g);},
trackStudyTime(subjectId,chapterId,minutes){const g=this.getGamification();if(!g.studyTime[subjectId])g.studyTime[subjectId]={};if(!g.studyTime[subjectId][chapterId])g.studyTime[subjectId][chapterId]=0;g.studyTime[subjectId][chapterId]+=minutes;this.saveGamification(g);},
showPointsAnimation(points,reason){const toast=document.getElementById('appToast')||this.createToast();toast.innerHTML=`<span style="font-size:20px;margin-right:8px">✨</span><span>+${points} points</span><div style="font-size:0.8rem;opacity:0.8">${reason}</div>`;toast.classList.add('show','points-animation');clearTimeout(toast._t);toast._t=setTimeout(()=>toast.classList.remove('show','points-animation'),3000);},
showBadgeAnimation(badgeId){const badges={
  'first-steps':{icon:'🌟',name:'First Steps',desc:'Completed your first lesson'},
  'on-fire':{icon:'🔥',name:'On Fire',desc:'7-day study streak'},
  'quiz-master':{icon:'🧠',name:'Quiz Master',desc:'Scored 90%+ in 5 quizzes'},
  'dedicated':{icon:'📚',name:'Dedicated',desc:'Completed entire subject'},
  'speed-learner':{icon:'⚡',name:'Speed Learner',desc:'Completed 3 chapters in one day'}
};
const badge=badges[badgeId];if(!badge)return;
const toast=document.getElementById('appToast')||this.createToast();toast.innerHTML=`<span style="font-size:24px;margin-right:8px">${badge.icon}</span><span>Badge Unlocked!</span><div style="font-size:0.9rem;font-weight:700">${badge.name}</div><div style="font-size:0.8rem;opacity:0.8">${badge.desc}</div>`;toast.classList.add('show','badge-animation');clearTimeout(toast._t);toast._t=setTimeout(()=>toast.classList.remove('show','badge-animation'),4000);},
createToast(){let t=document.getElementById('appToast');if(!t){t=document.createElement('div');t.id='appToast';t.className='toast';t.setAttribute('role','alert');document.body.appendChild(t);}return t;},
/* Study Time Tracking */
startStudySession(subjectId, chapterId){
  if(this.studySession){
    this.endStudySession();
  }
  this.studySession = {
    subjectId,
    chapterId,
    startTime: Date.now(),
    startTimestamp: new Date().toISOString()
  };
},
endStudySession(){
  if(!this.studySession) return;
  const duration = Math.round((Date.now() - this.studySession.startTime) / 60000); // minutes
  if(duration >= 1){ // Only count sessions of 1 minute or more
    this.trackStudyTime(this.studySession.subjectId, this.studySession.chapterId, duration);
    if(duration >= 10){ // Bonus points for longer sessions
      const bonusPoints = Math.floor(duration / 10) * 5;
      this.addPoints(bonusPoints, `Study session: ${duration} minutes`);
    }
  }
  this.studySession = null;
},
getStudyTimeStats(){
  const g = this.getGamification();
  let totalMinutes = 0;
  let sessionCount = 0;
  Object.values(g.studyTime).forEach(subject => {
    Object.values(subject).forEach(minutes => {
      totalMinutes += minutes;
      sessionCount += minutes >= 1 ? 1 : 0;
    });
  });
  return {
    totalMinutes,
    totalHours: Math.round(totalMinutes / 60 * 10) / 10,
    sessionCount,
    averageSession: sessionCount > 0 ? Math.round(totalMinutes / sessionCount) : 0
  };
},
applyMode(){document.documentElement.setAttribute('data-mode',localStorage.getItem('vm_mode')||'light');},
setMode(m){document.documentElement.setAttribute('data-mode',m);localStorage.setItem('vm_mode',m);document.querySelectorAll('.mt-btn').forEach(b=>b.classList.toggle('active',b.dataset.mode===m));const btn=document.getElementById('modeBtn');if(btn)btn.innerHTML=m==='dark'?'☀️':'🌙';},
toggleMode(){this.setMode((localStorage.getItem('vm_mode')||'light')==='dark'?'light':'dark');},
setScheme(s){document.documentElement.setAttribute('data-scheme',s);localStorage.setItem('vm_scheme',s);App.toast('Theme updated');},
/* Ads */
isFocus(){return localStorage.getItem('vm_focus')==='1';},
adNative(slot){
  if(this.isFocus()) return '';
  const ads={
    dashboard:{logo:'📘',title:'Unlock full mock papers',desc:'500+ CBSE Board questions with detailed solutions',cta:'Try Free',href:'#'},
    subjects:{logo:'🎯',title:'Personalised study plans',desc:'Expert teachers · Adaptive learning · Board-focused',cta:'Learn More',href:'#'}
  };
  const ad=ads[slot]||ads.dashboard;
  return`<div class="ad-native"><div class="ad-logo">${ad.logo}</div><div class="ad-body"><div class="ad-title">${ad.title}</div><div class="ad-desc">${ad.desc}</div></div><a href="${ad.href}" class="ad-cta" target="_blank" rel="noopener sponsored">${ad.cta}</a></div>`;
},
adBanner(){
  if(this.isFocus()) return '';
  return`<div class="ad-banner"><div class="ad-banner-icon">🏆</div><div class="ad-banner-text"><div class="ad-banner-title">Previous Years' Board Papers</div><div class="ad-banner-sub">2015–2024 with full solutions — free to download</div></div><a href="#" class="ad-banner-btn" target="_blank" rel="noopener sponsored">View →</a></div>`;
},
/* Navbar */
navbarHTML(){
  const profile=this.getProfile();
  const name=VidyaSec.sanitize(profile?.name||'Student');
  const initials=name[0]?.toUpperCase()||'S';
  const site=VidyaSec.sanitize(localStorage.getItem('vm_site_name')||'Class 10Edu');
  const mode=localStorage.getItem('vm_mode')||'light';
  return `<nav class="topnav au-sig-scroll" id="mainNav">
    <button class="nav-ic mob-burger signature-button" onclick="App.toggleSidebar()" style="display:none">☰</button>
    <a href="dashboard.html" class="nav-brand">
      <div class="nav-gem">C</div>
      <div class="nav-wordmark">
        <span class="nav-title">${site}</span>
        <span class="nav-sub">Class 10 · Premium</span>
      </div>
    </a>
    <div class="nav-search">
      <span class="nav-sico">⌕</span>
      <input type="text" id="searchInput" placeholder="Search for chapters, topics..." autocomplete="off" oninput="App.doSearch(this.value)" onfocus="App.showSearch()" onblur="setTimeout(()=>App.hideSearch(),200)">
      <div class="search-drop" id="searchDrop"></div>
    </div>
    <div class="nav-right">
      <button class="nav-ic signature-button" onclick="App.toggleMode()" id="modeBtn" title="Toggle Appearance">${mode==='dark'?'☀️':'🌙'}</button>
      <button class="nav-ic signature-button" onclick="ThemeEngine.toggle()" title="Themes">🎨</button>
      <div class="user-pill signature-button" onclick="App._showProfileEdit()">
        <div class="user-av">${initials}</div>
        <span class="user-nm">${name}</span>
      </div>
    </div>
  </nav>`;
},
/* Sidebar */
sidebarHTML(active){
  const role = localStorage.getItem('vm_user_role') || 'student';
  const subs=[{id:'mathematics',name:'Math',icon:'📐'},{id:'science',name:'Science',icon:'🔬'},{id:'social-science',name:'SST',icon:'🌍'},{id:'english',name:'English',icon:'📚'}];
  
  let navLinks;
  if (role === 'teacher') {
    navLinks = `
      <div class="sb-lbl">Teacher Tools</div>
      <a href="dashboard.html" class="sb-link ${active==='dashboard'?'on':''}"><span class="sb-icon">🏠</span> Dashboard</a>
      <a href="question-papers.html" class="sb-link ${active==='question-papers'?'on':''}"><span class="sb-icon">✍️</span> Question Papers</a>
      <a href="admin.html" class="sb-link ${active==='admin'?'on':''}"><span class="sb-icon">⚙️</span> Content Admin</a>
    `;
  } else {
    navLinks = `
      <div class="sb-lbl">Learning Path</div>
      <a href="dashboard.html" class="sb-link ${active==='dashboard'?'on':''}"><span class="sb-icon">🏠</span> Dashboard</a>
      <a href="todo.html" class="sb-link ${active==='todo'?'on':''}"><span class="sb-icon">✅</span> Study Planner</a>
      <a href="bookmarks.html" class="sb-link ${active==='bookmarks'?'on':''}"><span class="sb-icon">🔖</span> Bookmarks</a>
    `;
  }

  return `<aside class="sidebar au-sig-scroll-1" id="sidebar">
    ${navLinks}
    <div class="sb-div"></div>
    <div class="sb-lbl">Subjects</div>
    ${subs.map(s=>`<a href="subject.html?id=${s.id}" class="sb-link ${active===s.id?'on':''}"><span class="sb-icon">${s.icon}</span> ${s.name}</a>`).join('')}
    <div class="sb-div"></div>
    <a href="#" onclick="App.logout()" class="sb-link" style="margin-top:auto; opacity:0.6"><span class="sb-icon">↩️</span> Sign Out</a>
  </aside>`;
},
/* Logout */
logout(){
  localStorage.removeItem('vm_user_role');
  window.location.href = 'login.html';
},
/* AI Assistant UI */
aiHTML(){
  return `<div class="ai-widget">
    <div class="ai-panel" id="aiPanel">
      <div class="ai-head">
        <div class="nav-gem" style="width:32px;height:32px;font-size:14px">AI</div>
        <div style="flex:1">
          <div style="font-size:0.9rem;font-weight:800">Study Assistant</div>
          <div style="font-size:0.65rem;opacity:0.8">Ask any doubt • Online</div>
        </div>
        <button onclick="App.toggleAI()" style="color:#fff;font-size:20px">×</button>
      </div>
      <div class="ai-body" id="aiBody">
        <div class="ai-msg bot">Hello! I'm your AI study partner. How can I help you today?</div>
      </div>
      <div class="ai-foot">
        <input type="text" class="ai-input" id="aiInp" placeholder="Ask a question..." onkeydown="if(e.key==='Enter')App.sendAI()">
        <button class="ai-btn" style="width:40px;height:40px;font-size:18px" onclick="App.sendAI()">→</button>
      </div>
    </div>
     <div class="ai-btn" onclick="App.toggleAI()">✨</div>
   </div>`;
 },
 /* Pomodoro Timer */
 timerHTML(){
   return `<div class="timer-widget au-4" id="timerWidget" style="position:fixed; bottom:32px; left:32px; z-index:1000">
     <div class="premium-card" style="padding:16px; display:flex; align-items:center; gap:16px; min-width:200px">
       <div style="font-size:24px">⏱️</div>
       <div style="flex:1">
         <div id="timerDisplay" style="font-size:1.2rem; font-weight:900; font-family:var(--mono)">25:00</div>
         <div style="font-size:0.65rem; font-weight:700; color:var(--ink-4); text-transform:uppercase">Focus Session</div>
       </div>
       <button class="btn btn-primary" id="timerBtn" style="width:40px; height:40px; padding:0; border-radius:12px" onclick="App.toggleTimer()">▶</button>
     </div>
   </div>`;
 },
 _timer: null,
 _timeLeft: 1500,
 toggleTimer(){
   const btn=document.getElementById('timerBtn'), disp=document.getElementById('timerDisplay');
   if(this._timer){
     clearInterval(this._timer); this._timer=null;
     btn.innerHTML='▶'; btn.style.background='var(--accent)';
   } else {
     btn.innerHTML='■'; btn.style.background='#EF4444';
     this._timer=setInterval(()=>{
       this._timeLeft--;
       if(this._timeLeft<=0){
         clearInterval(this._timer); this._timer=null;
         this.toast('Session Complete! Take a break. ☕');
         this._timeLeft=1500; btn.innerHTML='▶';
       }
       const m=Math.floor(this._timeLeft/60), s=this._timeLeft%60;
       disp.innerHTML=`${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
     },1000);
   }
 },
 toggleAI(){
  const p=document.getElementById('aiPanel');
  if(p) p.classList.toggle('open');
},
sendAI(){
  const inp=document.getElementById('aiInp'), body=document.getElementById('aiBody');
  if(!inp || !inp.value.trim()) return;
  const q=inp.value.trim();
  body.innerHTML+=`<div class="ai-msg user">${VidyaSec.sanitize(q)}</div>`;
  inp.value='';
  body.scrollTop=body.scrollHeight;

  // Show typing indicator
  const typingIndicator = document.createElement('div');
  typingIndicator.className = 'ai-msg bot typing';
  typingIndicator.innerHTML = '<span></span><span></span><span></span>';
  body.appendChild(typingIndicator);
  body.scrollTop=body.scrollHeight;

  setTimeout(()=>{
    // Remove typing indicator
    body.removeChild(typingIndicator);

    const responses = [
      "That's a great question! Let me think... based on your recent activity, I'd recommend reviewing the chapter on quadratic equations.",
      "Interesting query. Have you tried looking at the NCERT solutions for this topic? They often provide a different perspective.",
      "I can help with that. A key formula to remember here is a² + b² = c². This is fundamental to understanding the Pythagorean theorem.",
      "Let's break that down. First, consider the main characters and their motivations. What does the author want you to feel?",
      "I'm not sure I have the answer to that right now, but I can search for some resources for you. Would you like me to do that?",
      "Excellent question! This relates to the concept of chemical bonding. Have you reviewed the differences between ionic and covalent bonds recently?"
    ];
    const response = responses[Math.floor(Math.random() * responses.length)];

    body.innerHTML+=`<div class="ai-msg bot">${response}</div>`;
    body.scrollTop=body.scrollHeight;
  }, 2500);
},
/* Progress Ring Helper */
progressRingHTML(pct, size=64){
  const r=(size/2)-4, circ=2*Math.PI*r, off=circ-(pct/100*circ);
  return `<div class="progress-ring" style="width:${size}px;height:${size}px;position:relative">
    <svg width="${size}" height="${size}" class="progress-ring-svg">
      <circle class="progress-ring-bg" cx="${size/2}" cy="${size/2}" r="${r}"></circle>
      <circle class="progress-ring-fill" cx="${size/2}" cy="${size/2}" r="${r}" style="stroke-dasharray:${circ};stroke-dashoffset:${off}"></circle>
    </svg>
    <div class="progress-val" style="font-size:${size/4.5}px">${pct}%</div>
  </div>`;
},
/* Theme panel */
themeHTML(){
  const mode=localStorage.getItem('vm_mode')||'light';
  const focus=this.isFocus();
  return`<div class="slide-panel" id="themePanel">
    <div class="sp-head"><h3>🎨 Appearance</h3><button class="btn btn-gh btn-sm" onclick="ThemeEngine.toggle()">✕</button></div>
    <span class="sp-lbl">Colour Mode</span>
    <div class="mode-toggle">
      <div class="mt-btn ${mode==='light'?'active':''}" data-mode="light" onclick="App.setMode('light')">☀️ Light</div>
      <div class="mt-btn ${mode==='dark'?'active':''}" data-mode="dark" onclick="App.setMode('dark')">🌙 Dark</div>
    </div>
    <span class="sp-lbl">Focus Mode</span>
    <div class="gcard" style="padding:12px;margin-bottom:14px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
        <div>
          <div style="font-size:.82rem;font-weight:800;color:var(--ink);margin-bottom:2px">Distraction-free</div>
          <div style="font-size:.74rem;color:var(--ink-3);line-height:1.5">Hide ads and reduce non-essential prompts.</div>
        </div>
        <button class="btn ${focus?'btn-b':'btn-gh'} btn-sm" id="focusBtn" onclick="App.toggleFocus()">${focus?'On':'Off'}</button>
      </div>
    </div>
    <span class="sp-lbl">Extract from Photo</span>
    <div class="upload-drop" onclick="document.getElementById('themeFileInp').click()">
      <input type="file" id="themeFileInp" accept="image/*" style="display:none" onchange="ThemeEngine.handleUpload(event)">
      <div style="font-size:24px;margin-bottom:5px">🖼️</div>
      <p style="font-size:.82rem;color:var(--ink-3);font-weight:600;margin-bottom:2px">Upload any image</p>
      <span style="font-size:.72rem;color:var(--ink-4)">Colours extracted automatically</span>
    </div>
    <div id="themePreviewWrap" style="display:none">
      <img id="themePreviewImg" src="" alt="" style="width:100%;height:78px;object-fit:cover;border-radius:8px;margin-bottom:8px">
      <div class="swatches-row" id="swatchRow"></div>
      <button class="btn btn-b" style="width:100%;margin-bottom:6px" onclick="ThemeEngine.applyExtracted()">✨ Apply Colours</button>
      <button class="btn btn-gh" style="width:100%" onclick="ThemeEngine.reset()">↺ Reset</button>
    </div>
  </div>
  <div class="backdrop" id="themeBack" onclick="ThemeEngine.toggle()"></div>`;
},
toggleFocus(){
  const on=this.isFocus();
  localStorage.setItem('vm_focus', on?'0':'1');
  this.toast(on?'Focus mode off':'Focus mode on','🎯');
  // Soft refresh for ad slots & panels
  setTimeout(()=>location.reload(),250);
},
todoPanelHTML(){return`<div class="slide-panel" id="todoPanel"><div class="sp-head"><h3>✅ My Tasks</h3><button class="btn btn-gh btn-sm" onclick="TodoPanel.toggle()">✕</button></div><div id="todoPanelBody"></div></div><div class="backdrop" id="todoBack" onclick="TodoPanel.toggle()"></div>`;},
_showProfileEdit(){
  const profile=this.getProfile()||{};
  const ov=document.createElement('div');ov.className='wall-overlay';
  ov.innerHTML=`<div class="wall-card"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px"><div class="wall-title" style="font-size:1.2rem">Edit Profile</div><button class="btn btn-gh btn-sm" id="cpClose">✕</button></div><div class="fg"><label>Your Name</label><input class="fc" id="cpName" value="${VidyaSec.sanitize(profile.name||'')}" maxlength="40"></div><button class="btn btn-b" id="cpSave" style="width:100%;justify-content:center;margin-top:4px">Save</button></div>`;
  document.body.appendChild(ov);
  ov.querySelector('#cpClose').addEventListener('click',()=>ov.remove());
  ov.querySelector('#cpSave').addEventListener('click',()=>{
    const name=VidyaSec.sanitize((ov.querySelector('#cpName').value||'').trim());
    if(!name)return;
    this.saveProfile({...profile,name});ov.remove();
    const nb=document.getElementById('nb');if(nb)nb.innerHTML=this.navbarHTML();
    App.toast('Profile updated ✅');
  });
},
async doSearch(q){
  const drop=document.getElementById('searchDrop');if(!drop)return;
  const sq=q.trim();if(!sq){drop.classList.remove('open');return;}
  const data=await this.loadData();const lq=sq.toLowerCase(),res=[];
  data.subjects.forEach(s=>{
    if(s.name.toLowerCase().includes(lq))res.push({icon:s.icon,title:s.name,sub:`${s.chapters.length} chapters`,url:`subject.html?id=${s.id}`});
    s.chapters.forEach(ch=>{
      if(ch.title.toLowerCase().includes(lq))res.push({icon:'📄',title:ch.title,sub:s.name,url:`chapter.html?subject=${s.id}&chapter=${ch.id}`});
      (ch.lessons||[]).forEach(l=>{if(l.title.toLowerCase().includes(lq))res.push({icon:'▶️',title:l.title,sub:`${s.name} › ${ch.title}`,url:`chapter.html?subject=${s.id}&chapter=${ch.id}&lesson=${l.id}`});});
      (ch.ncertTopics||[]).forEach(t=>{if(t.text.toLowerCase().includes(lq))res.push({icon:'⭐',title:t.text.slice(0,55),sub:`${s.name} › ${ch.title}`,url:`chapter.html?subject=${s.id}&chapter=${ch.id}`});});
    });
  });
  drop.innerHTML=res.length?res.slice(0,9).map(r=>`<a class="sd-row" href="${r.url}"><div class="sd-ico">${r.icon}</div><div><div class="sd-title">${VidyaSec.sanitize(r.title)}</div><div class="sd-sub">${VidyaSec.sanitize(r.sub)}</div></div></a>`).join(''):`<div class="sd-row"><div class="sd-sub">No results for "${VidyaSec.sanitize(sq)}"</div></div>`;
  drop.classList.add('open');
},
showSearch(){const v=document.getElementById('searchInput')?.value;if(v)this.doSearch(v);},
hideSearch(){document.getElementById('searchDrop')?.classList.remove('open');},
toggleSidebar(){document.getElementById('sidebar')?.classList.toggle('open');document.getElementById('sbBack')?.classList.toggle('on');},
closeSidebar(){document.getElementById('sidebar')?.classList.remove('open');document.getElementById('sbBack')?.classList.remove('on');},
handleTouchStart(e){this._touchStartX=e.touches[0].clientX;this._touchStartY=e.touches[0].clientY;this._touchStartTime=Date.now();},
handleTouchEnd(e){if(!this._touchStartX)return;const endX=e.changedTouches[0].clientX;const endY=e.changedTouches[0].clientY;const deltaX=endX-this._touchStartX;const deltaY=Math.abs(endY-this._touchStartY);const deltaTime=Date.now()-this._touchStartTime;if(Math.abs(deltaX)>50&&deltaY<100&&deltaTime<300){if(deltaX>50){this.closeSidebar();}else if(deltaX<-50&&this._touchStartX<50){document.getElementById('sidebar')?.classList.add('open');document.getElementById('sbBack')?.classList.add('on');}}this._touchStartX=null;},
handleTouchMove(e){if(!this._touchStartX)return;const currentX=e.touches[0].clientX;const deltaX=currentX-this._touchStartX;const sidebar=document.getElementById('sidebar');if(sidebar&&sidebar.classList.contains('open')&&deltaX>0){const progress=Math.min(deltaX/280,1);sidebar.style.transform=`translateX(${-280+deltaX}px)`;}else if(sidebar&&!sidebar.classList.contains('open')&&this._touchStartX<50&&deltaX<0){const progress=Math.min(Math.abs(deltaX)/280,1);sidebar.style.transform=`translateX(${-280+Math.abs(deltaX)}px)`;}},
toast(msg,ico='✅'){let t=document.getElementById('appToast');if(!t){t=document.createElement('div');t.id='appToast';t.className='toast';t.setAttribute('role','alert');document.body.appendChild(t);}t.innerHTML=`<span>${ico}</span> ${VidyaSec.sanitize(msg)}`;t.classList.add('show');clearTimeout(t._t);t._t=setTimeout(()=>t.classList.remove('show'),3200);},
initPage(active){
  const role = localStorage.getItem('vm_user_role');
  if (!role && window.location.pathname.indexOf('login.html') === -1) {
    window.location.href = 'login.html';
    return;
  }

  this.applyMode();
  const nb=document.getElementById('nb'),sb=document.getElementById('sb');
  if(nb)nb.innerHTML=this.navbarHTML();
  if(sb)sb.innerHTML=this.sidebarHTML(active);
  document.body.insertAdjacentHTML('beforeend',this.themeHTML());
  document.body.insertAdjacentHTML('beforeend',this.todoPanelHTML());
  document.body.insertAdjacentHTML('beforeend',this.aiHTML());
  document.body.insertAdjacentHTML('beforeend',this.timerHTML());
  document.body.insertAdjacentHTML('beforeend',`<div class="backdrop" id="sbBack" onclick="App.toggleSidebar()"></div>`);
  ThemeEngine.init();TodoPanel.init();
  
  // Initialize signature animations
  setTimeout(() => this.initSignatureAnimations(), 100);
  
  // Mobile touch gestures
  if('ontouchstart' in window){
    document.addEventListener('touchstart', (e) => this.handleTouchStart(e), {passive: true});
    document.addEventListener('touchend', (e) => this.handleTouchEnd(e), {passive: true});
    document.addEventListener('touchmove', (e) => this.handleTouchMove(e), {passive: true});
  }
  
  // Close sidebar on escape key
  document.addEventListener('keydown', (e) => {
    if(e.key === 'Escape') this.closeSidebar();
  });
  
  // Prevent body scroll when sidebar is open on mobile
  const sidebar = document.getElementById('sidebar');
  if(sidebar){
    const observer = new MutationObserver(() => {
      if(sidebar.classList.contains('open')){
        document.body.style.overflow = 'hidden';
      } else {
        document.body.style.overflow = '';
        // Reset transform after animation
        sidebar.style.transform = '';
      }
    });
    observer.observe(sidebar, {attributes: true, attributeFilter: ['class']});
    
    // Add touch end listener to cleanup transform
    sidebar.addEventListener('touchend', () => {
      setTimeout(() => {
        if(!sidebar.classList.contains('open')) {
          sidebar.style.transform = '';
        }
      }, 300);
    });
  }
  
  // Initialize signature animations
  initSignatureAnimations() {
    // Apply signature animations to cards
    document.querySelectorAll('.premium-card, .card-3d, .subj-card, .stat-card, .quick-act, .feat-card, .t-card').forEach((card, index) => {
      const className = `au-sig-scroll-${(index % 5) + 1}`;
      card.classList.add(className);
    });
    
    // Apply signature button classes
    document.querySelectorAll('.btn, .btn-sm, .btn-primary, .btn-secondary').forEach(btn => {
      if(!btn.classList.contains('signature-button')){
        btn.classList.add('signature-button');
      }
    });
    
    // Apply cinematic shimmer to loading elements
    document.querySelectorAll('.shimmer').forEach(el => {
      el.classList.add('cinematic-shimmer');
    });
    
    // Add depth glow to accent elements
    document.querySelectorAll('.glow').forEach(el => {
      el.classList.add('depth-glow');
    });
  }
  
  // Add ripple effect to buttons on mobile
  if('ontouchstart' in window){
    document.addEventListener('touchstart', (e) => {
      const btn = e.target.closest('.btn, .btn-sm, .btn-icon, .al-link, .stat-card, .quick-card, .content-type-card, .subj-card, .premium-card');
      if(btn && !btn.classList.contains('no-ripple')){
        const rect = btn.getBoundingClientRect();
        const ripple = document.createElement('span');
        const size = Math.max(rect.width, rect.height);
        const x = e.touches[0].clientX - rect.left - size/2;
        const y = e.touches[0].clientY - rect.top - size/2;
        
        ripple.style.cssText = `
          position: absolute;
          width: ${size}px;
          height: ${size}px;
          left: ${x}px;
          top: ${y}px;
          background: rgba(255,255,255,0.3);
          border-radius: 50%;
          transform: scale(0);
          animation: ripple 0.6s ease-out;
          pointer-events: none;
        `;
        
        btn.style.position = 'relative';
        btn.style.overflow = 'hidden';
        btn.appendChild(ripple);
        
        setTimeout(() => ripple.remove(), 600);
      }
    });
  }
  
  const m=localStorage.getItem('vm_mode')||'light';
  const btn=document.getElementById('modeBtn');if(btn)btn.innerHTML=m==='dark'?'☀️':'🌙';
  document.querySelectorAll('.mt-btn').forEach(b=>b.classList.toggle('active',b.dataset.mode===m));
}
};
