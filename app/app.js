/* ============================================================
   Aventura com Jesus — app navegável (vanilla). Estado em localStorage.
   ============================================================ */
const $  = (s,r=document)=>r.querySelector(s);
const elHdr=$('#hdr'), elScreen=$('#screen'), elOv=$('#overlay'),
      elMini=$('#mini'), elTab=$('#tabbar'), elToast=$('#toast');
const bgAudio=document.getElementById('bg-audio');

/* helper: monta animação Lottie (assets do zip); null se a lib não carregar */
function LOTTIE(el,path,loop=true,par='xMidYMid meet'){ if(window.lottie&&el){ try{ return lottie.loadAnimation({container:el,renderer:'svg',loop,autoplay:true,path,rendererSettings:{preserveAspectRatio:par}}); }catch(e){} } return null; }
/* áudio do player. Cada conteúdo pode ter um campo `audio` (URL da narração real).
   Se existir, toca essa narração; senão, mantém o background.mp3 (trilha ambiente em loop).
   Assim o dev só precisa preencher as URLs em data.js — sem mexer no player. */
const BG_TRACK='assets/sound/background.mp3';
let bgVol=.35, audioIsReal=false;
function setPlayerAudio(it){
  if(!bgAudio) return;
  const url=(it&&it.audio)?it.audio:BG_TRACK;
  audioIsReal=!!(it&&it.audio);
  // troca a fonte só quando muda (evita recarregar a trilha ambiente à toa)
  if(!(bgAudio.currentSrc||'').endsWith(url) && bgAudio.getAttribute('src')!==url){
    bgAudio.src=url; bgAudio.load();
  }
  bgAudio.loop=!audioIsReal;          // narração real não fica em loop; ambiente sim
  bgVol=audioIsReal?1:.35;
}
function playBg(){ try{ if(typeof noiseStop==='function') noiseStop(); }catch(e){} if(bgAudio){ bgAudio.volume=bgVol; bgAudio.play().catch(()=>{}); } }
function stopBg(){ if(bgAudio) bgAudio.pause(); }
function togglePlay(){ isPaused=!isPaused; if(isPaused){ if(bgAudio) bgAudio.pause(); } else { if(typeof noiseStop==='function') noiseStop(); if(bgAudio) bgAudio.play().catch(()=>{}); } updateMini(); }
function toggleRepeat(b){ if(!bgAudio) return; bgAudio.loop=!bgAudio.loop; if(b) b.classList.toggle('on',bgAudio.loop); toast(bgAudio.loop?'🔁 Repetir ligado':'Repetir desligado'); }

/* ---------------- estado ---------------- */
const LS='theoapp_v2';
const DEF={ profile:0, onboarded:false, names:{}, photos:{}, favs:[], ratings:{}, streak:1, week:[1,0,0,0,0,0,0],
  xp:0, level:1, coins:40, prev:null, missionsDone:[], doneToday:[], fedToday:0, colored:[], moodDone:false, outfit:null, decoration:null, dailyClaimed:null,
  lastDay:null, rewardDay:1, dailyClaimedDate:null, presenteDia6:false, trialStart:null, subscribed:false, notifLastDay:0, user:null, ent:null, xpV:0, novidade:0,
  settings:{ pet:true, lang:'Português', faith:'Não denominacional / Independente', dur:true, reminder:'20:00', music:'noise' } };
let state = load();
/* blindagem: localStorage corrompido (arrays/obj virando null) não pode derrubar render */
['favs','missionsDone','doneToday','colored','week'].forEach(k=>{ if(!Array.isArray(state[k])) state[k]=JSON.parse(JSON.stringify(DEF[k])); });
['ratings','names','photos'].forEach(k=>{ if(!state[k]||typeof state[k]!=='object') state[k]={}; });
/* MIGRAÇÃO da régua de nível (v1 linear xp/50 -> v2 curva). Roda uma vez só.
   ⚠️ O DEF traz xpV:0 DE PROPÓSITO — não 2. O load() faz {...DEF, ...salvo}, então
   se o default já fosse 2 todo save antigo herdaria o 2 e a migração nunca rodaria
   (foi exatamente o bug que o teste pegou: veterano Lv.20 ficava com 1000 XP numa
   régua que pede 3325). Pra quem é novo o bloco é inofensivo: nível 1 pede 0 XP.
   Sem isto, a criança que estava no Nível 20 acordaria no 10 — nível de criança
   NUNCA pode cair. Em vez de rebaixar, ELEVA o XP pro mínimo que a régua nova
   pede pro nível que ela já tem: mantém o número e deixa o próximo nível a uma
   distância normal, em vez de virar um muro. */
if(state.xpV !== 2){
  try{
    var _n = Math.max(1, state.level||1);
    var _alvo = _n<=1 ? 0 : 40*(_n-1) + 15*(_n-2)*(_n-1)/2;
    if((state.xp||0) < _alvo) state.xp = _alvo;
  }catch(_){ }
  state.xpV = 2;
}
/* nome REAL da criança (digitado pelos pais) sobrepõe o nome-exemplo do slot */
function pname(i){ return (state.names&&state.names[i]) || 'Meu pequeno'; }
function hasKid(i){ return !!(state.names&&state.names[i]); }
function activeKids(){ var a=[]; for(var i=0;i<PROFILES.length;i++) if(hasKid(i)) a.push(i); return a.length?a:[state.profile||0]; }
function cleanName(v){ return (v||'').replace(/["'<>]/g,'').replace(/\s+/g,' ').trim().slice(0,24); }
function load(){ try{ const s=JSON.parse(localStorage.getItem(LS)||'{}'); return {...DEF,...s, settings:{...DEF.settings,...(s.settings||{})}}; }catch{ return JSON.parse(JSON.stringify(DEF)); } }
function save(){
  try{ localStorage.setItem(LS, JSON.stringify(state)); }
  catch(e){   // storage cheio (geralmente fotos base64) — libera espaço e avisa, sem travar
    try{ state.photos={}; localStorage.setItem(LS, JSON.stringify(state)); toast('Memória cheia — as fotos foram removidas pra liberar espaço'); }
    catch(_){ toast('Não foi possível salvar (memória do aparelho cheia)'); }
  }
  try{ pushState(); }catch(_){}   // sync best-effort pro backend (NUNCA bloqueia/quebra o save local)
}

/* ===== SYNC com o BackendTheo (Railway) — dados do usuário ==============================
   Backend = fonte da verdade; localStorage = cache/fallback -> o app NUNCA cai por causa disto.
   Tudo best-effort (.catch, não-bloqueante). Protege usuário ativo: no 1o sync o dado LOCAL
   sobe pro servidor, jamais é apagado por um servidor vazio. Kill-switch: window.APP_API = "".  */
function _appApi(){ return ((typeof window!=='undefined' && window.APP_API) || '').replace(/\/$/,''); }
function _jwt(){ try{ return localStorage.getItem('theo_jwt')||''; }catch(_){ return ''; } }

async function appLogin(email, name){
  const api=_appApi(); if(!api || !email) return '';
  try{
    const r = await fetch(api+'/auth/app-login', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ email:(email||'').trim().toLowerCase(), name:name||'' }) });
    if(!r.ok) return '';
    const d = await r.json();
    if(d && d.token){ try{ localStorage.setItem('theo_jwt', d.token); }catch(_){} return d.token; }
  }catch(_){}
  return '';
}

async function pullState(){
  const api=_appApi(); if(!api || !_jwt()) return;
  try{
    const r = await fetch(api+'/me/profile', { headers:{ 'Authorization':'Bearer '+_jwt() } });
    if(!r.ok) return;                                    // 401/erro: mantém o local, não mexe em nada
    const d = await r.json();
    _sabemosOServidor = true;   // a partir daqui pode empurrar: sabemos o que existe la
    const srvTs   = (d && d.updatedAt) ? Date.parse(d.updatedAt) : 0;
    const srvData = (d && d.data && typeof d.data==='object') ? d.data : null;
    if(srvData && Object.keys(srvData).length && srvTs > (state._syncedAt||0)){
      // servidor MAIS NOVO -> adota (sincroniza de outro aparelho). Mantém fotos/user/ent locais.
      const keep = { photos: state.photos, user: state.user, ent: state.ent, _syncedAt: srvTs };
      state = { ...DEF, ...state, ...srvData, ...keep,
                settings: { ...DEF.settings, ...(state.settings||{}), ...(srvData.settings||{}) } };
      save(); if(typeof render==='function'){ try{ render(); }catch(_){} }
    } else {
      pushState(true);                                  // servidor vazio/velho -> sobe o LOCAL (protege usuário ativo)
    }
  }catch(_){}
}

/* TRAVA CONTRA APAGAR PROGRESSO (24/08).
   O boot chama save() ANTES do pullState, e save() agenda um push. Num navegador
   sem estado — que e exatamente o caso de quem adiciona o app a tela inicial no
   iPhone, porque o PWA tem armazenamento SEPARADO do Safari — esse push leva o
   estado VAZIO. Se o pull demorar mais que o debounce de 1,5s (cold start da
   Railway, 4G ruim), o vazio chega primeiro, sobrescreve o servidor, e o pull
   traz de volta o vazio que a gente mesmo mandou. O progresso da crianca some.
   Aconteceu de verdade com uma cliente em 24/08, logo depois de a gente comecar
   a recomendar "Adicionar a Tela de Inicio" pra quem tem iPhone.
   Agora nada sobe antes de sabermos o que o servidor tem. Se o pull falhar, o
   estado fica so no localStorage nesta sessao — nada se perde, so nao sincroniza. */
var _sabemosOServidor = false;

let _pushT;
function pushState(now){
  if(!_sabemosOServidor) return;   // nunca empurra antes de ler o servidor
  const api=_appApi(); if(!api || !_jwt()) return;
  clearTimeout(_pushT);
  const doIt = async ()=>{
    try{
      const data = { ...state }; delete data.photos; delete data._syncedAt;   // fotos ficam locais; _syncedAt é meta
      const r = await fetch(api+'/me/profile', { method:'PUT',
        headers:{ 'Authorization':'Bearer '+_jwt(), 'Content-Type':'application/json' },
        body: JSON.stringify({ data }) });
      if(!r.ok) return;
      const d = await r.json();
      if(d && d.updatedAt){ state._syncedAt = Date.parse(d.updatedAt); try{ localStorage.setItem(LS, JSON.stringify(state)); }catch(_){} }
    }catch(_){}
  };
  if(now) doIt(); else _pushT = setTimeout(doIt, 1500);   // debounce 1.5s (evita flood a cada moeda)
}
// Espera o sync (login+pull) assentar e SÓ ENTÃO roda cb (ex.: pedir o nome do filho).
// Assim não pergunta o nome antes do servidor devolver os dados. Teto de 4s: rede
// lenta/travada NUNCA segura o fluxo (cai no fallback local, igual antes).
function afterSync(p, cb){
  let done=false; const once=()=>{ if(done) return; done=true; try{ cb(); }catch(_){} };
  if(p && p.finally) p.finally(once); else Promise.resolve().then(once);
  setTimeout(once, 4000);
}
/* compressImage REMOVIDO: existia só pra encolher a foto tirada na câmera antes de virar
   base64 no localStorage. Sem upload de foto, virou código morto. */

/* ---------------- utils ---------------- */
let toastT;
/* O token {pao} vira o ícone da moeda. Montado com createTextNode/createElement e
   NUNCA com innerHTML: um dos toasts interpola o nome que a mãe digitou ("Que bom te
   ver, X!"), então parsear a mensagem como HTML seria abrir injeção pra economizar um
   ícone. Aqui o texto nunca é parseado — só o token conhecido vira elemento. */
function toast(msg){
  elToast.textContent='';
  String(msg).split('{pao}').forEach(function(parte, i){
    if(i){ var ic=document.createElement('i'); ic.className='pao'; elToast.appendChild(ic); }
    if(parte) elToast.appendChild(document.createTextNode(parte));
  });
  elToast.classList.add('show'); clearTimeout(toastT); toastT=setTimeout(()=>elToast.classList.remove('show'),1800);
}
/* evento nomeado de comportamento -> métrica AGREGADA no backend próprio (sem replay/gravação) */
function track(event, tagKey, tagVal){
  try{
    if(window.ANALYTICS_URL){ fetch(window.ANALYTICS_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event:event,tag:tagKey,val:tagVal,ts:Date.now()})}).catch(()=>{}); }
  }catch(_){}
}
/* compartilhamento real (folha nativa do celular) com fallback p/ copiar link */
function share(text){
  const data={ title:'Aventura com Jesus', text:(text?text+'\n\n':'')+'📖 Aventura com Jesus — histórias e fé para crianças.', url:location.href };
  if(navigator.share){ navigator.share(data).catch(()=>{}); }
  else if(navigator.clipboard){ navigator.clipboard.writeText(data.text+' '+data.url).then(()=>toast('🔗 Link copiado!')).catch(()=>toast('🔗 Compartilhar')); }
  else toast('🔗 Compartilhar');
}
const esc = s => (s||'').replace(/'/g,"&#39;");
/* escapa texto pra inserir com segurança no HTML (roteiros, etc.) */
const escHtml = s => (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

/* ÍCONES do app — SVG inline herdando currentColor (06/09/2026).
   Trocaram os emojis das telas cheias (nome da criança, primeiro passo, segunda
   chance, conclusão): emoji renderiza diferente em cada aparelho e some no meio
   de um layout escuro. SVG segue a cor do estado e o traço do resto do app. */
var ICONS = {
  balao:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.9 9.9 0 0 1-3.9-.8L3 21l1.9-4.4A8.2 8.2 0 0 1 3 11.5a8.4 8.4 0 0 1 9-8.4 8.4 8.4 0 0 1 9 8.4Z"/><path d="M9 10.5h.01M12 10.5h.01M15 10.5h.01"/></svg>',
  ok:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.2"/><path d="m8.2 12.3 2.6 2.6 5-5.4"/></svg>',
  coracao:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20.3s-7.3-4.6-7.3-9.6a4.2 4.2 0 0 1 7.3-2.8 4.2 4.2 0 0 1 7.3 2.8c0 5-7.3 9.6-7.3 9.6Z"/></svg>',
  pao:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 10.6c0-2.3 3.4-4.1 7.5-4.1s7.5 1.8 7.5 4.1c0 1-.6 1.6-1.3 2v4.3c0 1.3-2.8 2.3-6.2 2.3s-6.2-1-6.2-2.3v-4.3c-.7-.4-1.3-1-1.3-2Z"/><path d="M8.6 9.4c.5.7.5 1.7 0 2.4M12 9.2c.5.8.5 1.9 0 2.7M15.4 9.4c.5.7.5 1.7 0 2.4"/></svg>',
  festa:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4.2 19.8 8.6 8.4l7 7-11.4 4.4Z"/><path d="m13.2 6.2 1-2M17 8.9l2.2-1M17.9 13.1l2.3.5M15.3 3.6l.4 2.3"/></svg>',
  estrela:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3.6 2.6 5.3 5.8.85-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.85Z"/></svg>',
};

const typeLabel = t => (TYPES[t]?TYPES[t].label:t);
const isFav = id => state.favs.includes(id);
const heartSvg = on => `<svg class="hsvg" viewBox="0 0 24 24" fill="${on?'currentColor':'none'}" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="M12 20.3s-7-4.3-9.3-8.8C1.2 8.3 2.7 5.4 5.7 5.4c1.9 0 3.2 1.2 4.3 2.7C11.1 6.6 12.4 5.4 14.3 5.4c3 0 4.5 2.9 3 6.1C19 16 12 20.3 12 20.3z"/></svg>`;
/* capa: usa ilustração real (zip) quando item.img existe; senão emoji+gradiente */
const cov = it => it.img ? `<img class="coverimg" src="assets/img/${it.img}?v=19" alt="">` : it.emoji;

/* ---------------- header + tabs + router ---------------- */
const TABS=[
  ['today','Hoje','assets/img/ic_today_enable.webp'],
  ['explore','Explorar','assets/img/icon_explore_enable.webp'],
  ['theo','Davi','assets/img/ic_storybook.webp'],
  ['music','Música','assets/img/icon_music_enable.webp'],
  ['favs','Favoritos','assets/img/icon_favorites_enable.webp'],
];
let TAB='today';   // 1a abertura vai direto pra Home

function renderHeader(opts={}){
  if(opts.hide){ elHdr.style.display='none'; return; }
  elHdr.style.display='flex';
  const p=PROFILES[state.profile];
  elHdr.innerHTML=`
    <button class="prof" onclick="openProfile()"><span class="av">${avInner(state.profile)}</span>${escHtml(pname(state.profile))}</button>
    <div class="hr">
      ${opts.help?`<button class="ic" aria-label="Perguntas frequentes" onclick="openPetFaq()">?</button>`:''}
      <span class="streak" aria-label="${state.streak} dias de sequência">${state.streak} 🔥</span>
      <button class="ic ic-gear" aria-label="Ajustes" onclick="openSettings()"></button>
    </div>`;
}
function renderTabs(){ elTab.innerHTML=TABS.filter(([k])=>k!=='theo'||state.settings.pet).map(([k,l,i])=>`<button class="tab ${TAB===k?'on':''}" onclick="go('${k}')"><img class="ico icoW" src="${i}" alt="">${l}</button>`).join(''); }

function go(tab){ if(_locked){ showLockedScreen(); return; }   // assinatura inativa: nao navega
  TAB=tab; closeOverlays(); render(); track('navegou', 'tela', tab); }
function render(){
  renderTabs();
  try{ ({ today:screenToday, explore:screenExplore, theo:screenTheo, music:screenMusic, favs:screenFavs }[TAB])(); }
  catch(err){ console.error('render', err); elScreen.innerHTML='<div style="padding:48px 24px;text-align:center;color:var(--ink-soft,#fff)">Ops, algo deu errado ao abrir esta tela.<br>Toque em outra aba pra continuar.</div>'; }
  elScreen.classList.toggle('theo-screen', TAB==='theo');   // fundo azul só na tela do Davi
  elHdr.classList.toggle('theo-hdr', TAB==='theo');
  // o ambiente escolhido tinge a tela e o cabeçalho, não só o quadro do quarto
  [elScreen, elHdr].forEach(function(el){
    el.className = el.className.replace(/\s*deco-(?!fx\b)[a-z-]+/g,'');
    if(TAB==='theo') el.classList.add('deco-'+(state.decoration||'padrao'));
  });
  elScreen.scrollTop=0; updateMini();
}

/* ---------------- componentes de card ---------------- */
function fcard(item){
  const badge = item.badge ? `<span class="badge ${item.badge==='Novo'?'alt':''}">${item.badge}</span>` : `<span class="badge">Destaque</span>`;
  return `<button class="fcard" style="background:${item.grad}" onclick="openDetail('${item.id}')">
    <div class="cover">${cov(item)}</div><div class="scrim"></div>${badge}
    <div class="ti">${item.title}</div><div class="su">${esc(item.desc).slice(0,76)}…</div></button>`;
}
function mcard(m){
  const it=byId(m.id);
  return `<button class="mcard ${m.current?'cur':''}" onclick="openDetail('${m.id}')">
    <span class="rw">+${m.reward}</span>
    <div class="cv" style="background:${it.grad}">${cov(it)}</div>
    <div class="lb">${m.title}</div></button>`;
}
function tcard(item){
  return `<div class="tcard">
    <button class="heart ${isFav(item.id)?'on':''}" aria-label="${isFav(item.id)?'Remover dos favoritos':'Adicionar aos favoritos'}" onclick="toggleFav('${item.id}',this)">${heartSvg(isFav(item.id))}</button>
    ${item.premium?`<span class="lock"><img class="ico icoW lockico" src="assets/img/ic_locked.webp" alt="locked"></span>`:''}
    <button class="cv" style="background:${item.grad}" aria-label="Abrir ${esc(item.title)}" onclick="openDetail('${item.id}')">${cov(item)}</button>
    <div class="bd"><div class="ti">${item.title}</div><div class="ty">${typeLabel(item.type)}${state.settings.dur?` · ${item.dur}`:''}</div></div>
  </div>`;
}

/* card de SÉRIE (reusa o estilo do fcard) -> abre a lista de episódios */
function seriesCard(s){
  return `<button class="fcard" style="background:${s.grad}" onclick="openSeries('${s.id}')">
    <div class="cover">${cov(s)}</div><div class="scrim"></div><span class="badge alt">${s.badge}</span>
    <div class="ti">${s.title}</div><div class="su">${esc(s.desc).slice(0,70)}…</div></button>`;
}

/* ---------------- TODAY ---------------- */
function screenToday(){
  renderHeader();
  elScreen.innerHTML=`
    <h1 class="t">Hoje</h1>
    <div class="hscroll">${FEATURED.map(id=>fcard(byId(id))).join('')}</div>

    <div class="sec-t">Missões do Dia</div>
    <div class="hscroll">${MISSIONS.map(missionTodayCard).join('').replace(/\.webp"/g,'.webp?v=7"')}</div>

    ${state.settings.pet?`<div class="sec-t">Divirta-se com o Davi</div>
    <div class="funcard">
      <button class="fun-act" onclick="go('theo');setTimeout(openJoke,60)">
        <div class="fun-img"><img src="assets/img/mission_theater.webp?v=5" alt=""></div>
        <span class="fun-btn">Piada</span>
      </button>
      <button class="fun-act" onclick="go('theo')">
        <div class="fun-img"><img src="assets/img/pet_donkey.webp?v=13" alt=""></div>
        <span class="fun-btn">Brincar</span>
      </button>
    </div>`:''}

    <div class="verse-card">
      <div class="verse-ref">${BIBLE_VERSE.ref}</div>
      <div class="verse-text">${BIBLE_VERSE.text}</div>
      <button class="verse-share" onclick="share(BIBLE_VERSE.text+' — '+BIBLE_VERSE.ref)">⤴<span>Compartilhar</span></button>
    </div>

    <div class="sec-t">Recomendados</div>
    <div class="hscroll">${RECOMMENDED.map(recCard).join('')}</div>

    <div class="sec-t">Lançamentos</div>
    <div class="hscroll">${NEW_RELEASES.map(newCard).join('')}</div>

    <div class="sec-t">Séries</div>
    <div class="hscroll">${(typeof SERIES!=='undefined'?SERIES:[]).map(seriesCard).join('')}</div>

    <div class="sec-t">Melhores Vídeos · Escolha do Editor</div>
    <div class="hscroll">${CONTENT.filter(it=>it.video).filter((it,i,a)=>a.findIndex(x=>x.video===it.video)===i).map(tcard).join('')}</div>

    <div class="sec-t">Top 10 hoje no Brasil</div>
    <div class="hscroll top10">${TOP10_BR.map(top10Card).join('')}</div>

    <div class="streak-info">
      <div class="streak-card">
        <i class="streak-flame"></i>
        <div class="streak-txt">
          <div class="streak-n">${state.streak} <span>${state.streak===1?'dia':'dias'} seguidos</span></div>
          <div class="streak-d">Complete uma meditação todo dia pra aumentar sua sequência.</div>
        </div>
      </div>
    </div>`;
  initMissionAnims();
}

/* ============================================================
   Cards das novas seções da Today
   ============================================================ */
function missionTodayCard(m){
  const v=MISSION_VISUALS[m.id]||{label:m.title,emoji:'⭐'};
  const it=byId(m.id);
  const inner = v.anim
    ? `<div class="mtcard-anim" id="manim-${m.id}" data-anim="${v.anim}"></div>`
    : (v.img?`<img src="assets/img/${v.img}" alt="">`:`<span style="font-size:80px">${v.emoji}</span>`);
  // estrelinhas que brilham ao redor da bíblia (igual ao nativo)
  const sparkles = m.id==='gospel-0625'
    ? `<div class="mt-sparkles" aria-hidden="true">${[0,1,2,3,4].map(i=>`<span class="spk spk${i}">✦</span>`).join('')}</div>`
    : '';
  return `<button class="mtcard" onclick="openDetail('${m.id}')">
    <div class="mtcard-img">${inner}${sparkles}</div>
    <div class="mtcard-lb">${v.label}</div>
  </button>`;
}
/* inicia animações Lottie das missões (com fallback p/ imagem) */
function initMissionAnims(){
  document.querySelectorAll('.mtcard-anim').forEach(el=>{
    const inst=LOTTIE(el,'assets/anim/'+el.getAttribute('data-anim'));
    if(!inst){ const id=el.id.replace('manim-',''); const v=MISSION_VISUALS[id]||{};
      if(v.img) el.outerHTML=`<img src="assets/img/${v.img}?v=7" alt="">`; }
  });
}
/* abre o conteúdo do card (por id ou título); fallback toast se não existir */
function openCard(id,title){
  let it = id && byId(id);
  if(!it && title){ it = CONTENT.find(c=>c.title===title); }
  if(it) openDetail(it.id); else toast('▶ '+(title||''));
}
function recCard(r){
  const it=r.id&&byId(r.id);
  const ty=it?typeLabel(it.type):'Meditação';
  return `<button class="reccard" onclick="openCard('${r.id||''}','${esc(r.title)}')">
    <div class="reccard-img"><img src="assets/img/${r.img}" alt=""></div>
    <div class="reccard-bd"><div class="reccard-ti">${esc(r.title)}</div><div class="reccard-ty">${ty}</div></div>
  </button>`;
}
function newCard(n){
  return `<button class="newcard" onclick="openCard('${n.id||''}','${esc(n.title)}')">
    ${n.isNew?`<span class="badge-new">Novo</span>`:''}
    <div class="newcard-img"><img src="assets/img/${n.img}" alt=""></div>
    <div class="newcard-bd"><div class="newcard-ti">${esc(n.title)}</div><div class="newcard-ty">${n.kind}</div></div>
  </button>`;
}
function top10Card(t){
  return `<button class="topcard ${String(t.rank).length>1?'r2':''}" onclick="openCard('${t.id||''}','${esc(t.title)}')">
    <span class="topcard-rank">${t.rank}</span>
    <div class="topcard-img"><img src="assets/img/${t.img}" alt=""></div>
    <div class="topcard-bd"><div class="topcard-ti">${esc(t.title)}</div><div class="topcard-ty">${t.kind}</div></div>
  </button>`;
}

/* ---------------- EXPLORE ---------------- */
function screenExplore(){
  renderHeader();
  elScreen.innerHTML=`
    <h1 class="t">Explorar</h1>
    <div class="search"><img class="ico icoW" src="assets/img/icon_search.webp" alt=""><input placeholder="Buscar uma história" oninput="filterExplore(this.value)"></div>
    <button class="catbtn" onclick="window.openColorir&&window.openColorir()" aria-label="Abrir Colorir — pinte as figurinhas da Bíblia">
      <span class="cv"><img src="assets/img/cat_colorir.jpg?v=36" alt=""></span>
      <span class="ti">Colorir</span>
    </button>
    <div id="exp-list">${CATEGORIES.map(c=>`
      <button class="catbtn" onclick="openCategory('${c.slug}')">
        <span class="cv">${c.img?`<img src="assets/img/${c.img}?v=36" alt="">`:c.emoji}</span>
        <span class="ti">${c.title}</span>
      </button>`).join('')}</div>`;
}
function filterExplore(q){
  q=q.trim().toLowerCase();
  const box=$('#exp-list');
  if(!q){ screenExplore(); $('.search input').value=''; $('.search input').focus(); return; }
  const hits=CONTENT.filter(c=>c.title.toLowerCase().includes(q));
  box.innerHTML = hits.length
    ? `<div class="grid2">${hits.map(tcard).join('')}</div>`
    : `<p class="muted" style="text-align:center;margin-top:30px">Nenhum resultado para “${escHtml(q)}”.</p>`;
}
function openCategory(slug){
  const c=CATEGORIES.find(x=>x.slug===slug);
  const items=(c.slug==='videos'?CONTENT.filter(x=>x.video).filter((x,i,a)=>a.findIndex(y=>y.video===x.video)===i):CONTENT.filter(x=>x.type===c.type));
    elOv.style.display='block';
  elOv.innerHTML=`<div class="ov"><div class="ovtop"><button class="iconbtn" aria-label="Voltar" onclick="closeOverlays()">‹</button><b>${c.title}</b><span style="width:40px"></span></div>
    <div class="body" style="padding:0 16px 90px">
      <p class="muted" style="margin:4px 2px 14px">${c.desc}</p>
      <div class="grid2">${items.map(tcard).join('')}</div>
    </div>
    <button class="surprise-btn" onclick="surpriseCategory('${slug}')"><img src="assets/img/ic_storybook.webp" class="ico" alt="">Surpreenda-me</button></div>`;
}
function surpriseCategory(slug){
  const c=CATEGORIES.find(x=>x.slug===slug);
  const items=(c.slug==='videos'?CONTENT.filter(x=>x.video).filter((x,i,a)=>a.findIndex(y=>y.video===x.video)===i):CONTENT.filter(x=>x.type===c.type));
  if(!items.length) return;
  const pick=items[Math.floor(Math.random()*items.length)];
  openDetail(pick.id);
}

/* ---------------- DAVI (pet) ---------------- */
function screenTheo(){
  renderHeader({help:true});
  const lv=progressoNivel();
  elScreen.innerHTML=`
    <div class="petscene deco-${state.decoration||'padrao'}">
      <div class="deco-fx room-${state.decoration||'padrao'}"></div>
      <div class="hdr-blend"></div>
      <div class="room-window"></div>
      <div class="room-floor"></div>
      <div class="scene-fx" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
      <span class="frame">🖼️</span><span class="gift" role="button" tabindex="0" aria-label="Recompensas diárias" onclick="openDailyRewards()"><span class="gift-ring"></span></span>
      <div class="pet-stage"><div class="pet-shadow"></div><img class="petimg" id="pet" src="assets/img/pet_donkey.webp?v=13" alt="Davi" onclick="petPoke()"><div class="pet-wear"></div></div>
      <div id="pet-bubble" class="pet-bubble" style="display:none"></div>
    </div>
    <div class="petbar" id="petbar">${PET_ITEMS.map((it,i)=>`<button class="it ${state.moodDone&&i===0?'done':''}" aria-label="${it.label}" onclick="petItemClick(${i},this)"><span class="it-ic">${it.img?`<img class="pet-ic" src="assets/img/${it.img}?v=13" alt="">`:it.emoji}${state.moodDone&&i===0?'<span class="dot-check">✓</span>':''}</span><span class="it-lb">${it.label}</span></button>`).join('')}</div>
    <div id="feedwrap" style="text-align:center;min-height:30px"></div>
    <div class="theo-prog">
      <div class="lvcard">
        <span class="lv-bolt">⚡</span>
        <b class="lv-num">Lv.${state.level}</b>
        <div class="lv-bar"><i style="width:${lv.pct}%"></i></div>
        <span class="lv-xp">${lv.feito}/${lv.custo} XP</span>
      </div>
      <div class="lv-coins"><i class="pao"></i> ${state.coins}</div>
    </div>
    <div class="sec-t">Missões do Dia</div>
    <div class="theo-missions">${MISSIONS.map(m=>{ const v=MISSION_VISUALS[m.id]||{label:m.title,emoji:'⭐'}; return `
      <button class="theo-mcard ${state.doneToday.includes(m.id)?'done':''}" onclick="openDetail('${m.id}')" aria-label="${v.label||m.title}">
        <span class="theo-mrw">+${m.reward} <i class="pao"></i></span>${state.doneToday.includes(m.id)?'<span class="theo-mdone" aria-label="Conclu\u00edda">✓</span>':''}
        <div class="theo-mimg">${v.img?`<img src="assets/img/${v.img}?v=7" alt="">`:`<span>${v.emoji||'⭐'}</span>`}</div>
        <div class="theo-mlb">${v.label||m.title}</div>
      </button>`; }).join('')}</div>
    <div class="sec-t">Conheça o Davi</div>
    <div class="hscroll meet-scroll">${THEO_MEET.map(id=>{ const it=byId(id); if(!it) return ''; return `
      <div class="meetcard" role="button" tabindex="0" onclick="openDetail('${id}')" aria-label="${esc(it.title)}">
        <div class="meetcard-img" style="background:${it.grad}">${cov(it)}<button class="meetcard-heart" aria-label="${isFav(id)?'Remover dos favoritos':'Adicionar aos favoritos'}" onclick="event.stopPropagation();toggleFav('${id}',this)">${heartSvg(isFav(id))}</button></div>
        <div class="meetcard-ti">${it.title}</div>
        <div class="meetcard-ty">${typeLabel(it.type)}</div>
      </div>`; }).join('')}</div>`;
  startPetBlink();
  dressDonkey();   // veste o Davi com as roupas equipadas (state.worn)
}
/* burrinho pisca (troca pro frame de olhos fechados por ~150ms, em intervalos naturais)
   — só enquanto mostra o pet_donkey (não durante uma expressão de humor) */
let blinkT=null;
function petBlink(){
  const p=$('#pet');
  if(!p){ blinkT=null; return; }            // saiu da tela -> para
  const src=p.getAttribute('src')||'';
  if(/pet_donkey\.webp/.test(src)){
    // a maioria das vezes pisca; de vez em quando dá uma risadinha (igual ao idle do nativo)
    const giggle=Math.random()<0.28;
    const frame=giggle?'pet_donkey_talk.webp?v=1':'pet_donkey_blink.webp?v=1';
    p.setAttribute('src','assets/img/'+frame);
    setTimeout(()=>{ const pp=$('#pet'); if(pp && /blink|talk/.test(pp.getAttribute('src')||'')) pp.setAttribute('src',src); }, giggle?520:150);
  }
  blinkT=setTimeout(petBlink, 2800+Math.random()*3200);
}
function startPetBlink(){ clearTimeout(blinkT); blinkT=setTimeout(petBlink, 1800+Math.random()*1800); }
let foodSel=-1;
/* troca a expressão do burrinho (mood_*.webp) ou volta ao normal (null) */
function setPetFace(name){ const p=$('#pet'); if(!p) return;
  if(state.outfit){ p.setAttribute('src', petBaseSrc()); return; }   // vestido: mantém o traje, ignora expressões
  p.setAttribute('src', name?`assets/img/mood_${name}.webp?v=9`:'assets/img/pet_donkey.webp?v=13'); }
function petItemClick(i,btn){
  const item=PET_ITEMS[i];
  // sempre limpa seleção anterior
  $('#petbar').querySelectorAll('.it').forEach(b=>b.classList.remove('sel'));
  $('#feedwrap').innerHTML='';
  const p0=$('#pet'); if(p0) p0.classList.remove('eager','chew');
  if(item.action!=='feed') setPetFace(null);   // restaura cara normal ao sair do feed
  if(item.action==='mood'){ openMoodCheckin(); return; }
  if(item.action==='play'){ petPoke(); return; }   // pato = brincar (Davi reage/acena)
  if(item.action==='joke'){ openJoke(); return; }
  if(item.action==='outfits'){ openOutfitsPanel(); return; }
  if(item.action==='feed'){
    const resta = FEED_MAX_DIA - (state.fedToday||0);
    // o preço e o que resta aparecem NO botão: a criança precisa ver a regra antes de
    // tocar, não descobrir batendo num toast de erro.
    if(resta<=0){ toast('O Davi já comeu bastante hoje! {pao} Volte amanhã'); return; }
    if((state.coins||0) < FEED_CUSTO){ toast(`Faltam pãezinhos! Precisa de ${FEED_CUSTO} {pao}`); return; }
    btn.classList.add('sel'); foodSel=i;
    // burrinho fica ANSIOSO (boca aberta) esperando a comida — igual ao nativo
    const pet=$('#pet'); if(pet) pet.classList.add('eager');
    setPetFace('happy');
    // o ✕ vem ANTES do contador: o contador é display:block e quebraria a linha,
    // jogando o ✕ pra baixo do botão. "ainda pode 3x" em vez de "3 de 3", que se lê
    // como se as três já tivessem sido usadas.
    $('#feedwrap').innerHTML=`<button class="feed-btn" onclick="feedPet()">Alimentar · ${FEED_CUSTO} <i class="pao"></i></button>
      <button class="feed-cancel" aria-label="Cancelar" onclick="cancelFeed()">✕</button>
      <span class="feed-left">${resta===1 ? 'última de hoje' : `ainda pode ${resta}x hoje`}</span>`;
  }
}
function cancelFeed(){
  $('#petbar').querySelectorAll('.it').forEach(b=>b.classList.remove('sel'));
  $('#feedwrap').innerHTML=''; const pet=$('#pet'); if(pet) pet.classList.remove('eager','chew');
  setPetFace(null);
  foodSel=-1;
}
/* ===== ALIMENTAR — custa pão e tem teto diário ===================================
   Era +5 XP de graça, sem limite e sem cooldown: segurar o dedo no botão farmava XP
   infinito e a régua de nível não queria dizer nada. Agora custa 5 🥖 (a moeda do app
   É pãozinho — alimentar o burrinho sem gastar pão nunca fez sentido) e vale no máximo
   3x por dia, pra virar ritual em vez de tarefa repetitiva.
   Com as missões voltando a pagar, entra ~110 🥖/dia e sai 15 🥖/dia. */
const FEED_CUSTO = 5, FEED_MAX_DIA = 3;
function feedPet(){
  // as travas vêm ANTES de qualquer animação — senão o Davi mastiga e nada acontece
  if((state.fedToday||0) >= FEED_MAX_DIA){ cancelFeed(); toast('O Davi já comeu bastante hoje! {pao} Volte amanhã'); return; }
  if((state.coins||0) < FEED_CUSTO){ cancelFeed(); toast(`Faltam pãezinhos! Precisa de ${FEED_CUSTO} {pao}`); return; }
  $('#feedwrap').innerHTML=''; $('#petbar').querySelectorAll('.it').forEach(b=>b.classList.remove('sel'));
  const pet=$('#pet'); if(pet){ pet.classList.remove('eager'); pet.classList.add('chew'); }
  setPetFace('happy');                                  // mastigando, feliz
  state.coins-=FEED_CUSTO; state.fedToday=(state.fedToday||0)+1;
  toast(`O Davi ficou feliz! −${FEED_CUSTO} {pao}  +5 XP`); state.xp+=5; checkLevel(); save(); spawnFeedFx();
  setTimeout(()=>{ const p=$('#pet'); if(p){ p.classList.remove('chew'); p.classList.add('happy');
    setPetFace('relaxed'); setTimeout(()=>p&&p.classList.remove('happy'),500); } }, 950);  // satisfeito (olhos fechados)
  setTimeout(()=>{ if(TAB==='theo') screenTheo(); }, 1950);  // re-render: volta ao normal + atualiza XP + reinicia blink
}
/* ===== NÍVEL DO DAVI — régua v2 (curva) ==========================================
   Era `floor(xp/50)+1`: linear e infinito, cada nível custando o mesmo. Com isso
   qualquer entrada grande de XP virava vários níveis de uma vez — o Colorir inteiro
   dava 864 XP = 17 níveis, contra 0,6 nível/dia de quem faz as missões. O nível
   deixava de significar "vem todo dia".
   Agora cada nível custa mais que o anterior (40, 55, 70, 85...): absorve pico sem
   punir o hábito diário. Estas 4 funções são a ÚNICA fonte da régua — a barra, o
   rótulo e o colorir.js leem daqui (window.LV), ninguém mais divide por 50. */
function xpDoNivel(n){ return 40 + 15*(Math.max(1,n)-1); }                        // custo pra SAIR do nível n
function xpAcumulado(n){ return n<=1 ? 0 : 40*(n-1) + 15*(n-2)*(n-1)/2; }         // XP total pra ESTAR no nível n
function nivelPorXp(xp){ let n=1, acc=0;
  while(n<999){ const c=xpDoNivel(n); if(acc+c > (xp||0)) break; acc+=c; n++; } return n; }
function progressoNivel(){                                                        // {feito, custo, pct} do nível atual
  const n=state.level||1, base=xpAcumulado(n), custo=xpDoNivel(n);
  const feito=Math.max(0, Math.min(custo, (state.xp||0)-base));
  return { feito, custo, pct: custo ? Math.round(feito/custo*100) : 0 };
}
window.LV = { xpDoNivel, xpAcumulado, nivelPorXp, progressoNivel };                // o colorir.js consome isto
function checkLevel(){ const nl=nivelPorXp(state.xp); if(nl>state.level){ state.level=nl; toast(`🎉 O Davi subiu pro Nível ${nl}!`);} }
/* —— BRINCAR: várias reações do Davi + estrelinhas em CSS (sem emoji) —— */
const PLAY_MOVES=['hop','wiggle','bounce','tilt'];
const PLAY_LINES=['Vamos brincar!','Eba!','De novo, de novo!','Que divertido!','Hihihi!','Mais uma vez!'];
let playIdx=0;
function petPoke(){
  const stage=document.querySelector('.pet-stage'), p=$('#pet'); if(!stage||!p) return;
  if(stage.classList.contains('playing')) return;                      // já está reagindo
  const dressed=!!state.outfit;
  const open=dressed?petBaseSrc():(/pet_donkey\.webp/.test(p.getAttribute('src')||'')?p.getAttribute('src'):'assets/img/pet_donkey.webp?v=13');
  const move=PLAY_MOVES[Math.floor(Math.random()*PLAY_MOVES.length)];
  stage.classList.add('playing','play-'+move);
  const giggle=Math.random()<0.5;                                      // metade dá risadinha, metade acena
  if(!dressed) p.setAttribute('src','assets/img/'+(giggle?'pet_donkey_talk.webp?v=1':'pet_donkey_wave.webp?v=1'));  // vestido: mantém o traje
  spawnSparkles();
  showPetBubble(PLAY_LINES[playIdx++ % PLAY_LINES.length]);
  setTimeout(()=>{
    stage.classList.remove('playing','play-'+move);
    const pp=$('#pet'); if(pp && /wave|talk/.test(pp.getAttribute('src')||'')) pp.setAttribute('src',open);
  }, move==='tilt'?1000:900);
}
/* estrelinhas douradas (CSS, sem emoji) subindo ao redor do Davi */
function spawnSparkles(host){
  const s=host||document.querySelector('.petscene'); if(!s) return;
  for(let i=0;i<5;i++){ const e=document.createElement('span'); e.className='spark-star';
    e.style.left=(36+Math.random()*26)+'%'; e.style.top=(24+Math.random()*24)+'%';
    e.style.setProperty('--sz',(9+Math.random()*9)+'px'); e.style.animationDelay=(i*0.08)+'s';
    s.appendChild(e); setTimeout(()=>e.remove(),1250); }
}
/* "+5 XP" + estrelinhas ao alimentar */
function spawnFeedFx(){
  const s=document.querySelector('.petscene'); if(!s) return;
  const xp=document.createElement('div'); xp.className='feed-xp'; xp.textContent='+5 XP';
  s.appendChild(xp); setTimeout(()=>xp.remove(),1200);
  spawnSparkles(s);
}

/* ============================================================
   MOOD CHECK-IN
   ============================================================ */
function openMoodCheckin(){
  flow(`<div class="ovtop"><span style="width:40px"></span><b></b><button class="iconbtn iconbtn-close" aria-label="Fechar" onclick="closeOverlays()">✕</button></div>
    <div class="mood-bg-room ${state.decoration?'deco-'+state.decoration:''}"></div>
    <div class="mood-pet"><img src="assets/img/pet_donkey.webp?v=13" alt=""><div class="pet-wear"></div></div>
    <div class="mood-sheet">
      <div class="mood-q">Como você está se sentindo?</div>
      <div class="mood-grid">${MOODS.map(m=>`<button class="mood-card" style="background:${m.color}" onclick="setMood('${m.id}',this)">
        <div class="mood-face"><img src="assets/img/${m.img}?v=9" alt="${m.label}"></div>
        <div class="mood-label">${m.label}</div>
      </button>`).join('')}</div>
    </div>`,'mood');
  dressDonkey();
}
function setMood(id,btn){
  const m=MOODS.find(x=>x.id===id); if(!m) return;
  state.moodDone=true; state.lastMood=id; save(); track('humor', 'humor', id);
  // confirma visualmente o card escolhido antes de fechar
  if(btn){ const g=btn.closest('.mood-grid'); if(g) g.classList.add('chosen'); btn.classList.add('picked'); }
  const finish=()=>{ closeOverlays();
    const pet=$('#pet'); if(pet) pet.src=`assets/img/${m.img}?v=9`;  // troca pela expressão escolhida
    showPetBubble(m.msg); };
  btn ? setTimeout(finish,430) : finish();
}
function showPetBubble(text){
  const b=$('#pet-bubble'); if(!b) return;
  b.textContent=text; b.style.display='block';
  setTimeout(()=>{ if(b) b.style.display='none'; },5000);
}

/* ============================================================
   JOKE OF THE DAY
   ============================================================ */
let jokeIdx=0;
function openJoke(){
  jokeIdx=0;
  renderJoke();
}
function renderJoke(){
  const total=JOKES.length;
  const cur=JOKES[jokeIdx];
  const showAnswer=jokeIdx<0; // toggled by tap
  flow(`<div class="joke-screen">
    <button class="iconbtn iconbtn-close" style="position:absolute;top:14px;right:14px;z-index:5" aria-label="Fechar" onclick="closeOverlays()">✕</button>
    <div class="joke-marquee">PIADA DO DIA</div>
    <div class="joke-bubble" id="joke-bubble"><b>${cur.q}</b></div>
    <div class="joke-stage">
      <img class="joke-pet" src="assets/img/donkey_smoking.webp?v=9" alt="Davi comediante">
      <img class="joke-girl" src="assets/img/joke_girl.webp?v=1" alt="">
    </div>
    <button class="joke-next" aria-label="Próxima piada" onclick="nextJoke()">→</button>
  </div>`,'joke');
}
function nextJoke(){
  const b=$('#joke-bubble');
  if(b && !b.dataset.showed){ b.innerHTML=`<b>${JOKES[jokeIdx].a}</b>`; b.dataset.showed='1';
    b.style.animation='none'; void b.offsetWidth; b.style.animation='bubblePop .34s cubic-bezier(.34,1.56,.64,1)'; return; }
  jokeIdx++;
  if(jokeIdx>=JOKES.length){ closeOverlays(); toast('🎭 Isso é tudo por hoje!'); return; }
  renderJoke();
}

/* ============================================================
   OUTFITS + DECORATION
   ============================================================ */
/* posição de cada peça no corpo do Davi (% da altura, escala, rotação) */
/* imagem-base do Davi: traje vestido (state.outfit) OU burrinho normal.
   Cada roupa é uma imagem completa do burrinho já vestido (pet_donkey_<id>.webp). */
function petBaseSrc(){ return state.outfit ? `assets/img/pet_donkey_${state.outfit}.webp?v=100` : 'assets/img/pet_donkey.webp?v=13'; }
/* (re)veste o Davi trocando a IMAGEM em todo lugar visível (cena + previews dos painéis).
   Não interrompe uma expressão temporária (piscada/aceno/humor): só ajusta a imagem de repouso. */
function dressDonkey(){
  const src=petBaseSrc();
  document.querySelectorAll('.pet-stage .petimg, .mood-pet img').forEach(img=>{
    const cur=img.getAttribute('src')||'';
    if(/blink|wave|talk|mood_/.test(cur)) return;   // animação em andamento — não pisa
    img.setAttribute('src', src);
  });
  document.querySelectorAll('.pet-wear').forEach(l=>l.innerHTML='');   // remove overlay antigo de emoji
}
/* brilho + "pop" ao vestir uma roupa */
function playDressUp(){
  const pet=document.querySelector('.mood-pet')||document.querySelector('.pet-stage');
  if(pet){ pet.classList.remove('dressup'); void pet.offsetWidth; pet.classList.add('dressup'); setTimeout(()=>pet&&pet.classList.remove('dressup'),700); }
  spawnSparkles(document.querySelector('.mood-pet')?.parentElement || document.querySelector('.petscene'));
}
let outfitsTab='outfits';
function openOutfitsPanel(){
  track('abriu_loja_roupas');
  outfitsTab='outfits';
  renderOutfits();
}
function renderOutfits(){
  flow(`<div class="ovtop"><span style="width:40px"></span><b></b><span style="width:40px"></span></div>
    <div class="mood-bg-room ${state.decoration?'deco-'+state.decoration:''}"></div>
    <div class="mood-pet"><img src="assets/img/pet_donkey.webp?v=13" alt=""><div class="pet-wear"></div></div>
    <div class="outfits-sheet">
      <button class="iconbtn iconbtn-close ot-x" aria-label="Fechar" onclick="closeOverlays()">✕</button>
      <div class="outfits-tabs">
        <button class="ot-tab ${outfitsTab==='outfits'?'on':''}" onclick="setOutfitsTab('outfits')">👕</button>
        <button class="ot-tab ${outfitsTab==='decoration'?'on':''}" onclick="setOutfitsTab('decoration')">🛋️</button>
      </div>
      <div class="outfits-title">${outfitsTab==='outfits'?'ROUPAS':'DECORAÇÃO'}</div>
      <div class="outfits-grid">${
        (outfitsTab==='outfits' ? OUTFITS : DECORATIONS).map(o=>{
          const owned=(o.owned||(state.owned&&state.owned[o.id]));
          // sem decoração salva, quem está ativo é o quarto padrão
          const eq = outfitsTab==='outfits' ? (state.outfit===o.id) : ((state.decoration||'padrao')===o.id);
          return `<button class="of-card ${eq?'equipped':''}" data-id="${o.id}" onclick="buyItem('${outfitsTab}','${o.id}',${o.price||0})">
            <div class="of-emoji"><span class="of-thumb" style="background-image:url('assets/img/${outfitsTab==='outfits'?`pet_donkey_${o.id}.webp?v=100`:`${o.img}?v=168`}')"></span></div>
            ${owned?`<span class="of-owned">✓</span>`:``}
            ${eq?`<span class="of-eq">${outfitsTab==='outfits'?'vestida':'ativa'}</span>`:(owned?``:`<span class="of-price">${o.price} <i class="pao"></i></span>`)}
          </button>`; }).join('')
      }</div>
    </div>`,'outfits');
  dressDonkey();
}
function setOutfitsTab(t){ outfitsTab=t; renderOutfits(); }
/* Troca de decoração com fade. background-image não é animável em CSS, então o
   crossfade é feito em três tempos: apaga (opacity 0), troca a classe com a tela já
   apagada, acende. Antes a troca era um corte seco no meio da cena.
   Mexe nas classes dos elementos VIVOS — re-renderizar recriaria o nó e a transição
   não teria de onde partir. */
function aplicarDeco(id){
  const antes=state.decoration||'padrao';
  if(id==='padrao') id=null;                     // padrão = sem decoração salva
  state.decoration=id; save();
  // a tela e o cabeçalho entram junto: as vars --theo-sky-* deles seguem o ambiente,
  // senão o cenário laranja encosta direto no azul do rodapé.
  const novo=id||'padrao';
  if(antes===novo) return;

  // tela e cabeçalho: só trocar a classe já basta, o background tem transition
  [elScreen, elHdr].forEach(function(el){
    if(!el) return;
    el.className=el.className.replace(/\s*deco-(?!fx\b)[a-z-]+/g,'')+' deco-'+novo;
  });

  /* A CENA usa DUAS camadas. Com uma só, apagar revelava o quarto base por baixo
     antes do novo entrar — trocar Neon por Natal dava um flash azul no meio, que é
     o que fazia a transição parecer forçada. Agora a camada nova entra POR CIMA da
     antiga, e a antiga só sai quando a nova já está opaca: em nenhum quadro aparece
     o que está por baixo. */
  Array.prototype.slice.call(document.querySelectorAll('.petscene')).forEach(function(cena){
    // a própria cena guarda o ambiente: é o que diz se o presente precisa ser
    // desenhado (cenários novos) ou se já existe um pintado na arte (quarto padrão)
    cena.className=cena.className.replace(/\s*deco-(?!fx\b)[a-z-]+/g,'')+' deco-'+novo;
    const atual=cena.querySelector(':scope > .deco-fx'); if(!atual) return;
    const nova=document.createElement('div');
    nova.className='deco-fx room-'+novo;
    nova.style.opacity='0';
    cena.insertBefore(nova, atual.nextSibling);   // por cima da atual, abaixo do Davi
    void nova.offsetWidth;                         // força o reflow, senão não anima
    nova.style.opacity='1';
    setTimeout(function(){
      if(atual.parentNode) atual.parentNode.removeChild(atual);
      nova.style.opacity='';
    }, 440);
  });
  // o painel de decorações usa ::after, que não empilha — troca direta
  Array.prototype.slice.call(document.querySelectorAll('.mood-bg-room')).forEach(function(el){
    el.className=el.className.replace(/\s*deco-(?!fx\b)[a-z-]+/g,'')+' deco-'+novo;
  });
}
function buyItem(kind,id,price){
  state.owned=state.owned||{};
  const data=(kind==='outfits'?OUTFITS:DECORATIONS).find(o=>o.id===id);
  const already=(data&&data.owned)||state.owned[id];
  if(!already){
    if(state.coins<price){ toast('Moedas insuficientes {pao}'); return; }
    state.coins-=price; state.owned[id]=true;
    toast(`✓ ${kind==='outfits'?'Roupa':'Decoração'} adquirida!`);
  }
  let justDressed=false;
  if(kind==='decoration'){
    aplicarDeco(id); if(already) toast('✓ Decoração aplicada!');
  } else {
    // ROUPAS: uma de cada vez — comprar já veste; tocar de novo na peça vestida tira.
    if(state.outfit===id){ state.outfit=null; toast('Roupa removida'); }
    else { state.outfit=id; justDressed=true; if(already) toast('✓ Davi vestido!'); }
  }
  save();
  renderOutfits();
  dressDonkey();
  if(justDressed) playDressUp();
  requestAnimationFrame(()=>{ const c=elOv.querySelector(`.of-card[data-id="${id}"]`); if(c) c.classList.add('bought'); });
}

/* ============================================================
   DAILY REWARDS (gift box)
   ============================================================ */
/* ===== CARTAZ DE NOVIDADES — aparece UMA vez por versão =====================
   state.novidade guarda a última versão vista. Quem já viu não vê de novo, e
   quem instala agora (novato) também não vê: cartaz de "o que mudou" pra quem
   nunca usou o antigo é ruído. */
const NOVIDADE_V = 166;
function openNovidades(){
  track('viu_novidades');
  const figs=(typeof window.openColorir==='function')?72:0;
  flow(`<div class="ovtop"><span style="width:40px"></span><b></b><span style="width:40px"></span></div>
    <div class="rewards-sheet">
      <button class="iconbtn iconbtn-close rw-x" aria-label="Fechar" onclick="fecharNovidades()">✕</button>
      <div class="rw-title">NOVIDADES</div>
      <div class="rw-sub">O que chegou de novo pro seu pequeno 💛</div>
      <div style="padding:4px 18px 0">
        <div class="nv-item"><span class="nv-ic">🎨</span><div>
          <b>${figs} figurinhas pra colorir</b>
          <p>Eram 8, agora são ${figs} — em 9 álbuns: Heróis da Bíblia, a Criação, os Milagres, o Natal e até o dia a dia do Davi.</p></div></div>
        <div class="nv-item"><span class="nv-ic">⚡</span><div>
          <b>O app abre mais rápido</b>
          <p>Os desenhos agora carregam só quando a criança entra no Colorir.</p></div></div>
        <div class="nv-item"><span class="nv-ic">🫏</span><div>
          <b>O nível do Davi mudou de régua</b>
          <p>Agora ele cresce com o hábito de voltar todo dia, e cada nível vale mais que o anterior. <b>Ninguém perdeu nível</b> — o do seu pequeno continua igual.</p></div></div>
      </div>
      <button class="btn" style="margin:16px 18px 6px" onclick="fecharNovidades()">Entendi!</button>
    </div>`,'novidades');
}
function fecharNovidades(){ state.novidade=NOVIDADE_V; save(); closeOverlays(); }
/* mostra no boot, mas só pra quem JÁ usava (tem progresso) e ainda não viu esta versão */
function maybeNovidades(){
  try{
    if(state.novidade>=NOVIDADE_V) return false;
    const usou = (state.xp>0) || (state.coins>40) || (state.missionsDone||[]).length>0;
    if(!usou){ state.novidade=NOVIDADE_V; save(); return false; }   // novato: marca como visto e não mostra
    openNovidades(); return true;
  }catch(_){ return false; }
}

function openDailyRewards(){
  track('abriu_recompensas');
  flow(`<div class="ovtop"><span style="width:40px"></span><b></b><span style="width:40px"></span></div>
    <div class="rewards-sheet">
      <button class="iconbtn iconbtn-close rw-x" aria-label="Fechar" onclick="closeOverlays()">✕</button>
      <div class="rw-title">RECOMPENSAS DIÁRIAS</div>
      <div class="rw-sub">Volte todo dia pra ganhar uma nova recompensa!</div>
      <div class="rw-grid">${DAILY_REWARDS.map(r=>{
        const rd=state.rewardDay||1;
        return `<div class="rw-card ${r.day<rd?'claimed':''} ${r.day===rd?'today':''}">
          <div class="rw-day">${r.label}</div>
          <div class="rw-emoji">${r.ic==='gift'?'<i class="rw-gift"></i>':`<i class="pao rw-p${r.pao||1}"></i>`}</div>
          <div class="rw-amount">${r.amount}</div>
        </div>`; }).join('')}</div>
      <button class="rw-claim" ${state.dailyClaimedDate===dayKey()?'disabled':''} onclick="claimDaily()">${state.dailyClaimedDate===dayKey()?'Volte amanhã 🎁':'Resgatar'}</button>
    </div>`,'rewards');
}
function claimDaily(){
  const today=dayKey();
  if(state.dailyClaimedDate===today){ toast('Já resgatado hoje 🎁 Volte amanhã!'); return; }
  const rd=state.rewardDay||1, r=DAILY_REWARDS[rd-1]||DAILY_REWARDS[0];
  /* O dia 6 nao e pao: e o desbloqueio do Davi, o mascote. Antes caia num fallback
     de 50 paes — menos que os 200 do dia 5, quebrando a escada justo no premio. */
  const ehPresente = (typeof r.amount !== 'number');
  const amt = ehPresente ? 300 : r.amount;                       // 300 > 200 do dia 5: a escada sobe ate o fim
  if(ehPresente){ state.presenteDia6 = true; }
  state.coins+=amt; state.dailyClaimedDate=today;
  state.rewardDay = rd>=DAILY_REWARDS.length ? 1 : rd+1;          // avança a escada (cicla no fim)
  save();
  toast(ehPresente ? '🎁 Presente do 6º dia: o Davi virou avatar! +300 {pao}' : `+${amt} {pao} resgatados!`);
  openDailyRewards();                                            // re-renderiza com o novo estado
}

/* ---------------- GERADOR DE RUÍDO (Web Audio, 100% gerado — sem arquivo, sem copyright) ---------------- */
// Cada "cor" de ruído tem uma característica espectral: branco = plano, rosa = -3dB/oitava,
// marrom/vermelho = -6dB/oitava (grave), azul/roxo = agudo, verde = médio. Tudo gerado na hora.
const NOISE_SPEC = {
  'Branco':   { base:'white', gain:0.35 },
  'Rosa':     { base:'pink',  gain:0.55 },
  'Marrom':   { base:'brown', gain:0.85 },
  'Vermelho': { base:'brown', gain:0.72, filter:{type:'lowpass',  freq:2200 } },
  'Preto':    { base:'brown', gain:0.55, filter:{type:'lowpass',  freq:220  } },
  'Cinza':    { base:'white', gain:0.32, filter:{type:'lowpass',  freq:7000 } },
  'Azul':     { base:'white', gain:0.28, filter:{type:'highpass', freq:900  } },
  'Roxo':     { base:'white', gain:0.26, filter:{type:'highpass', freq:3200 } },
  'Verde':    { base:'pink',  gain:0.50, filter:{type:'bandpass', freq:520, Q:0.9 } },
};
const NM = { ctx:null, src:null, gain:null, cur:null };
function nmCtx(){ if(!NM.ctx){ const AC=window.AudioContext||window.webkitAudioContext; NM.ctx=new AC(); } return NM.ctx; }
function nmBuffer(ctx, base, secs){
  const n=Math.floor(ctx.sampleRate*secs), buf=ctx.createBuffer(1,n,ctx.sampleRate), d=buf.getChannelData(0);
  if(base==='white'){ for(let i=0;i<n;i++) d[i]=Math.random()*2-1; }
  else if(base==='pink'){ let b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0;
    for(let i=0;i<n;i++){ const w=Math.random()*2-1;
      b0=0.99886*b0+w*0.0555179; b1=0.99332*b1+w*0.0750759; b2=0.96900*b2+w*0.1538520;
      b3=0.86650*b3+w*0.3104856; b4=0.55000*b4+w*0.5329522; b5=-0.7616*b5-w*0.0168980;
      d[i]=(b0+b1+b2+b3+b4+b5+b6+w*0.5362)*0.11; b6=w*0.115926; } }
  else { let last=0; for(let i=0;i<n;i++){ const w=Math.random()*2-1; last=(last+0.02*w)/1.02; d[i]=last*3.5; } } // marrom (integrador com vazamento -> loopa sem estouro)
  return buf;
}
function noiseStop(){ if(NM.src){ try{ NM.src.stop(); }catch(e){} try{ NM.src.disconnect(); }catch(e){} } NM.src=null; NM.cur=null; }
function noisePlay(name){
  const ctx=nmCtx(); if(ctx.state==='suspended'){ try{ ctx.resume(); }catch(e){} }
  const spec=NOISE_SPEC[name]||{base:'white',gain:0.35};
  const src=ctx.createBufferSource(); src.buffer=nmBuffer(ctx, spec.base, 8); src.loop=true;
  let node=src;
  if(spec.filter){ const f=ctx.createBiquadFilter(); f.type=spec.filter.type; f.frequency.value=spec.filter.freq; if(spec.filter.Q) f.Q.value=spec.filter.Q; node.connect(f); node=f; }
  const g=ctx.createGain(); g.gain.value=(spec.gain!=null?spec.gain:0.4);
  node.connect(g); g.connect(ctx.destination); src.start();
  NM.src=src; NM.gain=g; NM.cur=name;
}
function noiseToggle(name){
  if(NM.cur===name){ noiseStop(); }
  else { noiseStop(); noisePlay(name); try{ if(typeof bgAudio!=='undefined'&&bgAudio){ bgAudio.pause(); isPaused=true; updateMini(); } }catch(e){} }
  screenMusic();  // re-renderiza pra atualizar o botão que está tocando
}

/* ---------------- MUSIC ---------------- */
function screenMusic(){
  renderHeader();
  const tab=state.settings.music;
  elScreen.innerHTML=`
    <h1 class="t">Música</h1>
    <div class="seg">
      <button class="${tab!=='music'?'on':''}" onclick="setMusicTab('noise')">Ruído Branco</button>
      <button class="${tab==='music'?'on':''}" onclick="setMusicTab('music')">Canções</button>
    </div>
    ${tab==='music'
      ? `<div class="music-soon">
            <div class="music-soon-emoji">🎶</div>
            <h3>Canções chegando em breve</h3>
            <p>Estamos preparando com muito carinho canções suaves de louvor e de ninar pra embalar a fé do seu pequeno. 💛</p>
            <p class="music-soon-tip">Enquanto isso, os sons do <b>Ruído Branco</b> ajudam a acalmar e dormir.</p>
            <button class="btn" onclick="setMusicTab('noise')">Abrir Ruído Branco 🔊</button>
         </div>`
      : `<p class="muted" style="text-align:center;margin:2px 0 12px;font-size:13px">🔊 Toque num som pra ligar/desligar — ótimo pra dormir e concentrar</p>
         <div class="noisegrid">${NOISES.map(n=>{const on=NM.cur===n.name;return `<button class="noisecard${on?' on':''}" onclick="noiseToggle('${n.name}')">
            <div class="noisecard-ic" style="background:radial-gradient(circle at 35% 28%, rgba(255,255,255,.28), ${n.c} 72%);box-shadow:inset 0 -6px 14px rgba(0,0,0,.25)"></div>
            <div class="noisecard-lb">${on?'⏸ Tocando':'Ruído '+n.name}</div>
          </button>`;}).join('')}</div>`}`;
}
function setMusicTab(t){ state.settings.music=t; save(); screenMusic(); }

/* ============================================================
   PLAYLIST DETAIL (clicar numa playlist em Music)
   ============================================================ */
function openPlaylist(id){
  const p=PLAYLISTS.find(x=>x.id===id); if(!p) return;
  const songs=SONGS[id]||[];
  flow(`<div class="ovtop"><button class="iconbtn" aria-label="Voltar" onclick="closeOverlays()">‹</button><span></span><span style="width:40px"></span></div>
    <div class="pl-detail">
      <div class="pl-cover">${p.img?`<img src="assets/img/${p.img}?v=9" alt="">`:p.emoji}</div>
      <h1 class="pl-title">${p.title}</h1>
      <div class="pl-actions">
        <button class="pl-act" onclick="toast('▶ Em breve')">▶ Tocar tudo</button>
        <button class="pl-act" onclick="toast('🔀 Em breve')">🔀 Aleatório</button>
      </div>
      <div class="pl-songs">${songs.map(s=>`
        <div class="songrow" onclick="toast('▶ ${esc(s.title)} — em breve')">
          <button class="song-play" aria-label="Tocar">▶</button>
          <span class="song-ti">${s.title}</span>
          <span class="song-dur">${s.dur}</span>
        </div>`).join('')}</div>
    </div>`,'playlist');
}

/* ---------------- FAVORITES ---------------- */
function screenFavs(){
  renderHeader();
  const items=state.favs.map(byId).filter(Boolean);
  if(!items.length){
    elScreen.innerHTML=`<h1 class="t">Favoritos</h1>
      <div class="empty"><svg class="emptyheart-svg" width="150" height="150" viewBox="0 0 24 24" fill="none" stroke="#e3c98a" stroke-width="1.1" stroke-linejoin="round"><path d="M12 20.3s-7-4.3-9.3-8.8C1.2 8.3 2.7 5.4 5.7 5.4c1.9 0 3.2 1.2 4.3 2.7C11.1 6.6 12.4 5.4 14.3 5.4c3 0 4.5 2.9 3 6.1C19 16 12 20.3 12 20.3z"/></svg></div>`;
    return;
  }
  elScreen.innerHTML=`<h1 class="t">Favoritos</h1><div class="grid2">${items.map(tcard).join('')}</div>`;
}
function toggleFav(id,btn){
  const i=state.favs.indexOf(id);
  if(i<0){ state.favs.push(id); toast('Salvo nos Favoritos ♥'); } else { state.favs.splice(i,1); toast('Removido dos Favoritos'); }
  save();
  if(btn){ btn.classList.toggle('on',isFav(id)); btn.innerHTML=heartSvg(isFav(id));
    btn.setAttribute('aria-label', isFav(id)?'Remover dos favoritos':'Adicionar aos favoritos');
    if(isFav(id)){ btn.classList.remove('pop'); void btn.offsetWidth; btn.classList.add('pop'); } }
  if(TAB==='favs') screenFavs();
}

/* ============================================================
   FLUXO DE CONTEÚDO (overlays)
   ============================================================ */
let detailT=null;
function flow(html, cls=''){ elOv.style.display='block'; elOv.innerHTML=`<div class="ov ${cls}">${html}</div>`; }
/* TRAVA DE ASSINATURA: a tela de bloqueio e so um overlay, e QUALQUER coisa que
   fechasse overlay soltava o app inteiro — _locked existia mas nao era conferido
   em lugar nenhum (so no botao voltar do Android). Um testador achou como passar
   dela arrastando a tela. Agora fechar overlay com a assinatura inativa reabre o
   bloqueio no mesmo ciclo, entao nao existe janela de conteudo liberado.
   ⚠️ Isto e trava de UX, nao de seguranca: o conteudo vive no data.js publico. */
function closeOverlays(){ clearTimeout(detailT); stopContent(); closeScript(); elOv.style.display='none'; elOv.innerHTML='';
  if(_locked){ showLockedScreen(); } }
/* minimiza o player (continua tocando + mostra mini) */
function minimizePlayer(){ clearInterval(playT); playT=null; elOv.style.display='none'; elOv.innerHTML=''; updateMini(); }
/* para de vez o conteúdo (fim da sessão) */
function stopContent(){ stopPlayer(); try{ if(typeof noiseStop==='function') noiseStop(); }catch(e){} nowPlaying=null; isPaused=false; updateMini(); }

function openDetail(id){
  const it=byId(id);
  // tela de loading leve em CSS (Bíblia que brilha) — sem Lottie pesado
  flow(`<div class="loadwrap"><img src="assets/img/mission_bible.webp?v=9" class="load-img" alt=""></div>`,'loading');
  clearTimeout(detailT); detailT=setTimeout(()=>renderDetail(id), 900);
}
function renderDetail(id){
  const it=byId(id);
  if(!it){ closeOverlays(); toast('Conteúdo indisponível'); return; }   // evita travar na tela de loading se o id não existir
  flow(`
    <div class="bigcover" style="background:${it.grad}">${cov(it)}</div><div class="scrim"></div>
    <div class="ovtop"><button class="iconbtn" aria-label="Voltar" onclick="closeOverlays()">‹</button>
      <button class="iconbtn" aria-label="${isFav(id)?'Remover dos favoritos':'Adicionar aos favoritos'}" onclick="toggleFav('${id}',this)" id="d-heart">${heartSvg(isFav(id))}</button></div>
    <div class="body" style="justify-content:flex-end">
      <div class="info detail">
        <div class="ty">${typeLabel(it.type)}</div>
        <h2>${it.title}</h2>
        <div class="dur">${it.video?'🎬 Vídeo':it.dur}${it.premium?' · 🔒 Premium':''}</div>
        <div class="chev">⌄</div>
        <p class="desc">${it.desc}</p>
        <button class="btn" onclick="${it.video?`openVideo('${id}')`:(it.daily?`openReading('${id}')`:`openPlayer('${id}')`)}">${it.video?'▶ Assistir':'Começar'}</button>
      </div>
    </div>`,'detail');
}

/* SÉRIE: mostra a capa + a lista de episódios; cada episódio é um conteúdo normal (openDetail) */
function openSeries(id){
  const s = (typeof SERIES!=='undefined' ? SERIES : []).find(x => x.id === id);
  if(!s){ toast('Série indisponível'); return; }
  const eps = s.eps.map(byId).filter(Boolean);
  flow(`
    <div class="bigcover" style="background:${s.grad}">${cov(s)}</div><div class="scrim"></div>
    <div class="ovtop"><button class="iconbtn" aria-label="Voltar" onclick="closeOverlays()">‹</button><span style="width:40px"></span></div>
    <div class="body" style="justify-content:flex-end">
      <div class="info detail">
        <div class="ty">Série · ${eps.length} episódios</div>
        <h2>${s.title}</h2>
        <p class="desc">${s.desc}</p>
        <div style="display:flex;flex-direction:column;gap:9px;margin-top:14px;width:100%">
          ${eps.map((e,i)=>`<button class="eprow" onclick="openDetail('${e.id}')">
            <span class="epnum">${i+1}</span>
            <span class="eptitle">${esc(e.title)}</span>
            <span class="epdur">${e.dur||''} ›</span>
          </button>`).join('')}
        </div>
      </div>
    </div>`,'detail');
}

let playT=null;
function openPlayer(id){
  const it=byId(id);
  if(it && it.premium && !canAccess()){ openSubscription(); toast('🔒 Conteúdo Premium — faça sua assinatura'); return; }
  track('abriu_conteudo', 'conteudo', it && it.title);
  flow(`
    <div class="player-top">
      <div class="player-hdr"><button class="iconbtn iconbtn-back" onclick="minimizePlayer()">‹</button></div>
      <div class="player-img" style="background:${it.grad}">${cov(it)}</div>
    </div>
    <div class="player-ctrl">
      <div class="player-title">${it.title}</div>
      <div class="player-bar" id="pbar-track" onclick="seekAudioTo(event)"><i id="pbar"></i><span class="pbar-thumb"></span></div>
      <div class="player-time"><span id="pcur">0:00</span><span id="pdur">${it.dur||'0:00'}</span></div>
      <div class="player-btns">
        <button class="pbtn-skip" aria-label="Voltar 10 segundos" onclick="seekAudio(-10)"><img class="ico icoW" src="assets/img/controls/gobackward_10.webp" alt=""></button>
        <button class="pbtn-play" id="sheet-pp" aria-label="Reproduzir ou pausar" onclick="togglePlay()">⏸</button>
        <button class="pbtn-skip" aria-label="Avançar 10 segundos" onclick="seekAudio(10)"><img class="ico icoW" src="assets/img/controls/goforward_10.webp" alt=""></button>
      </div>
      <div class="player-modes">
        <button class="pmode on" onclick="openScript('${id}')" aria-label="Ler o texto da história"><span class="pmode-ic">≡</span><span>Texto</span></button>
        ${it.audio?'':`<button class="pmode" onclick="toast('🎙️ Narração em breve')"><span class="pmode-ic">🎙</span><span>Voz</span></button>`}
        <button class="pmode" onclick="toggleRepeat(this)"><span class="pmode-ic">🔁</span><span>Repetir</span></button>
      </div>
      <button class="player-finish" onclick="finishPlay('${id}')">Concluir</button>
    </div>`,'player');
  nowPlaying=id; isPaused=false; setPlayerAudio(it); updateMini(); playBg();
  // narração real termina sozinha -> vai pra tela de conclusão (ambiente em loop nunca dispara)
  bgAudio.onended=()=>{ if(audioIsReal && nowPlaying===id){ finishPlay(id); } };
  const bar=$('#pbar');
  clearInterval(playT);
  // progresso REAL sincronizado com o áudio
  const setDur=()=>{ if(!audioIsReal) return; const d=$('#pdur'); if(d&&bgAudio.duration) d.textContent=fmtTime(bgAudio.duration); };
  bgAudio.onloadedmetadata=setDur; setDur();   // atribuição (não addEventListener) — não acumula a cada openPlayer
  playT=setInterval(()=>{
    if(!bgAudio||!bgAudio.duration) return;
    const pct=(bgAudio.currentTime/bgAudio.duration)*100;
    if(bar) bar.style.width=Math.min(pct,100)+'%';
    const c=$('#pcur'); if(c) c.textContent=fmtTime(bgAudio.currentTime);
  },250);
}
function fmtTime(s){ s=Math.floor(s||0); return Math.floor(s/60)+':'+String(s%60).padStart(2,'0'); }
function seekAudio(d){ if(bgAudio&&bgAudio.duration){ bgAudio.currentTime=Math.max(0,Math.min(bgAudio.duration,bgAudio.currentTime+d)); toast(d>0?'+10s':'-10s'); } }
function seekAudioTo(ev){ const t=document.getElementById('pbar-track'); if(!t||!bgAudio||!bgAudio.duration) return; const r=t.getBoundingClientRect(); const x=(ev.clientX-r.left)/r.width; bgAudio.currentTime=Math.max(0,Math.min(1,x))*bgAudio.duration; }
function stopPlayer(){ clearInterval(playT); playT=null; stopBg(); }

/* ===== VÍDEO (Cloudflare Stream) — itens com campo .video tocam vídeo real ===== */
const STREAM_HOST='customer-3zqag0gu566vwe3k.cloudflarestream.com';
function openVideo(id){
  const it=byId(id); if(!it){ closeOverlays(); toast('Conteúdo indisponível'); return; }
  if(!it.video){ openPlayer(id); return; }                                   // sem vídeo -> player de áudio
  if(it.premium && !canAccess()){ openSubscription(); toast('🔒 Conteúdo Premium — faça sua assinatura'); return; }
  stopContent();                                                             // silencia qualquer áudio antes do vídeo
  track('abriu_conteudo','video', it.title);
  const poster=encodeURIComponent(`https://${STREAM_HOST}/${it.video}/thumbnails/thumbnail.jpg?height=600`);
  const src=`https://${STREAM_HOST}/${it.video}/iframe?autoplay=true&poster=${poster}`;
  flow(`
    <div class="ovtop vid-top">
      <button class="iconbtn" aria-label="Voltar" onclick="closeOverlays()">‹</button>
      <b>${escHtml(it.title)}</b>
      <button class="iconbtn" aria-label="${isFav(id)?'Remover dos favoritos':'Adicionar aos favoritos'}" onclick="toggleFav('${id}',this)" id="d-heart">${heartSvg(isFav(id))}</button>
    </div>
    <div class="vidscroll">
      <div class="vidbox" style="padding-top:${it.vasp||'56.25%'}"><iframe src="${src}" loading="lazy" title="${escHtml(it.title)}" allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;" allowfullscreen="true"></iframe></div>
      <div class="vid-meta">
        <div class="ty">${typeLabel(it.type)} · Vídeo</div>
        <h2>${escHtml(it.title)}</h2>
        <p class="desc">${escHtml(it.desc||'')}</p>
        <button class="btn vid-done" onclick="finishPlay('${id}')">✓ Concluir</button>
      </div>
    </div>`,'video');
}

/* MODO TEXTO — overlay rolável com o roteiro do conteúdo (campo c.script) */
function openScript(id){
  const it=byId(id);
  if(!it){ return; }
  if(!it.script){ toast('📝 Texto em breve'); return; }
  let ov=document.getElementById('scriptov');
  if(!ov){ ov=document.createElement('div'); ov.id='scriptov'; document.getElementById('app').appendChild(ov); }
  const paras=it.script.split(/\n\n+/).map(p=>`<p>${escHtml(p)}</p>`).join('');
  ov.innerHTML=`
    <div class="scriptov-top">
      <button class="iconbtn" aria-label="Fechar texto" onclick="closeScript()">‹</button>
      <b>Texto</b>
      <span style="width:40px"></span>
    </div>
    <div class="scriptov-body" id="scriptov-body">
      <div class="scriptov-ty">${typeLabel(it.type)}</div>
      <h2 class="scriptov-title">${it.title}</h2>
      <div class="scriptov-text">${paras}</div>
    </div>`;
  ov.classList.add('show');
  const b=document.getElementById('scriptov-body'); if(b) b.scrollTop=0;
}
function closeScript(){ const ov=document.getElementById('scriptov'); if(ov) ov.classList.remove('show'); }

/* ===== LEITURA DO DIA — "Página de Luz" (usa it.daily das 50 leituras) ===== */
function openReading(id){
  const it=byId(id); if(!it){ closeOverlays(); toast('Conteúdo indisponível'); return; }
  const rd=it.daily; if(!rd){ openPlayer(id); return; }
  stopContent();   // silencia player/ruído anterior antes do autoplay
  track('abriu_conteudo','leitura', rd.title);
  const E=escHtml;
  let corpo=rd.script, oracao='';
  const m=String(rd.script).match(/^([\s\S]*?)\s*((?:Vamos orar|Bora orar|Vamos rezar|Vamos conversar com Deus)[\s\S]*)$/i);
  if(m){ corpo=m[1].trim(); oracao=m[2].replace(/^(Vamos orar|Bora orar|Vamos rezar|Vamos conversar com Deus)[^A-Za-zÀ-ú]*/i,'').trim(); }
  let paras=corpo.split(/\n+/).map(x=>x.trim()).filter(Boolean);
  if(paras.length<=1){ const sents=corpo.match(/[^.!?]+[.!?]+["\u201d]?/g)||[corpo]; paras=[]; for(let i=0;i<sents.length;i+=2) paras.push(sents.slice(i,i+2).join(' ').trim()); }
  const body=paras.map((x,i)=>`<p class="${i===0?'rd-lead':''}">${E(x)}</p>`).join('');
  const dateTxt=it.date?` · ${E(it.date)}`:'';
  flow(`
    <div class="rd-progress"><i id="rdbar"></i></div>
    <div class="rd-top">
      <button class="iconbtn" aria-label="Voltar" onclick="closeOverlays()">‹</button>
      <button class="iconbtn" aria-label="${isFav(id)?'Remover dos favoritos':'Adicionar aos favoritos'}" onclick="toggleFav('${id}',this)" id="d-heart">${heartSvg(isFav(id))}</button>
    </div>
    <div class="rd-body" id="rd-body" onscroll="rdScroll()">
      <div class="rd-hero"><img src="assets/img/${E(it.img||'illus_gospel.jpg')}?v=17" alt=""><span class="rd-hero-badge">✦ Leitura do Dia</span></div>
      <div class="rd-eyebrow">LEITURA DO DIA${dateTxt}</div>
      <h1 class="rd-title">${E(rd.title)}</h1>
      <p class="rd-verse">${E(rd.verse)}</p>
      <div class="rd-vref">— ${E(rd.ref)}</div>
      <div class="rd-audio-wrap" id="rd-aud-wrap">
        <audio class="rd-audio" autoplay controls preload="auto" src="${audioSrc(rd.id)}" onerror="var w=document.getElementById('rd-aud-wrap');if(w)w.classList.add('noaud')"></audio>
        <div class="rd-audio-soon">🎧 narração chegando — por enquanto, um adulto pode ler junto</div>
      </div>
      <div class="rd-hr"></div>
      <div class="rd-read">${body}</div>
      ${oracao?`<div class="rd-hr"></div><section class="rd-pray"><div class="rd-lbl">Vamos orar</div><blockquote>${E(oracao)}</blockquote></section>`:''}
      <div class="rd-bless">Que a paz de Jesus fique com você 💛</div>
      <button class="btn rd-done" onclick="finishPlay('${id}')">✓ Concluir leitura</button>
    </div>`,'reading');
  const b=document.getElementById('rd-body'); if(b) b.scrollTop=0;
  const bar=document.getElementById('rdbar'); if(bar) bar.style.width='0%';
}
function rdScroll(){
  const b=document.getElementById('rd-body'), bar=document.getElementById('rdbar'); if(!b||!bar) return;
  const max=b.scrollHeight-b.clientHeight;
  bar.style.width=(max>0?Math.min(100,(b.scrollTop/max)*100):100)+'%';
}

let _finished=false;
function finishPlay(id){ if(_finished) return; _finished=true; setTimeout(()=>_finished=false,400); stopContent();
  /* O prêmio é DIÁRIO, e quem manda nisso é o doneToday (que o dailyReset limpa).
     Antes o gate era o missionsDone, que NUNCA é limpo — então a missão pagava 3x na
     vida inteira. Do dia 2 em diante a tela mostrava a missão disponível de novo, a
     criança fazia, e não vinha nada. O missionsDone continua crescendo porque é
     contador vitalício: alimenta o "minutos ouvidos" e os gates de review/paywall. */
  const jaFezHoje = state.doneToday.indexOf(id) >= 0;
  if(!jaFezHoje) state.doneToday.push(id);
  if(!state.missionsDone.includes(id)) state.missionsDone.push(id);
  if(!jaFezHoje){
    // paga o que o card promete (m.reward = 10/15/15); estava fixo em 10 e duas
    // missões pagavam menos do que o próprio botão anunciava.
    const m=(typeof MISSIONS!=='undefined') ? MISSIONS.find(x=>x.id===id) : null;
    state.coins += (m && m.reward) || 10;
    state.xp += 10; checkLevel();
  }
  try{ marcaPrimeiroConcluido(); }catch(_){ }   // fecha o funil da 1a sessao (só se veio de lá)
  try{ kidStats().stories++; }catch(_){ }   // conta pra criança do perfil ativo, toda vez
  save();  // marca feito HOJE + credita 1x POR DIA
  /* HORA DA CONVERSA (06/09): se a história tem perguntas e o bônus ainda não foi
     ganho, a conversa entra ANTES da tela de nota — e ela mesma chama o rating
     depois. Sem perguntas (ou já feitas), o fluxo é o de sempre. */
  try{ if(abrirPerguntas(id)) return; }catch(_){ }
  ratingScreen(id); }

function ratingScreen(id){
  const it=byId(id), r=state.ratings[id]||0;
  flow(`<div class="ovtop"><span style="width:40px"></span><b>Concluído</b><span style="width:40px"></span></div>
    <div class="cscreen">
      <div class="big big-ic">${ICONS.festa}</div>
      <h2>Você gostou desse conteúdo?</h2>
      <div class="stars" id="stars">${[1,2,3,4,5].map(n=>`<span class="s ${n<=r?'on':''}" onclick="setRating('${id}',${n})">★</span>`).join('')}</div>
      <div class="donecard">
        <div class="cv" style="background:${it.grad}">${cov(it)}</div>
        <div><div style="font-size:12px;color:var(--ink-soft);font-weight:700">${typeLabel(it.type)}</div><b>${it.title}</b></div>
        <button class="share" aria-label="Compartilhar" onclick="share('${esc(it.title)}')">⤴</button>
      </div>
      <div class="foot"><button class="btn" onclick="continueRoutine('${id}')">Continuar</button></div>
    </div>`);
}
function setRating(id,n){ state.ratings[id]=n; save(); $('#stars').querySelectorAll('.s').forEach((s,i)=>s.classList.toggle('on',i<n)); }

let routineSeed=0;
function continueRoutine(id){
  // (recompensa já foi creditada em finishPlay)
  maybeAskDepoisDoConteudo();   // MOMENTO IDEAL: concluiu um conteúdo e gostou — só AQUI pedimos algo
  const pool=CONTENT.filter(c=>c.id!==id);
  const pick=[];
  const want=['story','affirmation','meditation','prayer'];
  want.forEach(t=>{ const opts=pool.filter(c=>c.type===t); if(opts.length) pick.push(opts[(routineSeed+pick.length)%opts.length]); });
  while(pick.length<4) pick.push(pool[(routineSeed+pick.length)%pool.length]);
  flow(`<div class="ovtop"><span style="width:40px"></span><b></b><span style="width:40px"></span></div>
    <div class="body" style="padding:0 18px 30px">
      <h2 style="text-align:center;font-size:22px;margin:6px 0 4px">Continue sua rotina com</h2>
      <p class="muted" style="text-align:center;margin:0 0 16px">Escolha o próximo momento com Deus.</p>
      <div class="grid2">${pick.map(it=>`
        <div class="tcard"><span class="badge" style="position:absolute;top:9px;left:9px;z-index:2;background:${TYPES[it.type].badge}">${typeLabel(it.type)}</span>
          <button class="cv" style="background:${it.grad}" aria-label="Abrir ${esc(it.title)}" onclick="openDetail('${it.id}')">${cov(it)}</button>
          <div class="bd"><div class="ti">${it.title}</div></div></div>`).join('')}</div>
      <div class="row-btn" style="margin-top:18px">
        <button class="btn ghost sm" style="flex:1" onclick="routineSeed++;continueRoutine('${id}')">🎲 Trocar</button>
        <button class="btn sm" style="flex:1" onclick="streakScreen()">Pular</button>
      </div>
    </div>`);
}

function streakScreen(){
  flow(`<div class="cscreen">
      <div class="big firelot" id="fire-lot">🔥</div>
      <h2>Sequência de ${state.streak} dia(s)!</h2>
      <p class="verse">“Deixe seu coração arder de amor pelo Senhor.”<br>— Romanos 12:11</p>
      <div class="weekrow">${WEEK.map((d,i)=>`<div class="d ${state.week[i]?'on':''}"><div class="dot">${state.week[i]?'🔥':''}</div>${d}</div>`).join('')}</div>
      <div class="foot"><button class="btn" onclick="retentionScreen()">Continuar</button></div>
    </div>`);
  const fa=LOTTIE($('#fire-lot'),'assets/anim/streaks_big_fire.json'); if(fa) $('#fire-lot').textContent='';
}

function retentionScreen(){
  flow(`<div class="cscreen">
      <div class="big">📅</div>
      <h2>Você consegue chegar a 7 dias?</h2>
      <p>Famílias que mantêm a sequência veem mudanças reais:</p>
      <div class="proof">
        <div class="p"><b>89%</b><span>dormem melhor</span></div>
        <div class="p"><b>90%</b><span>dormem mais rápido</span></div>
        <div class="p"><b>80%</b><span>mais conectadas</span></div>
        <div class="p"><b>90%</b><span>melhor humor no dia seguinte</span></div>
      </div>
      <div class="foot">
        <button class="btn" onclick="endFlow()">Eu consigo!</button>
        <button class="btn ghost" onclick="endFlow()">Não sei…</button>
      </div>
    </div>`);
}
function endFlow(){ closeOverlays(); stopContent(); TAB='today'; render(); }

/* ============================================================
   MINI-PLAYER + PLAYER COMPLETO (sleep timer)
   ============================================================ */
let nowPlaying=null, isPaused=false, sleepTimer='30m';
function updateMini(){
  if(!nowPlaying){ elMini.classList.remove('show'); return; }
  const it=byId(nowPlaying);
  if(!it){ closeOverlays(); toast('Conteúdo indisponível'); return; }   // id inválido: não trava com TypeError
  $('#mini-cv').innerHTML=cov(it); $('#mini-cv').style.background=it.grad;
  $('#mini-ti').textContent=it.title; $('#mini-pp').innerHTML=`<img class="ico icoB" src="assets/img/${isPaused?'ic_music_play':'ic_music_pause'}.webp" alt="">`;
  const sp=$('#sheet-pp'); if(sp) sp.innerHTML=`<img class="ico icoB" src="assets/img/${isPaused?'ic_music_play':'ic_music_pause'}.webp" alt="">`;
  elMini.classList.add('show');
}
$('#mini-pp').onclick=(e)=>{ e.stopPropagation(); togglePlay(); };
$('#mini-up').onclick=()=>{ if(nowPlaying) openPlayer(nowPlaying); };
$('#mini').addEventListener('click',e=>{ if(e.target.closest('#mini-up'))return; if(e.target.closest('#mini-pp'))return; if(nowPlaying) openPlayer(nowPlaying); });

function expandPlayer(){
  if(!nowPlaying) return; const it=byId(nowPlaying);
  flow(`<div class="ovtop"><button class="iconbtn" aria-label="Minimizar" onclick="closeOverlays()">⌄</button><b>Tocando Agora</b><span style="width:40px"></span></div>
    <div class="body" style="padding:0 24px 30px;justify-content:center">
      <div class="sheet-cover" style="background:${it.grad}">${cov(it)}</div>
      <div style="text-align:center;font-weight:800;font-size:20px">${it.title}</div>
      <div class="muted" style="text-align:center;margin-top:4px">${typeLabel(it.type)} · ${it.dur}</div>
      <div class="pcontrols">
        <button class="c" aria-label="Voltar 10 segundos" onclick="seekAudio(-10)"><img class="ico icoW" src="assets/img/controls/gobackward_10.webp" alt=""></button>
        <button class="play" id="sheet-pp" aria-label="Reproduzir ou pausar" onclick="togglePlay()"><img class="ico icoB" src="assets/img/${isPaused?'ic_music_play':'ic_music_pause'}.webp" alt=""></button>
        <button class="c" aria-label="Avançar 10 segundos" onclick="seekAudio(10)"><img class="ico icoW" src="assets/img/controls/goforward_10.webp" alt=""></button>
      </div>
      <div style="text-align:center;color:var(--ink-soft);font-weight:700;margin-bottom:8px">⏰ Timer de sono</div>
      <div class="timer" id="timer">${['1h','30m','10m','Personalizado'].map(o=>`<button class="o ${sleepTimer===o?'on':''}" onclick="setTimer('${o}')">${o}</button>`).join('')}</div>
    </div>`);
}
function setTimer(o){ sleepTimer=o; $('#timer').querySelectorAll('.o').forEach(b=>b.classList.toggle('on',b.textContent===o)); toast(o==='Personalizado'?'Timer personalizado':`Timer de sono: ${o}`); }

/* ============================================================
   PROFILE
   ============================================================ */
let profTab='stats';
/* ===== ESTATÍSTICAS POR CRIANÇA =================================================
   Eram globais: `missionsDone.length*4` minutos e `missionsDone.length` histórias,
   os MESMOS números em todos os perfis. Criar o segundo filho mostrava o histórico
   do primeiro. E os "minutos" eram um multiplicador inventado — nada media áudio.
   Agora cada perfil tem o seu contador, e o tempo é o que tocou de verdade. */
function kidStats(i){
  i = (i===undefined) ? (state.profile||0) : i;
  state.kid = state.kid || {};
  return (state.kid[i] = state.kid[i] || { secs:0, stories:0 });
}
/* Migração: quem já usava viu "20 minutos / 5 Histórias". Zerar seria apagar o que a
   mãe já tinha visto, então o histórico global vira o da PRIMEIRA criança (que é de
   quem ele era, na prática — o app só tinha um perfil de fato). */
if(!state.kidV){
  try{
    var _k0 = kidStats(0);
    if(!_k0.stories && !_k0.secs){
      _k0.stories = (state.missionsDone||[]).length;
      _k0.secs = _k0.stories * 4 * 60;      // mantém o número que ela já via
    }
  }catch(_){ }
  state.kidV = 1; save();
}
/* Tempo REAL de escuta. 'timeupdate' não borbulha, então escuto na fase de captura,
   que passa pelo document antes de chegar no <audio>. Só conta delta pra frente e
   menor que 2s: pular a faixa não vira "tempo de qualidade". */
(function(){
  var acc=0;
  document.addEventListener('timeupdate', function(e){
    var a=e.target;
    if(!a || a.tagName!=='AUDIO' || a.paused) return;
    var t=a.currentTime||0, d=t-(a.__ultimo||0); a.__ultimo=t;
    if(d<=0 || d>2) return;                 // seek, loop ou primeiro tick
    kidStats().secs += d;
    acc += d;
    if(acc>=15){ acc=0; save(); }           // salva a cada ~15s, não a cada tick
  }, true);
})();
/* avatar: foto do perfil (se a pessoa tirou) ou o emoji padrão */
/* sem estilo inline: o recorte é uma regra só (.av-img), igual nos quatro lugares
   onde a foto aparece — cabeçalho, seletor de perfil, lista de filhos e Minha conta */
/* ===== AVATARES ILUSTRADOS (substituem a foto do rosto da criança) =====
   Tirar a selfie do fluxo resolve três coisas de uma vez: some o dado mais sensível
   que um app infantil pode guardar, some o bug do "Memória cheia" (foto em base64
   estourava a cota do localStorage e o app apagava as fotos sozinho pra sobreviver),
   e dá pra bloquear a câmera no Permissions-Policy sem exceção.
   Quem JÁ tem foto continua vendo a dela — não destruímos nada, só paramos de oferecer. */
var AVATARES = [
  { id:'ovelhinha', nome:'Ovelhinha', img:'01_ovelhinha' },
  { id:'corujinha', nome:'Corujinha', img:'05_corujinha' },
  { id:'borboleta', nome:'Borboleta', img:'06_borboleta' },
  { id:'peixinho',  nome:'Peixinho',  img:'04_peixinho'  },
  /* trancados: cada um ensina um hábito diferente e mostra a meta (cadeado mudo frustra) */
  { id:'pombinha',  nome:'Pombinha',  img:'03_pombinha',  meta:'7 dias seguidos',   teste:function(){ return (state.streak||0) >= 7; } },
  { id:'leaozinho', nome:'Leãozinho', img:'02_leaozinho', meta:'Nível 5',           teste:function(){ return (state.level||1) >= 5; } },
  { id:'camelinho', nome:'Camelinho', img:'07_camelinho', meta:'5 histórias',       teste:function(){ return contarHistorias() >= META_HISTORIAS; } },
  { id:'baleia',    nome:'Baleia',    img:'08_baleia',    meta:'8 figurinhas',      teste:function(){ return (state.colored||[]).length >= META_FIGURINHAS; } },
  /* O PRESENTE DO DIA 6. Antes o 'presente' creditava 50 paes — MENOS que os 200
     do dia 5, uma queda de 75%% justo na coroacao da sequencia. Agora ele desbloqueia
     o Davi, o mascote do app: e a unica coisa aqui que nao se compra com pao. */
  { id:'davi', nome:'Davi', img:'09_davi', meta:'6 dias de recompensa', teste:function(){ return !!state.presenteDia6; } },
];
/* METAS — checadas contra o acervo REAL, senão viram grind impossível:
   • histórias: existem 12 no app inteiro (data.js). 10 seria 83% de tudo; 5 é ~40%,
     alcançável em algumas semanas sem virar obrigação.
   • figurinhas: o Colorir tem 9 álbuns de 8. Conto FIGURINHAS, não "álbum completo",
     porque state.colored é uma lista achatada — contar 8 quaisquer e prometer "1 álbum"
     seria mentira (dá pra pintar 8 espalhados e nunca fechar um álbum). O rótulo diz
     exatamente o que o teste faz. */
var META_HISTORIAS = 5;
var META_FIGURINHAS = 8;
function contarHistorias(){
  try{ return (state.missionsDone||[]).filter(function(id){ var it=byId(id); return it && it.type==='story'; }).length; }
  catch(_){ return 0; }
}
function avatarPorId(id){ for(var k=0;k<AVATARES.length;k++){ if(AVATARES[k].id===id) return AVATARES[k]; } return null; }
function avatarLiberado(a){ return !a.teste || a.teste(); }
function avatarSrc(a){ return 'assets/img/avatares/'+a.img+'.jpg?v=179'; }

/* o que aparece no lugar do avatar: foto antiga (se existir) > avatar escolhido > emoji padrão */
function avInner(i){
  const ph=state.photos&&state.photos[i];
  if(ph) return `<img class="av-img" src="${ph}" alt="">`;
  const a=avatarPorId((state.avatars||{})[i]);
  if(a) return `<img class="av-img" src="${avatarSrc(a)}" alt="">`;
  return PROFILES[i].avatar;
}
function escolherAvatar(id){
  const a=avatarPorId(id); if(!a) return;
  if(!avatarLiberado(a)){ toast('🔒 '+a.meta+' pra liberar'); return; }
  state.avatars=state.avatars||{};
  state.avatars[state.profile]=id;
  if(state.photos) delete state.photos[state.profile];   // escolheu avatar: a foto antiga sai de cena
  save(); openAvatarPicker();
  toast('Pronto! ✨');
}
function openAvatarPicker(){
  elOv.style.display='block';
  const atual=(state.avatars||{})[state.profile];
  const grade=AVATARES.map(function(a){
    const ok=avatarLiberado(a), sel=(a.id===atual);
    return '<button class="avpick '+(sel?'on':'')+(ok?'':' lock')+'" onclick="escolherAvatar(\''+a.id+'\')" aria-label="'+a.nome+(ok?'':' — bloqueado')+'">'
      +'<span class="avpick-img"><img src="'+avatarSrc(a)+'" alt="" loading="lazy">'+(ok?'':'<span class="avpick-cad">🔒</span>')+'</span>'
      +'<span class="avpick-n">'+a.nome+'</span>'
      +(ok?'':'<span class="avpick-meta">'+a.meta+'</span>')
      +'</button>';
  }).join('');
  elOv.innerHTML='<div class="ov"><div class="ovtop"><button class="iconbtn" aria-label="Voltar" onclick="openProfile()">‹</button><b>Escolher avatar</b><span style="width:40px"></span></div>'
    +'<div class="body" style="padding:0 16px 40px">'
    +'<p class="muted" style="margin:14px 2px 16px">Escolha o bichinho de '+escHtml(pname(state.profile))+'. Os bloqueados liberam conforme vocês avançam na aventura 💛</p>'
    +'<div class="avpick-grid">'+grade+'</div>'
    +'</div></div>';
}
function openProfile(){
    const p=PROFILES[state.profile];
  elOv.style.display='block';
  elOv.innerHTML=`<div class="ov"><div class="ovtop"><button class="iconbtn" aria-label="Voltar" onclick="closeOverlays()">‹</button><b>Perfil</b><span style="width:40px"></span></div>
    <div class="body" style="padding:0 16px 40px">
      ${state.coachPerfil ? '' : `<div class="coach">Crie um perfil personalizado pra outra criança<button class="coach-x" aria-label="Entendi" onclick="fecharCoach(this)">✕</button></div>`}
      <div class="avrow" style="margin-top:22px">
        ${activeKids().map(i=>`<button class="avitem ${i===state.profile?'on':''}" onclick="setProfile(${i})"><span class="a">${avInner(i)}</span>${i===state.profile?`<span class="av-cam" onclick="event.stopPropagation();openAvatarPicker()" title="Escolher avatar">🎨</span>`:''}<span class="n">${escHtml(pname(i))}</span></button>`).join('')}
        ${activeKids().length<PROFILES.length?`<button class="avitem add" onclick="addKid()"><span class="a">＋</span><span class="n">Adicionar</span></button>`:''}
      </div>
      <div class="seg" style="margin-top:18px">
        <button class="${profTab==='stats'?'on':''}" onclick="setProfTab('stats')">Estatísticas</button>
        <button class="${profTab==='edit'?'on':''}" onclick="setProfTab('edit')">Editar perfil</button>
      </div>
      <div id="prof-body">${profBody(p)}</div>
    </div></div>`;
}
function profBody(p){
  if(profTab==='stats'){
    const k=kidStats(), mins=Math.floor((k.secs||0)/60), st=k.stories||0;
    return `<div class="statcard"><b>${mins} ${mins===1?'minuto':'minutos'}</b><div class="muted">de tempo de qualidade juntos</div></div>
      <div class="statcard"><b>${st} ${st===1?'História':'Histórias'}</b><div class="muted">${st?'concluídas':'concluídas — a primeira vem já já 💛'}</div></div>`;
  }
  return `<div class="field"><label>Qual o nome do seu filho(a)?</label><input id="pf-name" maxlength="24" placeholder="Nome da criança" value="${hasKid(state.profile)?escHtml(pname(state.profile)):''}"></div>
    <button class="btn" onclick="saveProfName()">Atualizar</button>
    ${hasKid(state.profile)&&activeKids().length>1?`<button class="btn ghost" style="margin-top:10px;color:var(--red)" onclick="removeKid()">Excluir perfil</button>`:''}`;
}
function saveProfName(){
  var el=document.getElementById('pf-name'); var v=cleanName(el&&el.value);
  if(!v){ toast('Digite o nome do seu pequeno 🙂'); if(el) el.focus(); return; }
  state.names=state.names||{}; state.names[state.profile]=v; save();
  toast('Perfil atualizado ✓'); render(); openProfile();
}
function addKid(){ for(var i=0;i<PROFILES.length;i++){ if(!hasKid(i)){ state.profile=i; save(); profTab='edit'; openProfile(); setTimeout(function(){ var e=document.getElementById('pf-name'); if(e){ e.value=''; e.focus(); } },120); return; } } toast('Você já adicionou o máximo de crianças 🙂'); }
function removeKid(){ if(!confirm('Excluir o perfil de '+pname(state.profile)+'?')) return; if(state.names) delete state.names[state.profile]; if(state.photos) delete state.photos[state.profile]; state.profile=(activeKids()[0]!==undefined?activeKids()[0]:0); save(); render(); openProfile(); toast('Perfil removido'); }
function setProfTab(t){ profTab=t; $('#prof-body').innerHTML=profBody(PROFILES[state.profile]); $('.ov .seg').querySelectorAll('button').forEach((b,i)=>b.classList.toggle('on',(i===0)===(t==='stats'))); }
function setProfile(i){ state.profile=i; save(); openProfile(); }
/* O balão era renderizado toda vez, sem botão e sem memória — não saía nunca, e
   ainda cobria os avatares que ele mesmo estava explicando. */
function fecharCoach(btn){
  state.coachPerfil=1; save();
  var c=btn&&btn.closest('.coach'); if(!c) return;
  c.style.opacity='0'; c.style.transform='translateY(-6px)';
  setTimeout(function(){ if(c.parentNode) c.parentNode.removeChild(c); }, 260);
}

/* ============================================================
   SETTINGS
   ============================================================ */
function openSettings(){
    const rows=[
    // só aparece pra quem ainda não tem o ícone na tela (quem já instalou não precisa ver)
    ...(jaInstalado() ? [] : [['instalar','Instalar na tela inicial','askInstall()']]),
    ['share','Compartilhe com amigos!','share()'],
    ['faq','Perguntas Frequentes','openSettingsFaq()'],
    ['presente','Presentear assinatura','toast(\'Em breve: presentear uma assinatura 🎁\')'],
    // abria o SITE DE VENDAS — quem clica em "avaliar" quer avaliar, e caía num
    // checkout. Agora vai pra ficha da Play, onde a avaliação realmente acontece.
    ['estrela','Deixe uma avaliação!',"window.open('https://play.google.com/store/apps/details?id=br.com.aventuracomjesus','_blank')"],
    'div',
    ['conteudo','Configurações de conteúdo','openContentSettings()','chev'],
    ['lembrete','Lembretes','openReminders()','val:'+state.settings.reminder],
    'div',
    ['conta','Minha conta','openAccount()','chev'],
    ['assinatura','Minha assinatura','openSubscription()','chev'],
    ['contato','Fale conosco','openContact()','chev'],
  ];
  elOv.style.display='block';
  elOv.innerHTML=`<div class="ov"><div class="ovtop"><button class="iconbtn" aria-label="Voltar" onclick="closeOverlays()">‹</button><b>Ajustes</b><span style="width:40px"></span></div>
    <div class="body" style="padding:0 16px 40px"><div class="setlist">
      ${rows.map(r=>{
        if(r==='div') return `<div class="setdiv"></div>`;
        const [ic,label,act,extra]=r;
        let right=`<span class="ch">›</span>`;
        if(extra && extra.startsWith('val:')) right=`<span class="val">${extra.slice(4)}</span>`;
        return `<button class="setrow" onclick="${act}"><i class="si si-${ic}"></i>${label}${right}</button>`;
      }).join('')}
      <div style="text-align:center;margin-top:24px" onclick="notifStatsTap()"><img src="assets/img/jesus_avatar.webp?v=29" alt="" style="width:64px;height:64px;border-radius:50%;object-fit:cover;box-shadow:0 2px 10px rgba(0,0,0,.35)"><div class="muted" style="font-weight:800;font-size:16px;margin-top:6px">Aventura com Jesus</div></div>
    </div></div></div>`;
}

function openContentSettings(){
  const s=state.settings;
  elOv.innerHTML=`<div class="ov"><div class="ovtop"><button class="iconbtn" aria-label="Voltar" onclick="openSettings()">‹</button><b>Configurações de conteúdo</b><span style="width:40px"></span></div>
    <div class="body" style="padding:0 16px 40px"><div class="setlist">
      <div class="setrow"><i class="si si-idioma"></i>Idioma
        <select class="select" onchange="state.settings.lang=this.value;save()">${['English','Português','Español'].map(l=>`<option ${l===s.lang?'selected':''}>${l}</option>`).join('')}</select></div>
      <div class="setrow"><i class="si si-fe"></i>Tradição de fé
        <select class="select" onchange="state.settings.faith=this.value;save()">${['Católica','Protestante / Evangélica','Não denominacional / Independente','Ortodoxa (Oriental)','Outra'].map(f=>`<option ${f===s.faith?'selected':''}>${f}</option>`).join('')}</select></div>
      <div class="setrow"><i class="si si-duracao"></i>Mostrar duração das histórias/sessões<button class="toggle ${s.dur?'on':''}" role="switch" aria-label="Mostrar duração das histórias e sessões" aria-checked="${s.dur?'true':'false'}" onclick="state.settings.dur=!state.settings.dur;save();this.classList.toggle('on');this.setAttribute('aria-checked',state.settings.dur?'true':'false')"></button></div>
      <div class="setrow"><img class="si-davi" src="assets/img/pet_ic_mood.webp?v=13" alt="">Bichinho<button class="toggle ${s.pet?'on':''}" role="switch" aria-label="Mostrar o bichinho Davi" aria-checked="${s.pet?'true':'false'}" onclick="togglePet(this)"></button></div>
      <button class="setrow" onclick="toast('Nenhum conteúdo oculto por aqui 🙂')"><i class="si si-oculto"></i>Ver conteúdo oculto<span class="ch">›</span></button>
    </div></div></div>`;
}
function togglePet(btn){ state.settings.pet=!state.settings.pet; save(); btn.classList.toggle('on'); btn.setAttribute('aria-checked',state.settings.pet?'true':'false'); toast(state.settings.pet?'Davi ativado':'Davi escondido');
  if(!state.settings.pet && TAB==='theo') TAB='today';
  renderTabs(); render(); }  // some/reaparece a aba + seção do Davi na hora

function openAddDevice(){
  elOv.innerHTML=`<div class="ov"><div class="ovtop"><button class="iconbtn" aria-label="Voltar" onclick="openSettings()">‹</button><b>Usar a conta em outro aparelho</b><span style="width:40px"></span></div>
    <div class="body" style="padding:0 18px 40px">
      <h2 style="text-align:center;font-size:22px;line-height:1.25;margin:18px 0 22px">Siga estes passos para usar sua conta em um novo aparelho.</h2>
      <div class="step-t">1. Confirme seu e-mail e crie uma senha</div>
      <p class="muted" style="margin:6px 0 16px">Você precisa confirmar seu e-mail e criar uma senha.</p>
      <button class="btn" onclick="toast('Confirme seu e-mail em Minha conta')">Atualizar minhas informações</button>
      <div class="step-t" style="margin-top:24px">2. Baixe o app no novo aparelho</div>
      <div class="step-t" style="margin-top:20px">3. Entre com seu e-mail pessoal e senha</div>
    </div></div>`;
}
function openContact(){
  elOv.innerHTML=`<div class="ov"><div class="ovtop"><button class="iconbtn" aria-label="Voltar" onclick="openSettings()">‹</button><b>Fale conosco</b><span style="width:40px"></span></div>
    <div class="body" style="padding:0 16px 40px">
      <p class="muted" style="margin:12px 2px 18px">Dúvidas, cancelamento, reembolso ou sugestões? Escreva pra gente — respondemos com carinho. 💛</p>
      <button class="btn" style="display:block;width:100%" onclick="openSupport()">✉️ Falar com o suporte</button>
      <p class="muted" style="font-size:12px;margin-top:12px;text-align:center">contato@aventuracomjesus.com</p>
    </div></div>`;
}
function resetAppData(){ if(confirm('Apagar todos os dados do app neste aparelho? Isso remove progresso, fotos e preferências e não pode ser desfeito.')){ try{ localStorage.removeItem(LS); }catch(_){} location.reload(); } }
function openAccount(){
  const email=(state.user&&state.user.email)||'Conta neste dispositivo';
  const ph=state.photos&&state.photos['acct'];
  elOv.innerHTML=`<div class="ov"><div class="ovtop"><button class="iconbtn" aria-label="Voltar" onclick="openSettings()">‹</button><b>Minha conta</b><span style="width:40px"></span></div>
    <div class="body" style="padding:0 16px 40px">
      <div class="acct-head">
        <div class="acct-av">${ph?`<img class="av-img" src="${ph}" alt="">`:'<span>👤</span>'}</div>
        <div class="acct-email">${escHtml(email)}</div>
      </div>
      <div class="setlist" style="margin-top:8px">
        ${(state.user&&state.user.email)?`<button class="setrow" onclick="logout()"><i class="si si-sair"></i>Sair da conta<span class="ch">›</span></button>`:''}
        <button class="setrow" onclick="resetAppData()"><i class="si si-apagar"></i><span style="color:var(--red)">Apagar dados do app</span><span class="ch">›</span></button>
      </div>
      <div class="acct-sub">Minhas crianças</div>
      ${activeKids().map(i=>`<button class="child-row" onclick="setProfile(${i})"><span class="child-av">${avInner(i)}</span><div class="child-info"><b>${escHtml(pname(i))}</b><div class="muted">Estatísticas e perfil</div></div><span class="ch">›</span></button>`).join('')}
      ${activeKids().length<PROFILES.length?`<button class="child-row" onclick="addKid()"><span class="child-av">＋</span><div class="child-info"><b>Adicionar criança</b><div class="muted">Novo perfil</div></div><span class="ch">›</span></button>`:''}
    </div></div>`;
}
/* foto da conta do adulto REMOVIDA junto com a da criança (mesma câmera, mesmo motivo).
   Quem já tinha continua vendo a dela — o avInner/acct-av ainda renderiza state.photos. */

function openSubscription(){
  track('viu_assinatura');
  const left=trialDaysLeft(), inTrial=left>0, sub=state.subscribed;
  const statusLine = sub
    ? '✅ Assinatura ativa. Obrigado por apoiar a Aventura!'
    : inTrial
      ? `🎁 Teste grátis: <b>${left} ${left===1?'dia restante':'dias restantes'}</b>.`
      : 'Seu teste grátis terminou. Assine para continuar a aventura.';
  elOv.innerHTML=`<div class="ov"><div class="ovtop"><button class="iconbtn" aria-label="Voltar" onclick="openSettings()">‹</button><b>Minha assinatura</b><span style="width:40px"></span></div>
    <div class="body" style="padding:0 16px 40px">
      <div class="subcard">
        <div style="font-weight:800;font-size:18px;color:var(--gold)">Aventura Premium</div>
        <p class="muted" style="margin:6px 0 2px">${statusLine}</p>
        <p class="muted" style="margin:0">Depois dos 7 dias de teste grátis, a assinatura é cobrada automaticamente. Cancele quando quiser.</p>
        <div style="text-align:center;font-weight:800;font-size:16px;margin-top:18px">Seu plano inclui:</div>
        <div style="margin-top:12px">${SUB_BENEFITS.map(b=>`<div class="perk">🔥 ${b}</div>`).join('')}</div>
        <p class="muted" style="font-size:12px;margin-top:12px"><a href="javascript:void(0)" onclick="openLegal('termos.html','Termos de Uso')" style="color:inherit;text-decoration:underline">Termos de Uso</a> · <a href="javascript:void(0)" onclick="openLegal('privacidade.html','Política de Privacidade')" style="color:inherit;text-decoration:underline">Política de Privacidade</a></p>
        ${sub?'':`<button class="btn" style="margin-top:8px" onclick="startCheckout()">${inTrial?'ASSINAR AGORA':'REATIVAR ASSINATURA'}</button>`}
        <p class="muted" style="font-size:12px;margin-top:12px;text-align:center"><a href="javascript:void(0)" onclick="openSupport('Cancelamento ou reembolso — Aventura com Jesus','Olá! Quero cancelar ou pedir reembolso da minha assinatura da Aventura com Jesus. Meu e-mail da compra é: ')" style="color:inherit;text-decoration:underline">Cancelar ou pedir reembolso</a></p>
      </div>
    </div></div>`;
}
/* monta a URL do checkout/renovação acrescentando &e=<email> (quando houver e-mail),
   pra o funil já conhecer quem está pagando. Usa STRIPE_CHECKOUT_URL como base. */
function checkoutUrl(){
  const base = window.STRIPE_CHECKOUT_URL;
  if(!base) return '';
  const mail = (state.user && state.user.email) || '';
  return mail ? base + '&e=' + encodeURIComponent(mail) : base;
}
/* abre link externo (checkout/renovação) sem virar beco: usa Capacitor Browser se houver,
   senão window.open; se o popup for bloqueado (retorna null no WebView), navega a própria view
   — o listener appStateChange revalida o entitlement quando o usuário volta do Stripe. */
function openExternal(url){
  if(!url) return;
  var nat=!!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  var B=window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Browser;
  if(nat && B && B.open){ try{ B.open({url:url}); return; }catch(_){} }
  var w=null; try{ w=window.open(url,'_blank'); }catch(_){}
  if(!w) location.href=url;
}
/* suporte por WhatsApp (cancelamento/reembolso/dúvidas) — msg pré-preenchida pra colher o e-mail da compra */
/* suporte por e-mail (cancelamento/reembolso/dúvidas) — WhatsApp descontinuado (número banido pela Meta);
   corpo pré-preenchido pra já colher o e-mail da compra e agilizar o atendimento */
var SUPPORT_EMAIL='contato@aventuracomjesus.com';
function openSupport(subject,msg){ location.href='mailto:'+SUPPORT_EMAIL+'?subject='+encodeURIComponent(subject||'Ajuda — Aventura com Jesus')+'&body='+encodeURIComponent(msg||'Olá! Preciso de ajuda com a Aventura com Jesus. Meu e-mail da compra é: '); }
function openWaSupport(msg){ openSupport('Ajuda — Aventura com Jesus', msg); } /* compat: era WhatsApp, agora abre e-mail */
/* hand-off do pagamento: o dev seta window.STRIPE_CHECKOUT_URL (Payment Link) ou liga ao /api/create-subscription */
function startCheckout(){
  track('clicou_assinar');
  const url = checkoutUrl();
  if(url){ openExternal(url); return; }
  toast('💳 Pagamento via Stripe — em breve');
}
/* abre Termos/Privacidade (arquivos html empacotados no app, funciona offline) */
function openLegal(file,title){
  elOv.style.display='block';
  elOv.innerHTML=`<div class="ov"><div class="ovtop"><button class="iconbtn" aria-label="Voltar" onclick="closeOverlays()">‹</button><b>${title}</b><span style="width:40px"></span></div>
    <div class="body" style="padding:0 16px 40px"><div class="legal-body" id="legal-body"><p class="muted">Carregando…</p></div></div></div>`;
  fetch(file).then(r=>r.text()).then(html=>{
    const m=html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const inner=(m?m[1]:html).replace(/<a class="back"[\s\S]*?<\/a>/i,'');
    const el=document.getElementById('legal-body'); if(el) el.innerHTML=inner;
  }).catch(()=>{ const el=document.getElementById('legal-body'); if(el) el.innerHTML='<p>Não foi possível abrir o documento.</p>'; });
}

function openSettingsFaq(){ const FAQ=SETTINGS_FAQ;
  elOv.innerHTML=`<div class="ov"><div class="ovtop"><button class="iconbtn" aria-label="Voltar" onclick="openSettings()">‹</button><b>Perguntas Frequentes</b><span style="width:40px"></span></div>
    <div class="body" style="padding:0 16px 40px">${FAQ.map(f=>`<details class="acc"><summary>${f.q}<span>+</span></summary><p>${f.a}</p></details>`).join('')}</div></div>`;
}
function openPetFaq(){
  renderHeader({hide:true}); elOv.style.display='block';
  elOv.innerHTML=`<div class="ov"><div class="ovtop"><button class="iconbtn" aria-label="Voltar" onclick="closeOverlays()">‹</button><b>Sobre o Davi</b><span style="width:40px"></span></div>
    <div class="body" style="padding:0 16px 40px">${PET_FAQ.map(f=>`<details class="acc"><summary>${f.q}<span>+</span></summary><p>${f.a}</p></details>`).join('')}</div></div>`;
}

/* ---------------- init ---------------- */
/* data dinâmica do Evangelho do Dia (igual ao app nativo, sempre hoje) */
(function setGospelDate(){
  const g = byId('gospel-0625'); if(!g) return;
  const M=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const d=new Date(); const ds=`${d.getDate()} de ${M[d.getMonth()]}`;
  g.title=`Evangelho do Dia – ${ds}`; g.date=ds;
  if(typeof DAILY_READINGS!=='undefined' && DAILY_READINGS.length){
    const y0=new Date(d.getFullYear(),0,0);
    const doy=Math.floor((d - y0)/86400000);
    const pool=(typeof DR_NARRATED!=='undefined'&&DR_NARRATED.length)?DAILY_READINGS.filter(r=>DR_NARRATED.indexOf(r.id)>=0):DAILY_READINGS;
    const base=pool.length?pool:DAILY_READINGS;
    const rd=base[doy % base.length];
    g.daily=rd; g.readingTitle=rd.title;
    g.desc=`Hoje: ${rd.title}. “${rd.verse}”`;
    g.script=rd.script;
  }
})();

/* ---- dia / teste grátis / reset diário ---- */
function dayKey(d){ d=d||new Date(); return d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate(); }
function trialDaysLeft(){
  if(!state.trialStart) return 7;
  const p=String(state.trialStart).split('-'); const start=new Date(+p[0],+p[1]-1,+p[2]);
  const elapsed=Math.floor((new Date()-start)/86400000);
  return Math.max(0, 7-elapsed);
}
function canAccess(){
  if(state.subscribed) return true;                  // override manual (raro)
  if(state.ent){ return !!state.ent.active; }         // resposta do Stripe manda: ativo/trial = ok; cancelou/não pagou = bloqueia
  return !!(state.user && state.user.email) || trialDaysLeft()>0;   // ainda não checou (acabou de logar / 1ª vez offline): libera enquanto verifica
}
/* roda na abertura: avança/zera a ofensiva, reseta humor, marca o dia, inicia o trial */
function dailyReset(){
  const today=dayKey();
  if(!state.trialStart) state.trialStart=today;          // começa o teste grátis na 1ª abertura
  if(state.lastDay===today){ return; }                   // mesmo dia: nada muda
  if(state.lastDay){
    const y=new Date(); y.setDate(y.getDate()-1);
    state.streak = (state.lastDay===dayKey(y)) ? (state.streak||0)+1 : 1;  // consecutivo: ++ ; quebrou: 1
  }
  state.moodDone=false;                                  // novo dia: humor pode ser feito de novo
  state.doneToday=[];                                    // novo dia: missões voltam a poder ser feitas
  state.fedToday=0;                                      // novo dia: 3 alimentadas de novo
  const wd=(new Date().getDay()+6)%7; if(Array.isArray(state.week)) state.week[wd]=1;  // marca hoje
  state.lastDay=today;
  save();
}

/* ============================================================
   LEMBRETES + NOTIFICAÇÕES (Capacitor LocalNotifications no app nativo)
   ============================================================ */
function openReminders(){
  elOv.innerHTML=`<div class="ov"><div class="ovtop"><button class="iconbtn" aria-label="Voltar" onclick="openSettings()">‹</button><b>Lembretes</b><span style="width:40px"></span></div>
    <div class="body" style="padding:0 16px 40px">
      <p class="muted" style="margin:8px 2px 18px">Escolha o horário do lembrete diário. Todo dia nesse horário você recebe uma notificação pra viver um momento com Deus.</p>
      <div class="field"><label>Horário do lembrete</label><input type="time" id="rem-time" value="${state.settings.reminder||'20:00'}"></div>
      <button class="btn" style="margin-top:10px" onclick="saveReminder()">Salvar lembrete</button>
    </div></div>`;
}
function saveReminder(){
  const v=(document.getElementById('rem-time')||{}).value;
  if(v){ state.settings.reminder=v; save(); setupReminders(); toast('⏰ Lembrete salvo para '+v); }
  openSettings();
}
/* —— NOTIFICAÇÕES DE RETENÇÃO (estilo Duolingo: o Davi faz drama/saudade) ——
   Cada variante tem um id pra MEDIR qual copy traz mais gente de volta.
   {dias} é trocado pela sequência atual. */
/* —— NOTIFICAÇÕES DE RETENÇÃO (falando com a MÃE, puxando pra Deus) ——
   A copy é escolhida pelo CONTEXTO: domingo, dias de ausência REAIS, horário (noite=oração
   pra dormir), sequência. O id da categoria é o que a métrica compara.
   {dias} = nº real de dias (ausência) ou da sequência. */
const NOTIF_MSGS = {
  domingo: [
    {title:'Feliz domingo! ☀️🙏', body:'Dia do Senhor — que tal uma historinha sobre Jesus com seu pequeno hoje?'},
    {title:'Domingo é dia de Deus 💛', body:'Comece a semana plantando uma sementinha de fé no coração da sua criança.'},
  ],
  ausencia_longa: [
    {title:'Faz {dias} dias que o Davi não vê vocês 🥺', body:'Ele tá com saudade... mas guardou um momento com Jesus esperando seu pequeno voltar 💛'},
    {title:'{dias} dias sem um momento com Deus 😢', body:'O Davi entende a correria da vida de mãe, mas a fé do seu filho merece uns minutinhos hoje.'},
  ],
  ausencia: [
    {title:'Faz {dias} dias que vocês não aparecem 👀', body:'O Davi preparou uma história nova e tá esperando seu pequeno com carinho 💛'},
    {title:'Cadê vocês? 🫏💛', body:'Já faz {dias} dias... que tal um momentinho com Jesus hoje antes de dormir?'},
  ],
  noite: [
    {title:'Hora da oração antes de dormir 🌙🙏', body:'O Davi preparou uma oração pra acalmar o coração da sua criança hoje.'},
    {title:'Boa noite com Deus 🌙', body:'Que tal terminar o dia agradecendo a Deus junto com seu pequeno?'},
    {title:'Uma historinha pra dormir em paz 🌙📖', body:'O Davi separou uma aventura bíblica pra ninar o coração do seu filho.'},
  ],
  dia: [
    {title:'Uma sementinha de fé hoje 🌱', body:'O coração do seu pequeno floresce com cada história da Bíblia. Vamos plantar a de hoje?'},
    {title:'Deus tem algo lindo pra falar hoje 🕊️', body:'Reserve um momentinho com sua criança pra ouvir Ele.'},
    {title:'Que tal agradecer a Deus juntos? 🙏✨', body:'Um momento de gratidão em família aquece o coração de todo mundo.'},
  ],
  streak: [
    {title:'{dias} dias de fé seguidos! 🔥', body:'Que hábito lindo vocês construíram — não deixe esfriar. Só um minutinho com Deus hoje 💛'},
    {title:'A sequência de fé tá em {dias} 🔥', body:'Seu pequeno tá criando um hábito eterno. Bora manter viva hoje?'},
  ],
};
const NOTIF_LABELS = { domingo:'☀️ Domingo', ausencia_longa:'🥺 Sumiço 4+ dias', ausencia:'👀 Sumiço 2-3 dias', noite:'🌙 Oração / noite', dia:'🌱 Fé do dia', streak:'🔥 Sequência' };
/* escolhe a categoria pelo contexto da data agendada + estado. offset = dias desde a última abertura */
function pickNotif(date, offset){
  const dow=date.getDay(), hr=date.getHours();
  let cat;
  if(offset>=4) cat='ausencia_longa';
  else if(dow===0) cat='domingo';
  else if(offset>=2) cat='ausencia';
  else if((state.streak||0)>=3 && offset===1) cat='streak';
  else if(hr>=18 || hr<6) cat='noite';
  else cat='dia';
  const pool=NOTIF_MSGS[cat]||NOTIF_MSGS.dia;
  const msg=pool[Math.floor(date.getTime()/86400000) % pool.length];   // rodízio determinístico por data
  const dias=(cat==='streak') ? (state.streak||1) : offset;
  return { id:cat, title:msg.title.replace('{dias}', String(dias)), body:msg.body.replace('{dias}', String(dias)) };
}
/* agenda os próximos 7 dias, copy escolhida pelo contexto, no horário do lembrete */
function scheduleRetentionNotifs(){
  const LN = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications;
  if(!LN || !LN.schedule) return;
  state.notifStats = state.notifStats || {sent:{}, opened:{}};
  const p=(state.settings.reminder||'20:00').split(':');
  const h=parseInt(p[0],10)||20, m=parseInt(p[1],10)||0, DAY=86400000, now=Date.now();
  try{ LN.cancel({ notifications:[{id:777}] }); }catch(_){}   // remove o lembrete antigo único
  const notifs=[];
  for(let i=0;i<=6;i++){
    const at=new Date(); at.setHours(h,m,0,0); at.setDate(at.getDate()+i);
    if(at.getTime()<=now) continue;                          // nunca agenda no passado
    const dayIdx=Math.floor(at.getTime()/DAY);
    const msg=pickNotif(at, i);
    notifs.push({ id:1000+(dayIdx%100000), title:msg.title, body:msg.body,
      schedule:{ at }, smallIcon:'ic_stat_icon', iconColor:'#f0c14b', extra:{ variant:msg.id } });
    if(dayIdx > (state.notifLastDay||0)){ state.notifStats.sent[msg.id]=(state.notifStats.sent[msg.id]||0)+1; state.notifLastDay=dayIdx; }
  }
  save();
  try{ LN.schedule({ notifications: notifs }); }catch(e){}
}
async function setupReminders(){
  const LN = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications;
  if(!LN) return; // só roda dentro do app Android/iOS
  try{
    // atribuição da métrica: registra qual copy a pessoa TOCOU pra abrir o app
    if(!window.__notifAttach && LN.addListener){
      window.__notifAttach=true;
      LN.addListener('localNotificationActionPerformed', ev=>{
        const v=ev && ev.notification && ev.notification.extra && ev.notification.extra.variant;
        if(!v) return;
        state.notifStats=state.notifStats||{sent:{},opened:{}};
        state.notifStats.opened[v]=(state.notifStats.opened[v]||0)+1;
        state.notifStats.lastOpened={variant:v, at:new Date().toISOString()}; save();
        // hook p/ o dev agregar no funil: se houver endpoint, manda o evento
        if(window.ANALYTICS_URL){ try{ fetch(window.ANALYTICS_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event:'notif_open',variant:v,ts:Date.now()})}); }catch(_){} }
      });
    }
    const perm = await LN.requestPermissions();
    if(perm.display!=='granted') return;
    scheduleRetentionNotifs();
  }catch(e){}
}
/* painel oculto de métricas (toque 5x no rodapé dos Ajustes) */
let _nsTaps=0, _nsT=null;
function notifStatsTap(){ _nsTaps++; clearTimeout(_nsT); _nsT=setTimeout(()=>_nsTaps=0,1500); if(_nsTaps>=5){ _nsTaps=0; openNotifStats(); } }
function openNotifStats(){
  const s=state.notifStats||{sent:{},opened:{}};
  const rows=Object.keys(NOTIF_LABELS).map(id=>{ const sent=s.sent[id]||0, op=s.opened[id]||0; return {title:NOTIF_LABELS[id], sent, op, rate: sent?Math.round(op/sent*100):0}; })
    .sort((a,b)=> b.op-a.op || b.rate-a.rate);
  const best=rows.find(r=>r.op>0);
  elOv.style.display='block';
  elOv.innerHTML=`<div class="ov"><div class="ovtop"><button class="iconbtn" aria-label="Voltar" onclick="closeOverlays()">‹</button><b>📊 Notificações</b><span style="width:40px"></span></div>
    <div class="body" style="padding:0 14px 40px">
      <p class="muted" style="margin:10px 2px 14px">Desempenho de cada copy NESTE aparelho — mais "aberturas" = copy melhor. ${best?`🏆 Líder: <b>${best.title}</b>`:'(ainda sem aberturas registradas)'}</p>
      <table style="width:100%;border-collapse:collapse;font-size:12.5px">
        <tr style="text-align:left;color:var(--ink-soft,#9fb0c0)"><th style="padding:6px 4px">Copy</th><th style="text-align:center">Env.</th><th style="text-align:center">Abert.</th><th style="text-align:center">Taxa</th></tr>
        ${rows.map(r=>`<tr style="border-top:1px solid rgba(150,170,200,.15)"><td style="padding:9px 4px">${r.title}</td><td style="text-align:center">${r.sent}</td><td style="text-align:center;font-weight:800">${r.op}</td><td style="text-align:center">${r.rate}%</td></tr>`).join('')}
      </table>
      <p class="muted" style="font-size:11px;margin-top:18px">Dados deste dispositivo. Pra agregar entre todos os usuários no funil, o dev liga <code>window.ANALYTICS_URL</code> (já dispara um POST a cada abertura por notificação).</p>
    </div></div>`;
}

/* ============================================================
   BOAS-VINDAS (primeira abertura — opt-in de notificação)
   ============================================================ */
function openWelcome(){
  elOv.style.display='block';
  elOv.innerHTML=`<div class="ov welcome">
    <div class="welcome-body">
      <img class="welcome-logo" src="assets/img/logos/logo_aventura_branco.webp?v=42" alt="">
      <h2 class="welcome-h">Bem-vindo à Aventura com Jesus! 🙏</h2>
      <p class="welcome-p">Histórias bíblicas, meditações, orações e afirmações pra sua criança crescer na fé todos os dias — de um jeito leve, divertido e seguro.</p>
      <div class="welcome-feats">
        <div class="wf"><span>📖</span>Histórias ilustradas</div>
        <div class="wf"><span>🎧</span>Áudio e músicas</div>
        <div class="wf"><span>🔥</span>Sequência diária</div>
        <div class="wf"><span>🫏</span>O amiguinho Davi</div>
      </div>
      <button class="btn" onclick="finishWelcome(true)">Ativar lembrete diário 🔔</button>
      <button class="btn ghost" style="margin-top:10px" onclick="finishWelcome(false)">Agora não, começar</button>
    </div></div>`;
}
function finishWelcome(enableReminder){
  state.onboarded=true; save();
  closeOverlays();
  if(enableReminder){ setupReminders(); toast('🔔 Lembrete diário ativado para '+(state.settings.reminder||'20:00')); }
  ensureKidName();
}

/* —— captura do NOME REAL da criança (uma vez, logo após entrar) —— */
function ensureKidName(){ if(!hasKid(0)){ openNameCapture(); return true; } return false; }
function openNameCapture(){
  elOv.style.display='block';
  elOv.innerHTML=`<div class="ov welcome namecap">
    <div class="welcome-body">
      <img class="welcome-logo" src="assets/img/logos/logo_aventura_branco.webp?v=42" alt="">
      <div class="nc-ic">${ICONS.estrela}</div>
      <h2 class="welcome-h">Qual é o nome do seu pequeno?</h2>
      <p class="welcome-p">Vamos deixar a aventura com a carinha dele(a). Dá pra mudar depois lá no perfil.</p>
      <input id="nc-name" class="login-input" maxlength="24" placeholder="Nome da criança" autocomplete="off" autocapitalize="words" spellcheck="false" onkeydown="if(event.key==='Enter')saveNameCapture()">
      <button class="btn" style="margin-top:14px" onclick="saveNameCapture()">Começar a aventura ✨</button>
    </div></div>`;
  setTimeout(function(){ var e=document.getElementById('nc-name'); if(e) e.focus(); }, 250);
}
function saveNameCapture(){
  var el=document.getElementById('nc-name'); var v=cleanName(el&&el.value);
  if(!v){ toast('Digite o nome do seu pequeno 🙂'); if(el) el.focus(); return; }
  state.names=state.names||{}; state.names[0]=v; state.profile=0; save();
  closeOverlays(); render();
  primeiroPasso(v);   // nao larga a pessoa na Home: encadeia a primeira vitoria
}

/* ============================================================
   PRIMEIRA VITORIA — o passo que faltava depois do nome
   ============================================================
   Dado que motivou (23/08): das 16 contas, so 6 tinham QUALQUER XP; 8 pessoas
   entraram e nao completaram NADA. E o app tinha exatamente UM momento guiado —
   o nome do filho — que 12 de 13 completam (92%). Ou seja: quando existe um
   pedido claro, essa clientela obedece. So que esse momento terminava em
   'closeOverlays(); render(); toast()' e largava a mae numa Home cheia de opcoes.
   Escolha demais no primeiro contato = nenhuma escolha.

   Aqui a gente engata no passo que JA converte 92%% e oferece UMA acao curta,
   completavel na mesma sessao, que termina com XP e pao visiveis. Tutorial
   ensina; vitoria convence.
   ============================================================ */
var PRIMEIRO_CONTEUDO = 'afirm-amado';   // 'Sou Amado por Deus' — afirmacao de 2 min
function primeiroPasso(nome){
  try{ if(!byId(PRIMEIRO_CONTEUDO)){ render(); return; } }catch(_){ render(); return; }
  track('primeiro_passo','visto');
  state.ppSeen = state.ppSeen || Date.now(); save();   // lembra que a mae JA viu (a 2a chance decide por isto)
  elOv.style.display='block';
  elOv.innerHTML='<div class="ov welcome namecap"><div class="welcome-body">'
    +'<div class="nc-ic">'+ICONS.coracao+'</div>'
    +'<h2 class="welcome-h">A primeira de '+escHtml(nome)+'</h2>'
    /* O ARGUMENTO PRINCIPAL vem primeiro: a mae ja se sente culpada pelo tempo de
       tela com bobagem. 'Voce segura o celular, ela so escuta' desarma isso — nao e
       entregar o aparelho pra crianca, e ouvir junto. */
    +'<p class="welcome-p"><b>Nada de vídeo rolando sozinho. Aqui a '+escHtml(nome)+' faz.</b><br>Ela pinta com o dedinho, você do ladinho — 2 minutinhos, e no fim ela ganha o primeiro pão da aventura. 🥖</p>'
    +'<button class="btn" onclick="comecarPrimeiro()">Vamos pintar 🎨</button>'
    /* Sai de botao para link apagado: continua acessivel (nao prendo ninguem),
       mas para de disputar atencao com a acao que a gente quer. */
    +'<button onclick="pularPrimeiro()" style="margin-top:16px;background:none;border:none;color:#8b93a7;font-size:13px;text-decoration:underline;padding:6px">Agora não</button>'
    +'</div></div>';
}
/* 27/08: o primeiro passo levava pro audio de 2 min ('afirm-amado') e a medicao foi dura —
   de 6 que viram a tela, 4 pularam, 2 aceitaram e NENHUM concluiu (21 dos 26 pagantes com
   XP=0). No mesmo periodo o colorir fechou 57 de 60 desenhos abertos. Crianca de 4 anos nao
   fica 2 minutos ouvindo; fica 2 minutos pintando. Entao a primeira vitoria virou o colorir. */
function comecarPrimeiro(p){
  _ppPrefix = p || '';               // '2c_' quando veio da segunda chance — separa a medicao
  track('primeiro_passo', _ppPrefix + 'aceitou');
  _primeiroPendente = true;          // arma o 'concluiu' (o colorir e o player avisam)
  closeOverlays();
  // colorir.js carrega com defer; se por algum motivo nao estiver pronto, cai no audio
  if(typeof window.openColorir === 'function'){ window.openColorir(); return; }
  openDetail(PRIMEIRO_CONTEUDO);
}
function pularPrimeiro(p){ track('primeiro_passo', (p||'') + 'pulou'); closeOverlays(); render(); }

/* ============================================================
   SEGUNDA CHANCE do primeiro passo (31/08).
   Dado que motivou: 13 viram -> 9 PULARAM (69%) -> e o convite nunca mais
   aparecia. "Agora nao" de mae com pressa virava "nunca". Aqui, quem viu o
   convite, nao concluiu e continua com XP zero recebe o convite de novo numa
   VOLTA ao app — copy de retorno, nao de estreia.
   Respeito: no maximo 2 insistencias, com >=20h de espaco. Quem ja tem XP
   venceu por outro caminho e sai da mira pra sempre (ppDone).
   Retroativo de proposito: quem batizou a crianca antes desta versao ja viu o
   convite (ele vem grudado no nome), entao ppSeen ausente + nome + XP 0 conta
   como visto — e a 2a chance dispara ja na proxima abertura. Sao exatamente
   os 9 que pularam.
   ============================================================ */
function segundaChancePrimeiro(){
  try{
    if(state.ppDone) return false;
    if((state.xp||0) > 0){ state.ppDone = true; save(); return false; }
    if(!hasKid(0)) return false;                       // sem nome, o fluxo do nome vem primeiro
    if(!(state.user && state.user.email) && !window.__preview) return false;
    if(!state.ppSeen){ state.ppSeen = 1; save(); }     // retroativo (ver bloco acima)
    if((state.pp2c||0) >= 2) return false;
    if(Date.now() - Math.max(state.pp2cT||0, state.ppSeen) < 20*3600*1000) return false;
    state.pp2c = (state.pp2c||0) + 1; state.pp2cT = Date.now(); save();
    track('primeiro_passo','2c_visto');
    var nome = pname(state.profile||0);
    elOv.style.display='block';
    elOv.innerHTML='<div class="ov welcome namecap"><div class="welcome-body">'
      +'<div class="nc-ic">'+ICONS.pao+'</div>'
      +'<h2 class="welcome-h">Que bom te ver de volta!</h2>'
      +'<p class="welcome-p"><b>O primeiro pão da aventura ainda tá esperando.</b><br>2 minutinhos de pintura com o dedinho — você do ladinho — e '+escHtml(nome)+' ganha o primeiro pãozinho. 🥖</p>'
      +'<button class="btn" onclick="comecarPrimeiro(\'2c_\')">Vamos pintar 🎨</button>'
      +'<button onclick="pularPrimeiro(\'2c_\')" style="margin-top:16px;background:none;border:none;color:#8b93a7;font-size:13px;text-decoration:underline;padding:6px">Agora não</button>'
      +'</div></div>';
    return true;
  }catch(_){ return false; }
}

/* Fecha o funil da primeira sessao: visto -> aceitou -> CONCLUIU. Ate agora so dava pra
   inferir a conclusao pelo XP, que e indireto e chega dias depois. Vale uma vez por sessao
   e serve pros dois caminhos (colorir ou audio), por isso mora aqui e nao em cada um. */
var _primeiroPendente = false;
var _ppPrefix = '';   // '2c_' quando a vitoria veio da segunda chance
function marcaPrimeiroConcluido(){
  if(!_primeiroPendente) return;
  _primeiroPendente = false;
  track('primeiro_passo', _ppPrefix + 'concluiu');
  state.ppDone = true; save();   // venceu: sai da mira da segunda chance pra sempre
}
window.marcaPrimeiroConcluido = marcaPrimeiroConcluido;

/* —— LOGIN simples: identifica e registra o usuário no banco (o pagamento já foi no funil) —— */
function openLoginScreen(){
  elOv.style.display='block';
  var isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  var gBtn = isNative ? `
      <button class="btn google-btn" onclick="doGoogleLogin(this)">
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.83.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"/></svg>
        <span>Entrar com Google</span>
      </button>
      <div class="login-or"><span>ou com seu e-mail</span></div>` : '';
  elOv.innerHTML=`<div class="ov welcome login-ov">
    <div class="welcome-body">
      <img class="welcome-logo" src="assets/img/logos/logo_aventura_branco.webp?v=42" alt="">
      <h2 class="welcome-h">Bem-vindo! 🙏</h2>
      <p class="welcome-p">Faça seu login pra começar a aventura de fé do seu pequeno.</p>
      ${gBtn}
      <div class="login-fields">
        <input id="lg-name" class="login-input" type="text" placeholder="Seu nome" autocomplete="name">
        <input id="lg-email" class="login-input" type="email" placeholder="Seu e-mail" autocomplete="email" inputmode="email" autocapitalize="none" spellcheck="false">
      </div>
      <button class="btn login-btn" onclick="doLogin()">Entrar ✨</button>
      <p class="muted login-terms">Ao entrar você concorda com os <a href="javascript:void(0)" onclick="openLegal('termos.html','Termos de Uso')">Termos</a> e a <a href="javascript:void(0)" onclick="openLegal('privacidade.html','Política de Privacidade')">Privacidade</a>.</p>
    </div></div>`;
  setTimeout(()=>{ const e=$('#lg-name'); if(e) e.focus(); }, 250);
}
function doLogin(){
  const email=(($('#lg-email')||{}).value||'').trim().toLowerCase();
  const name=(($('#lg-name')||{}).value||'').trim();
  if(!email || email.indexOf('@')<1 || email.lastIndexOf('.')<email.indexOf('@') || !/^[^\s<>"]+@[^\s<>"]+\.[^\s<>"]+$/.test(email)){ toast('Ops, digite um e-mail válido 📧'); return; }
  state.user={ email, name }; state.onboarded=true; save();
  // registra no banco (best-effort — NUNCA bloqueia o usuário)
  const base=(window.API_BASE||'').replace(/\/$/,'');
  if(base){ try{ fetch(base+'/api/register',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({email,name,platform:(window.Capacitor&&window.Capacitor.getPlatform&&window.Capacitor.getPlatform())||'web'})}).catch(()=>{}); }catch(_){} }
  track('login', 'usuario', email);
  closeOverlays(); render(); checkEntitlement();
  toast('Que bom te ver, '+(name||'amiguinho')+'! 🙏');
  // liga no BackendTheo (Railway), sincroniza, e SÓ ENTÃO pergunta o nome do filho se faltar
  afterSync(appLogin(email, name).then(pullState), function(){ ensureKidName(); });
}
async function doGoogleLogin(btn){
  var GA = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.GoogleAuth;
  if(!GA){ toast('Login com Google indisponível aqui 🙏'); return; }
  if(btn){ btn.disabled=true; btn.dataset.t=(btn.querySelector('span')||{}).textContent||'Entrar com Google'; var sp=btn.querySelector('span'); if(sp) sp.textContent='Entrando…'; }
  try{
    try{ await GA.initialize(); }catch(_){}
    var u = await GA.signIn();
    var email = ((u && u.email)||'').trim().toLowerCase();
    var name  = ((u && (u.givenName||u.name||u.displayName))||'').trim();
    if(!email || email.indexOf('@')<1){ toast('Não consegui pegar seu e-mail do Google 😅'); if(btn){btn.disabled=false; var s2=btn.querySelector('span'); if(s2) s2.textContent=btn.dataset.t;} return; }
    state.user={ email, name }; state.onboarded=true; save();
    var base=(window.API_BASE||'').replace(/\/$/,'');
    if(base){ try{ fetch(base+'/api/register',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({email,name,platform:(window.Capacitor&&window.Capacitor.getPlatform&&window.Capacitor.getPlatform())||'web',via:'google'})}).catch(()=>{}); }catch(_){} }
    track('login','usuario',email);
    closeOverlays(); render(); checkEntitlement();
    toast('Que bom te ver, '+(name||'amiguinho')+'! 🙏');
    // liga no BackendTheo (Railway), sincroniza, e SÓ ENTÃO pergunta o nome do filho se faltar
    afterSync(appLogin(email, name).then(pullState), function(){ ensureKidName(); });
  }catch(e){
    if(btn){ btn.disabled=false; var s3=btn.querySelector('span'); if(s3) s3.textContent=btn.dataset.t||'Entrar com Google'; }
    toast('Login com Google não concluído.');
  }
}
function logout(){ if(confirm('Sair da conta?')){ state.user=null; state.ent=null; _locked=false; state._syncedAt=0; try{localStorage.removeItem('theo_jwt');}catch(_){} save(); openLoginScreen(); } }

/* ===== TRAVA DE ACESSO: o app pergunta ao Stripe se o e-mail tem assinatura ATIVA ===== */
var _locked=false;
/* CARÊNCIA PÓS-COMPRA — protege quem ACABOU de pagar.
   No trial a assinatura não existe no momento do redirect: ela nasce depois, no webhook
   (setup_intent.succeeded). Se a mãe fechar e reabrir o app nesse intervalo, o entitlement
   ainda não vê assinatura nenhuma e trancaria quem pagou agora — no pior momento possível.
   Por isso, nas primeiras 24h após o claim, uma resposta negativa NÃO tranca. */
var CLAIM_GRACE_MS = 24*60*60*1000;
function inClaimGrace(){ try{ return !!(state.claimedAt && (Date.now()-state.claimedAt) < CLAIM_GRACE_MS); }catch(_){ return false; } }
function recheckSub(){ toast('Verificando sua assinatura...'); checkEntitlement(); }
function checkEntitlement(){
  if(window.__preview) return;   // MODO PREVIEW (link secreto): não valida assinatura, não trava
  if(window.SKIP_SUB_CHECK) return;   // FASE DE VALIDAÇÃO BravoPay: não há ponte com /api/entitlement ainda, não trava ninguém
  if(!(state.user && state.user.email)) return;
  var base=(window.API_BASE||'').replace(/\/$/,'');
  if(!base) return;   // sem backend configurado: não trava (ex: rodando local/web dev)
  fetch(base+'/api/entitlement',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({email:state.user.email})})
    .then(function(r){ return r.json(); })
    .then(function(d){
      // comprou agora e o Stripe ainda não reflete? segura a onda em vez de trancar pagante
      if(!d.active && inClaimGrace()){
        state.ent={ active:true, status:'grace', ts:Date.now() }; save();
        if(_locked){ _locked=false; closeOverlays(); render(); }
        return;
      }
      state.ent={ active:!!d.active, status:(d&&d.status)||'', ts:Date.now() }; save();
      if(!state.ent.active){ showLockedScreen(); }
      else if(_locked){ _locked=false; closeOverlays(); render(); }   // renovou: solta
    })
    .catch(function(){ /* offline: mantém o último resultado salvo, não tranca agora */ });
}
function showLockedScreen(){
  _locked=true;
  elOv.style.display='block';
  var mail=(state.user&&state.user.email)||'';
  elOv.innerHTML='<div class="ov welcome login-ov"><div class="welcome-body">'
    +'<img class="welcome-logo" src="assets/img/logos/logo_aventura_branco.webp?v=42" alt="">'
    +'<h2 class="welcome-h">Sua assinatura não está ativa 🙏</h2>'
    +'<p class="welcome-p">Não encontramos uma assinatura ativa para <b>'+escHtml(mail)+'</b>. Renove para continuar a aventura de fé do seu pequeno.</p>'
    +'<button class="btn login-btn" onclick="openRenew()">Renovar assinatura</button>'
    +'<button class="btn ghost" style="margin-top:10px" onclick="recheckSub()">Já renovei — verificar</button>'
    +'<button class="btn google-btn" style="margin-top:10px" onclick="logout()"><span>Entrar com outro e-mail</span></button>'
    +'<p class="muted login-terms">Use o mesmo e-mail da sua compra. Dúvidas? <a href="mailto:contato@aventuracomjesus.com">contato@aventuracomjesus.com</a></p>'
    +'</div></div>';
}
function openRenew(){
  // abre o paywall do funil já com &e=<email> (quando houver), pra evitar beco sem saída de pagamento
  var url=checkoutUrl()||window.STRIPE_CHECKOUT_URL||window.API_BASE||'https://aventuracomjesus.com';
  openExternal(url);
}

/* rede de segurança: imagem que falha some (sem ícone de "quebrado") */
document.addEventListener('error', e=>{ const t=e.target; if(t&&t.tagName==='IMG'&&!t.dataset.fb){ t.dataset.fb='1'; t.style.visibility='hidden'; } }, true);

/* botão Voltar do Android (Capacitor): fecha overlay -> volta pra Home -> minimiza o app */
(function setupBackButton(){
  const App = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
  if(!App || !App.addListener) return;
  App.addListener('appStateChange', st=>{ if(st && st.isActive && state.user && state.user.email) checkEntitlement(); });  // revalida ao voltar do checkout
  App.addListener('backButton', ()=>{
    if(_locked || !(state.user && state.user.email)){ if(App.minimizeApp) App.minimizeApp(); else if(App.exitApp) App.exitApp(); return; }  // trancado/sem login: back minimiza, não dispensa
    const sv=document.getElementById('scriptov');
    if(sv && sv.classList.contains('show')){ closeScript(); return; }   // modo Texto aberto por cima do player: fecha só ele
    if(elOv && elOv.style.display==='block' && (elOv.innerHTML||'').trim()){ closeOverlays(); return; }
    if(TAB!=='today'){ go('today'); return; }
    if(App.minimizeApp) App.minimizeApp(); else if(App.exitApp) App.exitApp();
  });
})();

/* Gravação de sessão REMOVIDA (replay de tela em app infantil é incompatível com o
   Programa Famílias do Google Play). O SDK nativo nunca chegou a ser instalado. */

/* desbloqueia o áudio no 1º toque (alguns WebViews bloqueiam play sem gesto) */
(function unlockAudio(){
  function unlock(){
    if(bgAudio){ try{ bgAudio.muted=true; const p=bgAudio.play();
      if(p&&p.then) p.then(()=>{ bgAudio.pause(); bgAudio.currentTime=0; bgAudio.muted=false; }).catch(()=>{ bgAudio.muted=false; });
      else bgAudio.muted=false;
    }catch(_){ bgAudio.muted=false; } }
    document.removeEventListener('touchstart',unlock); document.removeEventListener('click',unlock);
  }
  document.addEventListener('touchstart',unlock,{once:true,passive:true});
  document.addEventListener('click',unlock,{once:true});
})();

/* ============================================================
   ACESSO PÓS-COMPRA (token) — a peça que faz o PWA funcionar de verdade.
   A pessoa paga e o Stripe devolve ela em  /app?s=<checkout_session_id>.
   O app troca esse id por uma SESSÃO real (JWT do backend) e guarda.
   Da 2ª abertura em diante ela entra sozinha, pelo ícone, sem digitar nada
   e sem token na URL — que é exatamente o que faltava no teste anterior.
   Segurança: o session_id só existe na URL de retorno de quem pagou, e é
   conferido direto na Stripe pelo /api/claim. Não dá pra chutar.
   ============================================================ */
function _claimApi(){ return (window.CLAIM_API || ((window.API_BASE||'').replace(/\/$/,'') + '/api/claim')); }
function _apiBase(){ return (window.API_BASE||'').replace(/\/$/,''); }

/* ---- LINK MÁGICO: a porta de VOLTA (cliente antigo, trocou de celular, limpou dados) ----
   Entra pelo ?t=<token> que chegou no e-mail. Mesmo desfecho do claim: vira sessão
   persistente, e a partir daí ela abre pelo ícone sem precisar de link nunca mais. */
async function magicAccess(codigoDigitado){
  var t=''; try{ t = new URLSearchParams(location.search).get('t') || ''; }catch(_){ }
  var cod = String(codigoDigitado || '').replace(/\D/g,'');
  if(!t && !cod) return false;
  var base=_apiBase(); if(!base) return false;
  try{
    const r = await fetch(base+'/api/magic-verify', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(cod ? { codigo: cod } : { t: t }) });
    const d = await r.json().catch(function(){ return null; });
    try{ history.replaceState({}, '', location.pathname); }catch(_){}   // tira o token da URL sempre
    if(!r.ok || !d || !d.ok || !d.email){ _magicExpirado = true; return false; }
    state.user = { email:(d.email||'').toLowerCase(), name: state.user && state.user.name || '' };
    state.ent  = { active:true, status:'magic', ts:Date.now() };
    state.onboarded = true; save();
    try{ fetch(base+'/api/register',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ email: state.user.email, name: state.user.name, platform:'pwa', via:'magic' })}).catch(()=>{}); }catch(_){}
    track('login','usuario',state.user.email);
    await appLogin(state.user.email, state.user.name);
    return true;
  }catch(_){ return false; }
}
var _magicExpirado = false;

/* tela de "receba seu link" — mostrada no lugar do redirect quando o portão barra.
   Não dá acesso nenhum: só dispara o e-mail. Quem não tem a caixa de entrada não entra. */
function openMagicScreen(){
  elOv.style.display='block';
  var aviso = _magicExpirado
    ? '<p class="welcome-p" style="color:#ffb4b4">Esse link expirou ou já foi usado. Peça um novo abaixo. 🙏</p>' : '';
  elOv.innerHTML='<div class="ov welcome login-ov"><div class="welcome-body">'
    +'<img class="welcome-logo" src="assets/img/logos/logo_aventura_branco.webp?v=42" alt="">'
    +'<h2 class="welcome-h">Bem-vindo de volta! 🙏</h2>'
    +aviso
    +'<p class="welcome-p">Digite o e-mail da sua compra e enviamos um link pra você entrar — sem senha, sem complicação.</p>'
    +'<div class="login-fields"><input id="mg-email" class="login-input" type="email" placeholder="Seu e-mail" autocomplete="email" inputmode="email" autocapitalize="none" spellcheck="false"></div>'
    +'<button class="btn login-btn" id="mg-btn" onclick="pedirMagicLink(this)">Receber meu link</button>'
    /* JÁ TEM O CÓDIGO? — no iPhone o link do e-mail abre no Safari e não aqui dentro,
       então quem entra pelo ícone precisa de um caminho que não dependa de link. */
    +'<button class="perg-skip" style="margin-top:14px" onclick="abrirCampoCodigo()">Já tenho um código</button>'
    +'<p class="muted login-terms">Ainda não tem acesso? <a href="/baixar">Conheça o app</a></p>'
    +'</div></div>';
  setTimeout(function(){ var e=$('#mg-email'); if(e) e.focus(); }, 250);
}
/* ENTRADA POR CÓDIGO (08/09/2026) — o caminho de quem está no iPhone.
   O link do e-mail sempre abre no Safari, e o app da tela de início tem armazenamento
   separado: a mãe logava lá e o ícone continuava pedindo login. Digitar o código aqui
   dentro resolve porque não depende de qual app abre o quê. */
function abrirCampoCodigo(){
  elOv.innerHTML='<div class="ov welcome login-ov"><div class="welcome-body">'
    +'<img class="welcome-logo" src="assets/img/logos/logo_aventura_branco.webp?v=42" alt="">'
    +'<h2 class="welcome-h">Digite seu código</h2>'
    +'<p class="welcome-p">É o número de 6 dígitos que está no e-mail de acesso.</p>'
    +'<div class="login-fields"><input id="mg-cod" class="login-input" type="text" inputmode="numeric" maxlength="7" placeholder="000000" style="text-align:center;letter-spacing:6px;font-size:22px"></div>'
    +'<button class="btn login-btn" onclick="enviarCodigo(this)">Entrar</button>'
    +'<button class="perg-skip" style="margin-top:14px" onclick="openMagicScreen()">Não tenho código</button>'
    +'</div></div>';
  setTimeout(function(){ var e=$('#mg-cod'); if(e) e.focus(); }, 250);
}

async function enviarCodigo(btn){
  var el=$('#mg-cod'), cod=((el&&el.value)||'').replace(/\D/g,'');
  if(cod.length !== 6){ toast('O código tem 6 números'); return; }
  if(btn){ btn.disabled=true; btn.textContent='Entrando…'; }
  var ok=false;
  try{ ok = await magicAccess(cod); }catch(_){ }
  if(ok){ closeOverlays(); dailyReset(); render(); ensureKidName(); toast('Bem-vindo de volta!'); return; }
  if(btn){ btn.disabled=false; btn.textContent='Entrar'; }
  toast('Código inválido ou já usado. Peça um novo.');
}

function pedirMagicLink(btn){
  var el=$('#mg-email'), email=((el&&el.value)||'').trim().toLowerCase();
  if(!email || !/^[^\s<>"@]+@[^\s<>"@]+\.[^\s<>"@]+$/.test(email)){ toast('Ops, digite um e-mail válido 📧'); return; }
  var base=_apiBase(); if(!base){ toast('Tente de novo em instantes 🙏'); return; }
  if(btn){ btn.disabled=true; btn.textContent='Enviando…'; }
  fetch(base+'/api/magic-link',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:email})})
    .catch(function(){})
    .finally(function(){
      // resposta SEMPRE igual (o servidor não revela se o e-mail tem conta — evita descobrir quem é cliente)
      elOv.innerHTML='<div class="ov welcome login-ov"><div class="welcome-body">'
        +'<div style="font-size:54px;line-height:1;margin-bottom:6px">📬</div>'
        +'<h2 class="welcome-h">Enviamos seu acesso!</h2>'
        +'<p class="welcome-p">Se houver uma assinatura ativa para <b>'+escHtml(email)+'</b>, o e-mail chega em instantes. Ele vale por 7 dias.</p>'
        /* No iPhone o botão do e-mail abre no Safari, não aqui — por isso o e-mail traz
           também um código de 6 dígitos, que é o caminho que sempre funciona. */
        +'<p class="welcome-p" style="margin-top:4px">No e-mail tem um <b>código de 6 dígitos</b>. Se o botão não te trouxer pra cá, é só digitar ele:</p>'
        +'<div class="login-fields"><input id="mg-cod" class="login-input" type="text" inputmode="numeric" maxlength="7" placeholder="000000" style="text-align:center;letter-spacing:6px;font-size:22px" onkeydown="if(event.key===&quot;Enter&quot;)enviarCodigo(this)"></div>'
        +'<button class="btn login-btn" onclick="enviarCodigo(this)">Entrar com o código</button>'
        +'<p class="muted login-terms">Não chegou? Veja a caixa de spam ou fale com <a href="mailto:contato@aventuracomjesus.com">contato@aventuracomjesus.com</a></p>'
        +'</div></div>';
    });
}
async function claimAccess(){
  /* Provas de pagamento que chegam de volta com o comprador:
       ?si=seti_...              Stripe, trial (Elements embutido)
       ?sub=sub_...              Stripe, sem trial
       ?transactionReference=HP… Hotmart — nome do parâmetro é DELES, vem assim na
                                 página de obrigado; não dá pra renomear. */
  var si='', sub='', ht='';
  try{ const q=new URLSearchParams(location.search);
       si=q.get('si')||''; sub=q.get('sub')||'';
       ht=q.get('transactionReference')||q.get('ht')||''; }catch(_){ }
  if(!si && !sub && !ht) return false;
  try{
    const r = await fetch(_claimApi(), { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(ht ? { ht: ht } : (si ? { si: si } : { sub: sub })) });
    if(!r.ok) return false;
    const d = await r.json();
    if(!d || !d.ok || !d.email) return false;
    state.user = { email:(d.email||'').toLowerCase(), name: d.name || '' };
    state.ent  = { active:true, status:'paid', ts:Date.now() };
    state.claimedAt = Date.now();   // marca a compra — liga a carência (ver inClaimGrace)
    state.onboarded = true; save();
    try{ history.replaceState({}, '', location.pathname); }catch(_){}   // tira o token da URL
    /* registra no funil — é ISSO que alimenta o set 'users' que o BI usa pra medir ATIVAÇÃO
       ("pagou → abriu o app"). Sem esta chamada, quem entra pelo PWA nunca aparece como
       ativado e o canário pareceria fracasso mesmo funcionando. Best-effort, nunca bloqueia. */
    var _b=(window.API_BASE||'').replace(/\/$/,'');
    if(_b){ try{ fetch(_b+'/api/register',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ email: state.user.email, name: state.user.name, platform:'pwa', via:'claim' })}).catch(()=>{}); }catch(_){} }
    track('login','usuario',state.user.email);
    await appLogin(state.user.email, state.user.name);                  // vira sessão persistente (JWT)
    return true;
  }catch(_){ return false; }
}

/* ============================================================
   INSTALAR NA TELA INICIAL — o que faz a mãe VOLTAR.
   Ela não precisa instalar pra usar (já entra funcionando no navegador), mas sem
   um ícone na tela inicial ela fecha a aba e o app some da vida dela.
   No Android o Chrome deixa a gente disparar a instalação com UM TOQUE — muito
   melhor que ensinar menu. No iPhone não existe esse recurso: só o passo a passo
   do Compartilhar > Adicionar à Tela de Início, então ali mostramos o tutorial.
   ============================================================ */
var _instalador = null;   // evento guardado do Chrome (beforeinstallprompt)
window.addEventListener('beforeinstallprompt', function(e){ e.preventDefault(); _instalador = e; });
window.addEventListener('appinstalled', function(){ state.instalado = true; save(); toast('🎉 Pronto! O ícone já está na sua tela.'); });

function jaInstalado(){
  try{
    if(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
    if(navigator.standalone) return true;              // iOS
    return !!state.instalado;
  }catch(_){ return false; }
}
function _ehIOS(){ try{ return /iPad|iPhone|iPod/i.test(navigator.userAgent||''); }catch(_){ return false; } }
function canAskInstall(){
  if(jaInstalado()) return false;
  if(state.instalaAsked) return false;                 // uma vez só; depois fica em Ajustes
  if(!_instalador && !_ehIOS()) return false;          // sem suporte: não enche o saco
  return (state.missionsDone || []).length >= 1;       // só depois de entregar valor
}
function maybeAskInstall(){
  if(!canAskInstall()) return false;
  setTimeout(function(){ if(canAskInstall()) askInstall(); }, 900);
  return true;
}
/* UM pedido por momento. Instalar vem primeiro: sem ícone na tela ela não volta,
   e sem voltar o lembrete não serve pra nada. A notificação fica pro próximo conteúdo. */
function maybeAskDepoisDoConteudo(){
  if(maybeAskInstall()) return;
  maybeAskNotify();
}
function askInstall(){
  state.instalaAsked = true; save();
  elOv.style.display='block';
  var corpo = _ehIOS()
    ? '<p class="welcome-p">Deixe o Aventura com Jesus na tela do seu celular, pertinho, pra abrir quando quiser:</p>'
      +'<div style="text-align:left;max-width:300px;margin:0 auto 6px">'
      +'<p class="welcome-p" style="margin:8px 0">1. Toque em <b>Compartilhar</b> <span style="font-size:19px">&#x2B06;</span> na barra do Safari</p>'
      +'<p class="welcome-p" style="margin:8px 0">2. Escolha <b>Adicionar à Tela de Início</b></p>'
      +'<p class="welcome-p" style="margin:8px 0">3. Toque em <b>Adicionar</b> 💛</p>'
      +'</div>'
      +'<button class="btn login-btn" onclick="closeOverlays()">Entendi!</button>'
    : '<p class="welcome-p">Coloque o app na tela do seu celular pra abrir com um toque, igual a qualquer outro aplicativo. É rapidinho e não ocupa espaço.</p>'
      +'<button class="btn login-btn" onclick="instalarAgora(this)">Colocar na minha tela 💛</button>'
      +'<button class="btn ghost" style="margin-top:10px" onclick="closeOverlays()">Agora não</button>';
  elOv.innerHTML='<div class="ov welcome login-ov"><div class="welcome-body">'
    +'<div style="font-size:54px;line-height:1;margin-bottom:6px">📲</div>'
    +'<h2 class="welcome-h">Deixe o app à mão</h2>'
    + corpo
    +'</div></div>';
}
async function instalarAgora(btn){
  if(!_instalador){ closeOverlays(); toast('Use o menu do navegador → "Instalar app" 🙏'); return; }
  if(btn){ btn.disabled = true; }
  try{
    _instalador.prompt();
    var r = await _instalador.userChoice;              // a decisão da pessoa é do NAVEGADOR, não nossa
    track('instalar_pwa', 'escolha', (r && r.outcome) || '');
    if(!r || r.outcome !== 'accepted') toast('Sem problema! Você pode instalar depois em Ajustes 💛');
  }catch(_){ }
  _instalador = null;                                  // o evento só serve uma vez
  closeOverlays();
}

/* ============================================================
   NOTIFICAÇÃO — pedida no MOMENTO CERTO, não na abertura.
   A permissão do navegador só pode ser pedida UMA vez: se a pessoa negar,
   não dá pra pedir de novo (ela teria que ir nas configurações). Por isso
   só perguntamos DEPOIS de entregar valor — quando ela concluiu o 1º
   conteúdo e acabou de ver que o app é bom. Aceitação muito maior.
   ============================================================ */
function _notifSupported(){ return ('Notification' in window) && ('serviceWorker' in navigator); }
function canAskNotify(){
  if(!_notifSupported()) return false;
  if(Notification.permission !== 'default') return false;     // já respondeu (sim ou não) antes
  if(state.notifAsked) return false;                          // já perguntamos uma vez
  return (state.missionsDone || []).length >= 1;              // só depois do 1º conteúdo concluído
}
function maybeAskNotify(){
  if(!canAskNotify()) return;
  setTimeout(function(){ if(canAskNotify()) askNotify(); }, 900);   // deixa a celebração respirar
}
function askNotify(){
  state.notifAsked = true; save();
  elOv.style.display='block';
  elOv.innerHTML = '<div class="ov welcome login-ov"><div class="welcome-body">'
    + '<div style="font-size:54px;line-height:1;margin-bottom:6px">🔔</div>'
    + '<h2 class="welcome-h">Quer que eu lembre vocês amanhã?</h2>'
    + '<p class="welcome-p">Mando um lembrete carinhoso no horário que combina com a rotina do seu pequeno — pra fé virar hábito, um dia de cada vez.</p>'
    + '<button class="btn login-btn" onclick="enableNotify()">Sim, quero lembrar 💛</button>'
    + '<button class="btn ghost" style="margin-top:10px" onclick="closeOverlays()">Agora não</button>'
    + '</div></div>';
}
async function enableNotify(){
  closeOverlays();
  try{
    const perm = await Notification.requestPermission();
    if(perm !== 'granted'){ toast('Tudo bem! Você pode ativar depois nas configurações 🙏'); return; }
    const reg = await navigator.serviceWorker.ready;
    await subscribePush(reg);                     // inscreve no push (se houver chave VAPID)
    state.notifOn = true; save();
    reg.showNotification('Aventura com Jesus 🙏', {
      body: 'Prontinho! Vou lembrar vocês da próxima aventura de fé.',
      icon: 'assets/img/logos/app_icon_192.png',
      badge: 'assets/img/logos/app_icon_192.png',
      tag: 'acj-welcome'
    });
    toast('🔔 Lembretes ativados!');
    track('notif_permitida');
  }catch(_){ toast('Não consegui ativar os lembretes agora 🙏'); }
}
/* inscreve no Web Push e manda a inscrição pro backend (quem dispara é o cron do servidor).
   Sem VAPID configurada, segue só com notificação local — não quebra nada. */
function _urlB64ToU8(b64){
  const pad='='.repeat((4 - b64.length % 4) % 4);
  const raw=atob((b64+pad).replace(/-/g,'+').replace(/_/g,'/'));
  return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)));
}
async function subscribePush(reg){
  const key = window.VAPID_PUBLIC_KEY;
  if(!key) return null;                                   // ainda não configurado: notificação local só
  try{
    const sub = await reg.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey:_urlB64ToU8(key) });
    const api=_appApi();
    if(api && _jwt()){
      fetch(api+'/me/push', { method:'POST',
        headers:{ 'Authorization':'Bearer '+_jwt(), 'Content-Type':'application/json' },
        body: JSON.stringify({ sub: sub, tz: Intl.DateTimeFormat().resolvedOptions().timeZone || '' }) }).catch(()=>{});
    }
    return sub;
  }catch(_){ return null; }
}

// MODO PREVIEW (link secreto ?preview=davi2026): abre o conteúdo SEM login e SEM assinatura — só p/ demo/gravação, NÃO divulgar
/* O acesso de teste era só o parâmetro na URL. Instalado na tela inicial, o atalho
   abre o start_url do manifest — que não tem parâmetro nenhum —, então o app voltava
   a ser um visitante sem assinatura e caía na tela de bloqueio. Agora entrar uma vez
   com o parâmetro deixa a marca gravada, e o atalho vale como o link.
   Não afrouxa nada: quem não tem o link continua sem entrar. */
window.__preview = (function(){
  try{
    if(new URLSearchParams(location.search).get('preview')==='davi2026'){ state.prev='davi2026'; return true; }
    return state.prev==='davi2026';
  }catch(_){ return state.prev==='davi2026'; }
})();
if(window.__preview){ state.user = state.user || { email:'preview@aventuracomjesus.com', name:'Visitante' }; state.ent = { active:true, status:'preview', ts:Date.now() }; }
(async function boot(){
  const claimed = await claimAccess()          // voltou do funil com ?si=/?sub= -> entra já logado, sem digitar nada
              || await magicAccess();          // ou clicou no link mágico do e-mail (?t=) -> mesma coisa
  /* ENTRADA SÓ POR PROVA DE ACESSO (window.WEB_TOKEN_ONLY).
     O login por e-mail SEM SENHA é um buraco: quem souber o e-mail de um cliente entra.
     Com esta chave ligada o app web aceita só quem acabou de pagar (?si=/?sub=), quem
     clicou no link mágico (?t=), ou quem já tem sessão salva.
     Sem prova: com MAGIC_LINK ligado oferece o link por e-mail; senão manda pro /baixar. */
  if(window.WEB_TOKEN_ONLY && !window.__preview && !claimed && !(state.user && state.user.email)){
    if(window.MAGIC_LINK){ dailyReset(); render(); openMagicScreen(); return; }
    location.replace('/baixar'); return;
  }
  dailyReset();
  render();
  state.onboarded=true; save();
  if(window.__preview || claimed){ ensureKidName(); }   // preview/pós-compra/link mágico: entra direto no conteúdo
  // se ainda não logou, mostra a tela de login por cima (o app só registra; o pagamento já foi no funil)
  else if(!(state.user && state.user.email)) openLoginScreen();
  else { var _lk = false;
         if(!window.SKIP_SUB_CHECK){
           checkEntitlement();   // logado: valida assinatura no Stripe
           _lk = !!(state.ent && !state.ent.active) && !inClaimGrace(); if(_lk) showLockedScreen();   // trava aparece NA HORA (não espera o sync); quem comprou agora nunca é trancado
         }
         // liga/sincroniza com o BackendTheo e SÓ DEPOIS pergunta o nome do filho (evita pedir nome e o sync sobrescrever)
         var _sp = _jwt() ? pullState() : appLogin(state.user.email, state.user.name).then(pullState);
         if(!_lk) afterSync(_sp, function(){ ensureKidName(); }); }
  setupReminders();
  /* Cartaz de novidades por último e com guarda: só depois do splash sumir (2,6s) e
     só se NADA estiver aberto — senão apareceria por cima do login, da tela de
     bloqueio ou do "qual o nome do seu filho?". */
  /* A 2a chance do primeiro passo tem prioridade sobre o cartaz de novidades:
     ativacao vale mais que aviso. As guardas continuam: so com nada aberto. */
  /* O cartaz de NOVIDADES saiu do boot em 06/09: ele ainda anunciava a v166 (as 72
     figurinhas, de julho) — notícia velha ocupando a primeira tela de quem volta.
     O mecanismo continua inteiro: pra usar de novo numa entrega futura, é subir o
     NOVIDADE_V, reescrever os itens e voltar o `|| maybeNovidades()` aqui. */
  setTimeout(function(){ try{ if(!elOv.innerHTML.trim()) segundaChancePrimeiro(); }catch(_){ } }, 2800);
})();
(function initSplash(){
  const sp=document.getElementById('splash');
  setTimeout(()=>{ if(!sp) return; sp.classList.add('hide'); setTimeout(()=>sp.remove(),600); }, 2000);
})();

/* ============================================================
   HORA DA CONVERSA — o que acontece depois da história (06/09/2026)
   ------------------------------------------------------------
   A história terminava em nada: tocava, dava o pão e caía na tela de nota. E a
   cena que a VSL vende (mãe perguntando, criança respondendo) não existia em
   lugar nenhum do produto.

   Aqui quem pergunta é a MÃE — o app só serve a pergunta e ela toca no que a
   criança respondeu. Por isso não tem cronômetro, não tem placar, e ERRAR NÃO
   TIRA NADA: o prêmio é por participar. Criança que se sente testada não pede a
   história de novo, e a história é o que segura a assinatura.

   Vale uma vez por história (perg:<id> no state) pra não virar fazenda de pão.
   Prêmio calibrado abaixo da própria história (10 pães) e do colorir (6): 5.
   ============================================================ */
var PERG_PAO = 5, PERG_XP = 5;
var _pergId = null, _pergI = 0, _pergAcertos = 0;


function pergDe(id){
  try{ return (typeof PERGUNTAS !== 'undefined' && PERGUNTAS[id]) || null; }catch(_){ return null; }
}
/* já ganhou o prêmio dessa história? (o bônus é uma vez; a conversa pode repetir) */
function pergJaFeita(id){ return !!(state.perg && state.perg[id]); }

/* Chamado pelo finishPlay. Devolve true se assumiu a tela; false = segue o fluxo
   normal (tela de nota), que é o caminho de quem não tem pergunta ou já ganhou. */
function abrirPerguntas(id){
  var qs = pergDe(id);
  if(!qs || !qs.length || pergJaFeita(id)) return false;
  _pergId = id; _pergI = 0; _pergAcertos = 0;
  track('perguntas','visto');
  pergRender();
  return true;
}

function pergRender(){
  var qs = pergDe(_pergId); if(!qs) return pergSair();
  var q = qs[_pergI];
  var dots = qs.map(function(_,i){ return '<i class="'+(i<=_pergI?'on':'')+'"></i>'; }).join('');
  elOv.style.display='block';
  elOv.innerHTML =
    '<div class="ov perg"><div class="perg-body"><div class="perg-card">'
    + '<div class="perg-ic">'+ICONS.balao+'</div>'
    + '<div class="perg-ty">Hora da conversa</div>'
    + '<h2 class="perg-h">Pergunte para o seu pequeno</h2>'
    + '<p class="perg-sub">Toque na resposta que ele deu</p>'
    + '<div class="perg-dots">'+dots+'</div>'
    + '<p class="perg-q">'+escHtml(q.q)+'</p>'
    + '<div class="perg-ops">'
      + q.op.map(function(o,i){ return '<button class="perg-op" onclick="pergResponde('+i+')">'+escHtml(o)+'</button>'; }).join('')
    + '</div>'
    + '<button class="perg-skip" onclick="pergPula()">Agora não</button>'
    + '</div></div></div>';
}

function pergResponde(i){
  var qs = pergDe(_pergId); if(!qs) return pergSair();
  var q = qs[_pergI], acertou = (i === q.ok);
  if(acertou) _pergAcertos++;
  track('perguntas', acertou ? 'acertou' : 'quase');
  var ultima = (_pergI >= qs.length - 1);
  elOv.innerHTML =
    '<div class="ov perg"><div class="perg-body"><div class="perg-card">'
    + '<div class="perg-fb '+(acertou?'ok':'quase')+'">'
      + (acertou ? ICONS.ok : ICONS.coracao)
      + '<b>'+(acertou ? 'Isso mesmo!' : 'Quase!')+'</b>'
      + '<p>'+(acertou ? '' : 'Era <b style="display:inline;font-size:inherit">'+escHtml(q.op[q.ok])+'</b>. ')
      + escHtml(q.dica)+'</p>'
    + '</div>'
    + '<button class="btn" onclick="'+(ultima ? 'pergPremio()' : 'pergProxima()')+'">'
      + (ultima ? 'Ver a recompensa' : 'Próxima pergunta') + '</button>'
    + '</div></div></div>';
}

function pergProxima(){ _pergI++; pergRender(); }

function pergPremio(){
  var novo = !pergJaFeita(_pergId);
  if(novo){
    state.perg = state.perg || {};
    state.perg[_pergId] = 1;
    state.coins += PERG_PAO;
    state.xp += PERG_XP;
    try{ checkLevel(); }catch(_){ }
    save();
  }
  track('perguntas','concluiu');
  elOv.innerHTML =
    '<div class="ov perg"><div class="perg-body"><div class="perg-card">'
    + '<div class="perg-ic">'+ICONS.estrela+'</div>'
    + '<h2 class="perg-h">Que conversa linda!</h2>'
    + '<p class="perg-sub">Perguntar é do que eles mais lembram depois</p>'
    + (novo ? '<div class="perg-premio"><span><i class="pao"></i>+'+PERG_PAO+'</span><span>+'+PERG_XP+' XP</span></div>' : '')
    + '<button class="btn" onclick="pergSair()">Continuar</button>'
    + '</div></div></div>';
}

function pergPula(){ track('perguntas','pulou'); pergSair(); }

/* sai pra tela de nota — o encerramento que a história já tinha antes */
function pergSair(){
  var id = _pergId; _pergId = null;
  try{ if(id) ratingScreen(id); else closeOverlays(); }catch(_){ closeOverlays(); }
}
