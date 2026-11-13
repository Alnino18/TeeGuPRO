
function isDebtOrder(o) {
  if (!o || o.status === 'cancelled') return false;
  const p = (o.payment || '').toLowerCase();
  return (p === 'консигнация' || p === 'qarz' || p === 'nasiya' || p === 'долг') && !o.debtPaid;
}


// --- AUTHENTICATION LOGIC ---
const ADMIN_HASH = "240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9"; // admin123

async function sha256(message) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function checkAdminPassword() {
  const pwd = document.getElementById('adminPasswordInput').value;
  if(!pwd) return;
  const hash = await sha256(pwd);
  if(hash === ADMIN_HASH) {
    localStorage.setItem('adminAuth', hash);
    document.getElementById('loginOverlay').style.opacity = '0';
    setTimeout(() => { document.getElementById('loginOverlay').style.display = 'none'; }, 300);
    init(); // call the main init function
  } else {
    document.getElementById('loginError').style.display = 'block';
  }
}

function verifyAuth() {
  const auth = localStorage.getItem('adminAuth');
  if(auth === ADMIN_HASH) {
    document.getElementById('loginOverlay').style.display = 'none';
    init();
  } else {
    document.getElementById('loginOverlay').style.display = 'flex';
  }
}


const firebaseConfig = {
  apiKey: "AIzaSyBpa1Bfj4L8q1itRh1BjHgyzIyIi-rzmSk",
  authDomain: "dostavka-b53d8.firebaseapp.com",
  projectId: "dostavka-b53d8",
  storageBucket: "dostavka-b53d8.firebasestorage.app",
  messagingSenderId: "1029089462422",
  appId: "1:1029089462422:web:937317b437139f31771ab7"
};
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const db = firebase.firestore();
db.enablePersistence().catch(err => console.log("Firebase Offline Error:", err));

const DEFAULT_PRODUCTS=[
  {id:'funchoza', name:'Фунчоза',       nameUz:'Funchoza',        price:25000,cost:0,emoji:'🍜'},
  {id:'morkovcha',name:'Морковча',       nameUz:'Sabzi',           price:25000,cost:0,emoji:'🥕'},
  {id:'sologurc', name:'Сол огурцы',    nameUz:'Tuzlangan bodring',price:20000,cost:0,emoji:'🥒'},
  {id:'kapusta',  name:'Сладкая капуста',nameUz:'Shirin karam',   price:20000,cost:0,emoji:'🥬'},
  {id:'kuksi',    name:'Кукси',          nameUz:'Kuksi',           price:35000,cost:0,emoji:'🍝',unit:'шт',step:1},
];
let PRODUCTS = [];
let lang=localStorage.getItem('lang')||'ru';
let theme=localStorage.getItem('theme')||'dark';
let chartPeriod='week';
let partialClientId=null;
let editingClientId=null;
let editingOrderId=null;
let warehouseFilterStatus='all';

function roundQty(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

let state={
  clients: [],
  orders: [],
  settings: {},
  deliveryStatus: {},
  templates: [],
  couriers: [],
  agents: [],
  quantities:{},selectedPayment:'наличные',currentOrderId:null,dateFilter:'today',
};

// Real-time Listeners (started after authentication and script init)
let realtimeListenersStarted = false;
function startRealtimeListeners() {
  if (realtimeListenersStarted) return;
  realtimeListenersStarted = true;

  db.collection('products').onSnapshot(snap => {
    if (snap.empty) {
      PRODUCTS = DEFAULT_PRODUCTS;
      const batch = db.batch();
      PRODUCTS.forEach(p => batch.set(db.collection('products').doc(String(p.id)), p));
      batch.commit().catch(()=>{});
    } else {
      PRODUCTS = snap.docs.map(d => d.data()).filter(Boolean).sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
    }
    try { renderProductsGrid(); } catch(e) { console.error(e); }
    try { renderProductsSettings(); } catch(e) { console.error(e); }
    try { renderWarehouse(); } catch(e) { console.error(e); }
    try { updateWarehouseBadge(); } catch(e) {}
    try { renderDashboard(); } catch(e) { console.error(e); }
  }, err => console.warn('products snapshot warn:', err));

  db.collection('clients').onSnapshot(snap => {
    state.clients = snap.docs.map(d => {
      const data = d.data();
      if (!data.id) data.id = d.id;
      return data;
    });
    try { populateClientSelect(); } catch(e) { console.error("populateClientSelect error:", e); }
    try { renderClientsList(); } catch(e) { console.error("renderClientsList error:", e); }
    try { renderDashboard(); } catch(e) { console.error("renderDashboard error:", e); }
  });

  db.collection('orders').onSnapshot(snap => {
    isOrdersLoaded = true;
    state.orders = snap.docs.map(d => {
      const data = d.data();
      if (!data.id) data.id = d.id;
      return data;
    }).sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    try { renderOrdersList(); } catch(e) { console.error("renderOrdersList error:", e); }
    try { renderClientsList(); } catch(e) { console.error("renderClientsList error:", e); }
    try { renderStats(); } catch(e) { console.error("renderStats error:", e); }
    try { renderDebts(); } catch(e) { console.error("renderDebts error:", e); }
    try { renderDelivery(); } catch(e) { console.error("renderDelivery error:", e); }
    try { renderWarehouse(); } catch(e) {}
    try { renderFavorites(); } catch(e) { console.error("renderFavorites error:", e); }
    try { renderDashboard(); } catch(e) { console.error("renderDashboard error:", e); }
    try { updateBadges(); } catch(e) { console.error("updateBadges error:", e); }
    try { if (typeof checkAutoDailySummary === 'function') checkAutoDailySummary(); } catch(e) {}
  });

  db.collection('settings').doc('main').onSnapshot(snap => {
    if (snap.exists) {
      state.settings = snap.data();
      loadSettings();
      try {
        if (state.settings.uiConfig && typeof syncUiConfigFromRemote === 'function') {
          syncUiConfigFromRemote(state.settings.uiConfig);
        }
        if (Array.isArray(state.settings.businessRules) && typeof syncBusinessRulesFromRemote === 'function') {
          syncBusinessRulesFromRemote(state.settings.businessRules);
        }
        if (typeof renderWarehouseLogs === 'function') renderWarehouseLogs();
      } catch(e) { console.warn("Remote settings sync warning:", e); }
    }
  });

  db.collection('couriers').onSnapshot(snap => {
    state.couriers = snap.docs.map(d => d.data());
    try { renderCouriersSettings(); populateCourierSelects(); } catch(e) {}
  });

  db.collection('agents').onSnapshot(snap => {
    state.agents = snap.docs.map(d => d.data());
    try { renderAgentsSettings(); } catch(e) {}
  });

  db.collection('templates').onSnapshot(snap => {
    state.templates = snap.docs.map(d => d.data());
    try { renderTemplates(); } catch(e) {}
  });
}
let isOrdersLoaded = false;

function saveProducts() {
  const batch = db.batch();
  PRODUCTS.forEach(p => batch.set(db.collection('products').doc(String(p.id)), p));
  batch.commit().catch(()=>{});
}


// THEME
function applyTheme(){document.body.classList.toggle('light',theme==='light');document.getElementById('themeBtn').textContent=theme==='light'?'🌙':'☀️';}
function toggleTheme(){theme=theme==='dark'?'light':'dark';localStorage.setItem('theme',theme);applyTheme();}

// LANG
const T={
  ru:{headerSub:'Система управления заказами',noOrders:'Нет заказов',noClients:'Нет клиентов',noDebts:'Нет долгов! Все оплатили',totalOrders:'Всего заказов',todayOrders:'Сегодня',totalRev:'Сумма (so\'m)',todayRev:'Сегодня (so\'m)',products:'Продукты',avg:'Средний чек',weekDays:['Пн','Вт','Ср','Чт','Пт','Сб','Вс'],tomorrow:'Завтра'},
  uz:{headerSub:'Buyurtmalarni boshqarish',noOrders:'Buyurtma yo\'q',noClients:'Mijoz yo\'q',noDebts:'Qarz yo\'q! Hammasi to\'lashdi',totalOrders:'Jami buyurtmalar',todayOrders:'Bugun',totalRev:'Summa (so\'m)',todayRev:'Bugun (so\'m)',products:'Mahsulotlar',avg:'O\'rtacha chek',weekDays:['Du','Se','Ch','Pa','Ju','Sh','Ya'],tomorrow:'Ertaga'},
};

function applyLang(){
  const lb = document.getElementById('langBtn');
  if (lb) lb.textContent=lang==='ru'?'UZ':'RU';
  const hs = document.getElementById('headerSub');
  if (hs) hs.textContent=T[lang].headerSub;
  document.querySelectorAll('.t').forEach(el=>{const v=el.dataset[lang];if(v)el.textContent=v;});
  try { if (typeof applySavedUiRenames === 'function') applySavedUiRenames(); } catch(e) {}
  try { if (typeof updateAiUiAccessButtons === 'function') updateAiUiAccessButtons(); } catch(e) {}
  try { if (typeof updateAiTtsButton === 'function') updateAiTtsButton(); } catch(e) {}
  try { if (typeof updateAiVoiceLangButtons === 'function') updateAiVoiceLangButtons(); } catch(e) {}
  try { if (typeof updateAiRulesBadge === 'function') updateAiRulesBadge(); } catch(e) {}
}
function toggleLang(){lang=lang==='ru'?'uz':'ru';localStorage.setItem('lang',lang);applyLang();renderAll();}
function renderAll(){
  const tasks=[renderProductsGrid,renderOrdersList,renderClientsList,renderStats,renderDebts,renderDelivery,renderWarehouse,renderFavorites,renderDashboard,()=>typeof renderAiPage==='function'&&renderAiPage(),()=>typeof renderCustomUiButtons==='function'&&renderCustomUiButtons()];
  tasks.forEach(fn=>{try{fn();}catch(e){console.warn('renderAll warn:',e);}});
}

function printOrder(id) {
  const o = state.orders.find(x => x.id == id);
  if(!o) return;
  const d = new Date(o.date);
  const ds = isNaN(d.getTime()) ? '—' : (d.toLocaleDateString('ru-RU') + ' ' + d.toLocaleTimeString('ru-RU', {hour:'2-digit', minute:'2-digit'}));
  let html = `<div style="text-align:center; font-size:18px; font-weight:bold; border-bottom:1px dashed #000; padding-bottom:10px; margin-bottom:10px;">
    🥗 TeeGu.PRO
  </div>
  <div style="margin-bottom:10px;">
    <b>Чек:</b> #${String(o.id||'').slice(-4)}<br>
    <b>Дата:</b> ${ds}<br>
    <b>Клиент:</b> ${escapeHTML(o.client||'')}<br>
    ${o.phone ? `<b>Тел:</b> ${escapeHTML(o.phone)}<br>` : ''}
    ${o.address ? `<b>Адрес:</b> ${escapeHTML(o.address)}<br>` : ''}
    ${o.courier ? `<b>Курьер:</b> ${escapeHTML(o.courier)}<br>` : ''}
  </div>
  <table style="width:100%; border-collapse:collapse; margin-bottom:10px;">
    <tr style="border-bottom:1px solid #000;"><th style="text-align:left">Наим.</th><th style="text-align:right">Кол</th><th style="text-align:right">Сумма</th></tr>`;
  
  (o.items || []).forEach(i => {
    html += `<tr><td style="padding:2px 0;">${escapeHTML(i.name||i.nameUz||'')}</td><td style="text-align:right">${i.qty}${escapeHTML(i.unit||'кг')}</td><td style="text-align:right">${fmt((Number(i.qty)||0)*(Number(i.price)||0))}</td></tr>`;
  });
  
  html += `</table>
  <div style="font-size:16px; font-weight:bold; border-top:1px dashed #000; padding-top:10px; margin-bottom:10px;">
    ИТОГО: ${fmt(Number(o.total)||0)} сум
  </div>
  <div style="text-align:center; font-size:12px; font-style:italic;">
    Спасибо за покупку!<br>
    ${state.settings.phone ? 'Тел: ' + escapeHTML(state.settings.phone) : ''}
  </div>`;
  
  const pa = document.getElementById('print-area');
  if (pa) pa.innerHTML = html;
  window.print();
}

// INIT
function startApp(){
  try { startRealtimeListeners(); } catch(e) { console.error("listeners err:", e); }
  try { initAiUiController(); } catch(e) { console.warn("AI UI init warn:", e); }
  try { loadBusinessRules(); updateAiTtsButton(); } catch(e) {}
  try { applyTheme(); applyLang(); } catch(e) { console.warn("Theme/lang warn:", e); }
  try { renderProductsGrid(); } catch(e) { console.error("renderProductsGrid err:", e); }
  try { populateClientSelect(); renderClientsList(); } catch(e) { console.error("clients init err:", e); }
  try { renderOrdersList(); } catch(e) { console.error("renderOrdersList err:", e); }
  try { renderStats(); } catch(e) { console.error("renderStats err:", e); }
  try { renderDebts(); } catch(e) { console.error("renderDebts err:", e); }
  try { renderDelivery(); } catch(e) { console.error("renderDelivery err:", e); }
  try { renderWarehouse(); } catch(e) { console.error("renderWarehouse err:", e); }
  try { renderFavorites(); } catch(e) { console.error("renderFavorites err:", e); }
  try { loadSettings(); updateBadges(); renderProductsSettings(); renderCouriersSettings(); populateCourierSelects(); } catch(e) { console.error("settings/badges err:", e); }
  const partialEl = document.getElementById('partialAmount');
  if (partialEl) partialEl.addEventListener('input', updatePartialRemaining);
  try { renderDashboard(); } catch(e) { console.error("renderDashboard err:", e); }
  try { if (typeof renderAiPage === 'function') renderAiPage(); } catch(e) {}
  try { updateWarehouseBadge(); renderCustomUiButtons(); } catch(e) {}
  try { setupOfflineSync(); } catch(e) {}
  // Telegram Mini App init
  if(window.Telegram?.WebApp){window.Telegram.WebApp.ready();window.Telegram.WebApp.expand();}
  // Live dashboard refresh every 60s
  setInterval(()=>{const pg=document.getElementById('page-dashboard');if(pg&&pg.classList.contains('active'))renderDashboard();},60000);
}
function init(){
  startApp();
}


// ==================== TEMPLATES ====================
function saveTemplate(){
  const clientId=document.getElementById('clientSelect').value;
  const items=getOrderItems();
  if(!clientId||!items.length){showToast('⚠️ '+(lang==='uz'?'Mijoz va mahsulot tanlang':'Выберите клиента и продукты'),'error');return;}
  const client=state.clients.find(c=>c.id==clientId);
  const name=prompt(lang==='uz'?'Shablon nomi:':'Название шаблона:',client?client.name+' стандарт':'');
  if(!name)return;
  const tpl={id:Date.now(),name,clientId,items:items.map(i=>({id:i.id,qty:i.qty})),payment:state.selectedPayment};
  state.templates.push(tpl);
  db.collection('templates').doc(String(tpl.id)).set(tpl);
  showToast('⭐ '+(lang==='uz'?'Shablon saqlandi':'Шаблон сохранён'),'success');
  renderTemplates();
}
function renderTemplates(){
  const el=document.getElementById('templatesList');if(!el)return;
  if(!state.templates.length){el.innerHTML=`<div style="color:var(--text3);font-size:13px;padding:8px 0">${lang==='uz'?'Shablon yo\'q':'Нет шаблонов'}</div>`;return;}
  el.innerHTML=state.templates.map(t=>{
    const c=state.clients.find(x=>x.id==t.clientId);
    const items=t.items.map(i=>{const p=PRODUCTS.find(x=>x.id===i.id);return p?`${p.emoji}${i.qty}${p.unit||'кг'}`:null;}).filter(Boolean).join(' ');
    return`<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;font-size:14px">${t.name}</div>
        <div style="font-size:12px;color:var(--text2)">${c?c.name:''} · ${items}</div>
      </div>
      <button onclick="applyTemplate(${t.id})" style="background:rgba(86,212,160,.15);border:1px solid var(--green);color:var(--green);border-radius:8px;padding:6px 12px;cursor:pointer;font-size:12px;font-weight:700">✅</button>
      <button onclick="deleteTemplate(${t.id})" style="background:rgba(247,90,90,.12);border:1px solid rgba(247,90,90,.3);color:var(--danger);border-radius:8px;padding:6px 10px;cursor:pointer;font-size:13px">🗑</button>
    </div>`;
  }).join('');
}
function applyTemplate(id){
  const t=state.templates.find(x=>x.id==id);if(!t)return;
  document.getElementById('clientSelect').value=t.clientId;
  state.quantities={};
  t.items.forEach(i=>{state.quantities[i.id]=i.qty;});
  state.selectedPayment=t.payment||'наличные';
  // Update payment pills
  document.querySelectorAll('.payment-pills .pill').forEach(p=>{p.classList.toggle('selected',p.dataset.pay===state.selectedPayment);});
  renderProductsGrid();
  // Restore qty displays
  t.items.forEach(i=>{const el=document.getElementById('qty-'+i.id);if(el)el.textContent=i.qty;const pc=document.getElementById('pc-'+i.id);if(pc&&i.qty>0)pc.classList.add('selected');});
  updateSummary();
  closeModal('templatesModal');
  showToast('⭐ '+(lang==='uz'?'Shablon qo\'llandi':'Шаблон применён'),'info');
}
function deleteTemplate(id){
  state.templates=state.templates.filter(x=>x.id!=id);
  db.collection('templates').doc(String(id)).delete();
  renderTemplates();
}
function openTemplatesModal(){renderTemplates();openModal('templatesModal');}
// NAV
function showPage(id){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  const pageEl = document.getElementById('page-'+id);
  if(pageEl) pageEl.classList.add('active');
  const tab=document.querySelector(`.tab[data-page="${id}"]`);if(tab)tab.classList.add('active');
  if(id==='orders')renderOrdersList();
  if(id==='clients')renderClientsList();
  if(id==='stats')renderStats();
  if(id==='debts')renderDebts();
  if(id==='delivery')renderDelivery();
  if(id==='warehouse')renderWarehouse();
  if(id==='products')renderProductsSettings();
  if(id==='new-order')renderFavorites();
  if(id==='dashboard')renderDashboard();
  if(id==='map')renderMap();
  if(id==='ai')renderAiPage();
  try { renderCustomUiButtons(); } catch(e) {}
}

// FAVORITES
function renderFavorites(){
  const cnt={};state.orders.forEach(o=>{cnt[o.clientId]=(cnt[o.clientId]||0)+1;});
  const top=state.clients.map(c=>({...c,n:cnt[c.id]||0})).filter(c=>c.n>0).sort((a,b)=>b.n-a.n).slice(0,8);
  const strip=document.getElementById('favoritesStrip');
  const wrap=document.getElementById('favStrip');
  if(!top.length){wrap.style.display='none';return;}
  wrap.style.display='block';
  strip.innerHTML=top.map(c=>`<div class="fav-chip" onclick="quickOrderSelect('${c.id}')"><div class="fav-avatar">${c.name.charAt(0).toUpperCase()}</div><div class="fav-name">${c.name.split(' ')[0]}</div></div>`).join('');
}
function quickOrderSelect(id){document.getElementById('clientSelect').value=id;showToast('👤 '+(lang==='uz'?'Tanlandi':'Выбран'),'info');}

// PRODUCTS
function renderProductsGrid(){
  
  const clientId = document.getElementById('clientSelect')?.value;
  const client = state.clients.find(c => c.id == clientId);
  
  document.getElementById('productsGrid').innerHTML=PRODUCTS.map(p=>{
    const cp = client?.customPrices?.[p.id];
    const hasCustom = (cp !== undefined && cp !== null && cp !== '');
    const price = hasCustom ? Number(cp) : Number(p.price || 0);
    const isTracked = typeof isProductTracked === 'function' && isProductTracked(p);
    let stockBadge = '';
    if (isTracked) {
      const stk = roundQty(p.stock);
      const st = getProductStockStatus(p);
      const lbl = (st === 'empty' || st === 'out') ? (lang==='uz'?'Tugadi':'Нет') : `${stk} ${p.unit||'кг'}`;
      stockBadge = `<div class="stock-badge-mini ${st}">🏭 ${lbl}</div>`;
    }
    return `
    <div class="product-card" id="pc-${p.id}">
      <div class="product-name">${p.emoji || '🥗'} ${lang==='uz'?(p.nameUz||p.name||''):(p.name||p.nameUz||'')}</div>
      <div class="product-price">${fmt(price)} / ${p.unit||'кг'} ${hasCustom ? '<span style="color:var(--orange)">★</span>' : ''}</div>
      ${stockBadge}
      <div class="product-qty">
        <div class="qty-btn" onclick="changeQty('${p.id}',${-(p.step||0.5)})">−</div>
        <div><span class="qty-val" id="qty-${p.id}">0</span> <span class="qty-unit">${p.unit||'кг'}</span></div>
        <div class="qty-btn" onclick="changeQty('${p.id}',${p.step||0.5})">+</div>
      </div>
    </div>`;}).join('');
}
function changeQty(id,delta){
  const p=PRODUCTS.find(x=>x.id===id);
  const isUnit=p&&p.unit==='шт';
  const n=isUnit?Math.max(0,Math.round((state.quantities[id]||0)+delta)):Math.max(0,Math.round(((state.quantities[id]||0)+delta)*10)/10);
  state.quantities[id]=n;
  const qtyEl=document.getElementById('qty-'+id);
  if(qtyEl)qtyEl.textContent=n;
  const pcEl=document.getElementById('pc-'+id);
  if(pcEl&&pcEl.classList)pcEl.classList.toggle('selected',n>0);
  updateSummary();
}
function updateSummary(){
  const items=getOrderItems();
  const block=document.getElementById('summaryBlock');
  if(!items.length){if(block)block.style.display='none';return;}
  if(block)block.style.display='block';
  let total=0,html='';
  items.forEach(i=>{const sub=i.qty*i.price;total+=sub;const u=i.unit||'кг';html+=`<div class="summary-row"><span class="summary-name">${i.emoji||'🥗'} ${lang==='uz'?(i.nameUz||i.name||''):(i.name||i.nameUz||'')}</span><span><span class="summary-qty">${i.qty} ${u}</span><span class="summary-price"> · ${fmt(sub)}</span></span></div>`;});
  html+=`<div class="total-row"><span class="total-label">${lang==='uz'?'Jami:':'Итого:'}</span><span class="total-amount">${fmt(total)} so'm</span></div>`;
  const sumEl=document.getElementById('orderSummary');
  if(sumEl)sumEl.innerHTML=html;
}
function getOrderItems(){
  const clientId = document.getElementById('clientSelect')?.value;
  const client = state.clients.find(c => c.id == clientId);
  return PRODUCTS.filter(p=>(state.quantities[p.id]||0)>0).map(p=>{
    const cp = client?.customPrices?.[p.id];
    const price = (cp !== undefined && cp !== null && cp !== '') ? Number(cp) : Number(p.price || 0);
    return {...p, price, qty:state.quantities[p.id]};
  });
}
function getTotal(){return getOrderItems().reduce((s,i)=>s+i.qty*i.price,0);}
function selectPayment(el){document.querySelectorAll('.payment-pills .pill').forEach(p=>p.classList.remove('selected'));el.classList.add('selected');state.selectedPayment=el.dataset.pay;}

function commitAdminOrderAndStock(order, client, ruleCheck = {}) {
  const batch = db.batch();
  const whLogEntries = [];
  const tgToken = state.settings.tgToken || atob('ODc5NjU4ODA3MTpBQUc4Wl9SOGhQOUVTWlpfM0x4VWFrRDhQQ1hqNUM1WlA2WQ==');
  const tgChatId = state.settings.tgChatId || '483325961';
  (order.items || []).forEach(i => {
    const p = PRODUCTS.find(x => x.id === i.id);
    if (p && isProductTracked(p)) {
      const prodRef = db.collection('products').doc(String(p.id));
      const newVal = roundQty(Number(p.stock) - Number(i.qty));
      p.stock = newVal;
      const incVal = (firebase?.firestore?.FieldValue?.increment)
        ? firebase.firestore.FieldValue.increment(-i.qty)
        : newVal;
      batch.update(prodRef, { stock: incVal });
      whLogEntries.push({
        productId: p.id, name: p.nameUz || p.name, emoji: p.emoji || '🥗',
        delta: -roundQty(i.qty), newStock: newVal, unit: p.unit || 'кг',
        reason: 'Buyurtma: ' + (client?.name || order.client || '')
      });
      const minTh = getProductMinStock(p);
      if (newVal <= minTh && tgToken && tgChatId) {
        const warning = `⚠️ Diqqat! ${p.name} zaxirasi kam qoldi! Qoldiq: ${newVal} ${p.unit || 'kg'}`;
        fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: tgChatId, text: warning }) }).catch(() => {});
      }
    }
  });
  batch.set(db.collection('orders').doc(String(order.id)), order);
  batch.commit();
  if (whLogEntries.length && typeof logWarehouseMovement === 'function') {
    logWarehouseMovement(whLogEntries);
  }
  if (ruleCheck && ruleCheck.largeOrderAlertKg && tgToken && tgChatId) {
    const bigMsg = `🚨 KATTA BUYURTMA (${ruleCheck.largeOrderAlertKg} kg)!\n👤 Mijoz: ${client?.name || order.client || ''}\n💰 Summa: ${fmt(order.total)} so'm`;
    fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: tgChatId, text: bigMsg }) }).catch(() => {});
  }
  try { renderWarehouse(); updateWarehouseBadge(); renderDelivery(); renderDashboard(); } catch (e) {}
}

// SUBMIT
let isOrderSubmitting = false;
async function submitOrder(){
  if (isOrderSubmitting) return;
  const clientId=document.getElementById('clientSelect').value;
  if(!clientId){showToast('⚠️ '+(lang==='uz'?'Mijozni tanlang':'Выберите клиента'),'error');return;}
  const items=getOrderItems();
  if(!items.length){showToast('⚠️ '+(lang==='uz'?'Mahsulot qo\'shing':'Добавьте продукт'),'error');return;}
  const client=state.clients.find(c=>c.id==clientId);
  if(!client){showToast('⚠️ '+(lang==='uz'?'Mijoz topilmadi':'Клиент не найден'),'error');return;}
  const ruleCheck = typeof evaluateOrderBusinessRules === 'function'
    ? evaluateOrderBusinessRules({ clientId: client?.id, clientName: client?.name, items, payment: state.selectedPayment, rules: aiBusinessRules, orders: state.orders })
    : { blocked: false, errors: [], largeOrderAlertKg: null };
  if (ruleCheck.blocked) {
    showToast('🚫 ' + ruleCheck.errors[0], 'error');
    return;
  }
  isOrderSubmitting = true;
  const btn=document.getElementById('submitBtn');
  if(btn){btn.innerHTML='<div class="spinner"></div>';btn.disabled=true;}
  try {
    const selectedCourier = document.getElementById('orderCourier')?.value || '';
    const order={
      id:Date.now(),date:new Date().toISOString(),
      client:client.name,clientId:client.id,
      phone:document.getElementById('clientPhone').value||client.phone||'',
      type:document.getElementById('clientType').value,
      items,total:getTotal(),payment:state.selectedPayment,
      note:document.getElementById('orderNote').value,
      sent:false,sentSheets:false,
      debtPaid:!['консигнация','qarz','nasiya','долг'].includes((state.selectedPayment||'').toLowerCase()),
      partialPaid:0,
      delivered:false,
      courier:selectedCourier,
      status:selectedCourier?'delivering':'new',
      stockDeducted:true
    };

    commitAdminOrderAndStock(order, client, ruleCheck);

    let tgOk=false;
    try{tgOk=await sendToTelegram(order);}catch(e){}

    if(tgOk) { order.sent=true; db.collection('orders').doc(String(order.id)).update({sent: true}).catch(()=>{}); }
    try { if (typeof applySavedUiRenames === 'function') applySavedUiRenames(); } catch(e) {}
    showToast(tgOk?'✅ '+(lang==='uz'?'Yuborildi':'Отправлено'):'⚠️ Локально',tgOk?'success':'info');
    resetOrder();updateBadges();renderFavorites();
  } finally {
    isOrderSubmitting = false;
    if(btn){
      btn.innerHTML='✅ <span class="t" data-ru="Оформить заказ" data-uz="Buyurtmani rasmiylashtirish">'+(lang==='uz'?'Buyurtmani rasmiylashtirish':'Оформить заказ')+'</span>';
      btn.disabled=false;
    }
  }
}

// TELEGRAM

function escapeHTML(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(str) {
  return escapeHTML(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function sendToTelegram(order){
  const tgToken=state.settings.tgToken || atob('ODc5NjU4ODA3MTpBQUc4Wl9SOGhQOUVTWlpfM0x4VWFrRDhQQ1hqNUM1WlA2WQ==');
  const tgChatId=state.settings.tgChatId || '483325961';
  if(!tgToken||!tgChatId)return false;
  if(!navigator.onLine){
    offlineQueue.push({id:order.id,type:'telegram',text:buildTgMsg(order)});
    localStorage.setItem('offlineQueue',JSON.stringify(offlineQueue));
    return false;
  }
  const r=await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:tgChatId,text:buildTgMsg(order),parse_mode:'HTML'})});
  return(await r.json()).ok;
}
function buildTgMsg(order){
  const pi={'наличные':'💵','клик':'📱','консигнация':'📝','Naqd':'💵','Karta':'📱','Qarz':'📝'};
  const d=new Date(order.date);
  const ds=isNaN(d.getTime())?'—':(d.toLocaleDateString('ru-RU')+' '+d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}));
  let l=[`🥗 <b>НОВЫЙ ЗАКАЗ</b>`,``,`👤 <b>${escapeHTML(order.client)}</b>`];
  if(order.phone)l.push(`📞 ${escapeHTML(order.phone)}`);
  l.push(``,'📦 <b>Заказ:</b>');
  (order.items||[]).forEach((i,n)=>l.push(`  ${n+1}. ${i.emoji||''} ${escapeHTML(i.name||i.nameUz||'')} — <b>${i.qty}${escapeHTML(i.unit||'кг')}</b> (${fmt((Number(i.qty)||0)*(Number(i.price)||0))} so'm)`));
  l.push(``,`💰 <b>Итого: ${fmt(Number(order.total)||0)} so'm</b>`,`${pi[order.payment]||'💳'} ${escapeHTML(order.payment)}`);
  if(order.note)l.push(`📝 ${escapeHTML(order.note)}`);
  l.push(``,`🕐 ${ds}`);
  return l.join('\n');
}

// DAY SUMMARY TELEGRAM
async function sendDaySummary(){
  const tgToken=state.settings.tgToken || atob('ODc5NjU4ODA3MTpBQUc4Wl9SOGhQOUVTWlpfM0x4VWFrRDhQQ1hqNUM1WlA2WQ==');
  const tgChatId=state.settings.tgChatId || '483325961';
  if(!tgToken||!tgChatId){showToast('⚠️ ' + (lang === 'uz' ? 'Telegram sozlanmagan' : 'Настройте Telegram'),'error');return false;}
  const today=new Date().toDateString();
  const todayOrders=(state.orders || []).filter(o=>new Date(o.date).toDateString()===today);
  const totalRev=todayOrders.reduce((s,o)=>s+(o.total||0),0);
  const debts=(state.orders || []).filter(isDebtOrder);
  const totalDebt=debts.reduce((s,o)=>s+(o.total||0)-(o.partialPaid||0),0);
  const prodTotals={};(PRODUCTS || []).forEach(p=>{prodTotals[p.id]=0;});
  todayOrders.forEach(o=>(o.items || []).forEach(i=>{if(prodTotals[i.id]!==undefined)prodTotals[i.id]+=i.qty;}));
  const isUz = lang === 'uz';
  const prodLines=(PRODUCTS || []).map(p=>{
    const pName = isUz && p.nameUz ? p.nameUz : p.name;
    const pUnit = p.unit || (isUz ? 'kg' : 'кг');
    return prodTotals[p.id]>0?('  ' + (p.emoji||'') + ' ' + escapeHTML(pName) + ': <b>' + prodTotals[p.id] + escapeHTML(pUnit) + '</b>'):'';
  }).filter(Boolean);
  const deliveredOrders = todayOrders.filter(o => o.status === 'done' || o.delivered);
  const deliveredClients = deliveredOrders.length > 0 ? deliveredOrders.map(o => '  👤 ' + escapeHTML(o.client)).join('\n') : (isUz ? '  Yetkazilganlar yo\'q' : '  Нет доставленных');
  const d=new Date();
  const lines=[
    '📊 <b>' + (isUz ? 'KUNLIK HISOBOT' : 'СВОДКА ЗА ДЕНЬ') + ' — ' + d.toLocaleDateString('ru-RU') + '</b>', '',
    '📦 <b>' + (isUz ? 'Buyurtmalar' : 'Заказов') + ':</b> ' + todayOrders.length,
    '💰 <b>' + (isUz ? 'Tushum' : 'Выручка') + ':</b> ' + fmt(totalRev) + ' so\'m', '',
    '📦 <b>' + (isUz ? 'Sotildi' : 'Продано') + ':</b>',
    ...prodLines, '',
    '💸 <b>' + (isUz ? 'Umumiy qarz (konsignatsiya)' : 'Общий долг (консигнация)') + ':</b> ' + fmt(totalDebt) + ' so\'m',
    '👥 <b>' + (isUz ? 'Qarzdorlar' : 'Должников') + ':</b> ' + new Set(debts.map(o=>o.clientId)).size, '',
    '✅ <b>' + (isUz ? 'Yetkazilgan mijozlar' : 'Доставленные клиенты') + ':</b>',
    deliveredClients
  ];
  const trackedStock = (PRODUCTS || []).filter(isProductTracked);
  if (trackedStock.length) {
    lines.push('', '🏭 <b>' + (isUz ? 'Sklad qoldig\'i' : 'Склад (Остаток)') + ':</b>');
    trackedStock.forEach(p => {
      const rem = roundQty(p.stock);
      const st = getProductStockStatus(p);
      const icon = st === 'empty' ? '🔴' : (st === 'low' ? '⚠️' : '✅');
      lines.push('  ' + icon + ' ' + (p.emoji || '') + ' ' + escapeHTML(isUz && p.nameUz ? p.nameUz : p.name) + ': <b>' + rem + escapeHTML(p.unit || 'kg') + '</b>');
    });
  }
  try{
    const r=await fetch('https://api.telegram.org/bot' + tgToken + '/sendMessage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:tgChatId,text:lines.join('\n'),parse_mode:'HTML'})});
    const res = await r.json();
    if(res.ok){
      showToast('✅ ' + (isUz ? 'Hisobot yuborildi!' : 'Сводка отправлена!'),'success');
      try {
        const todayStr = new Date().toLocaleDateString('en-CA');
        db.collection('settings').doc('main').set({ lastAutoSummaryDate: todayStr }, { merge: true });
        localStorage.setItem('lastAutoSummary', todayStr);
      } catch(e) {}
      return true;
    } else {
      showToast('❌ Ошибка Telegram','error');
      return false;
    }
  }catch(e){
    showToast('❌ Сеть','error');
    return false;
  }
}

// Avtomatik kunlik xisobot yuborish (har kuni kechki 22:00 da)
async function checkAutoDailySummary() {
  if (!isOrdersLoaded || !state.orders) return;
  const d = new Date();
  const targetTime = (state.settings && state.settings.tgSummaryTime) ? state.settings.tgSummaryTime : '22:00';
  const parts = targetTime.split(':').map(Number);
  const targetHour = isNaN(parts[0]) ? 22 : parts[0];
  const targetMinute = isNaN(parts[1]) ? 0 : parts[1];
  
  const currentMinutes = d.getHours() * 60 + d.getMinutes();
  const targetMinutes = targetHour * 60 + targetMinute;
  
  // Agar belgilangan vaqtdan (masalan 22:00) o'tgan bo'lsa va bugun yuborilmagan bo'lsa
  if (currentMinutes >= targetMinutes) {
    const todayStr = d.toLocaleDateString('en-CA');
    const lastSent = (state.settings && state.settings.lastAutoSummaryDate) || localStorage.getItem('lastAutoSummary');
    if (lastSent !== todayStr) {
      localStorage.setItem('lastAutoSummary', todayStr);
      const ok = await sendDaySummary();
      if (!ok) {
        localStorage.removeItem('lastAutoSummary');
      }
    }
  }
}

// Har 30 sekundda tekshirib turadi
setInterval(checkAutoDailySummary, 30000);

// ORDERS LIST
let ordersDisplayLimit = 60;
function loadMoreOrders(){ ordersDisplayLimit += 60; renderOrdersList(document.getElementById('ordersSearch')?.value || '', state.dateFilter); }
function renderOrdersList(filterText='',dateFilter=state.dateFilter){
  state.dateFilter=dateFilter;
  let orders=(state.orders || []).filter(Boolean);
  if(filterText) {
    const q = filterText.toLowerCase();
    orders = orders.filter(o => 
      (o.client || '').toLowerCase().includes(q) || 
      (o.phone || '').includes(q) || 
      (o.agent || '').toLowerCase().includes(q) ||
      (o.address || '').toLowerCase().includes(q)
    );
  }
  const now=new Date();
  if(dateFilter==='today'){
    orders=orders.filter(o=>{if(!o.date)return false;const d=new Date(o.date);return !isNaN(d.getTime())&&d.toDateString()===now.toDateString();});
  } else if(dateFilter==='week'){
    const w=new Date(now.getTime() - 7*86400000);
    orders=orders.filter(o=>{if(!o.date)return false;const d=new Date(o.date);return !isNaN(d.getTime())&&d>=w;});
  } else if(dateFilter && dateFilter.match(/^\d{4}-\d{2}-\d{2}$/)){
    orders = orders.filter(o => {
      if(!o.date) return false;
      const d = new Date(o.date);
      if(isNaN(d.getTime())) return false;
      const iso = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
      return iso === dateFilter;
    });
  }
  const list=document.getElementById('ordersList');
  if(!list) return;
  if(!orders.length){
    list.innerHTML=`<div class="empty"><div class="empty-icon">📋</div><div class="empty-text">${T[lang]?.noOrders || 'Buyurtmalar yo\'q'}</div></div>`;
    return;
  }
  const visibleOrders = (!filterText && dateFilter === 'all' && orders.length > ordersDisplayLimit)
    ? orders.slice(0, ordersDisplayLimit)
    : orders;
  const pi={'наличные':'💵','клик':'📱','консигнация':'📝','Naqd':'💵','Karta':'💳','Qarz':'📝','карта':'💳'};
  const pc={'наличные':'','клик':'click','консигнация':'consign','Naqd':'','Karta':'click','Qarz':'consign','карта':'click'};
  const cardsHtml = visibleOrders.map(o=>{
    if(!o) return '';
    const d=new Date(o.date || 0);
    const ds=isNaN(d.getTime())?'—':(d.toLocaleDateString('ru-RU')+' '+d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}));
    let orderProfit = 0;
    try { orderProfit = calculateOrderProfit(o); } catch(e) { orderProfit = 0; }
    const orderTotal = Number(o.total) || 0;
    const orderMarginPct = orderTotal > 0 ? Math.round((orderProfit / orderTotal) * 100) : 0;
    const oId = String(o.id || '').replace(/[^a-zA-Z0-9_-]/g, '');
    const isDebt = isDebtOrder(o);
    const itemsListHtml = (o.items || []).map(i => {
      const iName = escapeHTML(lang === 'uz' ? (i.nameUz || i.name || 'Mahsulot') : (i.name || i.nameUz || 'Продукт'));
      const iQty = i.qty !== undefined ? i.qty : 0;
      const iUnit = escapeHTML(i.unit || 'кг');
      return `${i.emoji || '🥗'} ${iName}: <b>${iQty}${iUnit}</b>`;
    }).join(' · ');

    return`<div class="order-item payment-${pc[o.payment] || ''}">
      <div class="order-top">
        <div>
          <div class="order-client" style="display:flex;align-items:center;gap:6px;">
            ${escapeHTML(o.client || 'Noma\'lum mijoz')}
            ${o.agent ? `<span style="font-size:10px;background:rgba(255,152,0,0.15);color:#ff9800;padding:2px 6px;border-radius:6px;border:1px solid rgba(255,152,0,0.3);font-weight:800;">👨‍💼 ${escapeHTML(o.agent)}</span>` : ''}
          </div>
          <div class="order-meta">${ds} · ${escapeHTML(o.type || 'Dostavka')}</div>
        </div>
        <div style="text-align:right;">
          <div class="order-badge ${pc[o.payment] || ''}">${pi[o.payment]||'💳'} ${escapeHTML(o.payment || '')}</div>
          <div style="margin-top:4px; margin-bottom:4px;">${o.sent?'<span class="sent-badge">✅ TG</span>':'<span class="unsent-badge">❌ TG</span>'}</div>
          <select onchange="updateOrderStatus('${oId}', this.value)" style="background:var(--bg3); color:var(--text); border:1px solid var(--border); padding:2px 4px; border-radius:4px; font-size:11px; width:100%;">
            <option value="new" ${!o.status || o.status==='new' ? 'selected' : ''}>🆕 ${lang==='uz'?'Yangi':'Новый'}</option>
            <option value="preparing" ${o.status==='preparing' ? 'selected' : ''}>👨‍🍳 ${lang==='uz'?'Tayyorlanmoqda':'Готовится'}</option>
            <option value="delivering" ${o.status==='delivering' ? 'selected' : ''}>🛵 ${lang==='uz'?'Yo\'lda':'В пути'}</option>
            <option value="done" ${o.status==='done' ? 'selected' : ''}>✅ ${lang==='uz'?'Bajarildi':'Доставлен'}</option>
            <option value="cancelled" ${o.status==='cancelled' ? 'selected' : ''}>❌ ${lang==='uz'?'Bekor qilindi':'Отменён'}</option>
          </select>
        </div>
      </div>
      <div class="order-items">${itemsListHtml}</div>
      ${o.note?`<div style="font-size:12px;color:var(--text3);margin-top:4px">📝 ${escapeHTML(o.note)}</div>`:''}
      <div class="order-total" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-top:8px;">
        <div>${fmt(orderTotal)} so'm ${isDebt?`<span class="tag orange">${lang==='uz'?'Qarz':'Долг'} ${o.partialPaid?fmt(o.partialPaid)+' to\'landi':''}</span>`:''}</div>
        <div style="color:var(--green);font-size:12px;font-weight:700;background:rgba(86,212,160,0.12);border:1px solid rgba(86,212,160,0.25);padding:3px 8px;border-radius:6px;display:inline-flex;align-items:center;gap:4px;">
          📈 ${lang==='uz'?'Foyda':'Прибыль'}: +${fmt(orderProfit)} so'm <span style="font-size:11px;opacity:0.85">(${orderMarginPct}%)</span>
        </div>
      </div>
      <div class="order-actions">
        <button class="btn btn-primary btn-sm" onclick="showOrderDetail('${oId}')">👁</button>
        <button class="btn btn-outline btn-sm" onclick="openEditOrderModal('${oId}')">✏️</button>
        <button class="btn btn-outline btn-sm" onclick="copyOrder('${oId}')" title="${lang==='uz'?'Nusxa':'Копировать'}">📋</button>
        <button class="btn btn-outline btn-sm" onclick="printInvoice('${oId}')">🖨️</button>
        <button class="btn btn-outline btn-sm" onclick="openLabelModal('${oId}')" title="${lang==='uz'?'Qadoq yorlig\'i (Etiketka)':'Печать этикеток'}">🏷️</button>
        <button class="btn btn-outline btn-sm" onclick="resendOrderById('${oId}')">📤</button>
        <button class="btn btn-danger btn-sm" onclick="deleteOrder('${oId}')">🗑</button>
      </div>
    </div>`;
  }).join('');
  const moreBtn = visibleOrders.length < orders.length
    ? `<button class="btn btn-outline" style="width:100%;margin-top:8px" onclick="loadMoreOrders()">${lang==='uz'?`Yana ko'rsatish (${orders.length - visibleOrders.length})`:`Показать ещё (${orders.length - visibleOrders.length})`}</button>`
    : '';
  list.innerHTML = cardsHtml + moreBtn;
}
function filterOrders(v){renderOrdersList(v);}
function filterByDate(f,el){ordersDisplayLimit=60;document.querySelectorAll('#page-orders .pill, #customOrderDate').forEach(p=>p.classList.remove('selected'));if(el)el.classList.add('selected');renderOrdersList(document.getElementById('ordersSearch')?.value||'',f);}

window.updateOrderStatus = function(id, newStatus) {
  const o = state.orders.find(x => x.id == id);
  const isDone = newStatus === 'done';
  const updatePayload = { status: newStatus, delivered: isDone };
  if (o) {
    if (Array.isArray(o.items) && o.items.length) {
      const wasCancelled = o.status === 'cancelled';
      const nowCancelled = newStatus === 'cancelled';
      if (!wasCancelled && nowCancelled && !o.stockRestored) {
        const deltas = {};
        o.items.forEach(i => { deltas[i.id] = (deltas[i.id] || 0) + (parseFloat(i.qty) || 0); });
        applyOrderStockDeltas(deltas, 'order_cancel', o.id, o.client);
        o.stockRestored = true;
        updatePayload.stockRestored = true;
      } else if (wasCancelled && !nowCancelled && o.stockRestored) {
        const deltas = {};
        o.items.forEach(i => { deltas[i.id] = (deltas[i.id] || 0) - (parseFloat(i.qty) || 0); });
        applyOrderStockDeltas(deltas, 'order_restore', o.id, o.client);
        o.stockRestored = false;
        updatePayload.stockRestored = false;
      }
    }
    o.status = newStatus;
    o.delivered = isDone;
  }
  try {
    renderOrdersList(document.getElementById('ordersSearch')?.value || '');
    renderDelivery(); renderDebts(); renderDashboard(); updateBadges();
    if (typeof renderDriveModeNextStop === 'function') renderDriveModeNextStop();
  } catch (e) {}
  db.collection('orders').doc(String(id)).update(updatePayload).then(()=>{
    showToast(lang==='uz'?'Status o\'zgardi':'Статус обновлён', 'success');
  }).catch(e=>{
    showToast(lang==='uz'?'Xatolik':'Ошибка', 'error');
  });
};

async function resendOrderById(id){
  const o=state.orders.find(x=>x.id==id);if(!o)return;
  showToast('📤...','info');
  try{if(await sendToTelegram(o)){db.collection('orders').doc(String(o.id)).update({sent:true});showToast('✅ TG','success');renderOrdersList();}else showToast('❌','error');}catch(e){showToast('❌','error');}
}
function deleteOrder(id){
  if(!confirm(lang==='uz'?'O\'chirishni tasdiqlaysizmi?':'Удалить заказ?'))return;
  const o = state.orders.find(x => x.id == id);
  if (o && o.status !== 'cancelled' && !o.stockRestored && Array.isArray(o.items) && o.items.length) {
    const deltas = {};
    o.items.forEach(i => { deltas[i.id] = (deltas[i.id] || 0) + (parseFloat(i.qty) || 0); });
    applyOrderStockDeltas(deltas, 'order_delete', o.id, o.client);
  }
  db.collection('orders').doc(String(id)).delete();
}
function copyOrder(id){
  const o=state.orders.find(x=>x.id==id);if(!o)return;
  const items = Array.isArray(o.items) ? o.items : [];
  document.getElementById('clientSelect').value=o.clientId||'';
  state.quantities={};
  items.forEach(i=>{state.quantities[i.id]=i.qty;});
  state.selectedPayment=o.payment||'наличные';
  document.querySelectorAll('.payment-pills .pill').forEach(p=>{p.classList.toggle('selected',p.dataset.pay===state.selectedPayment);});
  document.getElementById('orderNote').value=o.note||'';
  renderProductsGrid();
  items.forEach(i=>{const el=document.getElementById('qty-'+i.id);if(el)el.textContent=i.qty;const pc=document.getElementById('pc-'+i.id);if(pc&&i.qty>0)pc.classList.add('selected');});
  updateSummary();showPage('new-order');
  showToast('📋 '+(lang==='uz'?'Nusxa olindi':'Скопировано'),'info');
}
function normalizeOrderPaymentForSelect(pay) {
  const p = String(pay || '').toLowerCase();
  if (p === 'naqd' || p === 'наличные') return 'наличные';
  if (p === 'karta' || p === 'карта' || p === 'клик') return 'клик';
  if (p === 'qarz' || p === 'nasiya' || p === 'долг' || p === 'консигнация') return 'консигнация';
  return 'наличные';
}
function openEditOrderModal(id){
  const o=state.orders.find(x=>x.id==id);if(!o)return;
  editingOrderId=id;
  populateClientSelect();
  populateCourierSelects();
  const editSel=document.getElementById('editOrderClient');
  if (editSel) {
    const opts = editSel.options ? Array.from(editSel.options) : [];
    if (o.clientId && !opts.some(opt => String(opt.value) === String(o.clientId)) && typeof editSel.insertAdjacentHTML === 'function') {
      editSel.insertAdjacentHTML('beforeend', `<option value="${escapeAttr(o.clientId)}">${escapeHTML(o.client || 'Mijoz')}</option>`);
    }
    editSel.value = o.clientId || '';
  }
  const cEl = document.getElementById('editOrderCourier');
  if (cEl) {
    const opts = cEl.options ? Array.from(cEl.options) : [];
    if (o.courier && !opts.some(opt => opt.value === o.courier) && typeof cEl.insertAdjacentHTML === 'function') {
      cEl.insertAdjacentHTML('beforeend', `<option value="${escapeAttr(o.courier)}">${escapeHTML(o.courier)}</option>`);
    }
    cEl.value = o.courier || '';
  }
  document.getElementById('editOrderNote').value=o.note||'';
  document.getElementById('editOrderPayment').value=normalizeOrderPaymentForSelect(o.payment);
  const qWrap=document.getElementById('editOrderQtys');
  const orderItems = Array.isArray(o.items) ? o.items : [];
  qWrap.innerHTML=PRODUCTS.map(p=>{
    const item=orderItems.find(i=>i.id===p.id);
    const qty=item?item.qty:0;
    const u=p.unit||'кг';const st=p.step||0.5;
    return`<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)">
      <div><div style="font-weight:600">${p.emoji || '🥗'} ${escapeHTML(p.name || p.nameUz || '')}</div><div style="font-size:12px;color:var(--text2)">${fmt(p.price)} / ${u}</div></div>
      <div style="display:flex;align-items:center;gap:8px">
        <div class="qty-btn" onclick="editQtyChange('${p.id}',${-st})">−</div>
        <div><span id="eqty-${p.id}" style="font-weight:800;font-size:15px;min-width:28px;display:inline-block;text-align:center">${qty}</span> <span style="font-size:11px;color:var(--text3)">${u}</span></div>
        <div class="qty-btn" onclick="editQtyChange('${p.id}',${st})">+</div>
      </div>
    </div>`;
  }).join('');
  openModal('editOrderModal');
}
function editQtyChange(id,delta){
  const p=PRODUCTS.find(x=>x.id===id);
  const isUnit=p&&p.unit==='шт';
  const el=document.getElementById('eqty-'+id);
  const cur=parseFloat(el.textContent)||0;
  const n=isUnit?Math.max(0,Math.round(cur+delta)):Math.max(0,Math.round((cur+delta)*10)/10);
  el.textContent=n;
}
function saveEditOrder(){
  const o=state.orders.find(x=>x.id==editingOrderId);if(!o)return;
  const oldItems = (o.items || []).map(i => ({ id: i.id, qty: parseFloat(i.qty) || 0 }));
  const clientId=document.getElementById('editOrderClient').value;
  const client=state.clients.find(c=>c.id==clientId);
  if(clientId&&client){o.clientId=client.id;o.client=client.name;}
  o.payment=document.getElementById('editOrderPayment').value;
  o.note=document.getElementById('editOrderNote').value;
  const courierName = document.getElementById('editOrderCourier').value;
  if(courierName) {
    o.courier = courierName;
    if (!o.status || o.status === 'new') o.status = 'delivering';
  } else {
    o.courier = '';
    if (o.status === 'delivering') o.status = 'new';
  }
  o.delivered = o.status === 'done';
  o.debtPaid = !['консигнация','qarz','nasiya','долг'].includes((o.payment||'').toLowerCase());
  const newItems=PRODUCTS.map(p=>{
    const eqEl=document.getElementById('eqty-'+p.id);
    const qty=eqEl?(parseFloat(eqEl.textContent)||0):0;
    if(qty<=0)return null;
    const cp = client?.customPrices?.[p.id];
    const price = (cp !== undefined && cp !== null && cp !== '') ? Number(cp) : (Number(p.price)||0);
    return {...p,price,qty};
  }).filter(Boolean);
  if (o.status !== 'cancelled' && !o.stockRestored) {
    const deltas = {};
    oldItems.forEach(i => { deltas[i.id] = (deltas[i.id] || 0) + i.qty; });
    newItems.forEach(i => { deltas[i.id] = (deltas[i.id] || 0) - (parseFloat(i.qty) || 0); });
    applyOrderStockDeltas(deltas, 'order_edit', o.id, o.client);
  }
  o.items=newItems;o.total=newItems.reduce((s,i)=>s+i.qty*i.price,0);o.sent=false;
  db.collection('orders').doc(String(o.id)).set(o); closeModal('editOrderModal');
  try { renderOrdersList(document.getElementById('ordersSearch')?.value || ''); renderDelivery(); renderDebts(); renderDashboard(); updateBadges(); } catch(e) {}
  showToast('✅ '+(lang==='uz'?'Saqlandi':'Сохранено'),'success');
}
function showOrderDetail(id){
  const o=state.orders.find(x=>x.id==id);if(!o)return;
  state.currentOrderId=id;
  document.getElementById('detailTitle').textContent='📋 '+(o.client || 'Mijoz');
  const pi={'наличные':'💵','клик':'📱','консигнация':'📝','Naqd':'💵','Karta':'💳','Qarz':'📝','карта':'💳'};
  const d=new Date(o.date);
  const orderProfit = calculateOrderProfit(o);
  const orderMarginPct = o.total > 0 ? Math.round((orderProfit / o.total) * 100) : 0;
  document.getElementById('detailContent').innerHTML=`
    <div class="order-summary">
      ${(o.items || []).map(i=>`<div class="summary-row"><span class="summary-name">${i.emoji||'🥗'} ${(lang==='uz'?(i.nameUz||i.name):i.name)||''}</span><span class="summary-qty">${i.qty}${i.unit||'кг'} · ${fmt(i.qty*i.price)} so'm</span></div>`).join('')}
      <div class="total-row"><span class="total-label">${lang==='uz'?'Jami:':'Итого:'}</span><span class="total-amount">${fmt(o.total)} so'm</span></div>
      <div class="summary-row" style="margin-top:6px;padding-top:6px;border-top:1px dashed var(--border);color:var(--green);font-weight:700">
        <span>📈 ${lang==='uz'?'Kutilayotgan sof foyda:':'Чистая прибыль:'}</span>
        <span>+${fmt(orderProfit)} so'm (${orderMarginPct}%)</span>
      </div>
    </div>
    <button class="btn btn-outline" style="width:100%;margin-top:10px;padding:10px;font-weight:700;border-color:var(--accent);color:var(--accent);" onclick="openLabelModal(${o.id})">
      🏷️ ${lang==='uz'?'Qadoq yorliqlarini chop etish (Termo-etiketka)':'Печать этикеток на упаковку'}
    </button>
    <div style="font-size:13px;color:var(--text2);line-height:2">
      ${pi[o.payment]||'💳'} <b>${o.payment}</b> · 📅 ${d.toLocaleDateString('ru-RU')} ${d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}
      ${o.phone?`<br>📞 ${o.phone}`:''}${o.note?`<br>📝 ${o.note}`:''}
      ${o.rating ? `<br><div style="display:inline-block; margin-top:8px; padding:4px 10px; background:rgba(255,215,0,0.1); border-radius:12px; border:1px solid rgba(255,215,0,0.3); color:gold; font-size:16px;">${'⭐'.repeat(o.rating)}</div>` : ''}
    </div>`;
  openModal('orderDetailModal');
}
async function resendOrder(){
  if(!state.currentOrderId)return;
  const o=state.orders.find(x=>x.id==state.currentOrderId);if(!o)return;
  const btn=document.getElementById('detailSendBtn');btn.innerHTML='<div class="spinner"></div>';btn.disabled=true;
  let ok=false;try{ok=await sendToTelegram(o);}catch(e){}
  if(ok){db.collection('orders').doc(String(o.id)).update({sent:true});}
  btn.innerHTML='📤 '+(lang==='uz'?'Qayta yuborish':'Повторно');btn.disabled=false;
  showToast(ok?'✅':'❌',ok?'success':'error');
  showOrderDetail(state.currentOrderId);renderOrdersList();
}

// INVOICE PRINT
function printInvoice(id){
  const o=state.orders.find(x=>x.id==id);if(!o)return;
  const d=new Date(o.date);
  const num='INV-'+String(o.id).slice(-6);
  const html=`<div style="font-family:'Rubik',sans-serif;max-width:600px;margin:0 auto;padding:32px;color:#111;">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;border-bottom:2px solid #7c6af7;padding-bottom:16px;">
      <div>
        <div style="font-family:'Nunito',sans-serif;font-size:28px;font-weight:900;background:linear-gradient(135deg,#7c6af7,#56d4a0);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">🥗 СалатПро</div>
        <div style="font-size:13px;color:#888;margin-top:2px;">Система управления заказами</div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:20px;font-weight:800;color:#7c6af7;">${num}</div>
        <div style="font-size:13px;color:#888;">${d.toLocaleDateString('ru-RU')} ${d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}</div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px;">
      <div style="background:#f8f8ff;border-radius:12px;padding:14px;">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#888;margin-bottom:6px;">Клиент</div>
        <div style="font-weight:800;font-size:17px;">${o.client}</div>
        ${o.phone?`<div style="font-size:13px;color:#666;margin-top:3px;">📞 ${o.phone}</div>`:''}
        <div style="font-size:13px;color:#666;margin-top:3px;">${o.type}</div>
      </div>
      <div style="background:#f8f8ff;border-radius:12px;padding:14px;">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#888;margin-bottom:6px;">Оплата</div>
        <div style="font-weight:700;font-size:15px;">${o.payment}</div>
        ${o.note?`<div style="font-size:12px;color:#888;margin-top:4px;">📝 ${o.note}</div>`:''}
      </div>
    </div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
      <thead>
        <tr style="background:#7c6af7;color:white;">
          <th style="padding:10px 14px;text-align:left;border-radius:8px 0 0 0;font-size:13px;">#</th>
          <th style="padding:10px 14px;text-align:left;font-size:13px;">Продукт</th>
          <th style="padding:10px 14px;text-align:center;font-size:13px;">Кол-во</th>
          <th style="padding:10px 14px;text-align:right;font-size:13px;">Цена/ед.</th>
          <th style="padding:10px 14px;text-align:right;border-radius:0 8px 0 0;font-size:13px;">Сумма</th>
        </tr>
      </thead>
      <tbody>
        ${o.items.map((i,n)=>`<tr style="border-bottom:1px solid #eee;${n%2?'background:#fafafa':''}">
          <td style="padding:10px 14px;font-size:13px;color:#888;">${n+1}</td>
          <td style="padding:10px 14px;font-weight:600;">${i.emoji} ${i.name}</td>
          <td style="padding:10px 14px;text-align:center;font-weight:700;">${i.qty} ${i.unit||'кг'}</td>
          <td style="padding:10px 14px;text-align:right;color:#888;">${fmt(i.price)}</td>
          <td style="padding:10px 14px;text-align:right;font-weight:700;color:#56d4a0;">${fmt(i.qty*i.price)}</td>
        </tr>`).join('')}
      </tbody>
      <tfoot>
        <tr style="border-top:2px solid #7c6af7;">
          <td colspan="4" style="padding:12px 14px;font-weight:800;font-size:16px;">ИТОГО</td>
          <td style="padding:12px 14px;text-align:right;font-weight:900;font-size:18px;color:#7c6af7;">${fmt(o.total)} so'm</td>
        </tr>
      </tfoot>
    </table>
    <div style="text-align:center;font-size:12px;color:#aaa;border-top:1px solid #eee;padding-top:14px;">
      Спасибо за заказ! · СалатПро · ${new Date().getFullYear()}
    </div>
  </div>`;
  document.getElementById('print-area').innerHTML=html;
  window.print();
  setTimeout(()=>{document.getElementById('print-area').innerHTML='';},2000);
}

// DEBTS
function renderDebts(){
  const debtOrders=(state.orders || []).filter(isDebtOrder);
  const byClient={};
  debtOrders.forEach(o=>{
    const cKey = String(o.clientId || '');
    if(!byClient[cKey])byClient[cKey]={name:o.client || 'Mijoz',total:0,paid:0,orders:[]};
    byClient[cKey].total+=(Number(o.total)||0);
    byClient[cKey].paid+=(Number(o.partialPaid)||0);
    byClient[cKey].orders.push(o);
  });
  const totalDebt=Object.values(byClient).reduce((s,c)=>s+(c.total-c.paid),0);
  const totalDebtEl = document.getElementById('totalDebtAmount');
  if (totalDebtEl) totalDebtEl.textContent=fmt(totalDebt)+' so\'m';
  const debtsCountEl = document.getElementById('debtsCount');
  if (debtsCountEl) debtsCountEl.textContent=Object.keys(byClient).length||'';
  const list=document.getElementById('debtsList');
  if (!list) return;
  if(!Object.keys(byClient).length){list.innerHTML=`<div class="empty"><div class="empty-icon">✅</div><div class="empty-text">${T[lang]?.noDebts || 'Qarzlar yo\'q'}</div></div>`;return;}
  list.innerHTML=Object.entries(byClient).map(([cid,data])=>{
    const remaining=data.total-data.paid;
    const safeCid = String(cid).replace(/[^a-zA-Z0-9_-]/g, '');
    return`<div class="debt-item">
      <div class="debt-client">${escapeHTML(data.name)}</div>
      <div class="debt-amount">${fmt(remaining)} so'm</div>
      ${data.paid>0?`<div style="font-size:12px;color:var(--green)">✅ ${lang==='uz'?'To\'langan':'Оплачено'}: ${fmt(data.paid)} so'm</div>`:''}
      <div class="debt-meta">${lang==='uz'?'Buyurtmalar':'Заказов'}: ${data.orders.length}</div>
      <div class="debt-orders">${data.orders.map(o=>{const d=new Date(o.date);const ds=isNaN(d.getTime())?'—':d.toLocaleDateString('ru-RU');return`• ${ds} — ${fmt(Number(o.total)||0)} so'm${o.partialPaid?` (${lang==='uz'?'qoldi':'осталось'}: ${fmt((Number(o.total)||0)-(Number(o.partialPaid)||0))})`:''}`}).join('<br>')}</div>
      <button class="debt-paid-btn" onclick="markDebtPaid('${safeCid}')">✅ ${lang==='uz'?"To'ladi":'Оплатил'}</button>
      <button class="debt-partial-btn" onclick="openPartialPay('${safeCid}',${remaining})">💰 ${lang==='uz'?'Qisman to\'lov':'Частично'}</button>
    </div>`;
  }).join('');
}
function markDebtPaid(clientId){
  if(!confirm(lang==='uz'?"To'lashni tasdiqlaysizmi?":'Отметить как оплаченный?'))return;
  const batch = db.batch();
  (state.orders || []).forEach(o=>{if(String(o.clientId)===String(clientId)&&isDebtOrder(o)){ o.debtPaid=true; batch.update(db.collection('orders').doc(String(o.id)), {debtPaid:true}); }});
  batch.commit().catch(()=>{});
  try { renderDebts(); renderOrdersList(document.getElementById('ordersSearch')?.value || ''); renderDashboard(); updateBadges(); } catch(e) {}
  showToast('✅ '+(lang==='uz'?"To'landi":'Оплачено'),'success');
}
function openPartialPay(clientId,remaining,name){
  partialClientId=clientId;
  const resolvedName = name || (state.clients || []).find(c => String(c.id) === String(clientId))?.name || (state.orders || []).find(o => String(o.clientId) === String(clientId))?.client || 'Mijoz';
  document.getElementById('partialClientInfo').textContent=`${resolvedName} — ${lang==='uz'?'Qarz':'Долг'}: ${fmt(remaining)} so'm`;
  document.getElementById('partialAmount').value='';
  document.getElementById('partialRemaining').textContent='';
  openModal('partialPayModal');
}
function updatePartialRemaining(){
  if(!partialClientId)return;
  const debtOrders=(state.orders || []).filter(o=>String(o.clientId)==String(partialClientId) && isDebtOrder(o));
  const total=debtOrders.reduce((s,o)=>s+o.total-(o.partialPaid||0),0);
  const paid=parseFloat(document.getElementById('partialAmount').value)||0;
  const rem=Math.max(0,total-paid);
  document.getElementById('partialRemaining').textContent=`${lang==='uz'?'Qoladi':'Останется'}: ${fmt(rem)} so'm`;
}
function applyPartialPayment(){
  if(!partialClientId)return;
  const paid=parseFloat(document.getElementById('partialAmount').value)||0;
  if(paid<=0){showToast('⚠️ '+(lang==='uz'?'Summani kiriting':'Введите сумму'),'error');return;}
  let rem=paid;
  // FIFO: Sort unpaid debt orders by date ascending (oldest debt first)
  const debtOrders=(state.orders || []).filter(o=>String(o.clientId)==String(partialClientId) && isDebtOrder(o))
    .sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
  debtOrders.forEach(o=>{
    const owed=(Number(o.total)||0)-(Number(o.partialPaid)||0);
    if(rem>=owed){o.debtPaid=true;rem-=owed;}
    else{o.partialPaid=(Number(o.partialPaid)||0)+rem;rem=0;}
  });
  const batch = db.batch();
  debtOrders.forEach(o => batch.update(db.collection('orders').doc(String(o.id)), {debtPaid: !!o.debtPaid, partialPaid: Number(o.partialPaid)||0}));
  batch.commit().catch(()=>{});
  closeModal('partialPayModal');
  try { renderDebts(); renderOrdersList(document.getElementById('ordersSearch')?.value || ''); renderDashboard(); updateBadges(); } catch(e) {}
  showToast('✅ '+fmt(paid)+' so\'m '+( lang==='uz'?'qo\'shildi':'зачислено'),'success');
}

// DELIVERY
function renderDelivery(customOrdersList){
  const today=new Date().toDateString();
  let todayOrders=(state.orders || []).filter(o=>{
    if(!o || o.status==='cancelled' || !o.date) return false;
    const d=new Date(o.date);
    return !isNaN(d.getTime()) && d.toDateString()===today;
  });
  if (Array.isArray(customOrdersList)) {
    todayOrders = customOrdersList;
  } else if (typeof adminOptimizedRoute !== 'undefined' && adminOptimizedRoute && Array.isArray(adminOptimizedRoute.sortedOrders)) {
    const orderRank = new Map();
    adminOptimizedRoute.sortedOrders.forEach((so, idx) => orderRank.set(String(so.id), { idx, stepNum: so.stepNum, distKm: so.distKm }));
    todayOrders = todayOrders.map(o => {
      const r = orderRank.get(String(o.id));
      return r ? { ...o, stepNum: r.stepNum, distKm: r.distKm, _rank: r.idx } : { ...o, _rank: 9999 };
    }).sort((a, b) => a._rank - b._rank);
  }
  const total=todayOrders.length;
  const done=todayOrders.filter(o=>o.delivered || o.status === 'done').length;
  const countEl = document.getElementById('deliveryCount');
  if (countEl) countEl.textContent=total-done||'';
  const subtitleEl = document.getElementById('deliverySubtitle');
  if (subtitleEl) subtitleEl.textContent=`${lang==='uz'?'Jami':'Всего'}: ${total} · ${lang==='uz'?'Bajarildi':'Доставлено'}: ${done}`;
  const list=document.getElementById('deliveryList');
  if(!list) return;
  if(!total){list.innerHTML=`<div class="empty"><div class="empty-icon">🚚</div><div class="empty-text">${T[lang]?.noOrders || 'Bugun buyurtma yo\'q'}</div></div>`;return;}
  list.innerHTML=todayOrders.map((o,i)=>{
    const isDone = !!(o.delivered || o.status === 'done');
    const oId = String(o.id || '').replace(/[^a-zA-Z0-9_-]/g, '');
    const itemsText = (o.items || []).map(it=>`${it.emoji || '🥗'}${it.qty}${it.unit||'кг'}`).join(' ');
    const distInfo = (!isDone && o.stepNum && o.distKm !== undefined) ? ` · 📍 ~${o.distKm} km` : '';
    const coords = typeof getOrderLatLng === 'function' ? getOrderLatLng(o) : null;
    const phone = o.phone || (state.clients || []).find(c => String(c.id) === String(o.clientId))?.phone || '';
    const etaDone = o.etaNotifiedAt ? (lang === 'uz' ? '✅ Xabar ketdi' : '✅ Отправлено') : '';
    const miniActions = !isDone ? `
      <div class="deliv-mini-actions">
        <button class="deliv-mini-btn" style="border-color:rgba(123,97,255,0.45);color:var(--accent2);" onclick="sendOnMyWayNotification('${oId}')">📲 ${etaDone || (lang==='uz'?"Yo'ldaman":'В пути')}</button>
        ${coords ? `<a class="deliv-mini-btn" href="https://yandex.ru/maps/?rtext=~${coords.lat},${coords.lng}" target="_blank">📍 ${lang==='uz'?"Yo'l":'Карта'}</a>` : ''}
        ${phone ? `<a class="deliv-mini-btn" href="tel:${escapeAttr(phone)}">📞 ${escapeHTML(phone)}</a>` : ''}
      </div>
    ` : '';
    return `
    <div class="delivery-item ${isDone?'done':''}" id="ditem-${oId}">
      ${isDone?'<div class="delivery-check">✅</div>':`<div class="delivery-num">${o.stepNum || (i+1)}</div>`}
      <div class="delivery-info">
        <div class="delivery-client">${escapeHTML(o.client || 'Noma\'lum mijoz')}</div>
        <div class="delivery-details">${itemsText} · ${fmt(o.total || 0)} so'm${distInfo}</div>
        ${!isDone ? miniActions : (phone ? `<div class="delivery-details">📞 ${escapeHTML(phone)}</div>` : '')}
      </div>
      ${!isDone?`<button class="delivery-done-btn" onclick="markDelivered('${oId}')">✅ ${lang==='uz'?'Yetkazildi':'Доставлено'}</button>`:`<span style="font-size:12px;color:var(--green);font-weight:700">${lang==='uz'?'Bajarildi':'Доставлено'}</span>`}
    </div>`;
  }).join('');
}
function markDelivered(id){
  const o=(state.orders || []).find(x=>String(x.id)===String(id));if(!o)return;
  o.delivered = true; o.status = 'done';
  db.collection('orders').doc(String(id)).update({delivered:true, status:'done'});
  showToast('✅ '+(lang==='uz'?'Yetkazildi':'Доставлено'),'success');
  try {
    renderDelivery();
    renderDashboard();
    updateBadges();
    if (typeof renderDriveModeNextStop === 'function') renderDriveModeNextStop();
  } catch (e) {}
}
function resetDelivery(){
  const today=new Date().toDateString();
  const batch = db.batch();
  (state.orders || []).filter(o=>o && o.date && o.status!=='cancelled' && new Date(o.date).toDateString()===today).forEach(o=>{
    o.delivered=false; if(o.status==='done') o.status='new';
    batch.update(db.collection('orders').doc(String(o.id)), {delivered:false, status:o.status});
  });
  batch.commit().catch(()=>{});
  if (typeof adminOptimizedRoute !== 'undefined') adminOptimizedRoute = null;
  const sumBox = document.getElementById('adminRouteSummaryBox');
  if (sumBox) sumBox.innerHTML = '';
  try { renderDelivery(); updateBadges(); renderDashboard(); } catch (e) {}
}

// CLIENTS
function populateClientSelect(){
  const sel=document.getElementById('clientSelect');
  const editSel=document.getElementById('editOrderClient');
  const optsHtml=(state.clients || []).map(c=>`<option value="${c.id}">${escapeHTML(c.name || 'Mijoz')} (${escapeHTML(c.type || 'кафе')})</option>`).join('');
  if(sel){
    sel.onchange = renderProductsGrid;
    const cur=sel.value;
    sel.innerHTML=`<option value="">${lang==='uz'?'— Mijozni tanlang —':'— Выберите клиента —'}</option>`+optsHtml;
    if(cur)sel.value=cur;
  }
  if(editSel){
    const curEdit=editSel.value;
    editSel.innerHTML=`<option value="">${lang==='uz'?'— Mijozni tanlang —':'— Выберите клиента —'}</option>`+optsHtml;
    if(curEdit)editSel.value=curEdit;
  }
}
function renderClientsList(filterText=''){
  try {
    if (typeof renderChurnRadar === 'function') renderChurnRadar();
  } catch (err) {
    console.warn("Churn radar error:", err);
  }
  const list=document.getElementById('clientsList');
  if(!list) return;
  let clients=state.clients || [];
  if(filterText) clients=clients.filter(c=>(c.name || '').toLowerCase().includes(filterText.toLowerCase()) || (c.phone || '').includes(filterText));
  if(!clients.length){list.innerHTML=`<div class="empty"><div class="empty-icon">👥</div><div class="empty-text">${T[lang]?.noClients || 'Mijozlar topilmadi'}</div></div>`;return;}
  const ti={'кафе':'☕','фаст-фуд':'🍔','ресторан':'🍽️','другое':'📍','Oddiy':'📍'};
  list.innerHTML=clients.map(c=>{
    if(!c) return '';
    const cId = c.id !== undefined && c.id !== null ? String(c.id) : '';
    const cName = c.name || 'Noma\'lum mijoz';
    const firstLetter = (cName.trim() || '?').charAt(0).toUpperCase();
    const orders=(state.orders || []).filter(o=>o && o.status!=='cancelled' && String(o.clientId)===cId);
    const debt=(state.orders || []).filter(o=>String(o.clientId)===cId && isDebtOrder(o)).reduce((s,o)=>s+((Number(o.total)||0)-(Number(o.partialPaid)||0)),0);
    return`<div class="client-item" id="citem-${cId}">
      <div class="client-avatar" onclick="showClientHistory('${cId}')" style="cursor:pointer">${escapeHTML(firstLetter)}</div>
      <div style="flex:1;min-width:0;cursor:pointer" onclick="showClientHistory('${cId}')">
        <div class="client-name">${escapeHTML(cName)} ${debt>0?`<span class="tag orange">💰${fmt(debt)}</span>`:''}</div>
        <div class="client-info">${ti[c.type]||'📍'} ${escapeHTML(c.type||'кафе')}${c.phone?' · '+escapeHTML(c.phone):''}</div>
        <div class="client-info">${lang==='uz'?'Buyurtmalar':'Заказов'}: <b>${orders.length}</b> · ${fmt(orders.reduce((s,o)=>s+(Number(o.total)||0),0))} so'm</div>
      </div>
      <div style="display:flex;gap:5px;flex-shrink:0">
        <button onclick="openCoordModal('${cId}')" style="background:rgba(90,180,247,.12);border:1px solid rgba(90,180,247,.3);color:var(--blue);border-radius:10px;padding:8px 9px;cursor:pointer;font-size:14px;transition:all .2s" title="Координаты">${c.lat?'📍':'🗺️'}</button>
        <button onclick="openEditClientModal('${cId}')" style="background:rgba(124,106,247,.12);border:1px solid rgba(124,106,247,.3);color:var(--accent);border-radius:10px;padding:8px 9px;cursor:pointer;font-size:14px;transition:all .2s">✏️</button>
        <button onclick="deleteClient('${cId}')" style="background:rgba(247,90,90,.12);border:1px solid rgba(247,90,90,.3);color:var(--danger);border-radius:10px;padding:8px 9px;cursor:pointer;font-size:14px;transition:all .2s">🗑</button>
      </div>
    </div>`;
  }).join('');
}
function filterClients(v){renderClientsList(v);}
function deleteClient(id){
  const c=(state.clients || []).find(x=>String(x.id)===String(id));if(!c)return;
  const orderCount=(state.orders || []).filter(o=>String(o.clientId)===String(id)).length;
  const msg=lang==='uz'
    ?`"${c.name}"ni o'chirishni tasdiqlaysizmi?${orderCount?' ('+orderCount+' ta buyurtma ham o\'chadi)':''}`
    :`Удалить клиента "${c.name}"?${orderCount?' ('+orderCount+' заказов тоже будут удалены)':''}`;
  if(!confirm(msg))return;
  const batch = db.batch();
  batch.delete(db.collection('clients').doc(String(id)));
  (state.orders || []).filter(o=>String(o.clientId)===String(id)).forEach(o => batch.delete(db.collection('orders').doc(String(o.id))));
  batch.commit();
  showToast('🗑 '+(lang==='uz'?"O'chirildi":'Удалён'),'info');
  syncClientsToSheets(true);
}
function syncClientsToSheets() {}

function openEditClientModal(id){
  const c=(state.clients || []).find(x=>String(x.id)===String(id));if(!c)return;
  editingClientId=String(id);
  document.getElementById('editClientName').value=c.name||'';
  document.getElementById('editClientPhone').value=c.phone||'';
  document.getElementById('editClientType').value=c.type||'кафе';
  document.getElementById('editClientAddress').value=c.address||'';
  const customPricesHTML = (PRODUCTS || []).map(p => {
    const currentPrice = (c.customPrices && c.customPrices[p.id]) ? c.customPrices[p.id] : '';
    return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
      <div style="flex:1;font-size:14px">${p.emoji || '🥗'} ${p.name}</div>
      <input type="number" id="cp_edit_${p.id}" class="form-input" style="width:120px;padding:8px" placeholder="${p.price}" value="${currentPrice}">
    </div>`;
  }).join('');
  document.getElementById('editClientPrices').innerHTML = customPricesHTML;
  openModal('editClientModal');
}
function saveEditClient(){
  const name=document.getElementById('editClientName').value.trim();
  if(!name){showToast('⚠️ Введите имя','error');return;}
  const c=state.clients.find(x=>x.id==editingClientId);if(!c)return;
  c.name=name;c.phone=document.getElementById('editClientPhone').value.trim();
  c.type=document.getElementById('editClientType').value;c.address=document.getElementById('editClientAddress').value.trim();
  
  // Gather custom prices
  c.customPrices = {};
  PRODUCTS.forEach(p => {
    const cp = parseFloat(document.getElementById('cp_edit_' + p.id)?.value);
    if (!isNaN(cp) && cp > 0) c.customPrices[p.id] = cp;
  });
  
  const batch = db.batch();
  batch.set(db.collection('clients').doc(String(editingClientId)), c);
  state.orders.forEach(o=>{if(o.clientId==editingClientId){ batch.update(db.collection('orders').doc(String(o.id)), {client: name}); }});
  batch.commit(); closeModal('editClientModal');
  showToast('✅ '+(lang==='uz'?'Saqlandi':'Сохранено'),'success');
  syncClientsToSheets(true);
}
function showClientHistory(clientId){
  const client=state.clients.find(c=>c.id==clientId);if(!client)return;
  const orders=(state.orders||[]).filter(o=>o&&o.clientId==clientId).sort((a,b)=>new Date(b.date||0)-new Date(a.date||0));
  document.getElementById('historyTitle').textContent='📋 '+(client.name||'');
  const prodCount={};orders.filter(o=>o.status!=='cancelled').forEach(o=>(o.items||[]).forEach(i=>{if(i)prodCount[i.id]=(prodCount[i.id]||0)+(Number(i.qty)||0);}));
  const favProds=Object.entries(prodCount).sort((a,b)=>b[1]-a[1]).slice(0,3)
    .map(([id,qty])=>{const p=PRODUCTS.find(x=>x.id===id);return p?`<span class="fav-product-tag">${p.emoji||'🥗'} ${escapeHTML(lang==='uz'?(p.nameUz||p.name||''):(p.name||p.nameUz||''))} ${qty}${escapeHTML(p.unit||'кг')}</span>`:'';}).join('');
  document.getElementById('historyFavProducts').innerHTML=favProds?`<div style="font-size:12px;color:var(--text2);margin-bottom:5px">❤️ ${lang==='uz'?'Sevimli':'Любимые'}:</div><div class="fav-products">${favProds}</div>`:'';
  document.getElementById('historyContent').innerHTML=!orders.length
    ?`<div class="empty" style="padding:20px"><div class="empty-text">${T[lang].noOrders}</div></div>`
    :orders.map(o=>{
      const d=new Date(o.date);const ds=isNaN(d.getTime())?'—':(d.toLocaleDateString('ru-RU')+' '+d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}));
      const pi={'наличные':'💵','клик':'📱','консигнация':'📝','Naqd':'💵','Karta':'💳','Qarz':'📝','карта':'💳'};
      return`<div class="history-order">
        <div class="history-date">${ds} · ${pi[o.payment]||'💵'} ${escapeHTML(o.payment||'Naqd')}${o.status==='cancelled'?' · ❌':''}</div>
        <div class="history-items">${(o.items || []).map(i=>`${i.emoji||'🥗'} ${escapeHTML((lang==='uz'?(i.nameUz||i.name):i.name)||'')}: ${i.qty}${escapeHTML(i.unit||'кг')}`).join(' · ')}</div>
        ${o.note?`<div style="font-size:11px;color:var(--text3);margin-top:3px">📝 ${escapeHTML(o.note)}</div>`:''}
        <div class="history-total">${fmt(Number(o.total)||0)} so'm ${isDebtOrder(o)?`<span class="tag orange">${lang==='uz'?'Qarz':'Долг'}</span>`:''}</div>
      </div>`;
    }).join('');
  openModal('clientHistoryModal');
}
function openNewClientModal(){['newClientName','newClientPhone','newClientAddress'].forEach(id=>document.getElementById(id).value='');
  const customPricesHTML = PRODUCTS.map(p => {
    return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
      <div style="flex:1;font-size:14px">${p.emoji} ${p.name}</div>
      <input type="number" id="cp_new_${p.id}" class="form-input" style="width:120px;padding:8px" placeholder="${p.price}">
    </div>`;
  }).join('');
  document.getElementById('newClientPrices').innerHTML = customPricesHTML;
  openModal('newClientModal');}
function saveNewClient(){
  const name=document.getElementById('newClientName').value.trim();
  if(!name){showToast('⚠️ '+(lang==='uz'?'Ism kiriting':'Введите имя'),'error');return;}
  
  const customPrices = {};
  PRODUCTS.forEach(p => {
    const cp = parseFloat(document.getElementById('cp_new_' + p.id)?.value);
    if (!isNaN(cp) && cp > 0) customPrices[p.id] = cp;
  });
  
  const nc = {id:Date.now(),name,phone:document.getElementById('newClientPhone').value.trim(),type:document.getElementById('newClientType').value,address:document.getElementById('newClientAddress').value.trim(),createdAt:new Date().toISOString(), customPrices};
  db.collection('clients').doc(String(nc.id)).set(nc);
  closeModal('newClientModal');showToast('✅ '+name,'success');
}

// STATS
function renderStats(){
  let orders=(state.orders || []).filter(o => o && o.status !== 'cancelled');
  const sd = document.getElementById('statsStartDate')?.value;
  const ed = document.getElementById('statsEndDate')?.value;
  if(sd || ed) {
    orders = orders.filter(o => {
      const d = new Date(o.date);
      if (isNaN(d.getTime())) return false;
      d.setHours(0,0,0,0);
      let ok = true;
      if(sd) { const start = new Date(sd); start.setHours(0,0,0,0); if(d < start) ok = false; }
      if(ed) { const end = new Date(ed); end.setHours(0,0,0,0); if(d > end) ok = false; }
      return ok;
    });
  }
  const originalOrders = state.orders;
  state.orders = orders;
  try {
    const today=new Date().toDateString();
    const todayO=orders.filter(o=>o.date&&new Date(o.date).toDateString()===today);
    const totalRev=orders.reduce((s,o)=>s+(Number(o.total)||0),0);
    const todayRev=todayO.reduce((s,o)=>s+(Number(o.total)||0),0);
    const sg = document.getElementById('statsGrid');
    if (sg) sg.innerHTML=`
      <div class="stat-card"><div class="stat-val">${orders.length}</div><div class="stat-label">${T[lang].totalOrders}</div></div>
      <div class="stat-card"><div class="stat-val">${todayO.length}</div><div class="stat-label">${T[lang].todayOrders}</div></div>
      <div class="stat-card"><div class="stat-val" style="font-size:16px">${fmt(totalRev)}</div><div class="stat-label">${T[lang].totalRev}</div></div>
      <div class="stat-card"><div class="stat-val" style="font-size:16px">${fmt(todayRev)}</div><div class="stat-label">${T[lang].todayRev}</div></div>`;
    renderAvgStats();renderWeekCompare();renderChart();renderForecast();renderTopClients();renderMonthlyReport();renderSeasonality();
  } finally {
    state.orders = originalOrders;
  }

  const ps={};
  (PRODUCTS||[]).forEach(p=>{
    ps[p.id]={id:p.id,name:lang==='uz'?(p.nameUz||p.name||''):(p.name||p.nameUz||''),emoji:p.emoji||'🥗',qty:0,rev:0,profit:0,unit:p.unit||'кг'};
  });
  orders.forEach(o=>(o.items||[]).forEach(i=>{
    if(!i) return;
    if(!ps[i.id]){
      ps[i.id]={id:i.id,name:i.name||i.nameUz||'',emoji:i.emoji||'📦',qty:0,rev:0,profit:0,unit:i.unit||'кг'};
    }
    const itemProfit = calculateItemProfit(i, PRODUCTS.find(x => x.id === i.id));
    ps[i.id].qty += (Number(i.qty) || 0);
    ps[i.id].rev += ((Number(i.qty)||0) * (Number(i.price)||0));
    ps[i.id].profit += itemProfit;
  }));
  const sorted=Object.values(ps).sort((a,b)=>b.qty-a.qty);
  const prodStatsEl = document.getElementById('productStats');
  if (prodStatsEl) prodStatsEl.innerHTML=`<div class="card-title" style="margin-bottom:12px">📦 ${T[lang].products}</div>${sorted.map(p=>{
    const marginPct = p.rev > 0 ? Math.round((p.profit / p.rev) * 100) : 0;
    return`<div class="summary-row"><span>${p.emoji} ${escapeHTML(p.name)}</span><div style="text-align:right"><div><b>${roundQty(p.qty)}${p.unit}</b> · <span class="summary-price">${fmt(p.rev)} so'm</span></div><div style="font-size:11px;color:${p.profit>=0?'var(--green)':'var(--danger)'}">${lang==='uz'?'Foyda':'Маржа'}: <b>+${fmt(p.profit)} so'm</b> <span style="opacity:0.8">(${marginPct}%)</span></div></div></div>`;
  }).join('')}`;

  // Product Price Stats
  const priceStats = {};
  (PRODUCTS||[]).forEach(p => {
    priceStats[p.id] = { name: lang==='uz'?(p.nameUz||p.name||''):(p.name||p.nameUz||''), emoji: p.emoji||'🥗', unit: p.unit||'кг', prices: {} };
  });
  orders.forEach(o => (o.items||[]).forEach(i => {
    if(i && priceStats[i.id]) {
      if(!priceStats[i.id].prices[i.price]) priceStats[i.id].prices[i.price] = 0;
      priceStats[i.id].prices[i.price] += (Number(i.qty)||0);
    }
  }));
  
  let priceHtml = `<div class="card-title" style="margin-bottom:12px">🏷️ ${lang==='uz'?'Narxlar bo\'yicha sotuv':'Продажи по ценам'}</div>`;
  Object.values(priceStats).forEach(p => {
    const pricesObj = p.prices;
    const priceKeys = Object.keys(pricesObj).map(Number).sort((a,b)=>a-b);
    if(priceKeys.length > 0) {
      priceHtml += `<div style="margin-bottom:10px;">
        <div style="font-weight:700;margin-bottom:4px;color:var(--text);">${p.emoji||''} ${escapeHTML(p.name)}</div>`;
      priceKeys.forEach(price => {
        priceHtml += `<div class="summary-row" style="padding:4px 0;border-bottom:1px dashed var(--border);font-size:13px;align-items:center;">
          <span style="color:var(--text2);">${fmt(price)} so'm</span>
          <span style="font-weight:bold;color:var(--accent);font-size:14px;">${roundQty(pricesObj[price])} ${p.unit}</span>
        </div>`;
      });
      priceHtml += `</div>`;
    }
  });
  const ppsEl = document.getElementById('productPriceStats');
  if(ppsEl) {
    ppsEl.innerHTML = priceHtml;
    ppsEl.style.display = Object.keys(priceStats).some(id => Object.keys(priceStats[id].prices).length > 0) ? 'block' : 'none';
  }
}

function renderAvgStats(){
  const avgEl = document.getElementById('avgStats'); if(!avgEl) return;
  const orders=(state.orders||[]).filter(o=>o&&o.status!=='cancelled'&&o.date&&!isNaN(new Date(o.date).getTime()));
  if(!orders.length){avgEl.innerHTML=`<div style="color:var(--text3);font-size:13px">${T[lang].noOrders}</div>`;return;}
  const avg=orders.reduce((s,o)=>s+(Number(o.total)||0),0)/orders.length;
  // By day of week
  const byDay=[0,0,0,0,0,0,0],cntDay=[0,0,0,0,0,0,0];
  orders.forEach(o=>{const wd=(new Date(o.date).getDay()+6)%7;byDay[wd]+=(Number(o.total)||0);cntDay[wd]++;});
  const maxDay=Math.max(...byDay.map((s,i)=>cntDay[i]?s/cntDay[i]:0),1);
  // By client
  const byC={};orders.forEach(o=>{const ck=o.clientId||o.client||'unknown';if(!byC[ck])byC[ck]={name:o.client||'Mijoz',total:0,cnt:0};byC[ck].total+=(Number(o.total)||0);byC[ck].cnt++;});
  const topC=Object.values(byC).sort((a,b)=>(b.total/b.cnt)-(a.total/a.cnt)).slice(0,3);
  avgEl.innerHTML=`
    <div class="avg-chip"><span>📊</span><span style="font-weight:700">${lang==='uz'?'Umumiy o\'rtacha':'Общий средний чек'}:</span><span style="color:var(--accent);font-weight:900">${fmt(avg)} so'm</span></div>
    <div style="margin-bottom:12px">
      <div style="font-size:12px;color:var(--text2);margin-bottom:8px;font-weight:600">${lang==='uz'?'Hafta kunlari bo\'yicha':'По дням недели'}:</div>
      ${T[lang].weekDays.map((d,i)=>{
        const a=cntDay[i]?byDay[i]/cntDay[i]:0;const w=Math.round(a/maxDay*100);
        return`<div class="compare-bar-wrap"><div class="compare-label"><span>${d}</span><span>${a?fmt(a)+' so\'m':'-'}</span></div><div class="compare-bar-bg"><div class="compare-bar-fill" style="width:${w}%;background:linear-gradient(90deg,var(--accent),var(--accent2))"></div></div></div>`;
      }).join('')}
    </div>
    <div style="font-size:12px;color:var(--text2);margin-bottom:8px;font-weight:600">${lang==='uz'?'Mijozlar bo\'yicha top':'Топ по среднему чеку'}:</div>
    ${topC.map((c,i)=>`<div class="top-client-row"><div class="top-rank">${['🥇','🥈','🥉'][i]}</div><div style="flex:1"><div style="font-weight:700">${escapeHTML(c.name)}</div><div style="font-size:12px;color:var(--text2)">${c.cnt} ${lang==='uz'?'buyurtma':'заказов'}</div></div><div style="font-weight:800;color:var(--accent2)">${fmt(c.total/c.cnt)} so'm</div></div>`).join('')}`;
}

function renderWeekCompare(){
  const wcEl=document.getElementById('weekCompare'); if(!wcEl) return;
  const now=new Date();
  const startThisWeek=new Date(now);startThisWeek.setDate(now.getDate()-(now.getDay()+6)%7);startThisWeek.setHours(0,0,0,0);
  const startLastWeek=new Date(startThisWeek);startLastWeek.setDate(startThisWeek.getDate()-7);
  const active=(state.orders||[]).filter(o=>o&&o.status!=='cancelled'&&o.date&&!isNaN(new Date(o.date).getTime()));
  const thisWeekO=active.filter(o=>new Date(o.date)>=startThisWeek);
  const lastWeekO=active.filter(o=>new Date(o.date)>=startLastWeek&&new Date(o.date)<startThisWeek);
  const thisRev=thisWeekO.reduce((s,o)=>s+(Number(o.total)||0),0);
  const lastRev=lastWeekO.reduce((s,o)=>s+(Number(o.total)||0),0);
  const maxRev=Math.max(thisRev,lastRev,1);
  const diff=lastRev?Math.round((thisRev-lastRev)/lastRev*100):100;
  const arrow=diff>=0?'📈':'📉';
  wcEl.innerHTML=`
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <div><div style="font-size:12px;color:var(--text2)">${lang==='uz'?'Bu hafta':'Эта неделя'}</div><div style="font-size:20px;font-weight:900;color:var(--accent)">${fmt(thisRev)} so'm</div></div>
      <div style="font-size:24px">${arrow}</div>
      <div style="text-align:right"><div style="font-size:12px;color:var(--text2)">${lang==='uz'?'O\'tgan hafta':'Прошлая неделя'}</div><div style="font-size:20px;font-weight:900;color:var(--text2)">${fmt(lastRev)} so'm</div></div>
    </div>
    <div style="font-size:13px;font-weight:700;text-align:center;color:${diff>=0?'var(--green)':'var(--danger)'}">
      ${diff>=0?'+':''}${diff}% ${lang==='uz'?(diff>=0?'o\'sish':'kamayish'):(diff>=0?'рост':'снижение')}
    </div>
    <div style="display:flex;gap:8px;margin-top:12px">
      <div style="flex:1"><div style="font-size:11px;color:var(--text2);margin-bottom:3px">${lang==='uz'?'Bu hafta':'Эта'} (${thisWeekO.length})</div><div class="compare-bar-bg"><div class="compare-bar-fill" style="width:${Math.round(thisRev/maxRev*100)}%;background:linear-gradient(90deg,var(--accent),var(--accent2))"></div></div></div>
      <div style="flex:1"><div style="font-size:11px;color:var(--text2);margin-bottom:3px">${lang==='uz'?'O\'tgan':'Прошлая'} (${lastWeekO.length})</div><div class="compare-bar-bg"><div class="compare-bar-fill" style="width:${Math.round(lastRev/maxRev*100)}%;background:rgba(124,106,247,.4)"></div></div></div>
    </div>`;
}

function setChartPeriod(period,el){chartPeriod=period;document.querySelectorAll('.period-tab').forEach(t=>t.classList.remove('active'));el.classList.add('active');renderChart();}
function renderChart(){
  const days=chartPeriod==='week'?7:30;
  const cur={},prev={};
  const curKeys=[],prevKeys=[],labels=[];
  for(let i=days-1;i>=0;i--){
    const d=new Date();d.setDate(d.getDate()-i);d.setHours(0,0,0,0);
    const k=d.toLocaleDateString('ru-RU');
    const lbl=d.toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'});
    cur[k]=0;
    curKeys.push(k);
    labels.push(lbl);

    const d2=new Date(d);d2.setDate(d2.getDate()-days);d2.setHours(0,0,0,0);
    const k2=d2.toLocaleDateString('ru-RU');
    prev[k2]=0;
    prevKeys.push(k2);
  }
  state.orders.forEach(o=>{
    if(!o || o.status === 'cancelled' || !o.date) return;
    const d=new Date(o.date);if(isNaN(d.getTime())) return;
    d.setHours(0,0,0,0);
    const rev = Number(o.total) || 0;
    const k=d.toLocaleDateString('ru-RU');
    if(cur[k]!==undefined)cur[k]+=rev;
    if(prev[k]!==undefined)prev[k]+=rev;
  });
  const maxV=Math.max(...Object.values(cur),...Object.values(prev),1);
  const barsEl=document.getElementById('chartBars');
  if (barsEl) {
    barsEl.innerHTML=labels.map((label,i)=>{
      const val=cur[curKeys[i]]||0;
      const prevVal=prev[prevKeys[i]]||0;
      const hc=Math.max(3,Math.round(val/maxV*90));
      const hp=Math.max(3,Math.round(prevVal/maxV*90));
      return`<div class="chart-bar-col">
        <div style="display:flex;gap:2px;align-items:flex-end">
          <div class="chart-bar prev" style="height:${hp}px" title="${fmt(prevVal)}"></div>
          <div class="chart-bar cur" style="height:${hc}px" title="${fmt(val)}"></div>
        </div>
        <div class="chart-label">${label}</div>
      </div>`;
    }).join('');
  }
  const legEl=document.getElementById('chartLegend');
  if (legEl) {
    legEl.innerHTML=`
      <div><span class="legend-dot" style="background:linear-gradient(var(--accent),var(--accent2))"></span>${lang==='uz'?'Bu davr':'Текущий'}</div>
      <div><span class="legend-dot" style="background:rgba(124,106,247,.4)"></span>${lang==='uz'?'Oldingi':'Предыдущий'}</div>`;
  }
}

function renderForecast(){
  const fb = document.getElementById('forecastBlock'); if (!fb) return;
  const active=(state.orders||[]).filter(o=>o&&o.status!=='cancelled'&&o.date&&!isNaN(new Date(o.date).getTime()));
  const byDay=[{s:0,c:0},{s:0,c:0},{s:0,c:0},{s:0,c:0},{s:0,c:0},{s:0,c:0},{s:0,c:0}];
  active.forEach(o=>{const wd=(new Date(o.date).getDay()+6)%7;byDay[wd].s+=(Number(o.total)||0);byDay[wd].c++;});
  const tmr=new Date();tmr.setDate(tmr.getDate()+1);
  const tmrDayWd=(tmr.getDay()+6)%7;
  const forecast=byDay[tmrDayWd];
  const avgF=forecast.c?Math.round(forecast.s/forecast.c):0;
  // Product forecast
  const prodByDay=(PRODUCTS||[]).map(p=>{
    let s=0,c=0;
    active.forEach(o=>{if((new Date(o.date).getDay()+6)%7===tmrDayWd){const it=(o.items||[]).find(i=>i&&i.id===p.id);if(it){s+=(Number(it.qty)||0);c++;}}});
    return{...p,avgQty:c?Math.round(s/c*10)/10:0};
  }).filter(p=>p.avgQty>0);
  fb.innerHTML=!avgF
    ?`<div style="color:var(--text3);font-size:13px">${lang==='uz'?'Ma\'lumot yetarli emas':'Недостаточно данных'}</div>`
    :`<div class="avg-chip" style="margin-bottom:10px"><span>📅</span><span>${T[lang].tomorrow} (${T[lang].weekDays[tmrDayWd]})</span></div>
    <div style="font-size:22px;font-weight:900;color:var(--accent);margin-bottom:8px">~${fmt(avgF)} so'm</div>
    <div style="font-size:13px;color:var(--text2);margin-bottom:10px">${lang==='uz'?'Kutilayotgan buyurtmalar':'Ожид. заказов'}: ~${forecast.c}</div>
    ${prodByDay.length?`<div style="font-size:12px;color:var(--text2);margin-bottom:6px;font-weight:600">${lang==='uz'?'Taxminiy kerak':'Примерно нужно'}:</div>${prodByDay.map(p=>`<div class="forecast-row"><div class="forecast-day">${p.emoji||'🥗'} ${escapeHTML(lang==='uz'?(p.nameUz||p.name||''):(p.name||p.nameUz||''))}</div><div class="forecast-amt">~${p.avgQty}${p.unit||'кг'}</div></div>`).join('')}`:''}`;
}

function renderTopClients(){
  const byC={};
  (state.orders||[]).filter(o=>o&&o.status!=='cancelled').forEach(o=>{
    const cid=o.clientId||o.client||'unknown';
    if(!byC[cid])byC[cid]={name:o.client||'Mijoz',total:0,count:0,profit:0};
    byC[cid].total+=(Number(o.total)||0);
    byC[cid].profit+=calculateOrderProfit(o);
    byC[cid].count++;
  });
  const top=Object.values(byC).sort((a,b)=>b.profit-a.profit).slice(0,5);
  const ranks=['🥇','🥈','🥉','4️⃣','5️⃣'];
  const el=document.getElementById('topClients');
  if(!el)return;
  el.innerHTML=!top.length
    ?`<div style="color:var(--text3);font-size:13px">${T[lang].noOrders}</div>`
    :top.map((c,i)=>{
      const marginPct = c.total > 0 ? Math.round((c.profit / c.total) * 100) : 0;
      return `<div class="top-client-row">
        <div class="top-rank">${ranks[i]}</div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHTML(c.name)}</div>
          <div style="font-size:11px;color:var(--text2)">${c.count} ${lang==='uz'?'buyurtma':'заказов'} · ${lang==='uz'?'Tushum':'Выручка'}: ${fmt(c.total)} so'm</div>
        </div>
        <div style="text-align:right">
          <div style="font-weight:800;color:var(--green);font-size:13px">+${fmt(c.profit)} so'm</div>
          <div style="font-size:11px;color:var(--text3);font-weight:600">${lang==='uz'?'Sof marja':'Маржа'}: ${marginPct}%</div>
        </div>
      </div>`;
    }).join('');
}

// ==================== MONTHLY REPORT + SEASONALITY ====================
function renderMonthlyReport(){
  const el=document.getElementById('monthlyReport');if(!el)return;
  const months={};
  (state.orders||[]).filter(o=>o&&o.status!=='cancelled'&&o.date).forEach(o=>{
    const d=new Date(o.date); if(isNaN(d.getTime())) return;
    const key=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
    if(!months[key])months[key]={label:d.toLocaleDateString(lang==='uz'?'uz-UZ':'ru-RU',{month:'long',year:'numeric'}),rev:0,profit:0,count:0,debt:0};
    months[key].rev+=(Number(o.total)||0);
    months[key].profit+=calculateOrderProfit(o);
    months[key].count++;
    if(isDebtOrder(o))months[key].debt+=((Number(o.total)||0)-(Number(o.partialPaid)||0));
  });
  const entries=Object.entries(months).sort((a,b)=>b[0].localeCompare(a[0])).slice(0,12);
  if(!entries.length){el.innerHTML=`<div style="color:var(--text3);font-size:13px">${T[lang].noOrders}</div>`;return;}
  const maxRev=Math.max(...entries.map(e=>e[1].rev),1);
  el.innerHTML=entries.map(([key,m])=>{
    const marginPct = m.rev > 0 ? Math.round((m.profit / m.rev) * 100) : 0;
    return `
    <div style="padding:10px 0;border-bottom:1px solid var(--border)">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
        <div>
          <div style="font-weight:700;font-size:13px;text-transform:capitalize">${m.label}</div>
          <div style="font-size:11px;color:var(--text3);margin-top:2px">${m.count} ${lang==='uz'?'buyurtma':'заказов'}${m.debt>0?' · <span style="color:var(--orange)">💰 '+fmt(m.debt)+'</span>':''}</div>
        </div>
        <div style="text-align:right">
          <div style="font-weight:800;color:var(--accent2);font-size:13px">${fmt(m.rev)} so'm</div>
          <div style="font-size:12px;color:var(--green);font-weight:700;margin-top:2px">📈 +${fmt(m.profit)} so'm <span style="font-size:11px;opacity:0.85">(${marginPct}%)</span></div>
        </div>
      </div>
      <div style="background:var(--bg3);border-radius:100px;height:6px;overflow:hidden">
        <div style="height:100%;border-radius:100px;background:linear-gradient(90deg,var(--accent),var(--green));width:${Math.round(m.rev/maxRev*100)}%;transition:width .6s"></div>
      </div>
    </div>`;
  }).join('');
}

function renderSeasonality(){
  const el=document.getElementById('seasonalityBlock');if(!el)return;
  const days=[0,0,0,0,0,0,0],cnts=[0,0,0,0,0,0,0];
  (state.orders||[]).filter(o=>o&&o.status!=='cancelled'&&o.date&&!isNaN(new Date(o.date).getTime())).forEach(o=>{const wd=(new Date(o.date).getDay()+6)%7;days[wd]+=(Number(o.total)||0);cnts[wd]++;});
  const avgs=days.map((s,i)=>cnts[i]?Math.round(s/cnts[i]):0);
  const maxAvg=Math.max(...avgs,1);
  const best=avgs.indexOf(Math.max(...avgs));
  el.innerHTML=`
    <div style="font-size:12px;color:var(--text2);margin-bottom:10px">${lang==='uz'?'Eng yaxshi kun':'Лучший день'}: <b style="color:var(--accent)">${T[lang].weekDays[best]}</b></div>
    ${T[lang].weekDays.map((d,i)=>`
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
        <div style="width:24px;font-size:12px;font-weight:${i===best?'900':'400'};color:${i===best?'var(--accent)':'var(--text2)'}">${d}</div>
        <div style="flex:1;background:var(--bg3);border-radius:100px;height:8px;overflow:hidden">
          <div style="height:100%;border-radius:100px;background:${i===best?'linear-gradient(90deg,var(--accent),var(--accent2))':'rgba(124,106,247,.4)'};width:${Math.round(avgs[i]/maxAvg*100)}%;transition:width .6s"></div>
        </div>
        <div style="font-size:12px;font-weight:700;color:${i===best?'var(--accent2)':'var(--text2)'};min-width:80px;text-align:right">${avgs[i]?fmt(avgs[i])+' so\'m':'-'}</div>
      </div>`).join('')}`;
}
// EXPORT
// ==================== PRODUCTS SETTINGS ====================
function renderProductsSettings(){
  const el=document.getElementById('productsSettingsList');if(!el)return;
  el.innerHTML=PRODUCTS.map((p,i)=>{
    const tracked = isProductTracked(p);
    const st = getProductStockStatus(p);
    const stockBadge = tracked
      ? `<span onclick="showPage('warehouse')" style="cursor:pointer;font-size:11px;font-weight:700;padding:3px 8px;border-radius:10px;background:${st==='low'||st==='empty'?'rgba(247,90,90,.15)':'rgba(45,212,160,.14)'};color:${st==='low'||st==='empty'?'var(--danger)':'var(--green)'}">🏭 ${roundQty(p.stock)} ${p.unit||'kg'}</span>`
      : `<span onclick="openWarehouseEditModal('${p.id}')" style="cursor:pointer;font-size:11px;font-weight:600;padding:3px 8px;border-radius:10px;background:var(--bg3);color:var(--text3)">➕ Sklad kiritish</span>`;
    return `
    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:12px;margin-bottom:8px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <span style="font-size:22px">${p.emoji}</span>
        <div style="flex:1;font-weight:700">${p.name} <span style="font-size:11px;font-weight:400;color:var(--text3)">(${p.unit||'кг'})</span></div>
        ${stockBadge}
        <button onclick="deleteProduct(${i})" style="background:rgba(247,90,90,.12);border:1px solid rgba(247,90,90,.3);color:var(--danger);border-radius:8px;padding:5px 10px;cursor:pointer;font-size:13px">🗑</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div>
          <div style="font-size:11px;color:var(--text2);margin-bottom:3px">Цена (so'm)</div>
          <input type="number" id="pprice-${i}" value="${p.price}" class="form-input" style="padding:8px 10px;font-size:13px" onchange="updateProductPrice(${i},this.value)">
        </div>
        <div>
          <div style="font-size:11px;color:var(--text2);margin-bottom:3px">Себестоимость (so'm)</div>
          <input type="number" id="pcost-${i}" value="${p.cost||0}" class="form-input" style="padding:8px 10px;font-size:13px" onchange="updateProductCost(${i},this.value)">
        </div>
      </div>
      ${p.price&&(p.cost||0)>0?`<div style="margin-top:6px;font-size:12px;color:var(--green)">Маржа: ${fmt(p.price-(p.cost||0))} so'm (${Math.round((p.price-(p.cost||0))/p.price*100)}%)</div>`:''}
    </div>`;
  }).join('');
}
function updateProductPrice(idx,val){
  const newPrice=parseInt(val)||0;if(!newPrice)return;
  const p=PRODUCTS[idx];if(!p)return;
  p.price=newPrice;saveProducts();
  if(confirm(lang==='uz'?`Eski buyurtmalarni qayta hisoblash? (${p.name})`:`Пересчитать старые заказы по новой цене? (${p.name})`)){
    const batch = db.batch();
    let changed = 0;
    (state.orders || []).forEach(o=>{
      if (!o || o.status === 'cancelled') return;
      const items = Array.isArray(o.items) ? o.items : [];
      const item=items.find(i=>i.id===p.id);
      if(item){
        item.price=newPrice;
        o.total=items.reduce((s,i)=>s+(Number(i.qty)||0)*(Number(i.price)||0),0);
        batch.update(db.collection('orders').doc(String(o.id)), { items: o.items, total: o.total });
        changed++;
      }
    });
    if(changed > 0) batch.commit().catch(()=>{});
    save();
  }
  renderProductsGrid();renderProductsSettings();
  try { renderWarehouse(); updateWarehouseBadge(); renderDashboard(); renderOrdersList(); } catch(e) {}
  showToast('✅ '+(lang==='uz'?'Narx yangilandi':'Цена обновлена'),'success');
}
function updateProductCost(idx,val){
  if(!PRODUCTS[idx])return;
  PRODUCTS[idx].cost=parseInt(val)||0;saveProducts();renderProductsSettings();
  try { renderDashboard(); } catch(e) {}
  showToast('✅ '+(lang==='uz'?'Tannarx saqlandi':'Себестоимость сохранена'),'success');
}
function deleteProduct(idx){
  const p=PRODUCTS[idx];if(!p)return;
  if(!confirm(lang==='uz'?`"${p.name}"ni o'chirishni tasdiqlaysizmi?`:`Удалить продукт "${p.name}"?`))return;
  PRODUCTS.splice(idx,1);
  if (p.id !== undefined && p.id !== null) {
    db.collection('products').doc(String(p.id)).delete().catch(()=>{});
  }
  saveProducts();renderProductsGrid();renderProductsSettings();
  try { renderWarehouse(); updateWarehouseBadge(); renderDashboard(); } catch(e) {}
  showToast('🗑 '+(lang==='uz'?"O'chirildi":'Удалён'),'info');
}
function openAddProductModal(){
  ['newProdName','newProdNameUz','newProdEmoji','newProdPrice','newProdCost','newProdStock'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('newProdUnit').value='кг';
  openModal('addProductModal');
}
function saveNewProduct(){
  const name=document.getElementById('newProdName').value.trim();
  const price=parseInt(document.getElementById('newProdPrice').value)||0;
  if(!name||!price){showToast('⚠️ '+(lang==='uz'?'Nom va narx kiriting':'Введите название и цену'),'error');return;}
  const unit=document.getElementById('newProdUnit').value;
  let stockStr = document.getElementById('newProdStock').value.trim();
  let stock = stockStr === '' ? '' : parseFloat(stockStr);
  PRODUCTS.push({id:'prod_'+Date.now(),name,nameUz:document.getElementById('newProdNameUz').value.trim()||name,
    price,cost:parseInt(document.getElementById('newProdCost').value)||0,
    emoji:document.getElementById('newProdEmoji').value.trim()||'📦',unit,step:unit==='шт'?1:0.5, stock, order: PRODUCTS.length});
  saveProducts();closeModal('addProductModal');renderProductsGrid();renderProductsSettings();
  try { renderWarehouse(); updateWarehouseBadge(); renderDashboard(); } catch(e) {}
  showToast('✅ '+name,'success');
}
function exportToExcel(){
  const prods = PRODUCTS || [];
  const header = ['Дата','Клиент','Телефон','Тип','Оплата','Статус',...prods.map(p=>p.name||p.nameUz||p.id),'Итого','Примечание'];
  const rows=[header];
  (state.orders || []).filter(o=>o&&o.status!=='cancelled').forEach(o=>{
    const d=new Date(o.date);
    const ds=isNaN(d.getTime())?'—':(d.toLocaleDateString('ru-RU')+' '+d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}));
    const its=Array.isArray(o.items)?o.items:[];
    rows.push([ds,o.client||'',o.phone||'',o.type||'',o.payment||'',o.status||'new',...prods.map(p=>its.find(i=>i.id===p.id)?.qty||0),Number(o.total)||0,o.note||'']);
  });
  const csv=rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8;'}));
  a.download='TeeGuPRO_'+new Date().toLocaleDateString('ru-RU').replace(/\./g,'-')+'.csv';a.click();
  showToast('📊 '+(lang==='uz'?'Yuklandi':'Скачано'),'success');
}

function renderCouriersSettings(){
  const el=document.getElementById('couriersSettingsList');if(!el)return;
  if(!state.couriers.length) { el.innerHTML = `<div style="font-size:12px;color:var(--text3);padding:10px 0">Нет курьеров</div>`; return; }
  el.innerHTML=state.couriers.map(c=>`<div style="display:flex;justify-content:space-between;background:var(--bg2);border:1px solid var(--border);padding:10px;border-radius:10px;margin-bottom:8px">
    <div><div style="font-weight:700">${c.name}</div><div style="font-size:11px;color:var(--text2)">PIN: ${c.pin}</div></div>
    <button onclick="deleteCourier(${c.id})" style="background:rgba(247,90,90,.1);color:var(--danger);border:none;border-radius:6px;padding:4px 8px;cursor:pointer">🗑</button>
  </div>`).join('');
}
function openAddCourierModal() {
  document.getElementById('newCourierName').value = '';
  document.getElementById('newCourierPin').value = '';
  openModal('addCourierModal');
}
function saveNewCourier(){
  const name=document.getElementById('newCourierName').value.trim();
  const pin=document.getElementById('newCourierPin').value.trim();
  if(!name || !pin) { showToast('⚠️ Введите логин и пин', 'error'); return; }
  const c = {id:Date.now(), name, pin};
  db.collection('couriers').doc(String(c.id)).set(c);
  closeModal('addCourierModal');
  showToast('✅ '+(lang==='uz'?"Qo'shildi":'Добавлен'), 'success');
}
function deleteCourier(id){
  db.collection('couriers').doc(String(id)).delete();
}
function populateCourierSelects(){
  const html = '<option value="">-- Без курьера --</option>' + state.couriers.map(c=>`<option value="${c.name}">${c.name}</option>`).join('');
  const oc = document.getElementById('orderCourier'); if(oc) oc.innerHTML=html;
  const eoc = document.getElementById('editOrderCourier'); if(eoc) eoc.innerHTML=html;
}

function renderAgentsSettings(){
  const el=document.getElementById('agentsSettingsList');if(!el)return;
  if(!state.agents.length) { el.innerHTML = `<div style="font-size:12px;color:var(--text3);padding:10px 0">Нет агентов</div>`; return; }
  el.innerHTML=state.agents.map(a=>`<div style="display:flex;justify-content:space-between;background:var(--bg2);border:1px solid var(--border);padding:10px;border-radius:10px;margin-bottom:8px">
    <div><div style="font-weight:700">${a.name}</div><div style="font-size:11px;color:var(--text2)">PIN: ${a.pin}</div></div>
    <button onclick="deleteAgent(${a.id})" style="background:rgba(247,90,90,.1);color:var(--danger);border:none;border-radius:6px;padding:4px 8px;cursor:pointer">🗑️</button>
  </div>`).join('');
}
function openAddAgentModal() {
  document.getElementById('newAgentName').value = '';
  document.getElementById('newAgentPin').value = '';
  openModal('addAgentModal');
}
function saveNewAgent(){
  const name=document.getElementById('newAgentName').value.trim();
  const pin=document.getElementById('newAgentPin').value.trim();
  if(!name || !pin) { showToast('⚠️ Введите логин и пин', 'error'); return; }
  const a = {id:Date.now(), name, pin};
  db.collection('agents').doc(String(a.id)).set(a);
  closeModal('addAgentModal');
  showToast('✅ '+(lang==='uz'?"Qo'shildi":'Добавлен'), 'success');
}
function deleteAgent(id){
  db.collection('agents').doc(String(id)).delete();
}

// SETTINGS
function loadSettings(){
  const s=state.settings;
  if(s.tgToken)document.getElementById('tgToken').value=s.tgToken;
  if(s.tgChatId)document.getElementById('tgChatId').value=s.tgChatId;
  const timeEl = document.getElementById('tgSummaryTime');
  if(timeEl) timeEl.value = s.tgSummaryTime || '22:00';
  const geminiEl = document.getElementById('geminiApiKey');
  if(geminiEl) geminiEl.value = s.geminiApiKey || localStorage.getItem('geminiApiKey') || '';
  if(typeof checkAiKeyStatus === 'function') checkAiKeyStatus();
}

function saveSettings(){
  state.settings.tgToken=document.getElementById('tgToken').value.trim();
  state.settings.tgChatId=document.getElementById('tgChatId').value.trim();
  const timeEl = document.getElementById('tgSummaryTime');
  if(timeEl) state.settings.tgSummaryTime = timeEl.value || '22:00';
  const geminiEl = document.getElementById('geminiApiKey');
  if(geminiEl) {
    state.settings.geminiApiKey = geminiEl.value.trim();
    localStorage.setItem('geminiApiKey', state.settings.geminiApiKey);
  }
  if(typeof checkAiKeyStatus === 'function') checkAiKeyStatus();
  db.collection('settings').doc('main').set(state.settings);
  showToast('✅ '+(lang==='uz'?'Saqlandi':'Сохранено'),'success');
}
async function testTelegram(){saveSettings();const{tgToken,tgChatId}=state.settings;if(!tgToken||!tgChatId){showToast('⚠️','error');return;}try{const r=await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:tgChatId,text:'🥗 <b>СалатПро</b> – тест ✅',parse_mode:'HTML'})});if((await r.json()).ok)showToast('✅ Telegram OK!','success');else showToast('❌','error');}catch(e){showToast('❌','error');}}


// UTILS
function fmt(n){return Math.round(n).toLocaleString('ru-RU');}
// ==================== FOYDA VA MARJA QOIDALARI ====================
// 1. Funchoza & Morkovcha (Sabzi):
//    - 20 000 so'm narx uchun -> 1 kg ga 3 000 so'm foyda
//    - 22 000 so'm narx uchun -> 1 kg ga 4 000 so'm foyda
//    - 25 000 so'm narx uchun -> 1 kg ga 5 000 so'm foyda
// 2. Sol ogurtsy (Tuzlangan bodring):
//    - 20 000 so'm narx uchun -> 1 kg ga 5 000 so'm foyda
//    - 15 000 so'm narx uchun -> 1 kg ga 3 000 so'm foyda
// 3. Boshqa mahsulotlar: agar tannarx kiritilgan bo'lsa -> (narx - tannarx) * kg
function calculateItemProfit(item, prodFallback = null) {
  const id = (item.id || '').toLowerCase();
  const name = (item.name || '').toLowerCase();
  const nameUz = (item.nameUz || '').toLowerCase();
  const price = Math.round(item.price || 0);
  const qty = parseFloat(item.qty || 0) || 0;
  if (qty <= 0) return 0;

  // 1. Funchoza yoki Morkovcha (Sabzi)
  if (id === 'funchoza' || id === 'morkovcha' || 
      name.includes('фунчоз') || name.includes('морков') || 
      nameUz.includes('funchoz') || nameUz.includes('sabzi')) {
    if (price <= 20000) return 3000 * qty;
    if (price <= 22000) return 4000 * qty;
    return 5000 * qty; // 25000 va undan yuqori
  }

  // 2. Sol ogurtsy (Tuzlangan bodring)
  if (id === 'sologurc' || name.includes('сол') || name.includes('огурц') || nameUz.includes('tuzlangan')) {
    if (price <= 15000) return 3000 * qty;
    return 5000 * qty; // 20000 va undan yuqori
  }

  // 3. Boshqa mahsulotlar uchun (agar tannarxi bo'lsa)
  const cost = item.cost > 0 ? item.cost : (prodFallback?.cost > 0 ? prodFallback.cost : 0);
  if (cost > 0 && price > cost) {
    return (price - cost) * qty;
  }
  return 0;
}

function calculateOrderProfit(order) {
  if (!order) return 0;
  let profit = 0;
  try {
    (order.items || []).forEach(i => {
      if (!i) return;
      const p = (PRODUCTS || []).find(x => x && x.id === i.id);
      profit += calculateItemProfit(i, p);
    });
  } catch(e) {
    return 0;
  }
  return profit;
}

// ==================== DASHBOARD ====================
let lastDashboardChartDays = [];
let selectedDashboardDayIdx = 6;

function formatShortSum(val) {
  const n = Number(val) || 0;
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1000) return Math.round(n / 1000) + 'k';
  return String(Math.round(n));
}

function selectDashboardChartDay(idx) {
  if (!Array.isArray(lastDashboardChartDays) || !lastDashboardChartDays[idx]) return;
  selectedDashboardDayIdx = idx;
  const d = lastDashboardChartDays[idx];
  const infoEl = document.getElementById('dashChartSelectedInfo');
  if (infoEl) {
    infoEl.textContent = `${d.fullLabel}: ${fmt(d.value)} so'm (${d.count} ${lang === 'uz' ? 'ta' : 'зак.'})`;
  }
  const dots = document.querySelectorAll('.dash-chart-dot');
  dots.forEach((el, i) => {
    el.setAttribute('r', i === idx ? '5.5' : '3.8');
    el.setAttribute('stroke-width', i === idx ? '2.5' : '1.5');
  });
}

function buildDashboardRevenueChart(daysData) {
  lastDashboardChartDays = daysData;
  if (selectedDashboardDayIdx >= daysData.length) selectedDashboardDayIdx = daysData.length - 1;

  const w = 340, h = 148;
  const padL = 36, padR = 14, padT = 18, padB = 26;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const plotBottom = padT + plotH;

  const total7 = daysData.reduce((s, d) => s + d.value, 0);
  const rawMax = Math.max(...daysData.map(d => d.value), 0);
  const scaleMax = rawMax > 0 ? rawMax * 1.15 : 100000;

  const points = daysData.map((d, i) => {
    const x = padL + (daysData.length > 1 ? (i * plotW) / (daysData.length - 1) : plotW / 2);
    const ratio = Math.max(0, Math.min(1, d.value / scaleMax));
    const y = plotBottom - ratio * plotH;
    return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, ...d, idx: i };
  });

  // Smooth curve strictly within Y bounds using midpoint quadratic Bezier
  let linePath = '';
  let areaPath = '';
  if (points.length >= 2) {
    linePath = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length - 1; i++) {
      const mx = (points[i].x + points[i + 1].x) / 2;
      const my = (points[i].y + points[i + 1].y) / 2;
      linePath += ` Q ${points[i].x} ${points[i].y} ${mx.toFixed(1)} ${my.toFixed(1)}`;
    }
    const last = points[points.length - 1];
    linePath += ` T ${last.x} ${last.y}`;
    areaPath = `${linePath} L ${last.x} ${plotBottom} L ${points[0].x} ${plotBottom} Z`;
  }

  const gridLevels = [1, 0.5, 0].map(f => {
    const y = Math.round((plotBottom - f * plotH) * 10) / 10;
    const val = f * scaleMax;
    return `
      <line x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" stroke="var(--border)" stroke-width="1" ${f > 0 ? 'stroke-dasharray="3 3"' : ''}/>
      <text x="${padL - 5}" y="${y + 3}" text-anchor="end" fill="var(--text3)" font-size="9.5" font-weight="600">${f === 0 ? '0' : (rawMax > 0 ? formatShortSum(val) : '')}</text>`;
  }).join('');

  const dotsAndLabels = points.map((p, i) => {
    const isSel = i === selectedDashboardDayIdx;
    const valTag = p.value > 0
      ? `<text x="${p.x}" y="${Math.max(10, p.y - 7)}" text-anchor="middle" fill="var(--text2)" font-size="8.5" font-weight="700">${formatShortSum(p.value)}</text>`
      : '';
    return `
      ${valTag}
      <circle class="dash-chart-dot" cx="${p.x}" cy="${p.y}" r="${isSel ? '5.5' : '3.8'}" fill="var(--accent2)" stroke="var(--card)" stroke-width="${isSel ? '2.5' : '1.5'}" style="cursor:pointer" onclick="selectDashboardChartDay(${i})">
        <title>${p.fullLabel}: ${fmt(p.value)} so'm</title>
      </circle>
      <circle cx="${p.x}" cy="${p.y}" r="13" fill="transparent" style="cursor:pointer" onclick="selectDashboardChartDay(${i})"></circle>
      <text x="${p.x}" y="${h - 6}" text-anchor="middle" fill="${isSel ? 'var(--text)' : 'var(--text3)'}" font-size="9.5" font-weight="${isSel ? '800' : '600'}" style="cursor:pointer" onclick="selectDashboardChartDay(${i})">${p.label}</text>`;
  }).join('');

  const selDay = daysData[selectedDashboardDayIdx] || daysData[daysData.length - 1];
  return `
    <div id="revenueChart" style="background:var(--card);border:1px solid var(--border);border-radius:16px;padding:12px 12px 8px;margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:4px;">
        <div style="font-weight:800;font-size:13px;display:flex;align-items:center;gap:5px;">📈 ${lang === 'uz' ? '7 kunlik tushum' : 'Выручка за 7 дней'}</div>
        <div style="font-size:12px;font-weight:800;color:var(--accent2);">${fmt(total7)} so'm</div>
      </div>
      <div id="dashChartSelectedInfo" style="font-size:11px;color:var(--text3);margin-bottom:4px;">${selDay.fullLabel}: ${fmt(selDay.value)} so'm (${selDay.count} ${lang === 'uz' ? 'ta' : 'зак.'})</div>
      <div id="revenueChartWrap" style="width:100%;height:148px;position:relative;">
        <svg viewBox="0 0 ${w} ${h}" width="100%" height="148" style="width:100%;height:148px;display:block;overflow:visible;" role="img" aria-label="7 kunlik tushum grafigi">
          <defs>
            <linearGradient id="dashAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#7b61ff" stop-opacity="0.38"/>
              <stop offset="100%" stop-color="#00e5ff" stop-opacity="0.02"/>
            </linearGradient>
            <linearGradient id="dashLineGrad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stop-color="#7b61ff"/>
              <stop offset="100%" stop-color="#00e5ff"/>
            </linearGradient>
          </defs>
          ${gridLevels}
          ${areaPath ? `<path d="${areaPath}" fill="url(#dashAreaGrad)"/>` : ''}
          ${linePath ? `<path d="${linePath}" fill="none" stroke="url(#dashLineGrad)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
          ${dotsAndLabels}
        </svg>
      </div>
    </div>`;
}

function renderDashboard(){
  const el=document.getElementById('dashboardContent');if(!el)return;
  const now=new Date();
  const todayStr=now.toDateString();
  const activeOrders=(state.orders || []).filter(o => {
    if (!o || o.status === 'cancelled' || !o.date) return false;
    const d = new Date(o.date);
    return !isNaN(d.getTime());
  });
  const todayOrders=activeOrders.filter(o=>new Date(o.date).toDateString()===todayStr);
  const todayRev=todayOrders.reduce((s,o)=>s+(Number(o.total)||0),0);
  const todayCount=todayOrders.length;
  
  let todayProfit = 0;
  todayOrders.forEach(o => {
    todayProfit += calculateOrderProfit(o);
  });
  const todayMarginPct = todayRev > 0 ? Math.round((todayProfit / todayRev) * 100) : 0;

  const todayDelivered=todayOrders.filter(o=>o.delivered || o.status === 'done').length;
  const allDebts=activeOrders.filter(isDebtOrder);
  const totalDebt=allDebts.reduce((s,o)=>s+((Number(o.total)||0)-(Number(o.partialPaid)||0)),0);
  const debtClients=new Set(allDebts.map(o=>o.clientId)).size;
  const unsent=activeOrders.filter(o=>!o.sent).length;
  const weekStart=new Date(now);weekStart.setDate(now.getDate()-(now.getDay()+6)%7);weekStart.setHours(0,0,0,0);
  const weekOrders=activeOrders.filter(o=>new Date(o.date)>=weekStart);
  const weekRev=weekOrders.reduce((s,o)=>s+(Number(o.total)||0),0);
  
  let weekProfit = 0;
  weekOrders.forEach(o => {
    weekProfit += calculateOrderProfit(o);
  });
  const weekMarginPct = weekRev > 0 ? Math.round((weekProfit / weekRev) * 100) : 0;
  
  const prodToday={};PRODUCTS.forEach(p=>prodToday[p.id]=0);
  todayOrders.forEach(o=>(o.items||[]).forEach(i=>{if(i && prodToday[i.id]!==undefined)prodToday[i.id]+=(Number(i.qty)||0);}));
  const prodRows=PRODUCTS.filter(p=>prodToday[p.id]>0).map(p=>`
    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border)">
      <span style="font-size:15px">${p.emoji||'🥗'} ${escapeHTML(lang==='uz'?(p.nameUz||p.name||''):(p.name||p.nameUz||''))}</span>
      <span style="font-weight:800;font-size:18px">${roundQty(prodToday[p.id])} <span style="font-size:11px;opacity:.7">${p.unit||'кг'}</span></span>
    </div>`).join('')||`<div style="opacity:.5;font-size:13px;padding:12px 0">${lang==='uz'?'Bugun buyurtma yo\'q':'Сегодня заказов нет'}</div>`;
  const timeStr=now.toLocaleTimeString(lang==='uz'?'uz':'ru-RU',{hour:'2-digit',minute:'2-digit'});
  const dateStr=now.toLocaleDateString(lang==='uz'?'uz':'ru-RU',{weekday:'long',day:'numeric',month:'long'});

  const chartDays = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const dayStr = d.toDateString();
    const dayOrders = activeOrders.filter(o => new Date(o.date).toDateString() === dayStr);
    const rev = dayOrders.reduce((s, o) => s + (Number(o.total) || 0), 0);
    chartDays.push({
      label: d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }),
      fullLabel: d.toLocaleDateString(lang === 'uz' ? 'uz-UZ' : 'ru-RU', { day: 'numeric', month: 'short' }),
      value: rev,
      count: dayOrders.length
    });
  }
  const chartCardHtml = buildDashboardRevenueChart(chartDays);

  el.innerHTML=`
    <div style="text-align:center;margin-bottom:20px">
      <div style="font-size:56px;font-weight:900;letter-spacing:-2px;background:linear-gradient(135deg,var(--accent),var(--accent2));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;line-height:1">${timeStr}</div>
      <div style="font-size:13px;color:var(--text2);margin-top:4px;text-transform:capitalize">${dateStr}</div>
      <div style="display:inline-flex;align-items:center;gap:6px;margin-top:6px;font-size:11px;color:var(--text3)"><div id="onlineIndicator" style="width:8px;height:8px;border-radius:50%;background:var(--green);flex-shrink:0"></div>${lang==='uz'?'Onlayn':'Онлайн'}</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
      <div style="background:linear-gradient(135deg,rgba(124,106,247,.2),rgba(86,212,160,.1));border:1px solid rgba(124,106,247,.3);border-radius:16px;padding:12px;text-align:center">
        <div style="font-size:10px;color:var(--text2);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">${lang==='uz'?'Bugun tushum':'Сегодня'}</div>
        <div style="font-size:22px;font-weight:900;color:var(--accent2)">${fmt(todayRev)}</div>
        <div style="font-size:10px;color:var(--text3);margin-top:2px;margin-bottom:6px">so'm · ${todayCount} ${lang==='uz'?'ta':'шт'}</div>
        <div style="background:rgba(86,212,160,.15);border-radius:8px;padding:6px;margin-top:4px">
            <div style="font-size:9px;color:var(--text2);text-transform:uppercase">${lang==='uz'?'Sof foyda (Marja)':'Чистая прибыль (Маржа)'}</div>
            <div style="font-size:16px;font-weight:900;color:var(--green)">+${fmt(todayProfit)} <span style="font-size:11px;font-weight:600">(${todayMarginPct}%)</span></div>
        </div>
      </div>
      <div style="background:linear-gradient(135deg,rgba(90,180,247,.15),rgba(124,106,247,.1));border:1px solid rgba(90,180,247,.3);border-radius:16px;padding:12px;text-align:center">
        <div style="font-size:10px;color:var(--text2);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">${lang==='uz'?'Hafta tushum':'Эта неделя'}</div>
        <div style="font-size:22px;font-weight:900;color:var(--blue)">${fmt(weekRev)}</div>
        <div style="font-size:10px;color:var(--text3);margin-top:2px;margin-bottom:6px">so'm</div>
        <div style="background:rgba(86,212,160,.15);border-radius:8px;padding:6px;margin-top:4px">
            <div style="font-size:9px;color:var(--text2);text-transform:uppercase">${lang==='uz'?'Sof foyda (Marja)':'Чистая прибыль (Маржа)'}</div>
            <div style="font-size:16px;font-weight:900;color:var(--green)">+${fmt(weekProfit)} <span style="font-size:11px;font-weight:600">(${weekMarginPct}%)</span></div>
        </div>
      </div>
    </div>
    ${chartCardHtml}
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px">
      <div onclick="showPage('delivery')" style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px;text-align:center;cursor:pointer">
        <div style="font-size:22px">🚚</div>
        <div style="font-size:20px;font-weight:900;margin:2px 0">${todayDelivered}/${todayCount}</div>
        <div style="font-size:10px;color:var(--text3)">${lang==='uz'?'Yetkazildi':'Доставлено'}</div>
      </div>
      <div onclick="showPage('debts')" style="background:var(--card);border:1px solid ${totalDebt>0?'rgba(247,168,74,.4)':'var(--border)'};border-radius:12px;padding:12px;text-align:center;cursor:pointer">
        <div style="font-size:22px">💰</div>
        <div style="font-size:20px;font-weight:900;margin:2px 0;color:${totalDebt>0?'var(--orange)':'var(--text)'}">${debtClients}</div>
        <div style="font-size:10px;color:var(--text3)">${lang==='uz'?'Qarzdor':'Должников'}</div>
      </div>
      <div onclick="showPage('orders')" style="background:var(--card);border:1px solid ${unsent>0?'rgba(247,90,90,.4)':'var(--border)'};border-radius:12px;padding:12px;text-align:center;cursor:pointer">
        <div style="font-size:22px">${unsent>0?'❌':'✅'}</div>
        <div style="font-size:20px;font-weight:900;margin:2px 0;color:${unsent>0?'var(--danger)':'var(--green)'}">${unsent}</div>
        <div style="font-size:10px;color:var(--text3)">TG</div>
      </div>
    </div>
    <div style="background:var(--card);border:1px solid var(--border);border-radius:16px;padding:14px;margin-bottom:12px">
      <div style="font-weight:700;margin-bottom:4px;font-size:14px">📦 ${lang==='uz'?'Bugun sotilgan':'Сегодня продано'}</div>
      ${prodRows}
    </div>
    ${(()=>{
      const tracked = (PRODUCTS||[]).filter(isProductTracked);
      if (!tracked.length) return '';
      const totalKg = roundQty(tracked.reduce((s,p)=>s+Math.max(0, Number(p.stock)||0), 0));
      const lowItems = tracked.filter(p => getProductStockStatus(p) !== 'ok');
      return `<div onclick="showPage('warehouse')" style="cursor:pointer;background:var(--card);border:1px solid ${lowItems.length?'rgba(247,90,90,.4)':'var(--border)'};border-radius:16px;padding:12px 14px;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;gap:10px">
        <div>
          <div style="font-weight:700;font-size:13px">🏭 ${lang==='uz'?'Sklad qoldig\'i':'Остаток склада'}: <span style="color:var(--green)">${totalKg} kg</span></div>
          <div style="font-size:11px;color:${lowItems.length?'var(--danger)':'var(--text3)'};margin-top:2px">
            ${lowItems.length ? (lang==='uz'?'⚠️ Kam qolgan: ':'⚠️ Мало: ') + lowItems.map(p=>escapeHTML(p.nameUz||p.name||'')+' ('+roundQty(p.stock)+'kg)').slice(0,3).join(', ') : (lang==='uz'?'Barcha mahsulotlar yetarli':'Все товары в наличии')}
          </div>
        </div>
        <span style="font-size:12px;font-weight:700;color:var(--accent)">${lang==='uz'?'Ochish ›':'Открыть ›'}</span>
      </div>`;
    })()}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <button id="dashQuickOrderBtn" onclick="showPage('new-order')" class="btn btn-primary" style="border-radius:14px;padding:13px 8px;font-size:13px">➕ ${lang==='uz'?'Buyurtma':'Заказ'}</button>
      <button id="dashQuickDriveBtn" onclick="openDriveModeModal()" class="btn btn-success" style="border-radius:14px;padding:13px 8px;font-size:13px">🚗 ${lang==='uz'?'Rulda Rejimi':'За рулём'}</button>
      <button id="dashQuickWarehouseBtn" onclick="showPage('warehouse')" class="btn btn-outline" style="border-radius:14px;padding:13px 8px;font-size:13px;border-color:rgba(45,212,160,.45);color:var(--green)">🏭 ${lang==='uz'?'Sklad':'Склад'}</button>
      <button id="dashQuickReportBtn" onclick="sendDaySummary()" class="btn btn-outline" style="border-radius:14px;padding:13px 8px;font-size:13px">📤 ${lang==='uz'?'Xisobot':'Отчёт'}</button>
    </div>`;
  renderCustomUiButtons();
  applySavedUiRenames();
  updateOnlineIndicator();
}

// ==================== MAP ====================
let mapInstance=null;
let markersLayer=null;

function renderMap(){
  const el=document.getElementById('mapContainer');if(!el)return;
  const today=new Date().toDateString();
  const todayOrders=(state.orders||[]).filter(o=>o&&o.status!=='cancelled'&&o.date&&new Date(o.date).toDateString()===today);
  const todayClientIds=new Set(todayOrders.map(o=>String(o.clientId)));
  const clientsWithCoords=(state.clients||[]).filter(c=>c&&c.lat&&c.lng);
  const routeClients=clientsWithCoords.filter(c=>todayClientIds.has(String(c.id)));
  const routeEl=document.getElementById('mapRouteList');
  if(routeEl){
    routeEl.innerHTML=routeClients.length?routeClients.map((c,i)=>{
      const ord=todayOrders.filter(o=>o.clientId==c.id);
      return`<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
        <div style="width:26px;height:26px;border-radius:50%;background:linear-gradient(135deg,var(--accent),var(--accent2));display:flex;align-items:center;justify-content:center;color:white;font-weight:900;font-size:12px;flex-shrink:0">${i+1}</div>
        <div style="flex:1"><div style="font-weight:700;font-size:14px">${escapeHTML(c.name||'')}</div><div style="font-size:12px;color:var(--text2)">${ord.map(o=>(o.items||[]).map(i=>`${i.emoji||'🥗'}${i.qty}${i.unit||'кг'}`).join(' ')).join(' | ')}</div></div>
        <a href="https://yandex.ru/maps/?text=${c.lat},${c.lng}" target="_blank" style="padding:6px 10px;background:var(--bg3);border:1px solid var(--border);border-radius:8px;color:var(--accent);font-size:12px;font-weight:700;text-decoration:none">🗺️</a>
      </div>`;
    }).join(''):`<div style="color:var(--text3);font-size:13px;padding:8px 0">${lang==='uz'?'Koordinata yo\'q':'Нет координат у клиентов с заказами'}</div>`;
  }
  const mapsBtn=document.getElementById('openMapsBtn');
  if(mapsBtn&&routeClients.length>=1){
    const wps=routeClients.map(c=>`${c.lat},${c.lng}`).join('~');
    mapsBtn.href=`https://yandex.ru/maps/?rtext=${wps}`;
    mapsBtn.style.display='flex';
  } else if(mapsBtn){mapsBtn.style.display='none';}
  if(!window.ymaps){
    const scr=document.createElement('script');
    scr.src='https://api-maps.yandex.ru/2.1/?lang=ru_RU';
    scr.onload=()=>{
      ymaps.ready(()=>initYandexMap(clientsWithCoords,routeClients));
    };
    document.head.appendChild(scr);
  } else if(!mapInstance){
    ymaps.ready(()=>initYandexMap(clientsWithCoords,routeClients));
  } else {
    updateYandexMarkers(clientsWithCoords,routeClients);
  }
}
function initYandexMap(all,route){
  const center=all.length?[all[0].lat,all[0].lng]:[41.2995,69.2401];
  mapInstance=new ymaps.Map('leafletMap',{center:center,zoom:12,controls:['zoomControl','fullscreenControl']});
  markersLayer=[];
  updateYandexMarkers(all,route);
}
function updateYandexMarkers(all,route){
  if(!mapInstance || typeof ymaps === 'undefined')return;
  if(markersLayer && markersLayer.length){
    markersLayer.forEach(m=>mapInstance.geoObjects.remove(m));
  }
  markersLayer=[];
  const rIds=new Set(route.map(c=>c.id));
  all.forEach((c,idx)=>{
    const isR=rIds.has(c.id);
    const num=isR?route.findIndex(x=>x.id===c.id)+1:(c.name ? c.name.charAt(0).toUpperCase() : 'M');
    const clr=isR?'#7c6af7':'#56d4a0';
    const debt=(state.orders || []).filter(o=>String(o.clientId)==String(c.id) && isDebtOrder(o)).reduce((s,o)=>s+((Number(o.total)||0)-(Number(o.partialPaid)||0)),0);
    
    const iconLayout = ymaps.templateLayoutFactory.createClass(
        `<div style="background:${clr};color:white;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:13px;border:2px solid white;box-shadow:0 2px 8px rgba(0,0,0,.3); transform: translate(-16px, -16px)">${num}</div>`
    );
    
    const pm = new ymaps.Placemark([c.lat,c.lng], {
        balloonContent: `<b>${c.name}</b><br>${c.type}<br>${state.orders.filter(o=>o.clientId==c.id).length} заказов${debt>0?'<br>💰 '+fmt(debt)+' so\'m':''}`
    }, {
        iconLayout: iconLayout,
        iconShape: { type: 'Circle', coordinates: [0, 0], radius: 16 }
    });
    
    mapInstance.geoObjects.add(pm);
    markersLayer.push(pm);
  });
}
function openCoordModal(id){
  const c=state.clients.find(x=>x.id==id);if(!c)return;
  document.getElementById('coordClientName').textContent=c.name;
  document.getElementById('coordLat').value=c.lat||'';
  document.getElementById('coordLng').value=c.lng||'';
  document.getElementById('coordSaveId').value=id;
  openModal('coordModal');
}
function saveClientCoords(){
  const id=document.getElementById('coordSaveId').value;
  const c=state.clients.find(x=>x.id==id);if(!c)return;
  const lat=parseFloat(document.getElementById('coordLat').value);
  const lng=parseFloat(document.getElementById('coordLng').value);
  if(isNaN(lat)||isNaN(lng)){showToast('⚠️ Неверные координаты','error');return;}
  c.lat=lat; c.lng=lng;
  db.collection('clients').doc(String(id)).update({lat,lng}); closeModal('coordModal');
  if(mapInstance){ renderMap(); }
  showToast('📍 '+(lang==='uz'?'Saqlandi':'Сохранено'),'success');
}
function detectMyLocation(){
  if(!navigator.geolocation){showToast('⚠️ Геолокация недоступна','error');return;}
  navigator.geolocation.getCurrentPosition(p=>{
    document.getElementById('coordLat').value=p.coords.latitude.toFixed(6);
    document.getElementById('coordLng').value=p.coords.longitude.toFixed(6);
    showToast('📍 OK','success');
  },()=>showToast('❌ Нет доступа','error'));
}

// ==================== OFFLINE SYNC ====================
let offlineQueue=JSON.parse(localStorage.getItem('offlineQueue')||'[]');
function setupOfflineSync(){
  window.addEventListener('online',flushOfflineQueue);
  window.addEventListener('online',updateOnlineIndicator);
  window.addEventListener('offline',updateOnlineIndicator);
  if(navigator.onLine&&offlineQueue.length)flushOfflineQueue();
}
function updateOnlineIndicator(){
  const el=document.getElementById('onlineIndicator');if(!el)return;
  el.style.background=navigator.onLine?'var(--green)':'var(--danger)';
}
async function flushOfflineQueue(){
  if(!offlineQueue.length)return;
  const{tgToken,tgChatId}=state.settings;
  const sent=[];
  for(const item of offlineQueue){
    try{
      if(item.type==='telegram'&&tgToken&&tgChatId){
        const r=await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:tgChatId,text:item.text,parse_mode:'HTML'})});
        if((await r.json()).ok)sent.push(item.id);
      }
    }catch(e){}
  }
  if(sent.length){
    offlineQueue=offlineQueue.filter(i=>!sent.includes(i.id));
    localStorage.setItem('offlineQueue',JSON.stringify(offlineQueue));
    const batch = db.batch();
    sent.forEach(qid => batch.update(db.collection('orders').doc(String(qid)), {sent:true}));
    batch.commit();
    showToast(`✅ ${sent.length} ${lang==='uz'?'ta yuborildi':'отправлено (оффлайн очередь)'}`, 'success');
  }
}

function save(){localStorage.setItem('clients',JSON.stringify(state.clients));localStorage.setItem('orders',JSON.stringify(state.orders));}
function updateBadges(){
  const orders = state.orders || [];
  const unsent=orders.filter(o=>o && o.status!=='cancelled' && !o.sent).length;
  const badge=document.getElementById('pendingBadge');
  if(badge){badge.style.display=unsent?'flex':'none';badge.textContent=unsent;}
  const oc=document.getElementById('ordersCount');
  if(oc) oc.textContent=orders.length;
  const debtClients=new Set(orders.filter(isDebtOrder).map(o=>o.clientId)).size;
  const dc=document.getElementById('debtsCount');
  if(dc) dc.textContent=debtClients||'';
  const today=new Date().toDateString();
  const pendingDelivery=orders.filter(o=>o && o.status!=='cancelled' && o.status!=='done' && !o.delivered && o.date && !isNaN(new Date(o.date).getTime()) && new Date(o.date).toDateString()===today).length;
  const delC=document.getElementById('deliveryCount');
  if(delC) delC.textContent=pendingDelivery||'';
  if (typeof updateWarehouseBadge === 'function') updateWarehouseBadge();
}
function resetOrder(){
  const oc=document.getElementById('orderCourier');if(oc)oc.value='';state.quantities={};state.selectedPayment='наличные';document.getElementById('clientSelect').value='';document.getElementById('clientPhone').value='';document.getElementById('orderNote').value='';document.getElementById('summaryBlock').style.display='none';renderProductsGrid();document.querySelectorAll('.payment-pills .pill').forEach((p,i)=>p.classList.toggle('selected',i===0));}
function showToast(msg,type='info'){const t=document.getElementById('toast');t.textContent=msg;t.className='toast '+type+' show';setTimeout(()=>t.className='toast '+type,3000);}
function openModal(id){document.getElementById(id).classList.add('open');}
function closeModal(id){document.getElementById(id).classList.remove('open');}
document.querySelectorAll('.modal-overlay').forEach(overlay=>{overlay.addEventListener('click',e=>{if(e.target===overlay)overlay.classList.remove('open');});});

// ==================== SWIPE NAVIGATION ====================
const PAGE_ORDER = [
  'dashboard','new-order','orders','debts',
  'delivery','warehouse','clients','stats','products','map','ai','settings'
];

(function initSwipe() {
  let startX = 0, startY = 0, startTime = 0;
  const THRESHOLD = 55;
  const MAX_Y     = 90;
  const MAX_TIME  = 420;

  document.addEventListener('touchstart', function(e) {
    if (
      e.target.closest('.modal-overlay') ||
      e.target.closest('input') ||
      e.target.closest('select') ||
      e.target.closest('textarea') ||
      e.target.closest('.tabs') ||
      e.target.closest('#leafletMap') ||
      e.target.closest('.chart-bars')
    ) return;
    startX    = e.touches[0].clientX;
    startY    = e.touches[0].clientY;
    startTime = Date.now();
  }, { passive: true });

  document.addEventListener('touchend', function(e) {
    if (!startX) return;
    const dx = e.changedTouches[0].clientX - startX;
    const dy = Math.abs(e.changedTouches[0].clientY - startY);
    const dt = Date.now() - startTime;

    if (Math.abs(dx) < THRESHOLD || dy > MAX_Y || dt > MAX_TIME) {
      startX = 0; return;
    }

    const activePage = document.querySelector('.page.active');
    if (!activePage) { startX = 0; return; }

    const curId  = activePage.id.replace('page-', '');
    const curIdx = PAGE_ORDER.indexOf(curId);
    if (curIdx === -1) { startX = 0; return; }

    const nextIdx = dx < 0
      ? Math.min(curIdx + 1, PAGE_ORDER.length - 1)
      : Math.max(curIdx - 1, 0);

    if (nextIdx !== curIdx) {
      showPage(PAGE_ORDER[nextIdx]);
      const activeTab = document.querySelector('.tab[data-page="' + PAGE_ORDER[nextIdx] + '"]');
      if (activeTab) activeTab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      if (navigator.vibrate) navigator.vibrate(18);
    }
    startX = 0;
  }, { passive: true });
})();

// --- ADMIN MAP PICKER LOGIC ---
let adminPickerMapInstance = null;

window.openAdminMapPicker = function() {
  document.getElementById('adminMapOverlay').classList.add('open');
  if (!adminPickerMapInstance && window.ymaps) {
    ymaps.ready(() => {
      adminPickerMapInstance = new ymaps.Map("adminPickerMap", {
        center: [41.2995, 69.2401], // Tashkent default
        zoom: 15,
        controls: ['zoomControl', 'geolocationControl', 'searchControl']
      });
      // Try to center on existing lat/lng if present
      const currLat = parseFloat(document.getElementById('coordLat').value);
      const currLng = parseFloat(document.getElementById('coordLng').value);
      if(!isNaN(currLat) && !isNaN(currLng)) {
         adminPickerMapInstance.setCenter([currLat, currLng], 17);
      } else {
         adminPickerMapInstance.geolocation.get({ provider: 'browser', mapStateAutoApply: true }).then(function (result) {
           adminPickerMapInstance.setCenter(result.geoObjects.position, 16);
         });
      }
    });
  } else if (adminPickerMapInstance) {
     const currLat = parseFloat(document.getElementById('coordLat').value);
     const currLng = parseFloat(document.getElementById('coordLng').value);
     if(!isNaN(currLat) && !isNaN(currLng)) {
        adminPickerMapInstance.setCenter([currLat, currLng], 17);
     }
  }
}

window.closeAdminMapPicker = function() {
  document.getElementById('adminMapOverlay').classList.remove('open');
}

window.confirmAdminMapPicker = function() {
  if (adminPickerMapInstance) {
    const center = adminPickerMapInstance.getCenter();
    document.getElementById('coordLat').value = center[0].toFixed(6);
    document.getElementById('coordLng').value = center[1].toFixed(6);
  }
  closeAdminMapPicker();
}


// ==========================================
// TEEGU AI AGENT (GOOGLE GEMINI AI)
// ==========================================

let aiChatHistory = (() => {
  try {
    const raw = JSON.parse(localStorage.getItem('aiChatHistory') || '[]');
    return Array.isArray(raw) ? raw.filter(m => m && typeof m.text === 'string' && m.text.trim()) : [];
  } catch (e) {
    return [];
  }
})();
let aiRecognition = null;
let isAiRecording = false;
let isAiSending = false;

const DEFAULT_GEMINI_API_KEY = atob('QVEuQWI4Uk42SjNYaGJzdHRxYnVzd0lRMXdZNE9idm9UTlpicU1ONDdRcTE5QTZITXh2bFE=');

function getGeminiApiKey() {
  const k = (state.settings && state.settings.geminiApiKey) || localStorage.getItem('geminiApiKey') || DEFAULT_GEMINI_API_KEY;
  return String(k || '').trim() || DEFAULT_GEMINI_API_KEY;
}

function checkAiKeyStatus() {
  const key = getGeminiApiKey();
  const warningEl = document.getElementById('aiKeyWarning');
  const quickInput = document.getElementById('aiKeyQuickInput');
  const geminiEl = document.getElementById('geminiApiKey');
  if (warningEl) {
    warningEl.style.display = key ? 'none' : 'block';
  }
  if (quickInput && key) {
    quickInput.value = key;
  }
  if (geminiEl && key) {
    geminiEl.value = key;
  }
}

function toggleAiKeyModal() {
  const warningEl = document.getElementById('aiKeyWarning');
  if (warningEl) {
    warningEl.style.display = (warningEl.style.display === 'none' || !warningEl.style.display) ? 'block' : 'none';
  }
}

function saveQuickAiKey() {
  const val = (document.getElementById('aiKeyQuickInput')?.value || '').trim();
  if (!val) {
    showToast(lang === 'uz' ? 'Kalitni kiriting' : 'Введите ключ', 'error');
    return;
  }
  state.settings.geminiApiKey = val;
  localStorage.setItem('geminiApiKey', val);
  db.collection('settings').doc('main').set(state.settings, { merge: true });
  const geminiEl = document.getElementById('geminiApiKey');
  if (geminiEl) geminiEl.value = val;
  checkAiKeyStatus();
  showToast('✅ ' + (lang === 'uz' ? 'AI Kaliti saqlandi!' : 'Ключ AI сохранён!'), 'success');
}

function renderMarkdown(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^### (.*$)/gim, '<div style="font-weight:700;color:var(--accent2);margin:8px 0 4px;">$1</div>')
    .replace(/^## (.*$)/gim, '<div style="font-size:15px;font-weight:800;color:var(--accent);margin:10px 0 6px;">$1</div>')
    .replace(/^# (.*$)/gim, '<div style="font-size:16px;font-weight:900;margin:12px 0 8px;">$1</div>')
    .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
    .replace(/\*(.*?)\*/g, '<i>$1</i>')
    .replace(/`([^`]+)`/g, '<code style="background:var(--bg2);padding:2px 6px;border-radius:4px;font-size:13px;border:1px solid var(--border);">$1</code>')
    .replace(/^\s*[-*]\s+(.*$)/gim, '<div style="margin-left:14px;margin-bottom:3px;position:relative;"><span style="position:absolute;left:-12px;color:var(--accent2);">•</span> $1</div>')
    .replace(/(\+998\d{9})/g, '<a href="tel:$1" style="color:var(--accent2);text-decoration:none;font-weight:600;">📞 $1</a>')
    .replace(/\n\n/g, '<div style="height:8px;"></div>')
    .replace(/\n/g, '<br>');
}

function buildBusinessContext() {
  const now = new Date();
  const todayStr = now.toDateString();
  
  // 1. Bugungi buyurtmalar
  const todayOrders = (state.orders || []).filter(o => new Date(o.date).toDateString() === todayStr);
  const totalRev = todayOrders.reduce((s, o) => s + (o.total || 0), 0);
  let todayProfit = 0;
  todayOrders.forEach(o => { todayProfit += calculateOrderProfit(o); });
  const todayMarginPct = totalRev > 0 ? Math.round((todayProfit / totalRev) * 100) : 0;
  
  // Bugun sotilgan salatlar
  const prodTotalsToday = {};
  (PRODUCTS || []).forEach(p => { prodTotalsToday[p.nameUz || p.name] = 0; });
  todayOrders.forEach(o => {
    (o.items || []).forEach(i => {
      const p = (PRODUCTS || []).find(x => x.id === i.id);
      const name = p ? (p.nameUz || p.name) : i.name;
      if (prodTotalsToday[name] !== undefined) prodTotalsToday[name] += (i.qty || 0);
      else prodTotalsToday[name] = (i.qty || 0);
    });
  });
  
  // 2. Qarzlar (Konsignatsiya)
  const debts = (state.orders || []).filter(isDebtOrder);
  const totalDebt = debts.reduce((s, o) => s + (o.total || 0) - (o.partialPaid || 0), 0);
  
  const clientDebts = {};
  debts.forEach(o => {
    const cid = o.clientId || o.client;
    const debtAmount = (o.total || 0) - (o.partialPaid || 0);
    if (!clientDebts[cid]) {
      clientDebts[cid] = { name: o.client, phone: o.phone, totalDebt: 0, count: 0, oldestDate: o.date };
    }
    clientDebts[cid].totalDebt += debtAmount;
    clientDebts[cid].count += 1;
    if (new Date(o.date) < new Date(clientDebts[cid].oldestDate)) {
      clientDebts[cid].oldestDate = o.date;
    }
  });
  const topDebtors = Object.values(clientDebts).sort((a, b) => b.totalDebt - a.totalDebt).slice(0, 10);
  
  // 3. Oxirgi 7 kunlik statistika
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const weekOrders = (state.orders || []).filter(o => new Date(o.date) >= sevenDaysAgo);
  const weekRev = weekOrders.reduce((s, o) => s + (o.total || 0), 0);
  
  const prodTotalsWeek = {};
  (PRODUCTS || []).forEach(p => { prodTotalsWeek[p.nameUz || p.name] = 0; });
  weekOrders.forEach(o => {
    (o.items || []).forEach(i => {
      const p = (PRODUCTS || []).find(x => x.id === i.id);
      const name = p ? (p.nameUz || p.name) : i.name;
      if (prodTotalsWeek[name] !== undefined) prodTotalsWeek[name] += (i.qty || 0);
      else prodTotalsWeek[name] = (i.qty || 0);
    });
  });
  
  // 4. Nofaol mijozlar
  const clientLastOrder = {};
  (state.orders || []).forEach(o => {
    const cid = o.clientId || o.client;
    const orderDate = new Date(o.date);
    if (!clientLastOrder[cid] || orderDate > new Date(clientLastOrder[cid])) {
      clientLastOrder[cid] = o.date;
    }
  });
  
  const inactiveClients = (state.clients || []).map(c => {
    const lastDate = clientLastOrder[c.id];
    const daysSince = lastDate ? Math.floor((now - new Date(lastDate)) / (1000 * 60 * 60 * 24)) : 999;
    return { name: c.name, phone: c.phone, daysSinceOrder: daysSince };
  }).filter(c => c.daysSinceOrder >= 4 && c.daysSinceOrder < 900).sort((a, b) => b.daysSinceOrder - a.daysSinceOrder).slice(0, 8);
  
  // 5. Yetkazish
  const deliveredToday = todayOrders.filter(o => o.status === 'done' || o.delivered);
  const pendingToday = todayOrders.filter(o => o.status !== 'done' && !o.delivered);
  
  return {
    sana: now.toLocaleDateString('uz-UZ'),
    haftaKuni: now.toLocaleDateString('uz-UZ', { weekday: 'long' }),
    bugungiSavdo: {
      buyurtmalarSoni: todayOrders.length,
      tushumSomda: totalRev,
      sofFoydaSomda: todayProfit,
      marjaFoizi: todayMarginPct + '%',
      yetkazilganlar: deliveredToday.length,
      kutilayotganlar: pendingToday.length,
      sotilganSalatlarKg: prodTotalsToday,
      mijozlar: todayOrders.slice(0, 15).map(o => ({ client: o.client, total: o.total, payment: o.payment, delivered: !!(o.status === 'done' || o.delivered) }))
    },
    qarzlar: {
      umumiyQarzSomda: totalDebt,
      qarzdorlarSoni: Object.keys(clientDebts).length,
      engKattaQarzdorlar: topDebtors
    },
    oxirgiHafta: {
      buyurtmalarSoni: weekOrders.length,
      tushumSomda: weekRev,
      sotilganSalatlarKg: prodTotalsWeek
    },
    aloqagaChiqishKerakBolganMijozlar: inactiveClients,
    engDaromadliMijozlar: (function(){
      const cp = {};
      (state.orders||[]).forEach(o => {
        const cid = o.clientId || o.client;
        if (!cp[cid]) cp[cid] = { mijoz: o.client, jamiTushum: 0, sofFoyda: 0, buyurtmalar: 0 };
        cp[cid].jamiTushum += (o.total || 0);
        cp[cid].sofFoyda += calculateOrderProfit(o);
        cp[cid].buyurtmalar++;
      });
      return Object.values(cp).sort((a,b)=>b.sofFoyda-a.sofFoyda).slice(0,5).map(c=>({
        ...c,
        marjaFoizi: c.jamiTushum > 0 ? Math.round((c.sofFoyda/c.jamiTushum)*100)+'%' : '0%'
      }));
    })(),
    oylikSofFoydaTahlili: (function(){
      const ms = {};
      (state.orders||[]).forEach(o => {
        const d = new Date(o.date);
        const k = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
        if (!ms[k]) ms[k] = { oy: k, tushum: 0, sofFoyda: 0, buyurtmalar: 0 };
        ms[k].tushum += (o.total || 0);
        ms[k].sofFoyda += calculateOrderProfit(o);
        ms[k].buyurtmalar++;
      });
      return Object.values(ms).sort((a,b)=>b.oy.localeCompare(a.oy)).slice(0,3);
    })(),
    mahsulotlarNarxlari: (PRODUCTS || []).map(p => ({
      nomi: p.nameUz || p.name,
      narxi: p.price,
      tannarxi: p.cost,
      birlik: p.unit || 'kg'
    })),
    omborQoldigi: (PRODUCTS || []).map(p => ({
      id: p.id,
      nomi: p.nameUz || p.name,
      qoldiqKg: isProductTracked(p) ? roundQty(p.stock) : null,
      birlik: p.unit || 'kg',
      minChegara: getProductMinStock(p),
      holati: !isProductTracked(p) ? 'KIRITILMAGAN' : (getProductStockStatus(p) === 'empty' ? 'TUGAGAN' : (getProductStockStatus(p) === 'low' ? 'KAM' : 'YETARLI'))
    })),
    simulyatorBazasi: typeof buildSimulatorBaseline === 'function' ? buildSimulatorBaseline(30) : null,
    hududVaMarshrutTahlili: typeof buildGeoTerritorySummary === 'function' ? buildGeoTerritorySummary() : null,
    faolBiznesQoidalar: (typeof aiBusinessRules !== 'undefined' && Array.isArray(aiBusinessRules))
      ? aiBusinessRules.map(r => ({ id: r.id, turi: r.type, faol: !!r.enabled, tavsif: r.label }))
      : []
  };
}

async function callGemini(apiKey, systemPrompt, userMessage, chatHistory = []) {
  const contents = [];

  // Faqat yaroqli, xatosiz oxirgi 6 ta xabarni ketma-ketlikni buzmasdan tayyorlash
  const cleanHist = (chatHistory || [])
    .filter(m => m && !m.isError && typeof m.text === 'string' && m.text.trim())
    .slice(-6);

  // Suhbat har doim 'user' rolidan boshlanishi shart
  while (cleanHist.length && cleanHist[0].role !== 'user') {
    cleanHist.shift();
  }

  cleanHist.forEach(msg => {
    const role = msg.role === 'user' ? 'user' : 'model';
    const last = contents[contents.length - 1];
    if (last && last.role === role) {
      last.parts[0].text += '\n' + msg.text;
    } else {
      contents.push({ role, parts: [{ text: msg.text }] });
    }
  });

  // Agar history oxiri ham 'user' bo'lsa (masalan oldingi javob kelmay qolgan), dublikat bo'lmasligi uchun moslash
  const lastTurn = contents[contents.length - 1];
  if (lastTurn && lastTurn.role === 'user') {
    if (lastTurn.parts[0].text.trim() !== String(userMessage).trim()) {
      lastTurn.parts[0].text += '\n' + userMessage;
    }
  } else {
    contents.push({
      role: 'user',
      parts: [{ text: userMessage }]
    });
  }

  const payload = {
    system_instruction: {
      parts: [{ text: systemPrompt }]
    },
    contents: contents,
    generationConfig: {
      temperature: 0.35,
      maxOutputTokens: 4096
    }
  };

  const models = ['gemini-3-flash-preview', 'gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-3.5-flash'];
  const keysToTry = (apiKey && DEFAULT_GEMINI_API_KEY && apiKey !== DEFAULT_GEMINI_API_KEY)
    ? [apiKey, DEFAULT_GEMINI_API_KEY]
    : [apiKey || DEFAULT_GEMINI_API_KEY];

  let lastError = null;

  for (const activeKey of keysToTry) {
    let authInvalid = false;
    for (const model of models) {
      let timerId = null;
      try {
        const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        if (ctrl) {
          timerId = setTimeout(() => ctrl.abort(), 14000);
        }
        const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + encodeURIComponent(activeKey);
        const fetchOpts = {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        };
        if (ctrl) fetchOpts.signal = ctrl.signal;

        const res = await fetch(url, fetchOpts);
        if (timerId) clearTimeout(timerId);

        const data = await res.json();
        const parts = data?.candidates?.[0]?.content?.parts || [];
        const replyText = parts
          .filter(p => !p.thought && typeof p.text === 'string' && p.text.trim())
          .map(p => p.text)
          .join('\n')
          .trim()
          || parts.filter(p => typeof p.text === 'string').map(p => p.text).join('\n').trim();

        if (res.ok && replyText) {
          return replyText;
        }
        if (data?.error) {
          lastError = data.error.message || JSON.stringify(data.error);
          if (res.status === 400 && /api key|expired|invalid/i.test(lastError) || res.status === 401 || res.status === 403) {
            authInvalid = true;
            break;
          }
        } else if (data?.candidates?.[0]?.finishReason) {
          lastError = 'AI javob qaytarmadi (' + data.candidates[0].finishReason + ')';
        }
      } catch (err) {
        if (timerId) clearTimeout(timerId);
        lastError = err && err.name === 'AbortError' ? (model + ' timeout') : (err.message || String(err));
      }
    }
    if (!authInvalid && lastError && !/api key|invalid|expired|permission/i.test(lastError)) {
      break;
    }
  }

  throw new Error(lastError || 'Gemini API javob bermadi');
}

function renderAiPage() {
  checkAiKeyStatus();
  if (typeof updateAiUiAccessButtons === 'function') updateAiUiAccessButtons();
  if (typeof updateAiTtsButton === 'function') updateAiTtsButton();
  if (typeof updateAiRulesBadge === 'function') updateAiRulesBadge();
  const box = document.getElementById('aiChatBox');
  if (!box) return;
  
  if (aiChatHistory.length === 0) {
    const isUz = lang === 'uz';
    box.innerHTML = `
      <div class="ai-msg bot">
        <div style="font-size:15px;font-weight:700;">👋 ${isUz ? 'Assalomu alaykum!' : 'Здравствуйте!'}</div>
        <div style="margin-top:6px;line-height:1.5;">
          ${isUz 
            ? 'Men sizning <b>TeeGu.PRO</b> tizimidagi shaxsiy <b>AI Biznes Maslahatchi</b> va <b>Interfeys Dizayner</b>ingizman. Savdolar, sklad qoldig\'i, qarzdorlar va buyurtmalarni tahlil qilaman — hamda ruxsat yoqilgan bo\'lsa ilova tugmalari, ranglari va bo\'limlarini real vaqtda o\'zgartira olaman!'
            : 'Я ваш персональный <b>AI бизнес-ассистент</b> и <b>дизайнер интерфейса</b> в системе <b>TeeGu.PRO</b>. Анализирую продажи, склад, долги и заказы — а при включенном доступе могу менять кнопки, цвета и вкладки в реальном времени!'
          }
        </div>
        <div style="margin-top:8px; font-size:12px; color:var(--text2);">
          ${isUz ? '💡 Yuqoridagi tezkor tugmalardan birini bosing yoki buyruq yozing (masalan: "Tasdiqlash tugmasini kattalashtirib yashil qil"):' : '💡 Нажмите быструю кнопку сверху или напишите команду (например: "Сделай кнопку оформления зеленой и крупной"):'}
        </div>
        <div class="ai-msg-time">${new Date().toLocaleTimeString('ru-RU', {hour:'2-digit',minute:'2-digit'})}</div>
      </div>
    `;
  } else {
    box.innerHTML = aiChatHistory.map((m, idx) => {
      const uiBadge = (m.role === 'bot' && Array.isArray(m.uiApplied) && m.uiApplied.length)
        ? `<div class="ai-ui-applied-box">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
              <span>🎨 ${lang==='uz' ? 'Interfeysga qo\'llandi' : 'Применено к UI'} (${m.uiApplied.length})</span>
              <button class="chip" style="padding:3px 9px;font-size:11px;margin:0" onclick="undoLastUiChange()">↩️ ${lang==='uz'?'Bekor qilish':'Отменить'}</button>
            </div>
            <div style="font-size:11px;font-weight:500;color:var(--text2);margin-top:4px">${m.uiApplied.map(a => '• ' + escapeHTML(a)).join('<br>')}</div>
          </div>`
        : '';
      const ruleBadge = (m.role === 'bot' && Array.isArray(m.ruleApplied) && m.ruleApplied.length)
        ? `<div class="ai-rule-badge">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
              <span>🧠 ${lang==='uz' ? 'Biznes-qoida faollashtirildi' : 'Бизнес-правило применено'} (${m.ruleApplied.length})</span>
              <button class="chip" style="padding:3px 9px;font-size:11px;margin:0" onclick="openAiRulesModal()">⚙️ ${lang==='uz'?'Qoidalar':'Правила'}</button>
            </div>
            <div style="font-size:11px;font-weight:500;color:var(--text2);margin-top:4px">${m.ruleApplied.map(a => '• ' + escapeHTML(a)).join('<br>')}</div>
          </div>`
        : '';
      const simHtml = (m.role === 'bot' && m.simScenario && typeof renderSimCardHtml === 'function')
        ? renderSimCardHtml(m.simScenario)
        : '';
      const voiceOrderHtml = (m.role === 'bot' && m.voiceOrder && typeof renderAiVoiceOrderCard === 'function')
        ? renderAiVoiceOrderCard(m.voiceOrder, idx)
        : '';
      const isSpk = typeof aiSpeakingIdx !== 'undefined' && aiSpeakingIdx === idx;
      const speakBtn = m.role === 'bot'
        ? `<button class="ai-speak-btn ${isSpk ? 'speaking' : ''}" onclick="${isSpk ? 'stopAiSpeech()' : `speakAiMessage(${idx})`}">${isSpk ? '⏹ ' + (lang==='uz'?'To\'xtatish':'Стоп') : '🔊 ' + (lang==='uz'?'Tinglash':'Озвучить')}</button>`
        : '';
      return `
      <div class="ai-msg ${m.role}">
        <div>${m.role === 'bot' ? renderMarkdown(m.text) : escapeHTML(m.text)}</div>
        ${simHtml}
        ${voiceOrderHtml}
        ${ruleBadge}
        ${uiBadge}
        <div class="ai-msg-footer">
          ${speakBtn}
          <span class="ai-msg-time">${m.time || ''}</span>
        </div>
      </div>
    `;
    }).join('');
  }
  
  box.scrollTop = box.scrollHeight;
}

async function sendAiUserMessage(customText = null) {
  if (isAiSending) return;
  const inputEl = document.getElementById('aiInput');
  const sendBtn = document.getElementById('aiSendBtn');
  const text = (customText || (inputEl ? inputEl.value : '')).trim();
  if (!text) return;
  
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    showToast(lang === 'uz' ? 'Avval Gemini API kalitini kiriting' : 'Сначала введите ключ Gemini API', 'error');
    const warn = document.getElementById('aiKeyWarning');
    if (warn) warn.style.display = 'block';
    const qIn = document.getElementById('aiKeyQuickInput');
    if (qIn) qIn.focus();
    return;
  }
  
  isAiSending = true;
  if (sendBtn) {
    sendBtn.disabled = true;
    sendBtn.textContent = '⏳';
  }
  if (inputEl && !customText) inputEl.value = '';
  else if (inputEl) inputEl.value = '';
  
  const timeStr = new Date().toLocaleTimeString('ru-RU', {hour:'2-digit',minute:'2-digit'});
  const prevHistory = aiChatHistory.slice();
  aiChatHistory.push({ role: 'user', text: text, time: timeStr });
  try { localStorage.setItem('aiChatHistory', JSON.stringify(aiChatHistory.slice(-20))); } catch (e) {}
  renderAiPage();
  
  const box = document.getElementById('aiChatBox');
  const typingId = 'aiTypingIndicator';
  const typingDiv = document.createElement('div');
  typingDiv.id = typingId;
  typingDiv.className = 'ai-msg bot';
  typingDiv.innerHTML = `
    <div style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--text2);">
      <span>✨ Tahlil qilinmoqda...</span>
      <div class="ai-typing">
        <div class="ai-typing-dot"></div>
        <div class="ai-typing-dot"></div>
        <div class="ai-typing-dot"></div>
      </div>
    </div>
  `;
  if (box) {
    box.appendChild(typingDiv);
    box.scrollTop = box.scrollHeight;
  }
  
  try {
    const businessContext = buildBusinessContext();
    const uiAccessAllowed = typeof aiUiConfig !== 'undefined' ? aiUiConfig.aiUiAccess !== false : true;
    const uiContextBlock = uiAccessAllowed && typeof buildUiContext === 'function'
      ? `\n\nILOVA INTERFEYSINI BOSHQARISH DOSTUPI (FAOL ✅):
Sizga foydalanuvchi ilova dizayni, tugmalar, ranglar, matnlar, tartib va tezkor tugmalarni o'zgartirish uchun TO'LIQ RUXSAT berilgan!
Agar foydalanuvchi interfeysni, tugmalarni, ranglarni, nomlarni, bo'limlarni, shrift/o'lchamni o'zgartirishni, yangi tugma qo'shishni yoki asl holiga qaytarishni so'rasa, javobingizning ENG OXIRIDA quyidagi blokni qo'shing (foydalanuvchiga JSON ko'rinmasligi uchun tizim bu blokni avtomatik qirqib olib, darhol DOM + Firestore ga qo'llaydi):

<<<UI_ACTIONS>>>
{
  "actions": [
    ...
  ]
}
<<<END_UI_ACTIONS>>>

Qo'llab-quvvatlanadigan action turlari:
1. {"type":"set_theme","vars":{"--accent":"#10b981","--bg":"#091512","--card":"#13241f"},"scope":"all"}
   - O'zgartirsa bo'ladigan CSS o'zgaruvchilar: --bg, --bg2, --card, --card2, --border, --text, --text2, --text3, --accent, --accent2, --green, --gold, --danger, --r, --r2
2. {"type":"style_element","selector":"#submitBtn","styles":{"fontSize":"18px","padding":"18px","borderRadius":"20px","background":"#10b981","color":"#fff","fontWeight":"900"},"scope":"admin"}
   - Keng tarqalgan selektorlar: #submitBtn, #dashQuickOrderBtn, #dashQuickWarehouseBtn, #dashQuickReportBtn, #btnOptimizeDelivery, #btnSendDaySummary, #btnAddProduct, #btnWarehouseBatch, #btnWarehouseTg, .tab, .btn-primary, .btn-outline, .product-card, .wh-card, #agentSubmitBtn (scope:"agent"), #courierOptimizeBtn (scope:"courier"), #checkoutSubmitBtn (scope:"client")
   - Barcha ilovalarga (admin, agent, courier, client) taalluqli bo'lsa "scope":"all" yozing.
3. {"type":"rename_element","selector":".tab[data-page=\"warehouse\"]","text":"📦 Ombor","scope":"admin"}
4. {"type":"set_visibility","selector":"#btnTemplates","visible":false,"scope":"admin"}
5. {"type":"set_layout","target":"productGrid|tabs|global","columns":3,"fontScale":1.08,"radius":"18px","compact":false,"scope":"admin"}
6. {"type":"reorder_tabs","order":["dashboard","warehouse","new-order","orders","debts","delivery","clients","stats","products","map","ai","settings"]}
7. {"type":"add_custom_button","page":"dashboard|new-order|orders|warehouse","id":"btn_fast_report","label":"📊 Tezkor hisobot","action":"navigate:stats","color":"#10b981"}
   - Ruxsat etilgan action lar: "navigate:<pageId>", "openModal:<modalId>", "call:sendDaySummary|sendWarehouseToTelegram|openWarehouseBatchModal|exportToExcel|openBroadcastModal|openPriceBroadcastModal|optimizeAdminDeliveryRoute|undoLastUiChange", "ai:<savol>"
8. {"type":"remove_custom_button","id":"btn_fast_report"}
9. {"type":"navigate","page":"warehouse|dashboard|new-order|orders|debts|delivery|clients|stats|products|map|settings"}
10. {"type":"reset_ui"} — hamma UI o'zgarishlarni zavod holatiga qaytaradi.

Hozirgi Interfeys va Tugmalar Holati (JSON):
${JSON.stringify(buildUiContext(), null, 2)}`
      : `\n\nESLATMA: Hozir "UI Dostup" o'chirilgan (aiUiAccess: false). Agar foydalanuvchi tugma yoki interfeysni o'zgartirishni so'rasa, yuqoridagi "🎨 UI Dostup" tugmasini yoqishini muloyimlik bilan ayting va <<<UI_ACTIONS>>> blokini qaytarmang.`;

    const systemPrompt = `Siz "TeeGu.PRO" salat va oziq-ovqat yetkazib berish tizimining rasmiy aqlli AI Biznes Maslahatchisi va UI Boshqaruvchisiz.
Biznes egasiga buyurtmalar, savdo tahlili, sklad (ombor qoldig'i), qarzdorlar, kuryerlar, ertangi kun uchun salat tayyorlash rejasini hisoblashda va (dostup yoqilganda) ilova interfeysini moslashtirishda yordam berasiz.

Hozirgi real biznes va ombor ma'lumotlari (JSON):
${JSON.stringify(businessContext, null, 2)}

QOIDALAR:
1. Foydalanuvchi qaysi tilda yozsa (o'zbekcha yoki ruscha), o'sha tilda javob bering.
2. Ma'lumotlardagi aniq raqamlarga, summalar (so'm), sklad qoldig'iga (kg), tovar nomlari va mijozlarga tayanib gapiring. Hech qanday raqamni to'qimang.
3. Javobni chiroyli va qulay qilib formatlang: emojilar, qalin shriftlar (**bold**), ro'yxatlar ishlating.
4. Agar "Ertaga nima tayyorlaymiz?" deb so'ralsa, oxirgi kunlar sotuv hajmi va hozirgi sklad qoldig'ini hisobga olib, har bir salat bo'yicha tavsiya qilingan kg miqdorini aniq raqamlar bilan yozib bering.
5. Qarzlar bo'yicha gap ketganda, eng katta qarzdorlarni va telefon raqamlarini ko'rsating.
6. Agar foydalanuvchi UI o'zgartirishini so'ramagan bo'lsa, <<<UI_ACTIONS>>> blokini ISHLATMANG. Faqat UI o'zgarishi so'ralganda aniq va xavfsiz <<<UI_ACTIONS>>> JSON qaytaring va nima o'zgarganini qisqa tushuntiring.
7. NARX VA FOYDA SIMULYATORI ("Nima bo'lar edi agar..."): Agar foydalanuvchi narx oshirish/tushirish, chegirma berish yoki foyda prognozi haqida ssenariy so'rasa, "simulyatorBazasi" dagi real raqamlarga suyanib hisoblang va javob oxirida quyidagi karta blokini qaytaring:
<<<SIM_SCENARIO>>>
{"title":"Ssenariy nomi","subtitle":"Qisqa izoh","oldRevenue":10000000,"newRevenue":11200000,"oldProfit":2000000,"newProfit":2650000,"volumeChangePct":-5,"breakEvenDropPct":24,"recommendation":"Qisqa tavsiya"}
<<<END_SIM_SCENARIO>>>
8. ODDIY GAP BILAN BIZNES-QOIDA TUZISH (<<<BIZ_RULES>>>): Agar foydalanuvchi avtomatik cheklov yoki ogohlantirish qoidasini yaratish/o'chirish/o'zgartirishni so'rasa (masalan: "Qarzi 500 000 dan oshgan mijozga nasiya yopilsin", "Eng kam buyurtma 2 kg bo'lsin", "Sklad 3 kg dan tushsa ogohlantir", "Buyurtma 30 kg dan oshsa xabar ber", "10 kundan oshgan qarzi bo'lsa nasiya bermasin"), javob oxirida quyidagi blokni qo'shing:
<<<BIZ_RULES>>>
{"ops":[{"op":"add","type":"block_debt_above|min_order_kg|warehouse_low_alert_kg|large_order_alert_kg|max_order_debt_days","limit":500000,"minKg":2,"thresholdKg":3,"maxDays":10,"productId":"all","label":"Qoidaning tushunarli nomi"}]}
<<<END_BIZ_RULES>>>
(Qoidani o'chirish uchun {"op":"remove","id":"..."} yoki o'chirib yoqish uchun {"op":"toggle","id":"...","enabled":false} yozing).
9. MARSHRUT VA HUDUD BO'SHLIG'I TAHLILI: Agar yangi mijoz qayerdan topish, qaysi tumanga kengayish yoki marshrut samaradorligi so'ralsa, "hududVaMarshrutTahlili" dagi faol hududlar, 1-2 mijozli bo'sh yo'nalishlar ("boshliqYonalishlar") va kirmagan tumanlar ("kirmaganTumanlar") asosida aniq amaliy reja bering.
10. OVOZ BILAN TEZKOR BUYURTMA (<<<VOICE_ORDER>>>): Agar foydalanuvchi suhbatda mijozga buyurtma yozib qo'yishni aytsa (masalan: "Alfraganusga 5 kg funchoza, 2 kg sabzi naqdga"), javob oxirida quyidagi tayyor qoralama blokini qaytaring:
<<<VOICE_ORDER>>>
{"clientName":"Mijoz nomi","items":[{"id":"funchoza","qty":5}],"payment":"наличные|клик|консигнация","note":""}
<<<END_VOICE_ORDER>>>${uiContextBlock}`;

    const aiResponse = await callGemini(apiKey, systemPrompt, text, prevHistory);
    
    const typingEl = document.getElementById(typingId);
    if (typingEl) typingEl.remove();

    let cleanText = aiResponse;
    let uiApplied = [];
    let ruleApplied = [];
    let simScenario = null;
    let voiceOrder = null;
    if (typeof extractAndApplyUiActions === 'function') {
      const uiRes = extractAndApplyUiActions(cleanText);
      cleanText = uiRes.cleanText || cleanText;
      uiApplied = uiRes.applied || [];
      if (uiRes.blocked) {
        cleanText += (lang === 'uz' ? '\n\n🔒 _Eslatma: UI Dostup o\'chirilgan. Tepadagi "🎨 UI: OFF" tugmasini yoqing._' : '\n\n🔒 _Доступ к UI отключен. Нажмите "🎨 UI: OFF" сверху._');
      }
    }
    if (typeof extractAndApplyBizRules === 'function') {
      const rRes = extractAndApplyBizRules(cleanText);
      cleanText = rRes.cleanText || cleanText;
      ruleApplied = rRes.applied || [];
    }
    if (typeof extractSimScenario === 'function') {
      const sRes = extractSimScenario(cleanText);
      cleanText = sRes.cleanText || cleanText;
      simScenario = sRes.scenario || null;
    }
    if (typeof extractVoiceOrder === 'function') {
      const vRes = extractVoiceOrder(cleanText);
      cleanText = vRes.cleanText || cleanText;
      voiceOrder = vRes.voiceOrder || null;
    }
    
    const botTime = new Date().toLocaleTimeString('ru-RU', {hour:'2-digit',minute:'2-digit'});
    aiChatHistory.push({ role: 'bot', text: cleanText, uiApplied, ruleApplied, simScenario, voiceOrder, time: botTime });
    
    if (aiChatHistory.length > 20) aiChatHistory = aiChatHistory.slice(-20);
    localStorage.setItem('aiChatHistory', JSON.stringify(aiChatHistory));
    
    renderAiPage();
    const shouldAutoSpeak = (typeof aiAutoSpeak !== 'undefined' && aiAutoSpeak) || (typeof lastInputWasVoice !== 'undefined' && lastInputWasVoice);
    lastInputWasVoice = false;
    if (shouldAutoSpeak && typeof speakAiMessage === 'function') {
      speakAiMessage(aiChatHistory.length - 1);
    }
  } catch (err) {
    const typingEl = document.getElementById(typingId);
    if (typingEl) typingEl.remove();
    
    const errTime = new Date().toLocaleTimeString('ru-RU', {hour:'2-digit',minute:'2-digit'});
    const isUz = lang === 'uz';
    const errText = isUz 
      ? ('❌ Xatolik yuz berdi: ' + err.message + '. Qaytadan urinib ko\'ring yoki 🔑 kalitni tekshiring.')
      : ('❌ Произошла ошибка: ' + err.message + '. Попробуйте снова или проверьте ключ 🔑.');
      
    aiChatHistory.push({ role: 'bot', text: errText, isError: true, time: errTime });
    try { localStorage.setItem('aiChatHistory', JSON.stringify(aiChatHistory.slice(-20))); } catch (e) {}
    renderAiPage();
    showToast(isUz ? 'AI xatolik berdi' : 'Ошибка AI', 'error');
  } finally {
    isAiSending = false;
    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.textContent = '➤';
    }
  }
}

function askAiQuick(type) {
  const isUz = lang === 'uz';
  if (type === 'ui-reset') {
    if (typeof resetUiConfig === 'function') resetUiConfig();
    return;
  }
  const queries = {
    'today': isUz ? 'Bugungi savdo, umumiy tushum, sotilgan salatlar va yetkazilgan buyurtmalar tahlilini ber.' : 'Дай полный отчет по сегодняшним продажам, выручке и доставленным заказам.',
    'warehouse': isUz ? 'Sklad (ombor) qoldig\'ini tahlil qil: qaysi salatlar kam qolgan, qaysilari tugagan va bugun nimani ko\'proq tayyorlash kerak?' : 'Проанализируй остатки на складе: каких салатов мало, что закончилось и что нужно приготовить сегодня?',
    'debts': isUz ? 'Eng katta qarzdor mijozlar kimlar? Umumiy qarz qancha va kimga birinchi navbatda qo\'ng\'iroq qilish kerak?' : 'Кто самые крупные должники? Каков общий долг и кому нужно позвонить в первую очередь?',
    'forecast': isUz ? 'Oxirgi kunlar savdosi va hozirgi sklad qoldig\'iga qarab, ertaga qaysi salatlardan necha kg tayyorlashni maslahat berasan?' : 'На основе последних продаж и остатков на складе, сколько кг каких салатов ты рекомендуешь приготовить на завтра?',
    'top-products': isUz ? 'Oxirgi 7 kunda eng ko\'p sotilgan salatlar va mahsulotlar reytingini ko\'rsat.' : 'Покажи рейтинг самых продаваемых продуктов за последние 7 дней.',
    'inactive-clients': isUz ? 'Oxirgi 4-5 kunda buyurtma bermagan, aloqaga chiqish tavsiya etiladigan mijozlar ro\'yxatini chiqar.' : 'Выведи список постоянных клиентов, которые не заказывали последние 4-5 дней.',
    'delivery': isUz ? 'Bugungi yetkazib berish holati qanday? Qancha buyurtma topshirildi va kuryerlar nima qilmoqda?' : 'Каков статус доставки на сегодня? Сколько заказов доставлено и сколько в пути?',
    'ui-big-btns': isUz ? 'Ilovadagi asosiy tasdiqlash (#submitBtn) va tezkor buyurtma (#dashQuickOrderBtn) hamda agent/kuryer tugmalarini kattaroq, qalinroq va barmoq bilan bosishga qulay qilib o\'zgartir.' : 'Сделай основные кнопки оформления (#submitBtn, #dashQuickOrderBtn) более крупными, жирными и удобными для нажатия.',
    'ui-emerald': isUz ? 'Ilova rang temasini zamonaviy zumrad-yashil (Emerald) qilib o\'zgartir (--accent va --green yashil ohangda, hamma ilovalarga qo\'llansin).' : 'Измени цветовую тему приложения на современный изумрудно-зелёный стиль (для всех приложений).',
    'ui-warehouse-first': isUz ? 'Tepadagi menyuda Sklad bo\'limini dashboarddan keyingi 2-o\'ringa qo\'y va nomini "🏭 Ombor" deb yoz.' : 'Перемести вкладку Склада на 2-е место сразу после Главной и назови её "🏭 Ombor".',
    'ui-custom-btn': isUz ? 'Bosh sahifaga (dashboard) bitta qulay tezkor tugma qo\'sh: "🏭 Skladga kirish" tugmasi, bosilganda Sklad sahifasini ochsin.' : 'Добавь на главную страницу (dashboard) быструю кнопку "🏭 Skladga kirish", которая открывает вкладку Склада.',
    'simulator': isUz ? 'Nima bo\'lar edi agar barcha salatlar narxini 10% oshirsak va 5% mijoz ketsa, yoki Funchoza narxini 2000 so\'m oshirsak? Real raqamlarga qarab 2 ta ssenariyni solishtirib ber va <<<SIM_SCENARIO>>> kartasini chiqar.' : 'Что если поднять цены на все салаты на 10% при оттоке 5% клиентов, или повысить цену Фунчозы на 2000 сум? Сравни сценарии по реальным цифрам и верни карточку <<<SIM_SCENARIO>>>.',
    'rule-demo': isUz ? 'Avtomatik qoida o\'rnat: qarzi 500 000 so\'mdan oshgan mijozlarga nasiyaga (qarzga) buyurtma yopilsin va omborda salat 3 kg dan tushsa ogohlantirish chiqsin.' : 'Установи автоматические правила: блокировать отгрузку в долг клиентам с долгом выше 500 000 сум и предупреждать при остатке на складе ниже 3 кг.',
    'territory': isUz ? 'Hududlar va marshrut bo\'shliqlarini tahlil qil: qayerdan yangi mijoz topsak yo\'l xarajatimiz tejaladi va qaysi tumanlarga hali kirmaganmiz?' : 'Проанализируй зоны доставки и маршруты: где лучше искать новых клиентов, чтобы снизить расходы на логистику, и какие районы еще не охвачены?'
  };
  
  const text = queries[type] || type;
  sendAiUserMessage(text);
}

function clearAiChat() {
  if (confirm(lang === 'uz' ? 'AI suhbatlar tarixini tozalashni xohlaysizmi?' : 'Очистить историю чата с AI?')) {
    if (typeof stopAiSpeech === 'function') stopAiSpeech();
    aiChatHistory = [];
    localStorage.removeItem('aiChatHistory');
    renderAiPage();
    showToast(lang === 'uz' ? 'Tarix tozalandi' : 'История очищена', 'info');
  }
}

function toggleVoiceInput() {
  try { if (typeof unlockAiAudioPlayback === 'function') unlockAiAudioPlayback(); } catch (e) {}
  const micBtn = document.getElementById('aiMicBtn');
  const inputEl = document.getElementById('aiInput');

  if (typeof geminiMicState !== 'undefined' && geminiMicState.active && geminiMicState.mode === 'chat') {
    if (typeof stopGeminiMicRecorder === 'function') stopGeminiMicRecorder();
    return;
  }

  if (isAiRecording) {
    try { if (aiRecognition) aiRecognition.stop(); } catch (e) {}
    isAiRecording = false;
    if (micBtn) micBtn.classList.remove('recording');
    return;
  }

  const recLang = typeof getVoiceRecognitionLang === 'function' ? getVoiceRecognitionLang() : (lang === 'uz' ? 'uz-UZ' : 'ru-RU');
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) {
    if (typeof startGeminiMicRecorder === 'function') {
      startGeminiMicRecorder('chat', recLang);
    } else {
      showToast(lang === 'uz' ? 'Brauzeringiz ovozli kiritishni qo\'llamaydi' : 'Голосовой ввод не поддерживается', 'error');
    }
    return;
  }

  try {
    aiRecognition = new SpeechRec();
    aiRecognition.lang = recLang;
    aiRecognition.interimResults = false;
    aiRecognition.maxAlternatives = 1;
    let fallbackTriggered = false;

    aiRecognition.onstart = function() {
      isAiRecording = true;
      if (micBtn) micBtn.classList.add('recording');
      showToast(recLang === 'uz-UZ' ? '🇺🇿 O\'zbekcha gapiring...' : '🇷🇺 Говорите по-русски...', 'info');
    };

    aiRecognition.onresult = function(event) {
      const speechResult = event && event.results && event.results[0] && event.results[0][0] ? event.results[0][0].transcript : '';
      if (speechResult && inputEl) {
        lastInputWasVoice = true;
        inputEl.value = (inputEl.value ? inputEl.value + ' ' : '') + speechResult;
        inputEl.focus();
      }
    };

    aiRecognition.onerror = function(event) {
      const errCode = event && event.error ? String(event.error) : '';
      console.warn('Speech recognition error:', errCode);
      isAiRecording = false;
      if (micBtn) micBtn.classList.remove('recording');
      if (!fallbackTriggered && (errCode === 'language-not-supported' || errCode === 'service-not-allowed' || errCode === 'network') && typeof startGeminiMicRecorder === 'function' && typeof canUseGeminiMicRecorder === 'function' && canUseGeminiMicRecorder()) {
        fallbackTriggered = true;
        startGeminiMicRecorder('chat', recLang);
      }
    };

    aiRecognition.onend = function() {
      isAiRecording = false;
      if (micBtn && !(typeof geminiMicState !== 'undefined' && geminiMicState.active && geminiMicState.mode === 'chat')) {
        micBtn.classList.remove('recording');
      }
    };

    aiRecognition.start();
  } catch (err) {
    console.error('Speech recognition init error:', err);
    isAiRecording = false;
    if (micBtn) micBtn.classList.remove('recording');
    if (typeof startGeminiMicRecorder === 'function' && typeof canUseGeminiMicRecorder === 'function' && canUseGeminiMicRecorder()) {
      startGeminiMicRecorder('chat', recLang);
    }
  }
}

// ==================== 1. THERMAL LABEL & BARCODE GENERATOR ====================
function generateBarcodeSVG(text) {
  const code39 = {
    '0':'101001101101','1':'110100101011','2':'101100101011','3':'110110010101',
    '4':'101001101011','5':'110100110101','6':'101100110101','7':'101001011011',
    '8':'110100101101','9':'101100101101','A':'110101001011','B':'101101001011',
    'C':'110110100101','D':'101011001011','E':'110101100101','F':'101101100101',
    'G':'101010011011','H':'110101001101','I':'101101001101','J':'101011001101',
    'K':'110101010011','L':'101101010011','M':'110110101001','N':'101011010011',
    'O':'110101101001','P':'101101101001','Q':'101010110011','R':'110101011001',
    'S':'101101011001','T':'101011011001','U':'110010101011','V':'100110101011',
    'W':'110011010101','X':'100101101011','Y':'110010110101','Z':'100110110101',
    '-':'100101011011','.':'110010101101',' ':'100110101101','*':'100101101101'
  };
  const clean = '*' + String(text).toUpperCase().replace(/[^0-9A-Z\-\.]/g, '') + '*';
  let binary = '';
  for (let char of clean) {
    binary += (code39[char] || code39['-']) + '0';
  }
  const barWidth = 1.35;
  const height = 34;
  const width = Math.round(binary.length * barWidth);
  let rects = '';
  for (let i = 0; i < binary.length; i++) {
    if (binary[i] === '1') {
      rects += `<rect x="${(i * barWidth).toFixed(1)}" y="0" width="${barWidth.toFixed(1)}" height="${height}" fill="#000" />`;
    }
  }
  return `<svg viewBox="0 0 ${width} ${height + 13}" style="width:100%;max-width:200px;height:auto;display:block;margin:0 auto;">
    ${rects}
    <text x="${width/2}" y="${height + 10}" font-family="monospace" font-size="10" font-weight="700" text-anchor="middle" fill="#000">${clean.replace(/\*/g,'')}</text>
  </svg>`;
}

let currentLabelOrder = null;
let currentLabelCounts = {};

function openLabelModal(orderId) {
  const o = (state.orders || []).find(x => x.id == orderId);
  if (!o) return;
  currentLabelOrder = o;
  currentLabelCounts = {};

  (o.items || []).forEach(item => {
    currentLabelCounts[item.id] = (item.qty && item.qty >= 10) ? Math.ceil(item.qty / 5) : 1;
  });

  renderLabelModalContent();
  openModal('labelModal');
}

function updateLabelItemCount(itemId, delta) {
  if (currentLabelCounts[itemId] !== undefined) {
    currentLabelCounts[itemId] = Math.max(0, currentLabelCounts[itemId] + delta);
    renderLabelModalContent();
  }
}

function renderLabelModalContent() {
  if (!currentLabelOrder) return;
  const o = currentLabelOrder;
  const selector = document.getElementById('labelItemsSelector');
  const preview = document.getElementById('labelPreviewArea');
  if (!selector || !preview) return;

  selector.innerHTML = (o.items || []).map(item => {
    const count = currentLabelCounts[item.id] || 0;
    const name = lang === 'uz' ? (item.nameUz || item.name) : item.name;
    return `
      <div style="display:flex;justify-content:space-between;align-items:center;background:var(--card);border:1px solid var(--border);border-radius:10px;padding:8px 12px;margin-bottom:6px;">
        <div>
          <div style="font-weight:700;font-size:13px;">${item.emoji || '🥗'} ${name}</div>
          <div style="font-size:11px;color:var(--text3);">${lang==='uz'?'Jami vazn':'Общий вес'}: <b>${item.qty}${item.unit||'kg'}</b></div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <button class="btn btn-outline btn-sm" style="width:30px;height:30px;padding:0;font-size:16px;" onclick="updateLabelItemCount('${item.id}', -1)">−</button>
          <span style="font-weight:800;font-size:14px;min-width:24px;text-align:center;">${count}</span>
          <button class="btn btn-outline btn-sm" style="width:30px;height:30px;padding:0;font-size:16px;" onclick="updateLabelItemCount('${item.id}', 1)">+</button>
        </div>
      </div>`;
  }).join('');

  const now = new Date(o.date || new Date());
  const dateStr = now.toLocaleDateString('ru-RU') + ' ' + now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const orderNum = 'INV-' + String(o.id).slice(-4);

  const labelsHtml = [];
  (o.items || []).forEach(item => {
    const count = currentLabelCounts[item.id] || 0;
    if (count <= 0) return;
    const singleWeight = Math.round((item.qty / count) * 10) / 10;
    const pName = (item.name || '').toUpperCase();
    const pNameUz = (item.nameUz || '').toUpperCase();
    const barcodeCode = 'TG' + String(o.id).slice(-4) + '-' + (item.id || 'P').toUpperCase().slice(0, 6);
    const barcodeSvg = generateBarcodeSVG(barcodeCode);

    for (let c = 1; c <= count; c++) {
      labelsHtml.push(`
        <div class="thermal-label">
          <div class="label-header">
            <span class="label-brand">🥗 TeeGu.PRO</span>
            <span class="label-badge">${lang === 'uz' ? 'TABIIY SALAT' : 'САЛАТЫ'}</span>
          </div>
          <div class="label-product">${pName}</div>
          ${pNameUz && pNameUz !== pName ? `<div class="label-product-uz">${pNameUz}</div>` : ''}
          <div class="label-weight-row">
            <span class="label-weight">${singleWeight} ${item.unit || 'kg'}</span>
            <span class="label-order">#${orderNum} ${count > 1 ? `(${c}/${count})` : ''}</span>
          </div>
          <div class="label-info">👤 <b>${lang === 'uz' ? 'Do\'kon' : 'Клиент'}:</b> ${o.client}</div>
          <div class="label-info">📅 <b>${lang === 'uz' ? 'Sana' : 'Дата'}:</b> ${dateStr}</div>
          <div class="label-info">⏱️ <b>${lang === 'uz' ? 'Yaroqlilik' : 'Срок годности'}:</b> 72 ${lang === 'uz' ? 'soat' : 'часа'} (+2°...+6°C)</div>
          <div class="label-barcode-wrap">
            ${barcodeSvg}
          </div>
          <div class="label-footer">Sertifikatlangan mahsulot · TeeGu.PRO</div>
        </div>
      `);
    }
  });

  if (!labelsHtml.length) {
    preview.innerHTML = `<div style="text-align:center;padding:20px;font-size:12px;color:var(--text3);">
      ${lang === 'uz' ? 'Birorta ham yorliq tanlanmadi (+ tugmasini bosing)' : 'Выберите хотя бы одну этикетку (+)'}
    </div>`;
  } else {
    preview.innerHTML = labelsHtml.join('');
  }
}

function printGeneratedLabels() {
  const preview = document.getElementById('labelPreviewArea');
  if (!preview || !preview.innerHTML.trim()) {
    showToast(lang === 'uz' ? 'Chop etish uchun yorliqlar yo\'q' : 'Нет этикеток для печати', 'error');
    return;
  }
  const printArea = document.getElementById('print-area');
  if (!printArea) return;

  printArea.innerHTML = preview.innerHTML;
  window.print();
  closeModal('labelModal');
  showToast(lang === 'uz' ? '🖨️ Chop etishga yuborildi' : '🖨️ Отправлено на печать', 'success');
}

// ==================== 2. CHURN RISK RADAR ====================
let currentRadarFilter = 'all';

function toggleChurnRadar() {
  const body = document.getElementById('radarBody');
  const btnText = document.getElementById('radarToggleText');
  if (!body) return;
  const isHidden = body.style.display === 'none';
  body.style.display = isHidden ? 'block' : 'none';
  if (btnText) {
    btnText.textContent = isHidden 
      ? (lang === 'uz' ? "▴ Yashirish" : "▴ Скрыть")
      : (lang === 'uz' ? "▾ Ko'rish" : "▾ Показать");
  }
}

function getClientRiskStatus(client) {
  if (!client || client.id === undefined || client.id === null) {
    return { level: 'none', badge: '', desc: '', daysSince: null, avgInterval: null, ordersCount: 0, monthlyRisk: 0 };
  }
  const cId = String(client.id);
  const orders = (state.orders || []).filter(o => String(o.clientId) === cId);
  const validOrders = orders.filter(o => o.date && !isNaN(new Date(o.date).getTime()));
  if (!validOrders.length) {
    return {
      level: 'none',
      badge: lang === 'uz' ? 'Yangi mijoz' : 'Новый клиент',
      desc: '',
      daysSince: null,
      avgInterval: null,
      ordersCount: 0,
      monthlyRisk: 0
    };
  }

  const sorted = [...validOrders].sort((a,b) => new Date(b.date) - new Date(a.date));
  const now = new Date();
  const lastOrderDate = new Date(sorted[0].date);
  const daysSince = Math.max(0, Math.floor((now - lastOrderDate) / (1000 * 60 * 60 * 24)));

  let avgInterval = 3;
  if (sorted.length >= 2) {
    const oldest = new Date(sorted[sorted.length - 1].date);
    const spanDays = Math.max(1, Math.floor((lastOrderDate - oldest) / (1000 * 60 * 60 * 24)));
    avgInterval = Math.max(1, Math.round(spanDays / (sorted.length - 1)));
  }

  const avgOrderTotal = Math.round(validOrders.reduce((s,o)=>s+(Number(o.total)||0),0) / validOrders.length);
  const monthlyRisk = Math.round(avgOrderTotal * (30 / Math.max(1, avgInterval))) || 0;

  if (daysSince >= 14 || (sorted.length >= 2 && daysSince >= avgInterval * 2.8)) {
    return {
      level: 'critical',
      badge: lang === 'uz' ? '🔴 Kritik' : '🔴 Критический',
      desc: lang === 'uz' ? `Odatda har ${avgInterval} kunda · ${daysSince} kundan beri buyurtma yo'q!` : `Обычно каждые ${avgInterval} дн. · Нет заказов ${daysSince} дн.!`,
      daysSince,
      avgInterval,
      ordersCount: validOrders.length,
      monthlyRisk
    };
  } else if (daysSince >= 6 || (sorted.length >= 2 && daysSince >= avgInterval * 1.6)) {
    return {
      level: 'warning',
      badge: lang === 'uz' ? '🟡 Ogohlantirish' : '🟡 Внимание',
      desc: lang === 'uz' ? `Odatda har ${avgInterval} kunda · ${daysSince} kundan beri buyurtma yo'q` : `Обычно каждые ${avgInterval} дн. · Задержка ${daysSince} дн.`,
      daysSince,
      avgInterval,
      ordersCount: validOrders.length,
      monthlyRisk
    };
  } else {
    return {
      level: 'active',
      badge: lang === 'uz' ? '🟢 Faol' : '🟢 Активен',
      desc: '',
      daysSince,
      avgInterval,
      ordersCount: validOrders.length,
      monthlyRisk: 0
    };
  }
}

function filterRadarLevel(level, btnEl) {
  currentRadarFilter = level;
  document.querySelectorAll('#churnRadarCard .pill').forEach(p => p.classList.remove('selected'));
  if (btnEl) btnEl.classList.add('selected');
  renderChurnRadar(level);
}

function renderChurnRadar(levelFilter = currentRadarFilter) {
  const container = document.getElementById('radarClientsList');
  if (!container) return;

  const clientsWithRisk = (state.clients || []).map(c => ({
    client: c,
    risk: getClientRiskStatus(c)
  })).filter(x => x.risk.level === 'critical' || x.risk.level === 'warning');

  clientsWithRisk.sort((a,b) => {
    if (a.risk.level === 'critical' && b.risk.level !== 'critical') return -1;
    if (b.risk.level === 'critical' && a.risk.level !== 'critical') return 1;
    return (b.risk.monthlyRisk || 0) - (a.risk.monthlyRisk || 0);
  });

  const critCount = clientsWithRisk.filter(x => x.risk.level === 'critical').length;
  const warnCount = clientsWithRisk.filter(x => x.risk.level === 'warning').length;
  const totalRisk = clientsWithRisk.length;

  const countAllEl = document.getElementById('radarCountAll');
  const countCritEl = document.getElementById('radarCountCrit');
  const countWarnEl = document.getElementById('radarCountWarn');
  const totalBadge = document.getElementById('radarTotalRiskCount');

  if (countAllEl) countAllEl.textContent = totalRisk;
  if (countCritEl) countCritEl.textContent = critCount;
  if (countWarnEl) countWarnEl.textContent = warnCount;
  if (totalBadge) totalBadge.textContent = totalRisk + (lang === 'uz' ? " ta do'kon xavfda" : ' магазинов');

  let filtered = clientsWithRisk;
  if (levelFilter === 'critical') filtered = clientsWithRisk.filter(x => x.risk.level === 'critical');
  else if (levelFilter === 'warning') filtered = clientsWithRisk.filter(x => x.risk.level === 'warning');

  if (!filtered.length) {
    container.innerHTML = `<div style="text-align:center;padding:12px;font-size:13px;color:var(--text3);">
      🎉 ${lang === 'uz' ? 'Hozircha xavf ostidagi mijozlar yo\'q. Barcha do\'konlar o\'z vaqtida buyurtma bermoqda!' : 'Клиентов в зоне риска нет! Все заказывают вовремя.'}
    </div>`;
    return;
  }

  container.innerHTML = filtered.slice(0, 10).map(({ client: c, risk: r }) => {
    if (!c) return '';
    const isCrit = r.level === 'critical';
    const borderClr = isCrit ? 'rgba(247,90,90,0.3)' : 'rgba(255,152,0,0.3)';
    const bgClr = isCrit ? 'rgba(247,90,90,0.06)' : 'rgba(255,152,0,0.06)';
    const phoneClean = typeof c.phone === 'string' ? c.phone.replace(/\D/g, '') : '';
    const tgLink = phoneClean ? 'https://t.me/+' + phoneClean : '';
    const cId = String(c.id || '');

    return `
      <div class="radar-item" style="border-color:${borderClr};background:${bgClr};flex-wrap:wrap;">
        <div style="flex:1;min-width:180px;">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;">
            <span style="font-weight:800;font-size:14px;">${c.name || 'Mijoz'}</span>
            <span style="font-size:10px;font-weight:700;padding:2px 6px;border-radius:6px;background:${isCrit?'rgba(247,90,90,0.2)':'rgba(255,152,0,0.2)'};color:${isCrit?'var(--danger)':'var(--orange)'};">${r.badge}</span>
          </div>
          <div style="font-size:11px;color:var(--text2);margin-bottom:2px;">${r.desc}</div>
          <div style="font-size:11px;color:var(--text3);">
            ${lang === 'uz' ? 'Xavf ostidagi oylik aylanma:' : 'Риск оборота:'} <b style="color:${isCrit?'var(--danger)':'var(--orange)'}">~${fmt(r.monthlyRisk || 0)} so'm/oy</b>
          </div>
        </div>
        <div style="display:flex;gap:6px;align-items:center;">
          ${c.phone ? `<a href="tel:${c.phone}" class="btn btn-outline btn-sm" style="padding:6px 10px;font-size:12px;" title="${lang==='uz'?'Qo\'ng\'iroq qilish':'Позвонить'}">📞</a>` : ''}
          ${tgLink ? `<a href="${tgLink}" target="_blank" class="btn btn-outline btn-sm" style="padding:6px 10px;font-size:12px;" title="Telegram">💬</a>` : ''}
          <button class="btn btn-primary btn-sm" style="padding:6px 12px;font-size:12px;" onclick="quickOrderForClient('${cId}')">
            📝 ${lang === 'uz' ? 'Buyurtma' : 'Заказ'}
          </button>
        </div>
      </div>`;
  }).join('');
}

function quickOrderForClient(clientId) {
  const sel = document.getElementById('clientSelect');
  if (sel) sel.value = clientId;
  showPage('new-order');
  renderProductsGrid();
  showToast(lang === 'uz' ? 'Mijoz tanlandi, buyurtma qabul qiling' : 'Клиент выбран для нового заказа', 'info');
}

// ==================== 3. ADMIN SMART DELIVERY ROUTE ====================
let adminOptimizedRoute = null;

function optimizeAdminDeliveryRoute() {
  const today = new Date().toDateString();
  const todayOrders = (state.orders || []).filter(o => new Date(o.date).toDateString() === today);
  if (!todayOrders.length) {
    showToast(lang === 'uz' ? "Bugun yetkaziladigan buyurtmalar yo'q" : 'Нет заказов на сегодня', 'info');
    return;
  }

  showToast(lang === 'uz' ? "📍 Optimal marshrut hisoblanmoqda..." : 'Расчёт оптимального маршрута...', 'info');

  const withCoords = [];
  const withoutCoords = [];

  todayOrders.forEach(o => {
    let lat = null, lng = null;
    if (o.lat && o.lng) {
      lat = parseFloat(o.lat); lng = parseFloat(o.lng);
    } else {
      const c = (state.clients || []).find(cl => cl.id == o.clientId);
      if (c && c.lat && c.lng) {
        lat = parseFloat(c.lat); lng = parseFloat(c.lng);
      }
    }
    if (lat && lng) {
      withCoords.push({ ...o, _lat: lat, _lng: lng });
    } else {
      withoutCoords.push(o);
    }
  });

  if (!withCoords.length) {
    showToast(lang === 'uz' ? "Mijozlarda xarita koordinatalari topilmadi" : 'У клиентов нет координат на карте', 'error');
    return;
  }

  let current = { lat: 41.2995, lng: 69.2401 };
  let remaining = [...withCoords];
  const sorted = [];
  let totalKm = 0;

  function calcDist(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }

  while (remaining.length > 0) {
    let bestIdx = 0;
    let minD = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = calcDist(current.lat, current.lng, remaining[i]._lat, remaining[i]._lng);
      if (d < minD) {
        minD = d;
        bestIdx = i;
      }
    }
    const next = remaining.splice(bestIdx, 1)[0];
    next.stepNum = sorted.length + 1;
    next.distKm = Math.round(minD * 10) / 10;
    totalKm += minD;
    current = { lat: next._lat, lng: next._lng };
    sorted.push(next);
  }

  const yandexPoints = [
    '41.2995,69.2401',
    ...sorted.map(s => `${s._lat},${s._lng}`)
  ];
  const yandexUrl = `https://yandex.ru/maps/?rtext=${yandexPoints.join('~')}&rtt=auto`;

  adminOptimizedRoute = {
    totalKm: Math.round(totalKm * 10) / 10,
    count: sorted.length,
    yandexUrl,
    sortedOrders: [...sorted, ...withoutCoords]
  };

  const sumBox = document.getElementById('adminRouteSummaryBox');
  if (sumBox) {
    sumBox.innerHTML = `
      <div style="background:linear-gradient(135deg,rgba(124,106,247,0.15),rgba(86,212,160,0.12));border:1px solid var(--accent);border-radius:12px;padding:12px;margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <span style="font-weight:800;font-size:14px;">🧭 ${lang === 'uz' ? 'Optimal ketma-ketlik' : 'Оптимальный маршрут'}</span>
          <span style="font-weight:900;color:var(--green);font-size:15px;">~${adminOptimizedRoute.totalKm} km</span>
        </div>
        <div style="font-size:12px;color:var(--text2);margin-bottom:8px;">
          ${adminOptimizedRoute.count} ${lang === 'uz' ? 'ta manzil eng qisqa yo\'l bo\'yicha saralandi.' : 'адресов упорядочены по кратчайшему расстоянию.'}
        </div>
        <a href="${adminOptimizedRoute.yandexUrl}" target="_blank" class="btn btn-primary btn-sm" style="padding:10px;text-decoration:none;display:flex;align-items:center;justify-content:center;gap:6px;">
          🚀 ${lang === 'uz' ? 'Barcha marshrutni Yandex Xaritalarda ochish' : 'Открыть весь маршрут в Яндекс Картах'}
        </a>
      </div>
    `;
  }

  renderDelivery(adminOptimizedRoute.sortedOrders);
  showToast(lang === 'uz' ? `✅ Marshrut tayyor: ~${adminOptimizedRoute.totalKm} km` : `✅ Маршрут готов: ~${adminOptimizedRoute.totalKm} км`, 'success');
}


// ==================== TELEGRAM BROADCAST / NARXNOMA ====================
function openBroadcastModal(templateKey = null) {
  updateBroadcastTargetInfo();
  if (templateKey) {
    loadBroadcastTemplate(templateKey);
  } else if (!document.getElementById('broadcastBody').value) {
    loadBroadcastTemplate('pricelist');
  } else {
    updateBroadcastPreview();
  }
  openModal('broadcastModal');
}

function updateBroadcastTargetInfo() {
  const target = document.getElementById('broadcastTarget')?.value || 'both';
  const infoEl = document.getElementById('broadcastTargetInfo');
  if (!infoEl) return;

  const defaultGroupId = (state.settings && state.settings.tgChatId) || '483325961';
  const clientsWithTg = (state.clients || []).filter(c => c.tgId || c.chatId || c.telegramId);

  if (target === 'group') {
    infoEl.innerHTML = `🏢 Asosiy guruhga yuboriladi (Chat ID: <b>${defaultGroupId}</b>)`;
  } else if (target === 'clients') {
    infoEl.innerHTML = `👤 Bot orqali ulangan do'konlarga yuboriladi (Ulanganlar: <b>${clientsWithTg.length} ta</b>)`;
  } else {
    infoEl.innerHTML = `👥 Asosiy guruhga (ID: ${defaultGroupId}) hamda botdagi ${clientsWithTg.length} ta do'konga yuboriladi`;
  }
}

function loadBroadcastTemplate(type) {
  const titleInput = document.getElementById('broadcastTitle');
  const bodyInput = document.getElementById('broadcastBody');
  if (!titleInput || !bodyInput) return;

  const now = new Date();
  const dateStr = now.toLocaleDateString('ru-RU');

  if (type === 'pricelist') {
    titleInput.value = `🥗 TeeGu.PRO — AMALDAGI NARXNOMA (${dateStr})`;
    const prodLines = (PRODUCTS || []).map(p => {
      const name = lang === 'uz' ? (p.nameUz || p.name) : p.name;
      const unit = p.unit || 'kg';
      return `${p.emoji || '🥗'} <b>${name}</b> — ${fmt(p.price)} so'm / ${unit}`;
    }).join('\n');

    bodyInput.value = `Hurmatli hamkorlar va do'kon egalari!\nBugungi amaldagi ulgurji narxlarimiz bilan tanishing:\n\n${prodLines}\n\n✨ Barcha salatlarimiz 100% yangi va tabiiy masalliqlardan tayyorlangan.\n🚚 Yetkazib berish har kuni ertalab soat 09:00 dan boshlanadi.\n📞 Buyurtma uchun: ${state.settings.phone || '+998 ...'}`;
  } else if (type === 'price_update') {
    titleInput.value = `📢 DIQQAT: YANGILANGAN NARXLAR (${dateStr})`;
    const prodLines = (PRODUCTS || []).map(p => {
      const name = lang === 'uz' ? (p.nameUz || p.name) : p.name;
      return `• ${p.emoji || '🥗'} ${name}: <b>${fmt(p.price)} so'm</b>`;
    }).join('\n');

    bodyInput.value = `Hurmatli qadrli do'kon egalari!\nXomashyo va bozor narxlari o'zgarishi munosabati bilan yangilangan narxlar kuchga kirdi:\n\n${prodLines}\n\nSifatli va mazali mahsulotlarni o'z vaqtida yetkazishda davom etamiz.\nHurmat bilan, TeeGu.PRO jamoasi 🥗`;
  } else if (type === 'new_product') {
    titleInput.value = `✨ ASSORTIMENTDA YANGI SALAT!`;
    bodyInput.value = `Hurmatli do'kon egalari va oshpazlar!\nBizning salatlar qatoriga yangi o'zgacha ta'mli salat qo'shildi!\n\nYuqori sifat, tabiiy masalliqlar va maxsus ulgurji narxda taklif etamiz.\n\nDo'koningiz peshtaxtasi uchun birinchi partiyaga hoziroq buyurtma bering!\n📞 ${state.settings.phone || '+998 ...'}`;
  } else if (type === 'holiday') {
    titleInput.value = `🌙 BAYRAM JADVALI VA YETKAZIB BERISH`;
    bodyInput.value = `Hurmatli do'konlar va hamkorlar!\nYaqinlashib kelayotgan bayram munosabati bilan oshxonamiz va kuryerlarimiz ish rejasini ma'lum qilamiz.\n\nDo'koningizda salatlar uzilishlarsiz bo'lishi uchun bayramoldi buyurtmalarni 1 kun oldin berishingizni so'raymiz!\n\nSizga tinchlik va baraka tilaymiz! 🥗`;
  }

  updateBroadcastPreview();
}

function updateBroadcastPreview() {
  const title = document.getElementById('broadcastTitle')?.value.trim() || '';
  const body = document.getElementById('broadcastBody')?.value.trim() || '';
  const previewBox = document.getElementById('broadcastPreviewBox');
  if (!previewBox) return;

  if (!title && !body) {
    previewBox.innerHTML = '<span style="color:var(--text3);font-style:italic">Xabar matnini yozing yoki shablondan tanlang...</span>';
    return;
  }

  let previewHtml = '';
  if (title) previewHtml += `<div style="font-weight:900;font-size:15px;margin-bottom:8px;color:var(--accent);">${title}</div>`;
  if (body) previewHtml += `<div>${body}</div>`;
  previewBox.innerHTML = previewHtml;
}

async function sendTelegramBroadcast() {
  const title = document.getElementById('broadcastTitle')?.value.trim();
  const body = document.getElementById('broadcastBody')?.value.trim();
  const target = document.getElementById('broadcastTarget')?.value || 'both';
  const sendBtn = document.getElementById('broadcastSendBtn');

  if (!title && !body) {
    showToast(lang === 'uz' ? "Iltimos, xabar sarlavhasi yoki matnini kiriting" : "Введите текст сообщения", 'error');
    return;
  }

  const tgToken = (state.settings && state.settings.tgToken) || '8796588071:AAG8Z_R8hP9ESZZ_3LxUakD8PCXj5C5ZP6Y';
  const mainChatId = (state.settings && state.settings.tgChatId) || '483325961';

  if (!tgToken) {
    showToast("Telegram Bot Token sozlanmagan", 'error');
    return;
  }

  // Build recipients list
  const recipientIds = new Set();
  if (target === 'group' || target === 'both') {
    if (mainChatId) recipientIds.add(String(mainChatId));
  }
  if (target === 'clients' || target === 'both') {
    (state.clients || []).forEach(c => {
      const id = c.tgId || c.chatId || c.telegramId;
      if (id) recipientIds.add(String(id));
    });
  }

  if (recipientIds.size === 0) {
    showToast("Hech qanday qabul qiluvchi topilmadi", 'error');
    return;
  }

  const fullText = `<b>${title}</b>\n\n${body}`;

  sendBtn.disabled = true;
  sendBtn.innerHTML = '📤 Yuborilmoqda...';

  let successCount = 0;
  let failCount = 0;

  for (const chatId of recipientIds) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: fullText,
          parse_mode: 'HTML'
        })
      });
      const data = await res.json();
      if (data.ok) successCount++;
      else failCount++;
    } catch (e) {
      failCount++;
    }
    // Small safe delay
    await new Promise(r => setTimeout(r, 60));
  }

  sendBtn.disabled = false;
  sendBtn.innerHTML = '🚀 ' + (lang === 'uz' ? 'Barchaga yuborish' : 'Отправить');
  closeModal('broadcastModal');

  if (successCount > 0) {
    showToast(lang === 'uz' ? `✅ ${successCount} ta manzilga muvaffaqiyatli yuborildi!` : `✅ Отправлено (${successCount})`, 'success');
  } else {
    showToast(lang === 'uz' ? "Xatolik: Xabar yuborilmadi" : "Ошибка отправки", 'error');
  }
}

// ==================== WAREHOUSE (SKLAD) SYSTEM ====================
let warehouseLogs = (() => {
  try {
    const raw = JSON.parse(localStorage.getItem('teegu_wh_logs') || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch (e) {
    return [];
  }
})();

function isProductTracked(p) {
  return Boolean(p && p.stock !== undefined && p.stock !== null && p.stock !== '' && !isNaN(Number(p.stock)));
}

function getProductMinStock(p) {
  if (typeof aiBusinessRules !== 'undefined' && Array.isArray(aiBusinessRules)) {
    const specificRule = aiBusinessRules.find(r => r && r.enabled && r.type === 'warehouse_low_alert_kg' && p && String(r.productId) === String(p.id));
    if (specificRule && !isNaN(Number(specificRule.thresholdKg))) return Math.max(0, Number(specificRule.thresholdKg));
    const globalRule = aiBusinessRules.find(r => r && r.enabled && r.type === 'warehouse_low_alert_kg' && (!r.productId || r.productId === 'all'));
    if (globalRule && !isNaN(Number(globalRule.thresholdKg))) return Math.max(0, Number(globalRule.thresholdKg));
  }
  if (p && p.minStock !== undefined && p.minStock !== null && p.minStock !== '' && !isNaN(Number(p.minStock))) {
    return Math.max(0, Number(p.minStock));
  }
  return 5;
}

function getProductStockStatus(p) {
  if (!isProductTracked(p)) return 'untracked';
  const q = Number(p.stock);
  const min = getProductMinStock(p);
  if (q <= 0) return 'empty';
  if (q <= min) return 'low';
  return 'ok';
}

function updateWarehouseBadge() {
  const badge = document.getElementById('warehouseBadge');
  if (!badge) return;
  const lowCount = (PRODUCTS || []).filter(p => {
    const st = getProductStockStatus(p);
    return st === 'low' || st === 'empty';
  }).length;
  badge.textContent = lowCount > 0 ? String(lowCount) : '';
  if (badge.style) {
    badge.style.display = lowCount > 0 ? '' : 'none';
  }
}

function setWarehouseFilter(status) {
  warehouseFilterStatus = status || 'all';
  ['all', 'low', 'ok'].forEach(s => {
    const btn = document.getElementById('whPill-' + s);
    if (btn && btn.classList) btn.classList.toggle('selected', s === warehouseFilterStatus);
  });
  renderWarehouse();
}

function applyOrderStockDeltas(deltas, reasonPrefix, orderId, clientName) {
  if (!deltas || typeof deltas !== 'object') return;
  const entries = Object.entries(deltas).filter(([, d]) => Math.abs(Number(d) || 0) > 0.0001);
  if (!entries.length) return;

  const logItems = [];
  const labelMap = {
    order_cancel: 'Buyurtma bekor qilindi',
    order_restore: 'Buyurtma tiklandi',
    order_delete: 'Buyurtma o\'chirildi',
    order_edit: 'Buyurtma tahrirlandi'
  };
  const reasonLabel = (labelMap[reasonPrefix] || reasonPrefix || 'Buyurtma') + (clientName ? ': ' + clientName : '');

  entries.forEach(([pid, rawDelta]) => {
    const delta = roundQty(rawDelta);
    const p = (PRODUCTS || []).find(x => String(x.id) === String(pid));
    if (!p || !isProductTracked(p)) return;
    const newVal = roundQty(Number(p.stock) + delta);
    p.stock = newVal;
    const incVal = (typeof firebase !== 'undefined' && firebase.firestore && firebase.firestore.FieldValue && firebase.firestore.FieldValue.increment)
      ? firebase.firestore.FieldValue.increment(delta)
      : newVal;
    try {
      db.collection('products').doc(String(p.id)).update({ stock: incVal });
    } catch (e) {}
    logItems.push({
      productId: p.id,
      name: p.nameUz || p.name,
      emoji: p.emoji || '🥗',
      delta,
      newStock: newVal,
      unit: p.unit || 'kg',
      reason: reasonLabel + (orderId ? ' #' + String(orderId).slice(-4) : '')
    });
  });

  if (logItems.length) {
    logWarehouseMovement(logItems);
    try { renderWarehouse(); updateWarehouseBadge(); renderProductsGrid(); } catch (e) {}
  }
}

function renderWarehouse() {
  const listEl = document.getElementById('warehouseList');
  if (!listEl) return;

  const prods = PRODUCTS || [];
  const tracked = prods.filter(isProductTracked);
  const totalKg = roundQty(tracked.reduce((s, p) => s + Math.max(0, Number(p.stock) || 0), 0));
  const okCount = tracked.filter(p => getProductStockStatus(p) === 'ok').length;
  const lowCount = tracked.filter(p => {
    const st = getProductStockStatus(p);
    return st === 'low' || st === 'empty';
  }).length;
  const totalVal = Math.round(tracked.reduce((s, p) => {
    const q = Math.max(0, Number(p.stock) || 0);
    const unitVal = Number(p.cost) > 0 ? Number(p.cost) : (Number(p.price) || 0);
    return s + q * unitVal;
  }, 0));

  const elKg = document.getElementById('whTotalKg');
  const elOk = document.getElementById('whOkCount');
  const elLow = document.getElementById('whLowCount');
  const elVal = document.getElementById('whTotalVal');
  if (elKg) elKg.textContent = totalKg + ' kg';
  if (elOk) elOk.textContent = String(okCount);
  if (elLow) elLow.textContent = String(lowCount);
  if (elVal) elVal.textContent = fmt(totalVal) + ' so\'m';

  const searchInput = document.getElementById('warehouseSearch');
  const qStr = (searchInput && searchInput.value ? searchInput.value : '').trim().toLowerCase();

  const filtered = prods.filter(p => {
    const nameMatch = !qStr ||
      (p.name || '').toLowerCase().includes(qStr) ||
      (p.nameUz || '').toLowerCase().includes(qStr);
    if (!nameMatch) return false;
    const st = getProductStockStatus(p);
    if (warehouseFilterStatus === 'low') return st === 'low' || st === 'empty';
    if (warehouseFilterStatus === 'ok') return st === 'ok';
    return true;
  });

  if (!filtered.length) {
    listEl.innerHTML = `<div style="text-align:center;padding:24px;color:var(--text3)">🏭 ${lang==='uz'?'Mahsulot topilmadi':'Товары не найдены'}</div>`;
  } else {
    listEl.innerHTML = filtered.map(p => {
      const trackedItem = isProductTracked(p);
      const st = getProductStockStatus(p);
      const minTh = getProductMinStock(p);
      const stockNum = trackedItem ? roundQty(p.stock) : null;
      const unit = p.unit || 'kg';
      const cap = Math.max(minTh * 4, 25);
      const pct = trackedItem ? Math.max(0, Math.min(100, Math.round((Math.max(0, stockNum) / cap) * 100))) : 100;

      const statusMeta = {
        ok: { cls: 'ok', label: lang === 'uz' ? 'YETARLI' : 'В НАЛИЧИИ', bar: 'var(--green)' },
        low: { cls: 'low', label: lang === 'uz' ? 'KAM QOLDI' : 'МАЛО', bar: 'var(--gold)' },
        empty: { cls: 'empty', label: lang === 'uz' ? 'TUGAGAN' : 'НЕТ В НАЛИЧИИ', bar: 'var(--danger)' },
        untracked: { cls: 'untracked', label: '∞ HISOBSIZ', bar: 'var(--text3)' }
      }[st];

      const qtyDisplay = trackedItem ? `${stockNum} <span style="font-size:13px;font-weight:600;color:var(--text2)">${escapeHTML(unit)}</span>` : '∞';
      const costInfo = Number(p.cost) > 0 ? `${fmt(p.cost)} / ${fmt(p.price)} so'm` : `${fmt(p.price)} so'm`;

      return `
        <div class="wh-card ${st === 'low' || st === 'empty' ? 'status-' + st : ''}">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
            <div style="display:flex;align-items:center;gap:10px;min-width:0">
              <div style="font-size:28px;line-height:1">${p.emoji || '🥗'}</div>
              <div style="min-width:0">
                <div style="font-weight:800;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHTML((lang==='uz' && p.nameUz) ? p.nameUz : p.name)}</div>
                <div style="font-size:11px;color:var(--text3)">${costInfo} · Min: ${minTh} ${escapeHTML(unit)}</div>
              </div>
            </div>
            <div style="text-align:right;flex-shrink:0">
              <div class="wh-qty-big">${qtyDisplay}</div>
              <span class="wh-status-pill ${statusMeta.cls}">${statusMeta.label}</span>
            </div>
          </div>
          ${trackedItem ? `<div class="wh-bar-bg"><div class="wh-bar-fill" style="width:${pct}%;background:${statusMeta.bar}"></div></div>` : ''}
          <div class="wh-actions">
            <button class="wh-quick-btn plus" onclick="quickAdjustStock('${p.id}', 1)">+1</button>
            <button class="wh-quick-btn plus" onclick="quickAdjustStock('${p.id}', 5)">+5</button>
            <button class="wh-quick-btn plus" onclick="quickAdjustStock('${p.id}', 10)">+10</button>
            <button class="wh-quick-btn minus" onclick="quickAdjustStock('${p.id}', -1)">-1</button>
            <button class="wh-quick-btn" onclick="openWarehouseEditModal('${p.id}')">✏️ ${lang==='uz'?'Tahrir':'Изм.'}</button>
          </div>
        </div>
      `;
    }).join('');
  }

  renderWarehouseLogs();
  renderCustomUiButtons();
}

function quickAdjustStock(prodId, delta, customReason) {
  const p = (PRODUCTS || []).find(x => String(x.id) === String(prodId));
  if (!p) return;
  const wasTracked = isProductTracked(p);
  const oldVal = wasTracked ? Number(p.stock) : 0;
  const d = roundQty(delta);
  const newVal = roundQty(oldVal + d);
  p.stock = newVal;
  if (p.minStock === undefined) p.minStock = 5;

  const incVal = (wasTracked && typeof firebase !== 'undefined' && firebase.firestore && firebase.firestore.FieldValue && firebase.firestore.FieldValue.increment)
    ? firebase.firestore.FieldValue.increment(d)
    : newVal;

  try {
    db.collection('products').doc(String(p.id)).update({
      stock: incVal,
      minStock: getProductMinStock(p)
    });
  } catch (e) {
    try { db.collection('products').doc(String(p.id)).set({ stock: newVal, minStock: getProductMinStock(p) }, { merge: true }); } catch (e2) {}
  }

  logWarehouseMovement([{
    productId: p.id,
    name: p.nameUz || p.name,
    emoji: p.emoji || '🥗',
    delta: d,
    newStock: newVal,
    unit: p.unit || 'kg',
    reason: customReason || (d >= 0 ? 'Tezkor kirim' : 'Tezkor chiqim')
  }]);

  renderWarehouse();
  updateWarehouseBadge();
  renderProductsGrid();
  try { renderDashboard(); } catch (e) {}
  showToast(`${p.emoji || '🥗'} ${p.nameUz || p.name}: ${d >= 0 ? '+' : ''}${d} → ${newVal} ${p.unit || 'kg'}`, d >= 0 ? 'success' : 'info');
}

function openWarehouseBatchModal() {
  const wrap = document.getElementById('warehouseBatchList');
  if (!wrap) return;
  wrap.innerHTML = (PRODUCTS || []).map(p => {
    const curTxt = isProductTracked(p) ? `${roundQty(p.stock)} ${p.unit || 'kg'}` : '∞';
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:14px">${p.emoji || '🥗'} ${escapeHTML(p.nameUz || p.name)}</div>
          <div style="font-size:11px;color:var(--text3)">Hozir: ${curTxt}</div>
        </div>
        <div style="display:flex;align-items:center;gap:6px">
          <input type="number" step="0.5" min="0" id="whBatchIn-${p.id}" class="form-input" style="width:92px;text-align:center;padding:8px;font-weight:700" placeholder="0">
          <span style="font-size:12px;color:var(--text3);min-width:22px">${escapeHTML(p.unit || 'kg')}</span>
        </div>
      </div>
    `;
  }).join('');
  const noteEl = document.getElementById('warehouseBatchNote');
  if (noteEl) noteEl.value = '';
  openModal('warehouseBatchModal');
}

function saveWarehouseBatch() {
  const noteEl = document.getElementById('warehouseBatchNote');
  const note = (noteEl && noteEl.value ? noteEl.value : '').trim() || 'Tayyorlov (kirim)';
  const batch = db.batch();
  const logs = [];

  (PRODUCTS || []).forEach(p => {
    const inEl = document.getElementById('whBatchIn-' + p.id);
    const addQty = inEl ? roundQty(parseFloat(inEl.value) || 0) : 0;
    if (addQty <= 0) return;

    const wasTracked = isProductTracked(p);
    const oldVal = wasTracked ? Number(p.stock) : 0;
    const newVal = roundQty(oldVal + addQty);
    p.stock = newVal;
    if (p.minStock === undefined) p.minStock = 5;

    const ref = db.collection('products').doc(String(p.id));
    const incVal = (wasTracked && typeof firebase !== 'undefined' && firebase.firestore && firebase.firestore.FieldValue && firebase.firestore.FieldValue.increment)
      ? firebase.firestore.FieldValue.increment(addQty)
      : newVal;
    batch.update(ref, { stock: incVal, minStock: getProductMinStock(p) });

    logs.push({
      productId: p.id,
      name: p.nameUz || p.name,
      emoji: p.emoji || '🥗',
      delta: addQty,
      newStock: newVal,
      unit: p.unit || 'kg',
      reason: note
    });
  });

  if (!logs.length) {
    showToast(lang === 'uz' ? 'Kamida bitta mahsulot miqdorini kiriting' : 'Введите количество хотя бы одного товара', 'error');
    return;
  }

  batch.commit();
  logWarehouseMovement(logs);
  closeModal('warehouseBatchModal');
  renderWarehouse();
  updateWarehouseBadge();
  renderProductsGrid();
  try { renderDashboard(); } catch (e) {}
  showToast(`✅ ${logs.length} ta mahsulot skladga qo'shildi`, 'success');
}

function openWarehouseEditModal(prodId) {
  const p = (PRODUCTS || []).find(x => String(x.id) === String(prodId));
  if (!p) return;
  const idEl = document.getElementById('whEditProductId');
  const titleEl = document.getElementById('whEditTitle');
  const infoEl = document.getElementById('whEditCurrentInfo');
  const modeEl = document.getElementById('whEditMode');
  const qtyEl = document.getElementById('whEditQty');
  const minEl = document.getElementById('whEditMinStock');
  const noteEl = document.getElementById('whEditNote');

  if (idEl) idEl.value = String(p.id);
  if (titleEl) titleEl.textContent = `${p.emoji || '🥗'} ${p.nameUz || p.name}`;
  if (infoEl) infoEl.textContent = isProductTracked(p)
    ? `Hozirgi qoldiq: ${roundQty(p.stock)} ${p.unit || 'kg'}`
    : 'Hozircha cheklanmagan (hisobsiz)';
  if (modeEl) modeEl.value = 'set';
  if (qtyEl) qtyEl.value = isProductTracked(p) ? String(roundQty(p.stock)) : '0';
  if (minEl) minEl.value = String(getProductMinStock(p));
  if (noteEl) noteEl.value = '';
  onWhEditModeChange();
  openModal('warehouseEditModal');
}

function onWhEditModeChange() {
  const modeEl = document.getElementById('whEditMode');
  const grp = document.getElementById('whEditQtyGroup');
  if (!grp || !modeEl) return;
  if (grp.style) grp.style.display = modeEl.value === 'unlimited' ? 'none' : '';
}

function saveWarehouseEdit() {
  const pid = document.getElementById('whEditProductId')?.value;
  const p = (PRODUCTS || []).find(x => String(x.id) === String(pid));
  if (!p) return;

  const mode = document.getElementById('whEditMode')?.value || 'set';
  const qtyInput = parseFloat(document.getElementById('whEditQty')?.value);
  const minInput = parseFloat(document.getElementById('whEditMinStock')?.value);
  const note = (document.getElementById('whEditNote')?.value || '').trim();
  const minStock = !isNaN(minInput) ? Math.max(0, roundQty(minInput)) : getProductMinStock(p);
  p.minStock = minStock;

  if (mode === 'unlimited') {
    delete p.stock;
    const delVal = (typeof firebase !== 'undefined' && firebase.firestore && firebase.firestore.FieldValue && firebase.firestore.FieldValue.delete)
      ? firebase.firestore.FieldValue.delete()
      : null;
    try { db.collection('products').doc(String(p.id)).update({ stock: delVal, minStock }); } catch (e) {}
    logWarehouseMovement([{
      productId: p.id, name: p.nameUz || p.name, emoji: p.emoji || '🥗',
      delta: 0, newStock: '∞', unit: p.unit || 'kg', reason: note || 'Cheklanmagan rejimga o\'tkazildi'
    }]);
  } else {
    if (isNaN(qtyInput)) {
      showToast(lang === 'uz' ? 'Miqdorni to\'g\'ri kiriting' : 'Введите корректное число', 'error');
      return;
    }
    const oldVal = isProductTracked(p) ? Number(p.stock) : 0;
    let newVal = oldVal;
    if (mode === 'set') newVal = roundQty(qtyInput);
    else if (mode === 'add') newVal = roundQty(oldVal + qtyInput);
    else if (mode === 'sub') newVal = roundQty(oldVal - qtyInput);
    const delta = roundQty(newVal - oldVal);
    p.stock = newVal;
    try { db.collection('products').doc(String(p.id)).update({ stock: newVal, minStock }); } catch (e) {}
    logWarehouseMovement([{
      productId: p.id, name: p.nameUz || p.name, emoji: p.emoji || '🥗',
      delta, newStock: newVal, unit: p.unit || 'kg',
      reason: note || (mode === 'set' ? 'Inventarizatsiya (=)' : mode === 'add' ? 'Kirim (+)' : 'Spisaniya (-)')
    }]);
  }

  closeModal('warehouseEditModal');
  renderWarehouse();
  updateWarehouseBadge();
  renderProductsGrid();
  renderProductsSettings();
  try { renderDashboard(); } catch (e) {}
  showToast('✅ Sklad yangilandi', 'success');
}

function logWarehouseMovement(entries) {
  if (!Array.isArray(entries) || !entries.length) return;
  const now = new Date().toISOString();
  const stamped = entries.map((e, idx) => ({
    id: Date.now() + idx,
    date: now,
    ...e
  }));
  warehouseLogs = [...stamped, ...warehouseLogs].slice(0, 40);
  try { localStorage.setItem('teegu_wh_logs', JSON.stringify(warehouseLogs)); } catch (e) {}
  try {
    db.collection('settings').doc('main').set({ warehouseLogs: warehouseLogs.slice(0, 40) }, { merge: true });
  } catch (e) {}
  renderWarehouseLogs();
}

function renderWarehouseLogs() {
  const el = document.getElementById('warehouseLogsList');
  if (!el) return;
  if (!warehouseLogs.length) {
    el.innerHTML = `<div style="font-size:12px;color:var(--text3);padding:8px 0">${lang==='uz'?'Hozircha harakatlar yo\'q':'Пока нет движений'}</div>`;
    return;
  }
  el.innerHTML = warehouseLogs.slice(0, 20).map(l => {
    const dNum = Number(l.delta);
    const deltaStr = l.newStock === '∞' ? '∞' : (dNum > 0 ? `+${dNum}` : `${dNum}`);
    const col = l.newStock === '∞' ? 'var(--text2)' : (dNum > 0 ? 'var(--green)' : (dNum < 0 ? 'var(--danger)' : 'var(--gold)'));
    const tm = l.date ? new Date(l.date).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '';
    const dt = l.date ? new Date(l.date).toLocaleDateString('ru-RU') : '';
    return `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border);font-size:12px">
        <div style="min-width:0">
          <div style="font-weight:700">${l.emoji || '🥗'} ${escapeHTML(l.name || '')}</div>
          <div style="color:var(--text3);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHTML(l.reason || '')} · ${dt} ${tm}</div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-weight:800;color:${col}">${deltaStr} ${escapeHTML(l.unit || 'kg')}</div>
          <div style="font-size:10px;color:var(--text3)">Qoldiq: ${l.newStock}${l.newStock === '∞' ? '' : ' ' + escapeHTML(l.unit || 'kg')}</div>
        </div>
      </div>
    `;
  }).join('');
}

async function sendWarehouseToTelegram() {
  const tgToken = state.settings.tgToken || atob('ODc5NjU4ODA3MTpBQUc4Wl9SOGhQOUVTWlpfM0x4VWFrRDhQQ1hqNUM1WlA2WQ==');
  const tgChatId = state.settings.tgChatId || '483325961';
  if (!tgToken || !tgChatId) {
    showToast('⚠️ Telegram sozlanmagan', 'error');
    return false;
  }
  const tracked = (PRODUCTS || []).filter(isProductTracked);
  if (!tracked.length) {
    showToast('ℹ️ Skladda hisobga olingan mahsulot yo\'q', 'info');
    return false;
  }
  const d = new Date();
  const totalKg = roundQty(tracked.reduce((s, p) => s + Math.max(0, Number(p.stock) || 0), 0));
  const lines = [
    `🏭 <b>SKLAD QOLDIG'I — ${d.toLocaleDateString('ru-RU')} ${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</b>`,
    ``
  ];
  tracked.forEach(p => {
    const st = getProductStockStatus(p);
    const icon = st === 'empty' ? '🔴' : (st === 'low' ? '⚠️' : '✅');
    lines.push(`${icon} ${p.emoji || '🥗'} ${escapeHTML(p.nameUz || p.name)}: <b>${roundQty(p.stock)} ${escapeHTML(p.unit || 'kg')}</b>`);
  });
  lines.push(``, `📦 <b>Jami qoldiq:</b> ${totalKg} kg`);
  try {
    const r = await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: tgChatId, text: lines.join('\n'), parse_mode: 'HTML' })
    });
    const res = await r.json();
    if (res.ok) {
      showToast('✅ Sklad hisoboti Telegramga yuborildi', 'success');
      return true;
    }
    showToast('❌ Telegram xatolik', 'error');
    return false;
  } catch (e) {
    showToast('❌ Tarmoq xatosi', 'error');
    return false;
  }
}

// ==================== AI UI CONTROL ENGINE ====================
const DEFAULT_UI_CONFIG = {
  aiUiAccess: true,
  themeVars: {},
  styles: {},
  renames: {},
  visibility: {},
  layout: {},
  tabOrder: null,
  customButtons: [],
  updatedAt: null
};

let aiUiConfig = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem('teegu_ui_config') || 'null');
    return saved && typeof saved === 'object' ? { ...cloneUiConfig(DEFAULT_UI_CONFIG), ...cloneUiConfig(saved) } : cloneUiConfig(DEFAULT_UI_CONFIG);
  } catch (e) {
    return cloneUiConfig(DEFAULT_UI_CONFIG);
  }
})();

let aiUiHistory = (() => {
  try {
    const h = JSON.parse(localStorage.getItem('teegu_ui_history') || '[]');
    return Array.isArray(h) ? h : [];
  } catch (e) {
    return [];
  }
})();

const ORIGINAL_UI_TEXTS = {};
const PROTECTED_UI_SELECTORS = [
  '#page-ai', '.tab[data-page="ai"]',
  '#page-settings', '.tab[data-page="settings"]',
  '#aiChatBox', '#aiUiInspectorModal', '#aiUiAccessToggle', '#loginOverlay'
];

function cloneUiConfig(cfg) {
  return JSON.parse(JSON.stringify(cfg || DEFAULT_UI_CONFIG));
}

function initAiUiController() {
  if (state && state.settings && state.settings.uiConfig) {
    syncUiConfigFromRemote(state.settings.uiConfig);
  } else {
    applySavedUiConfig();
    updateAiUiAccessButtons();
  }
}

function syncUiConfigFromRemote(remoteCfg) {
  if (!remoteCfg || typeof remoteCfg !== 'object') return;
  const remoteTs = Number(remoteCfg.updatedAt) || 0;
  const localTs = Number(aiUiConfig.updatedAt) || 0;
  if (remoteTs >= localTs || !localTs) {
    aiUiConfig = { ...cloneUiConfig(DEFAULT_UI_CONFIG), ...cloneUiConfig(remoteCfg) };
    try { localStorage.setItem('teegu_ui_config', JSON.stringify(aiUiConfig)); } catch (e) {}
    applySavedUiConfig();
    updateAiUiAccessButtons();
  }
}

function persistUiConfig(pushSnapshotBefore) {
  if (pushSnapshotBefore) {
    aiUiHistory.push(cloneUiConfig(pushSnapshotBefore));
    if (aiUiHistory.length > 10) aiUiHistory = aiUiHistory.slice(-10);
    try { localStorage.setItem('teegu_ui_history', JSON.stringify(aiUiHistory)); } catch (e) {}
  }
  aiUiConfig.updatedAt = Date.now();
  const clean = cloneUiConfig(aiUiConfig);
  try { localStorage.setItem('teegu_ui_config', JSON.stringify(clean)); } catch (e) {}
  try { db.collection('settings').doc('main').set({ uiConfig: clean }, { merge: true }); } catch (e) {}
}

function updateAiUiAccessButtons() {
  const enabled = aiUiConfig.aiUiAccess !== false;
  const isUz = lang === 'uz';
  const topBtn = document.getElementById('aiUiAccessToggle');
  if (topBtn) {
    topBtn.textContent = enabled
      ? (isUz ? '🎨 UI: ON' : '🎨 UI: ВКЛ')
      : (isUz ? '🔒 UI: OFF' : '🔒 UI: ВЫКЛ');
    if (topBtn.classList) {
      topBtn.classList.toggle('enabled', enabled);
      topBtn.classList.toggle('disabled', !enabled);
    }
  }
  const modalBtn = document.getElementById('uiModalToggleBtn');
  if (modalBtn) {
    modalBtn.textContent = enabled ? (isUz ? 'YOQILGAN' : 'ВКЛЮЧЕНО') : (isUz ? 'O\'CHIRILGAN' : 'ВЫКЛЮЧЕНО');
    if (modalBtn.classList) {
      modalBtn.classList.toggle('enabled', enabled);
      modalBtn.classList.toggle('disabled', !enabled);
    }
  }
  const sub = document.getElementById('uiAccessStatusSub');
  if (sub) {
    sub.textContent = enabled
      ? (isUz ? 'Yoqilgan — AI sizning buyrug\'ingiz bilan tugma va dizaynlarni tahrirlay oladi' : 'Включено — AI может редактировать кнопки и дизайн по вашей команде')
      : (isUz ? 'O\'chirilgan — AI faqat ma\'lumot beradi, tugmalarni o\'zgartira olmaydi' : 'Отключено — AI только отвечает на вопросы без изменения кнопок');
  }
}

function toggleAiUiAccess() {
  aiUiConfig.aiUiAccess = !(aiUiConfig.aiUiAccess !== false);
  persistUiConfig(null);
  updateAiUiAccessButtons();
  showToast(aiUiConfig.aiUiAccess
    ? (lang==='uz'?'🎨 AI UI dostup yoqildi':'🎨 Доступ AI к UI включён')
    : (lang==='uz'?'🔒 AI UI dostup o\'chirildi':'🔒 Доступ AI к UI отключён'), 'info');
}

function buildUiContext() {
  return {
    aiUiAccess: aiUiConfig.aiUiAccess !== false,
    activeConfig: {
      themeVars: aiUiConfig.themeVars || {},
      styledSelectors: Object.keys(aiUiConfig.styles || {}),
      renames: aiUiConfig.renames || {},
      hiddenSelectors: Object.keys(aiUiConfig.visibility || {}).filter(k => aiUiConfig.visibility[k] === false),
      layout: aiUiConfig.layout || {},
      tabOrder: aiUiConfig.tabOrder || PAGE_ORDER,
      customButtons: aiUiConfig.customButtons || []
    },
    availableSelectors: {
      adminButtons: ['#submitBtn', '#btnHeaderAi', '#btnHeaderPending', '#btnHeaderSettings', '#btnNewClientQuick', '#btnTemplates', '#btnSaveTemplate', '#btnResetOrder', '#dashQuickOrderBtn', '#dashQuickWarehouseBtn', '#dashQuickReportBtn', '#btnOptimizeDelivery', '#btnSendDaySummary', '#btnAddClient', '#btnBroadcast', '#btnExportExcel', '#btnBroadcastPrice', '#btnAddProduct', '#btnWarehouseBatch', '#btnWarehouseTg', '#aiSendBtn'],
      adminContainers: ['#productsGrid', '#tabsBar', '.card', '.kpi-card', '.product-card', '.wh-card', '.btn-primary', '.btn-outline', '.tab'],
      tabs: ['.tab[data-page="dashboard"]', '.tab[data-page="new-order"]', '.tab[data-page="orders"]', '.tab[data-page="debts"]', '.tab[data-page="delivery"]', '.tab[data-page="warehouse"]', '.tab[data-page="clients"]', '.tab[data-page="stats"]', '.tab[data-page="products"]', '.tab[data-page="map"]'],
      otherApps: ['#agentSubmitBtn (scope:"agent")', '#courierOptimizeBtn (scope:"courier")', '#btnOrder (scope:"client")', '#checkoutSubmitBtn (scope:"client")']
    }
  };
}

function sanitizeCssProp(prop) {
  if (!prop || typeof prop !== 'string') return '';
  const trimmed = prop.trim();
  const kebab = trimmed.startsWith('--') ? trimmed : trimmed.replace(/[A-Z]/g, m => '-' + m.toLowerCase()).toLowerCase();
  return /^(--)?[a-z][a-z0-9-]{1,45}$/.test(kebab) ? kebab : '';
}

function sanitizeCssValue(val) {
  if (val === null || val === undefined) return '';
  const s = String(val).trim();
  if (!s || s.length > 200) return '';
  if (/javascript:|vbscript:|expression\s*\(|@import|url\s*\(|<|>|\{|\}|;/i.test(s)) return '';
  return s;
}

function isSafeUiSelector(sel, isHideAction = false) {
  if (!sel || typeof sel !== 'string') return false;
  const s = sel.trim();
  if (!s || s.length > 120 || /[<>;{}\\]/.test(s)) return false;
  const low = s.toLowerCase();
  if (isHideAction && PROTECTED_UI_SELECTORS.some(p => low === p.toLowerCase() || low.includes(p.toLowerCase()))) {
    return false;
  }
  return true;
}

function applyUiActions(actions) {
  if (!Array.isArray(actions) || !actions.length) return [];
  if (aiUiConfig.aiUiAccess === false) return [];

  const prevSnapshot = cloneUiConfig(aiUiConfig);
  const applied = [];

  for (const act of actions) {
    if (!act || typeof act !== 'object') continue;
    const t = act.type;
    const scope = act.scope || 'admin';

    if (t === 'set_theme' && act.vars && typeof act.vars === 'object') {
      aiUiConfig.themeVars = aiUiConfig.themeVars || {};
      let count = 0;
      Object.entries(act.vars).forEach(([k, v]) => {
        if (!/^--[a-zA-Z0-9-]{2,32}$/.test(k)) return;
        const sv = sanitizeCssValue(v);
        if (sv) {
          aiUiConfig.themeVars[k] = sv;
          count++;
        }
      });
      if (count) applied.push(`Tema ranglari (${count} ta o'zgaruvchi)`);
    } else if (t === 'style_element' && isSafeUiSelector(act.selector) && act.styles && typeof act.styles === 'object') {
      const sel = act.selector.trim();
      aiUiConfig.styles = aiUiConfig.styles || {};
      const cur = aiUiConfig.styles[sel] || {};
      const nextProps = { ...(cur.props || {}) };
      let count = 0;
      Object.entries(act.styles).forEach(([k, v]) => {
        const pk = sanitizeCssProp(k);
        const sv = sanitizeCssValue(v);
        if (pk && sv) {
          nextProps[pk] = sv;
          count++;
        }
      });
      if (count) {
        aiUiConfig.styles[sel] = { scope, props: nextProps };
        applied.push(`${sel} uslubi (${count} xossa)`);
      }
    } else if (t === 'rename_element' && isSafeUiSelector(act.selector) && typeof act.text === 'string') {
      const sel = act.selector.trim();
      const txt = act.text.trim().slice(0, 80);
      if (txt) {
        aiUiConfig.renames = aiUiConfig.renames || {};
        aiUiConfig.renames[sel] = { text: txt, scope };
        applied.push(`"${txt}" deb nomlandi (${sel})`);
      }
    } else if (t === 'set_visibility') {
      const vis = act.visible !== false;
      if (isSafeUiSelector(act.selector, !vis)) {
        const sel = act.selector.trim();
        aiUiConfig.visibility = aiUiConfig.visibility || {};
        if (vis) delete aiUiConfig.visibility[sel];
        else aiUiConfig.visibility[sel] = false;
        applied.push(`${sel}: ${vis ? 'ko\'rsatildi' : 'yashirildi'}`);
      }
    } else if (t === 'set_layout') {
      aiUiConfig.layout = aiUiConfig.layout || {};
      if (act.columns !== undefined) {
        const cols = Math.min(4, Math.max(1, parseInt(act.columns, 10) || 2));
        aiUiConfig.layout.columns = cols;
        applied.push(`Grid ustunlari: ${cols} ta`);
      }
      if (act.fontScale !== undefined) {
        const fs = Math.min(1.35, Math.max(0.85, parseFloat(act.fontScale) || 1));
        aiUiConfig.layout.fontScale = fs;
        applied.push(`Shrift masshtabi: ${Math.round(fs * 100)}%`);
      }
      if (act.radius !== undefined) {
        const sr = sanitizeCssValue(act.radius);
        if (sr) {
          aiUiConfig.layout.radius = sr;
          applied.push(`Burchak yumaloqligi: ${sr}`);
        }
      }
    } else if (t === 'reorder_tabs' && Array.isArray(act.order) && act.order.length) {
      const cleanOrder = act.order.map(x => String(x).trim()).filter(Boolean);
      if (cleanOrder.length) {
        aiUiConfig.tabOrder = cleanOrder;
        applied.push(`Tablar tartibi yangilandi`);
      }
    } else if (t === 'add_custom_button' && act.label && act.action) {
      const actionStr = String(act.action).trim();
      if (/^(navigate:|openModal:|call:|ai:)/.test(actionStr)) {
        aiUiConfig.customButtons = aiUiConfig.customButtons || [];
        const id = String(act.id || ('cbtn_' + Date.now())).replace(/[^a-zA-Z0-9_-]/g, '');
        const page = ['dashboard', 'new-order', 'orders', 'warehouse'].includes(act.page) ? act.page : 'dashboard';
        const color = sanitizeCssValue(act.color || '') || 'var(--accent)';
        const btnObj = { id, page, label: String(act.label).trim().slice(0, 50), action: actionStr, color };
        aiUiConfig.customButtons = aiUiConfig.customButtons.filter(b => b.id !== id).concat(btnObj);
        applied.push(`Yangi tugma: "${btnObj.label}" (${page})`);
      }
    } else if (t === 'remove_custom_button' && act.id) {
      aiUiConfig.customButtons = (aiUiConfig.customButtons || []).filter(b => b.id !== act.id);
      applied.push(`Maxsus tugma o'chirildi (${act.id})`);
    } else if (t === 'navigate' && act.page) {
      try { showPage(String(act.page)); } catch (e) {}
      applied.push(`Sahifa ochildi: ${act.page}`);
    } else if (t === 'reset_ui') {
      aiUiConfig = { ...cloneUiConfig(DEFAULT_UI_CONFIG), aiUiAccess: aiUiConfig.aiUiAccess !== false };
      applied.push(`Barcha interfeys sozlamalari asl holiga qaytarildi`);
      break;
    }
  }

  if (applied.length) {
    persistUiConfig(prevSnapshot);
    applySavedUiConfig();
  }
  return applied;
}

const VALID_AI_UI_TYPES = new Set([
  'set_theme', 'style_element', 'rename_element', 'set_visibility',
  'set_layout', 'reorder_tabs', 'add_custom_button', 'remove_custom_button',
  'navigate', 'reset_ui'
]);

function extractAndApplyUiActions(rawText) {
  if (!rawText || typeof rawText !== 'string') return { cleanText: '', applied: [], blocked: false };
  let cleanText = rawText;
  let parsedActions = null;

  const tagRe = /<<<UI_ACTIONS>>>([\s\S]*?)(?:<<<END_UI_ACTIONS>>>|$)/i;
  const m = rawText.match(tagRe);
  if (m && m[1]) {
    cleanText = rawText.replace(tagRe, '').trim();
    const cleanedJson = m[1].trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    try {
      const obj = JSON.parse(cleanedJson);
      if (obj && Array.isArray(obj.actions)) parsedActions = obj.actions;
    } catch (e) {}
  } else {
    const codeRe = /```(?:json)?\s*(\{[\s\S]*?"actions"\s*:\s*\[[\s\S]*?\][\s\S]*?\})\s*```/i;
    const cm = rawText.match(codeRe);
    if (cm && cm[1]) {
      try {
        const obj = JSON.parse(cm[1]);
        if (obj && Array.isArray(obj.actions) && obj.actions.some(a => a && VALID_AI_UI_TYPES.has(a.type))) {
          parsedActions = obj.actions;
          cleanText = rawText.replace(codeRe, '').trim();
        }
      } catch (e) {}
    }
  }

  if (!parsedActions || !parsedActions.length) {
    return { cleanText, applied: [], blocked: false };
  }
  if (aiUiConfig.aiUiAccess === false) {
    return { cleanText, applied: [], blocked: true };
  }
  const applied = applyUiActions(parsedActions);
  return { cleanText, applied, blocked: false };
}

function applySavedUiConfig() {
  const cfg = aiUiConfig || DEFAULT_UI_CONFIG;
  const cssLines = [];

  // Theme vars
  const themeEntries = Object.entries(cfg.themeVars || {});
  const rootRules = [];
  themeEntries.forEach(([k, v]) => {
    rootRules.push(`${k}: ${v} !important;`);
    if (typeof document !== 'undefined' && document.documentElement && document.documentElement.style && typeof document.documentElement.style.setProperty === 'function') {
      document.documentElement.style.setProperty(k, v);
    }
  });
  if (cfg.layout && cfg.layout.radius) {
    rootRules.push(`--r: ${cfg.layout.radius} !important;`);
    rootRules.push(`--r2: ${cfg.layout.radius} !important;`);
  }
  if (rootRules.length) {
    cssLines.push(`:root { ${rootRules.join(' ')} }`);
  }

  // Layout overrides
  if (cfg.layout && cfg.layout.columns) {
    cssLines.push(`.products-grid { grid-template-columns: repeat(${cfg.layout.columns}, 1fr) !important; }`);
  }
  if (cfg.layout && cfg.layout.fontScale) {
    cssLines.push(`body { font-size: ${Math.round(14 * cfg.layout.fontScale)}px !important; }`);
  }

  // Element styles (for admin or all)
  Object.entries(cfg.styles || {}).forEach(([sel, entry]) => {
    if (!entry) return;
    const sc = entry.scope || 'admin';
    if (sc !== 'all' && sc !== 'admin') return;
    const props = entry.props || entry;
    const decls = Object.entries(props)
      .filter(([pk, pv]) => pk !== 'scope' && pv !== undefined && pv !== '')
      .map(([pk, pv]) => `${pk}: ${pv} !important;`);
    if (decls.length) cssLines.push(`${sel} { ${decls.join(' ')} }`);
  });

  // Visibility overrides
  Object.entries(cfg.visibility || {}).forEach(([sel, visible]) => {
    if (visible === false && isSafeUiSelector(sel, true)) {
      cssLines.push(`${sel} { display: none !important; }`);
    }
  });

  if (typeof document !== 'undefined') {
    let styleEl = document.getElementById('teeguAiCustomStyles');
    if (!styleEl && document.head && typeof document.createElement === 'function') {
      styleEl = document.createElement('style');
      styleEl.id = 'teeguAiCustomStyles';
      if (typeof document.head.appendChild === 'function') document.head.appendChild(styleEl);
    }
    if (styleEl) styleEl.textContent = cssLines.join('\n');
  }

  applyTabOrder();
  applySavedUiRenames();
  renderCustomUiButtons();
}

function applyTabOrder() {
  const order = aiUiConfig && Array.isArray(aiUiConfig.tabOrder) ? aiUiConfig.tabOrder : null;
  if (!order || typeof document === 'undefined') return;
  const bar = document.getElementById('tabsBar');
  if (!bar || !bar.children || typeof bar.appendChild !== 'function') return;
  const children = Array.from(bar.children);
  if (!children.length) return;
  order.forEach(page => {
    const tab = children.find(el => el && el.dataset && el.dataset.page === page);
    if (tab) bar.appendChild(tab);
  });
}

function applySavedUiRenames() {
  if (typeof document === 'undefined') return;
  const renames = (aiUiConfig && aiUiConfig.renames) || {};
  Object.entries(renames).forEach(([sel, entry]) => {
    const val = typeof entry === 'string' ? entry : (entry && entry.text);
    const sc = typeof entry === 'object' && entry ? (entry.scope || 'admin') : 'admin';
    if (!val || (sc !== 'all' && sc !== 'admin')) return;
    try {
      const el = document.querySelector(sel);
      if (!el) return;
      if (!ORIGINAL_UI_TEXTS[sel]) {
        ORIGINAL_UI_TEXTS[sel] = el.textContent || el.innerText || '';
      }
      el.textContent = val;
    } catch (e) {}
  });
}

function renderCustomUiButtons() {
  if (typeof document === 'undefined') return;
  const btns = (aiUiConfig && Array.isArray(aiUiConfig.customButtons)) ? aiUiConfig.customButtons : [];
  ['dashboard', 'new-order', 'orders', 'warehouse'].forEach(page => {
    const wrap = document.getElementById('customBtns-' + page);
    if (!wrap) return;
    const pageBtns = btns.filter(b => b.page === page);
    if (!pageBtns.length) {
      wrap.innerHTML = '';
      return;
    }
    wrap.innerHTML = pageBtns.map(b => {
      const bg = b.color ? `background:${escapeAttr(b.color)};border-color:transparent;color:#fff;` : '';
      return `<button class="ai-custom-btn" style="${bg}" data-btn-id="${escapeAttr(b.id)}" onclick="executeCustomUiButtonAction(this.dataset.btnId)">${escapeHTML(b.label)}</button>`;
    }).join('');
  });
}

const ALLOWED_UI_CALLS = {
  sendDaySummary: () => typeof sendDaySummary === 'function' && sendDaySummary(),
  sendWarehouseToTelegram: () => typeof sendWarehouseToTelegram === 'function' && sendWarehouseToTelegram(),
  openWarehouseBatchModal: () => typeof openWarehouseBatchModal === 'function' && openWarehouseBatchModal(),
  exportToExcel: () => typeof exportToExcel === 'function' && exportToExcel(),
  openBroadcastModal: () => typeof openBroadcastModal === 'function' && openBroadcastModal(),
  openPriceBroadcastModal: () => typeof openBroadcastModal === 'function' && openBroadcastModal('pricelist'),
  optimizeAdminDeliveryRoute: () => typeof optimizeAdminDeliveryRoute === 'function' && optimizeAdminDeliveryRoute(),
  optimizeDeliveryOrder: () => typeof optimizeAdminDeliveryRoute === 'function' && optimizeAdminDeliveryRoute(),
  openDriveModeModal: () => typeof openDriveModeModal === 'function' && openDriveModeModal(),
  undoLastUiChange: () => undoLastUiChange(),
  openUiInspectorModal: () => openUiInspectorModal()
};

function executeCustomUiButtonAction(btnId) {
  const b = (aiUiConfig.customButtons || []).find(x => x.id === btnId);
  if (!b || !b.action) return;
  const act = String(b.action);
  if (act.startsWith('navigate:')) {
    showPage(act.slice(9).trim());
  } else if (act.startsWith('openModal:')) {
    openModal(act.slice(10).trim());
  } else if (act.startsWith('call:')) {
    const fnName = act.slice(5).trim();
    if (ALLOWED_UI_CALLS[fnName]) ALLOWED_UI_CALLS[fnName]();
  } else if (act.startsWith('ai:')) {
    showPage('ai');
    sendAiUserMessage(act.slice(3).trim());
  }
}

function undoLastUiChange() {
  if (!aiUiHistory.length) {
    showToast(lang === 'uz' ? 'Qaytariladigan o\'zgarish yo\'q' : 'Нет изменений для отмены', 'info');
    return false;
  }
  const prev = aiUiHistory.pop();
  try { localStorage.setItem('teegu_ui_history', JSON.stringify(aiUiHistory)); } catch (e) {}

  // Restore any renamed elements whose rename was removed in prev
  const curRenames = aiUiConfig.renames || {};
  const prevRenames = (prev && prev.renames) || {};
  Object.keys(curRenames).forEach(sel => {
    if (!prevRenames[sel] && ORIGINAL_UI_TEXTS[sel] !== undefined) {
      try {
        const el = document.querySelector(sel);
        if (el) el.textContent = ORIGINAL_UI_TEXTS[sel];
      } catch (e) {}
    }
  });

  aiUiConfig = { ...cloneUiConfig(DEFAULT_UI_CONFIG), ...(prev ? cloneUiConfig(prev) : {}), aiUiAccess: aiUiConfig.aiUiAccess !== false };
  persistUiConfig(null);
  applySavedUiConfig();
  updateAiUiAccessButtons();
  renderUiInspector();
  showToast('↩️ Oxirgi UI o\'zgarishi bekor qilindi', 'success');
  return true;
}

function resetUiConfig() {
  const prev = cloneUiConfig(aiUiConfig);
  Object.keys(ORIGINAL_UI_TEXTS).forEach(sel => {
    try {
      const el = document.querySelector(sel);
      if (el) el.textContent = ORIGINAL_UI_TEXTS[sel];
    } catch (e) {}
  });
  if (typeof document !== 'undefined' && document.documentElement && document.documentElement.style && typeof document.documentElement.style.removeProperty === 'function') {
    Object.keys(aiUiConfig.themeVars || {}).forEach(k => document.documentElement.style.removeProperty(k));
    document.documentElement.style.removeProperty('--r');
    document.documentElement.style.removeProperty('--r2');
  }
  aiUiConfig = { ...cloneUiConfig(DEFAULT_UI_CONFIG), aiUiAccess: aiUiConfig.aiUiAccess !== false };
  persistUiConfig(prev);
  applySavedUiConfig();
  try { applyLang(); } catch (e) {}
  renderUiInspector();
  showToast('🗑️ Interfeys zavod holatiga qaytarildi', 'success');
}

function openUiInspectorModal() {
  updateAiUiAccessButtons();
  renderUiInspector();
  openModal('aiUiInspectorModal');
}

function renderUiInspector() {
  const el = document.getElementById('aiUiChangesList');
  if (!el) return;
  const rows = [];
  Object.entries(aiUiConfig.themeVars || {}).forEach(([k, v]) => {
    rows.push({ cat: 'themeVars', key: k, label: `🎨 Tema ${k}: ${v}` });
  });
  Object.entries(aiUiConfig.styles || {}).forEach(([sel, entry]) => {
    rows.push({ cat: 'styles', key: sel, label: `✨ Uslub: ${sel} (${Object.keys(entry.props || entry || {}).length} xossa)` });
  });
  Object.entries(aiUiConfig.renames || {}).forEach(([sel, entry]) => {
    const t = typeof entry === 'string' ? entry : (entry && entry.text);
    rows.push({ cat: 'renames', key: sel, label: `🏷️ Nom (${sel}) → "${t}"` });
  });
  Object.entries(aiUiConfig.visibility || {}).forEach(([sel, vis]) => {
    if (vis === false) rows.push({ cat: 'visibility', key: sel, label: `🙈 Yashirilgan: ${sel}` });
  });
  if (aiUiConfig.layout && Object.keys(aiUiConfig.layout).length) {
    rows.push({ cat: 'layout', key: 'all', label: `📐 Joylashuv: ${JSON.stringify(aiUiConfig.layout)}` });
  }
  if (Array.isArray(aiUiConfig.tabOrder)) {
    rows.push({ cat: 'tabOrder', key: 'all', label: `🔀 Tablar tartibi o'zgartirilgan` });
  }
  (aiUiConfig.customButtons || []).forEach(b => {
    rows.push({ cat: 'customButtons', key: b.id, label: `🔘 Tugma (${b.page}): "${b.label}"` });
  });

  if (!rows.length) {
    el.innerHTML = `<div style="font-size:12px;color:var(--text3);padding:10px 0">${lang==='uz'?'Hozircha interfeys o\'zgartirilmagan (standart ko\'rinish)':'Пока нет активных изменений интерфейса'}</div>`;
    return;
  }
  el.innerHTML = rows.map(r => `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 9px;background:var(--bg2);border:1px solid var(--border);border-radius:10px;margin-bottom:6px;font-size:12px">
      <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHTML(r.label)}</span>
      <button class="chip" style="margin:0;padding:3px 8px;font-size:11px;color:var(--danger)" data-cat="${escapeAttr(r.cat)}" data-key="${escapeAttr(r.key)}" onclick="revertSingleUiItem(this.dataset.cat,this.dataset.key)">✕</button>
    </div>
  `).join('');
}

function revertSingleUiItem(cat, key) {
  const prev = cloneUiConfig(aiUiConfig);
  if (cat === 'themeVars' && aiUiConfig.themeVars) {
    if (typeof document !== 'undefined' && document.documentElement && document.documentElement.style && typeof document.documentElement.style.removeProperty === 'function') {
      document.documentElement.style.removeProperty(key);
    }
    delete aiUiConfig.themeVars[key];
  } else if (cat === 'styles' && aiUiConfig.styles) {
    delete aiUiConfig.styles[key];
  } else if (cat === 'renames' && aiUiConfig.renames) {
    if (ORIGINAL_UI_TEXTS[key] !== undefined) {
      try {
        const el = document.querySelector(key);
        if (el) el.textContent = ORIGINAL_UI_TEXTS[key];
      } catch (e) {}
    }
    delete aiUiConfig.renames[key];
  } else if (cat === 'visibility' && aiUiConfig.visibility) {
    delete aiUiConfig.visibility[key];
  } else if (cat === 'layout') {
    aiUiConfig.layout = {};
  } else if (cat === 'tabOrder') {
    aiUiConfig.tabOrder = null;
  } else if (cat === 'customButtons') {
    aiUiConfig.customButtons = (aiUiConfig.customButtons || []).filter(b => b.id !== key);
  }
  persistUiConfig(prev);
  applySavedUiConfig();
  renderUiInspector();
  showToast('↩️ Tanlangan o\'zgarish bekor qilindi', 'info');
}

// ==================== TWO-WAY VOICE ASSISTANT (GEMINI NEURAL UZ/RU TTS + STT) ====================
let aiAutoSpeak = false;
try { aiAutoSpeak = localStorage.getItem('teegu_ai_auto_speak') === 'true'; } catch (e) {}
let aiVoiceLang = 'uz-UZ';
try {
  const savedVL = localStorage.getItem('teegu_ai_voice_lang');
  if (savedVL === 'uz-UZ' || savedVL === 'ru-RU' || savedVL === 'auto') aiVoiceLang = savedVL;
} catch (e) {}
let aiSpeakingIdx = -1;
let lastInputWasVoice = false;
let aiSpeechSessionId = 0;
let aiActiveAudio = null;
let aiSharedAudioEl = null;
const aiTtsCache = new Map();
const geminiMicState = { active: false, mode: null, recorder: null, stream: null, chunks: [], mimeType: 'audio/webm', recLang: 'uz-UZ' };

function getVoiceRecognitionLang() {
  if (aiVoiceLang === 'uz-UZ') return 'uz-UZ';
  if (aiVoiceLang === 'ru-RU') return 'ru-RU';
  return lang === 'uz' ? 'uz-UZ' : 'ru-RU';
}

function detectSpeechLanguage(text) {
  const s = String(text || '').trim();
  if (!s) return aiVoiceLang === 'ru-RU' ? 'ru' : (lang === 'uz' ? 'uz' : 'ru');
  if (/[ўқғҳЎҚҒҲ]/.test(s)) return 'uz';
  if (/\b(so'm|so‘m|soʻm|summa|bugun|ertaga|mijoz|buyurtma|qarz|qarzdor|sklad|qoldiq|mahsulot|foyda|daromad|xarajat|yo'q|kerak|tayyor|yetkazish|salom|xo'p|naqd|qisman|sotildi|jami|o'rtacha)\b/i.test(s) || /(?:o['‘’ʻ`]|g['‘’ʻ`])/i.test(s)) {
    return 'uz';
  }
  const cyrCount = (s.match(/[а-яА-ЯёЁ]/g) || []).length;
  const latCount = (s.match(/[a-zA-Z]/g) || []).length;
  if (cyrCount > latCount && cyrCount > 2) return 'ru';
  if (latCount > 0) return 'uz';
  return aiVoiceLang === 'ru-RU' ? 'ru' : (lang === 'uz' ? 'uz' : 'ru');
}

function getEffectiveSpeechLang(text) {
  const detected = detectSpeechLanguage(text);
  if (aiVoiceLang === 'auto') return detected;
  if (/[ўқғҳЎҚҒҲ]/.test(text || '')) return 'uz';
  if (aiVoiceLang === 'uz-UZ') {
    const cyrCount = (String(text || '').match(/[а-яА-ЯёЁ]/g) || []).length;
    const latCount = (String(text || '').match(/[a-zA-Z]/g) || []).length;
    return cyrCount > latCount * 2 && cyrCount > 6 ? 'ru' : 'uz';
  }
  return detected;
}

function updateAiVoiceLangButtons() {
  const label = aiVoiceLang === 'uz-UZ'
    ? (lang === 'uz' ? '🇺🇿 UZ Ovoz' : '🇺🇿 УЗ Голос')
    : (aiVoiceLang === 'ru-RU'
      ? (lang === 'uz' ? '🇷🇺 RU Ovoz' : '🇷🇺 РУ Голос')
      : (lang === 'uz' ? '🌐 Avto Ovoz' : '🌐 Авто Голос'));
  ['aiVoiceLangBtn', 'driveVoiceLangBtn'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = label;
    el.classList.toggle('active', aiVoiceLang === 'uz-UZ');
  });
}

function cycleAiVoiceLang() {
  aiVoiceLang = aiVoiceLang === 'uz-UZ' ? 'ru-RU' : (aiVoiceLang === 'ru-RU' ? 'auto' : 'uz-UZ');
  try { localStorage.setItem('teegu_ai_voice_lang', aiVoiceLang); } catch (e) {}
  updateAiVoiceLangButtons();
  stopAiSpeech();
  const msg = aiVoiceLang === 'uz-UZ'
    ? (lang === 'uz' ? '🇺🇿 Ovoz tili: O\'zbekcha (uz-UZ)' : '🇺🇿 Язык голоса: Узбекский (uz-UZ)')
    : (aiVoiceLang === 'ru-RU'
      ? (lang === 'uz' ? '🇷🇺 Ovoz tili: Ruscha (ru-RU)' : '🇷🇺 Язык голоса: Русский (ru-RU)')
      : (lang === 'uz' ? '🌐 Ovoz tili: Avtomatik' : '🌐 Язык голоса: Авто'));
  showToast(msg, 'info');
}

function cleanTextForSpeech(rawText) {
  return String(rawText || '')
    .replace(/<<<UI_ACTIONS>>>[\s\S]*?(?:<<<END_UI_ACTIONS>>>|$)/g, ' ')
    .replace(/<<<BIZ_RULES>>>[\s\S]*?(?:<<<END_BIZ_RULES>>>|$)/g, ' ')
    .replace(/<<<SIM_SCENARIO>>>[\s\S]*?(?:<<<END_SIM_SCENARIO>>>|$)/g, ' ')
    .replace(/<<<VOICE_ORDER>>>[\s\S]*?(?:<<<END_VOICE_ORDER>>>|$)/g, ' ')
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\|\s*[:\-]{2,}[\s|:-]*/g, ' ')
    .replace(/[-_=]{3,}/g, ' ')
    .replace(/[ʻ’‘]/g, "'")
    .replace(/[\*#_`~|>]/g, ' ')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function latinUzbekToRussianPhonetic(text) {
  let s = String(text || '')
    .replace(/ў/g, 'у').replace(/Ў/g, 'У')
    .replace(/қ/g, 'к').replace(/Қ/g, 'К')
    .replace(/ғ/g, 'г').replace(/Ғ/g, 'Г')
    .replace(/ҳ/g, 'х').replace(/Ҳ/g, 'Х')
    .replace(/[ʻ’‘`]/g, "'")
    .replace(/so'm/gi, 'сум')
    .replace(/o'/gi, 'у')
    .replace(/g'/gi, 'г')
    .replace(/sh/gi, 'ш')
    .replace(/ch/gi, 'ч')
    .replace(/yo/gi, 'ё')
    .replace(/yu/gi, 'ю')
    .replace(/ya/gi, 'я')
    .replace(/ye/gi, 'е')
    .replace(/ng/gi, 'нг')
    .replace(/'/g, '');
  const map = { a:'а', b:'б', c:'к', d:'д', e:'э', f:'ф', g:'г', h:'х', i:'и', j:'дж', k:'к', l:'л', m:'м', n:'н', o:'о', p:'п', q:'к', r:'р', s:'с', t:'т', u:'у', v:'в', w:'в', x:'х', y:'й', z:'з' };
  return s.replace(/[a-zA-Z]/g, ch => map[ch.toLowerCase()] || ch);
}

function getGeminiCandidateKeys() {
  const keys = [];
  const primary = typeof getGeminiApiKey === 'function' ? getGeminiApiKey() : '';
  const defKey = typeof DEFAULT_GEMINI_API_KEY !== 'undefined' ? DEFAULT_GEMINI_API_KEY : '';
  if (primary) keys.push(primary);
  if (defKey && !keys.includes(defKey)) keys.push(defKey);
  return keys;
}

function extractGeminiAudioFromResponse(data) {
  if (!data || typeof data !== 'object') return null;
  const steps = Array.isArray(data.steps) ? data.steps : [];
  for (let i = steps.length - 1; i >= 0; i--) {
    const st = steps[i];
    if (st && (st.type === 'model_output' || !st.type) && Array.isArray(st.content)) {
      for (let j = st.content.length - 1; j >= 0; j--) {
        const c = st.content[j];
        if (c && c.type === 'audio' && c.data) {
          return { data: c.data, mimeType: c.mime_type || 'audio/wav', sampleRate: c.sample_rate || 24000 };
        }
      }
    }
  }
  const outputs = Array.isArray(data.outputs) ? data.outputs : [];
  for (let j = outputs.length - 1; j >= 0; j--) {
    const c = outputs[j];
    if (c && c.type === 'audio' && c.data) {
      return { data: c.data, mimeType: c.mime_type || 'audio/wav', sampleRate: c.sample_rate || 24000 };
    }
  }
  const parts = data.candidates?.[0]?.content?.parts || [];
  for (let k = parts.length - 1; k >= 0; k--) {
    const p = parts[k];
    if (p && p.inlineData && p.inlineData.data) {
      return { data: p.inlineData.data, mimeType: p.inlineData.mimeType || 'audio/wav', sampleRate: 24000 };
    }
  }
  return null;
}

function extractGeminiTextFromResponse(data) {
  if (!data || typeof data !== 'object') return '';
  if (typeof data.output_text === 'string' && data.output_text.trim()) return data.output_text.trim();
  const out = [];
  (Array.isArray(data.steps) ? data.steps : []).forEach(st => {
    if (st && (st.type === 'model_output' || !st.type) && Array.isArray(st.content)) {
      st.content.forEach(c => { if (c && c.type === 'text' && c.text) out.push(c.text); });
    }
  });
  if (out.length) return out.join(' ').trim();
  (Array.isArray(data.outputs) ? data.outputs : []).forEach(c => {
    if (c && c.type === 'text' && c.text) out.push(c.text);
  });
  if (out.length) return out.join(' ').trim();
  return (data.candidates?.[0]?.content?.parts || []).map(p => p?.text || '').join(' ').trim();
}

function wrapPcmToWav(pcmBytes, sampleRate = 24000) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const wav = new Uint8Array(44 + pcmBytes.length);
  const view = new DataView(wav.buffer);
  const writeStr = (off, str) => { for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i)); };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + pcmBytes.length, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, 'data');
  view.setUint32(40, pcmBytes.length, true);
  wav.set(pcmBytes, 44);
  return wav;
}

function buildAudioPlayableUrl(base64Data, mimeType = 'audio/wav', sampleRate = 24000) {
  if (typeof atob === 'function' && typeof Blob !== 'undefined' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
    const bin = atob(base64Data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const isRiff = bytes.length >= 4 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
    const finalBytes = (!isRiff && /l16|pcm/i.test(mimeType)) ? wrapPcmToWav(bytes, sampleRate) : bytes;
    const blobType = (!isRiff && /l16|pcm/i.test(mimeType)) ? 'audio/wav' : (mimeType || 'audio/wav');
    return { url: URL.createObjectURL(new Blob([finalBytes], { type: blobType })), isObjectUrl: true };
  }
  return { url: `data:${mimeType || 'audio/wav'};base64,${base64Data}`, isObjectUrl: false };
}

function unlockAiAudioPlayback() {
  if (typeof Audio === 'undefined') return;
  try {
    if (!aiSharedAudioEl) aiSharedAudioEl = new Audio();
  } catch (e) {}
}

async function synthesizeSpeechWithGemini(text, targetLang) {
  if (typeof fetch !== 'function') return null;
  const keys = getGeminiCandidateKeys();
  if (!keys.length) return null;

  const trimmedText = text.length > 1400 ? (text.slice(0, 1400).replace(/\s+\S*$/, '') || text.slice(0, 1400)) : text;
  const cacheKey = `${targetLang}::${trimmedText}`;
  if (aiTtsCache.has(cacheKey)) return aiTtsCache.get(cacheKey);

  const models = ['gemini-3.8-flash-lite-tts', 'gemini-3.8-flash-tts'];
  const speechStyle = targetLang === 'uz'
    ? 'Clear, natural, warm Northern Uzbek pronunciation at a steady conversational pace'
    : 'Clear, natural, warm Russian pronunciation at a steady conversational pace';
  const voiceName = targetLang === 'uz' ? 'Sulafat' : 'Kore';

  for (const activeKey of keys) {
    for (const model of models) {
      let timer = null;
      try {
        const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        if (ctrl) timer = setTimeout(() => ctrl.abort(), 18000);
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/interactions?key=${encodeURIComponent(activeKey)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: ctrl ? ctrl.signal : undefined,
            body: JSON.stringify({
              model,
              input: [{
                type: 'user_input',
                content: [{
                  type: 'text',
                  text: trimmedText,
                  annotations: [{ type: 'speech_metadata', style: speechStyle }]
                }]
              }],
              response_format: { type: 'audio' },
              generation_config: { speech_config: [{ voice: voiceName }] }
            })
          }
        );
        if (timer) clearTimeout(timer);
        if (!res.ok) continue;
        const json = await res.json();
        const audio = extractGeminiAudioFromResponse(json);
        if (audio && audio.data) {
          const playable = buildAudioPlayableUrl(audio.data, audio.mimeType, audio.sampleRate);
          if (aiTtsCache.size >= 20) {
            const firstKey = aiTtsCache.keys().next().value;
            const old = aiTtsCache.get(firstKey);
            if (old && old.isObjectUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
              try { URL.revokeObjectURL(old.url); } catch (e) {}
            }
            aiTtsCache.delete(firstKey);
          }
          aiTtsCache.set(cacheKey, playable);
          return playable;
        }
      } catch (e) {
        if (timer) clearTimeout(timer);
      }
    }
  }
  return null;
}

function speakViaBrowserSpeechSynthesis(clean, targetLang, idx, sessionId) {
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
  const Utter = typeof SpeechSynthesisUtterance !== 'undefined'
    ? SpeechSynthesisUtterance
    : (typeof window !== 'undefined' ? window.SpeechSynthesisUtterance : null);
  if (!synth || typeof synth.speak !== 'function' || !Utter) {
    if (sessionId === aiSpeechSessionId) {
      aiSpeakingIdx = -1;
      renderAiPage();
      showToast(lang === 'uz' ? 'Brauzerda ovozli o\'qish mavjud emas' : 'Озвучка не поддерживается браузером', 'info');
    }
    return false;
  }

  try { if (typeof synth.cancel === 'function') synth.cancel(); } catch (e) {}
  let spokenText = clean;
  let utterLang = targetLang === 'uz' ? 'uz-UZ' : 'ru-RU';
  let chosenVoice = null;
  try {
    const voices = typeof synth.getVoices === 'function' ? (synth.getVoices() || []) : [];
    const exactUz = voices.find(v => v && v.lang && v.lang.toLowerCase().startsWith('uz'));
    const exactRu = voices.find(v => v && v.lang && v.lang.toLowerCase().startsWith('ru'));
    if (targetLang === 'uz') {
      if (exactUz) {
        chosenVoice = exactUz;
        utterLang = exactUz.lang || 'uz-UZ';
      } else {
        const altTurkic = voices.find(v => v && v.lang && /^(tr|az|kk|ky)/i.test(v.lang));
        if (altTurkic) {
          chosenVoice = altTurkic;
          utterLang = altTurkic.lang;
        } else {
          chosenVoice = exactRu || null;
          utterLang = 'ru-RU';
          spokenText = latinUzbekToRussianPhonetic(clean);
        }
      }
    } else {
      chosenVoice = exactRu || null;
      utterLang = 'ru-RU';
    }
  } catch (e) {}

  aiSpeakingIdx = idx;
  const utter = new Utter(spokenText);
  utter.lang = utterLang;
  utter.rate = 1.0;
  if (chosenVoice) utter.voice = chosenVoice;

  utter.onend = () => { if (sessionId === aiSpeechSessionId) { aiSpeakingIdx = -1; renderAiPage(); } };
  utter.onerror = () => { if (sessionId === aiSpeechSessionId) { aiSpeakingIdx = -1; renderAiPage(); } };
  synth.speak(utter);
  renderAiPage();
  return true;
}

function updateAiTtsButton() {
  const btn = document.getElementById('aiTtsToggleBtn');
  if (!btn) return;
  if (aiAutoSpeak) {
    btn.classList.add('active');
    btn.textContent = lang === 'uz' ? '🔊 Ovoz: ON' : '🔊 Голос: ВКЛ';
  } else {
    btn.classList.remove('active');
    btn.textContent = lang === 'uz' ? '🔇 Ovoz: OFF' : '🔇 Голос: ВЫКЛ';
  }
}

function toggleAiTts() {
  try { unlockAiAudioPlayback(); } catch (e) {}
  aiAutoSpeak = !aiAutoSpeak;
  try { localStorage.setItem('teegu_ai_auto_speak', aiAutoSpeak ? 'true' : 'false'); } catch (e) {}
  updateAiTtsButton();
  if (!aiAutoSpeak) stopAiSpeech();
  showToast(aiAutoSpeak
    ? (lang === 'uz' ? '🔊 AI ovozli javobi yoqildi (O\'zbekcha Neural TTS)' : '🔊 Голосовые ответы AI включены')
    : (lang === 'uz' ? '🔇 AI ovozli javobi o\'chirildi' : '🔇 Голосовые ответы AI выключены'), 'info');
}

function stopAiSpeech() {
  aiSpeechSessionId++;
  aiSpeakingIdx = -1;
  try {
    if (aiActiveAudio) {
      aiActiveAudio.pause();
      aiActiveAudio.currentTime = 0;
      aiActiveAudio.onended = null;
      aiActiveAudio.onerror = null;
      aiActiveAudio = null;
    }
  } catch (e) {}
  try {
    if (typeof window !== 'undefined' && window.speechSynthesis && typeof window.speechSynthesis.cancel === 'function') {
      window.speechSynthesis.cancel();
    }
  } catch (e) {}
  renderAiPage();
}

function speakAiMessage(idx) {
  const msg = Array.isArray(aiChatHistory) ? aiChatHistory[idx] : null;
  if (!msg || !msg.text) return false;
  const clean = cleanTextForSpeech(msg.text);
  if (!clean) return false;

  const targetLang = getEffectiveSpeechLang(clean);
  stopAiSpeech();
  const mySession = aiSpeechSessionId;

  const canUseNeuralTts = typeof Audio !== 'undefined'
    && typeof fetch === 'function'
    && getGeminiCandidateKeys().length > 0
    && (typeof navigator === 'undefined' || navigator.onLine !== false);

  if (!canUseNeuralTts) {
    return speakViaBrowserSpeechSynthesis(clean, targetLang, idx, mySession);
  }

  aiSpeakingIdx = idx;
  try { unlockAiAudioPlayback(); } catch (e) {}
  const audioEl = aiSharedAudioEl || new Audio();
  aiActiveAudio = audioEl;
  renderAiPage();

  synthesizeSpeechWithGemini(clean, targetLang).then(playable => {
    if (mySession !== aiSpeechSessionId) return;
    if (!playable || !playable.url) {
      speakViaBrowserSpeechSynthesis(clean, targetLang, idx, mySession);
      return;
    }
    audioEl.src = playable.url;
    audioEl.onended = () => {
      if (mySession === aiSpeechSessionId) {
        aiSpeakingIdx = -1;
        aiActiveAudio = null;
        renderAiPage();
      }
    };
    audioEl.onerror = () => {
      if (mySession === aiSpeechSessionId) {
        aiActiveAudio = null;
        speakViaBrowserSpeechSynthesis(clean, targetLang, idx, mySession);
      }
    };
    const playPromise = audioEl.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(err => {
        if (mySession !== aiSpeechSessionId) return;
        aiSpeakingIdx = -1;
        aiActiveAudio = null;
        if (err && err.name === 'NotAllowedError') {
          renderAiPage();
          showToast(lang === 'uz' ? '🔊 Eshitish uchun xabar ostidagi O\'qish tugmasini bosing' : '🔊 Нажмите «Читать» под сообщением', 'info');
        } else {
          speakViaBrowserSpeechSynthesis(clean, targetLang, idx, mySession);
        }
      });
    }
  }).catch(() => {
    if (mySession === aiSpeechSessionId) {
      aiActiveAudio = null;
      speakViaBrowserSpeechSynthesis(clean, targetLang, idx, mySession);
    }
  });

  return true;
}

function canUseGeminiMicRecorder() {
  return typeof navigator !== 'undefined'
    && navigator.mediaDevices
    && typeof navigator.mediaDevices.getUserMedia === 'function'
    && typeof MediaRecorder !== 'undefined';
}

function pickSupportedAudioMimeType() {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return '';
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg', 'audio/mp4', 'audio/aac'];
  return candidates.find(m => MediaRecorder.isTypeSupported(m)) || '';
}

function blobToBase64Audio(blob) {
  return new Promise((resolve, reject) => {
    if (typeof FileReader === 'undefined') return reject(new Error('FileReader unavailable'));
    const reader = new FileReader();
    reader.onloadend = () => {
      const res = String(reader.result || '');
      const idx = res.indexOf(',');
      resolve(idx >= 0 ? res.slice(idx + 1) : res);
    };
    reader.onerror = () => reject(reader.error || new Error('Read failed'));
    reader.readAsDataURL(blob);
  });
}

async function transcribeAudioWithGemini(blob, recLang) {
  const keys = getGeminiCandidateKeys();
  if (!keys.length || typeof fetch !== 'function') return '';
  const base64 = await blobToBase64Audio(blob);
  const rawMime = String(blob.type || 'audio/webm').split(';')[0].trim().toLowerCase();
  const mimeType = rawMime === 'audio/mp4' ? 'audio/m4a' : (rawMime || 'audio/webm');
  const vocab = [];
  (state.products || []).slice(0, 25).forEach(p => { if (p?.name) vocab.push(p.name); if (p?.nameUz) vocab.push(p.nameUz); });
  (state.clients || []).slice(0, 40).forEach(c => { if (c?.name) vocab.push(c.name); });
  vocab.push('naqd', 'klik', 'qarz', 'konsignatsiya', "so'm", 'kg');

  for (const activeKey of keys) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/interactions?key=${encodeURIComponent(activeKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'gemini-3.5-transcribe',
            input: [{ type: 'audio', data: base64, mime_type: mimeType }],
            generation_config: {
              transcription_config: {
                language_codes: [recLang || 'uz-UZ'],
                custom_vocabulary: vocab.slice(0, 80),
                mode: 'smart'
              }
            }
          })
        }
      );
      if (!res.ok) continue;
      const json = await res.json();
      const transcript = extractGeminiTextFromResponse(json);
      if (transcript) return transcript;
    } catch (e) {}
  }
  return '';
}

function stopGeminiMicRecorder() {
  try {
    if (geminiMicState.recorder && geminiMicState.recorder.state !== 'inactive') {
      geminiMicState.recorder.stop();
    }
  } catch (e) {}
}

async function startGeminiMicRecorder(mode, recLang) {
  if (!canUseGeminiMicRecorder()) {
    showToast(lang === 'uz' ? 'Brauzerda mikrofon yozish qo\'llanmaydi' : 'Микрофон не поддерживается браузером', 'error');
    return false;
  }
  if (geminiMicState.active) {
    stopGeminiMicRecorder();
    return false;
  }
  const targetBtn = mode === 'drive' ? document.getElementById('driveVoiceOrderBtn') : document.getElementById('aiMicBtn');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = pickSupportedAudioMimeType();
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    geminiMicState.active = true;
    geminiMicState.mode = mode;
    geminiMicState.recorder = recorder;
    geminiMicState.stream = stream;
    geminiMicState.chunks = [];
    geminiMicState.mimeType = mimeType || recorder.mimeType || 'audio/webm';
    geminiMicState.recLang = recLang || getVoiceRecognitionLang();

    if (mode === 'drive') isDriveRecording = true; else isAiRecording = true;
    if (targetBtn) targetBtn.classList.add('recording');
    showToast(
      geminiMicState.recLang === 'uz-UZ'
        ? '🎙️ Yozilmoqda (O\'zbekcha)... Tugagach yana bosing'
        : '🎙️ Запись (Русский)... Нажмите снова для отправки',
      'info'
    );

    recorder.ondataavailable = e => {
      if (e && e.data && e.data.size > 0) geminiMicState.chunks.push(e.data);
    };
    recorder.onstop = async () => {
      const m = geminiMicState.mode;
      const rl = geminiMicState.recLang;
      const mt = geminiMicState.mimeType;
      const chunks = geminiMicState.chunks.slice();
      try { stream.getTracks().forEach(t => t.stop()); } catch (e) {}
      geminiMicState.active = false;
      geminiMicState.mode = null;
      geminiMicState.recorder = null;
      geminiMicState.stream = null;
      geminiMicState.chunks = [];
      if (m === 'drive') isDriveRecording = false; else isAiRecording = false;
      if (targetBtn) targetBtn.classList.remove('recording');
      if (!chunks.length) return;

      showToast(lang === 'uz' ? '⏳ Ovoz matnga aylantirilmoqda...' : '⏳ Распознаём речь...', 'info');
      const blob = new Blob(chunks, { type: mt });
      const text = await transcribeAudioWithGemini(blob, rl);
      if (!text) {
        showToast(lang === 'uz' ? 'Ovozni tushunib bo\'lmadi, qayta urinib ko\'ring' : 'Не удалось распознать речь', 'error');
        return;
      }
      if (m === 'drive') {
        const inp = document.getElementById('driveVoiceInput');
        if (inp) inp.value = text;
        if (typeof previewDriveVoiceText === 'function') previewDriveVoiceText(text);
      } else {
        const inputEl = document.getElementById('aiInput');
        if (inputEl) {
          lastInputWasVoice = true;
          inputEl.value = (inputEl.value ? inputEl.value + ' ' : '') + text;
          inputEl.focus();
        }
      }
    };
    recorder.start();
    return true;
  } catch (e) {
    geminiMicState.active = false;
    if (mode === 'drive') isDriveRecording = false; else isAiRecording = false;
    if (targetBtn) targetBtn.classList.remove('recording');
    showToast(lang === 'uz' ? 'Mikrofonga ruxsat berilmadi' : 'Нет доступа к микрофону', 'error');
    return false;
  }
}

// ==================== WHAT-IF PRICE & PROFIT SIMULATOR ====================
function buildSimulatorBaseline(days = 30) {
  const cutoff = Date.now() - days * 86400000;
  const recentOrders = (state.orders || []).filter(o => o && o.status !== 'cancelled' && new Date(o.date).getTime() >= cutoff);
  const byProd = {};
  let earliestTs = Date.now();
  recentOrders.forEach(o => {
    const ts = new Date(o.date).getTime();
    if (!isNaN(ts) && ts < earliestTs) earliestTs = ts;
    (o.items || []).forEach(it => {
      if (!it || !it.qty) return;
      const key = String(it.id || it.name || 'other');
      const prod = (PRODUCTS || []).find(p => String(p.id) === String(it.id));
      if (!byProd[key]) {
        byProd[key] = {
          id: key,
          name: (prod && (lang === 'uz' ? prod.nameUz : prod.name)) || it.nameUz || it.name || key,
          basePrice: (prod && Number(prod.price)) || Number(it.price) || 0,
          explicitCost: (prod && Number(prod.cost)) || 0,
          qty: 0,
          rev: 0,
          profit: 0
        };
      }
      const q = Number(it.qty) || 0;
      const pVal = Number(it.price) || 0;
      byProd[key].qty += q;
      byProd[key].rev += q * pVal;
      byProd[key].profit += typeof calculateItemProfit === 'function' ? calculateItemProfit(it, prod) : 0;
    });
  });

  const observedDays = recentOrders.length ? Math.max(1, Math.min(days, Math.ceil((Date.now() - earliestTs) / 86400000))) : 0;
  const productsSummary = Object.values(byProd).map(row => {
    const avgPrice = row.qty > 0 ? Math.round(row.rev / row.qty) : row.basePrice;
    const avgUnitProfit = row.qty > 0 ? Math.round(row.profit / row.qty) : 0;
    return {
      ...row,
      qty: Math.round(row.qty * 10) / 10,
      avgPrice,
      avgUnitProfit,
      marginPct: row.rev > 0 ? Math.round((row.profit / row.rev) * 100) : 0
    };
  });

  const totalRev = Math.round(productsSummary.reduce((s, r) => s + r.rev, 0));
  const totalProfit = Math.round(productsSummary.reduce((s, r) => s + r.profit, 0));
  const totalKg = Math.round(productsSummary.reduce((s, r) => s + r.qty, 0) * 10) / 10;

  return {
    davrKunlar: days,
    bazaviyKunlar: observedDays,
    jamiKg: totalKg,
    jamiTushum: totalRev,
    jamiSofFoyda: totalProfit,
    umumiyMarjaFoiz: totalRev > 0 ? Math.round((totalProfit / totalRev) * 100) : 0,
    mahsulotlar: productsSummary
  };
}

function simulatePriceScenario(params = {}) {
  const {
    productId = 'all',
    priceDeltaPct = 0,
    priceDeltaAbs = 0,
    volumeElasticityPct = 0,
    discountPct = 0,
    days = 30
  } = params;

  const base = buildSimulatorBaseline(days);
  const targets = base.mahsulotlar.filter(r => productId === 'all' || String(r.id) === String(productId));

  let oldRevenue = 0;
  let newRevenue = 0;
  let oldProfit = 0;
  let newProfit = 0;
  let oldQty = 0;
  let newQty = 0;

  targets.forEach(row => {
    const q = row.qty;
    const origPrice = row.avgPrice || row.basePrice || 0;
    const origUnitProfit = row.avgUnitProfit;
    const rawNewPrice = origPrice * (1 + (Number(priceDeltaPct) || 0) / 100) + (Number(priceDeltaAbs) || 0);
    const finalNewPrice = Math.max(0, Math.round(rawNewPrice * (1 - (Number(discountPct) || 0) / 100)));
    const newQ = Math.max(0, Math.round(q * (1 + (Number(volumeElasticityPct) || 0) / 100) * 10) / 10);

    let newUnitProfit = origUnitProfit;
    if (finalNewPrice !== origPrice) {
      if (row.explicitCost > 0) {
        newUnitProfit = finalNewPrice - row.explicitCost;
      } else {
        newUnitProfit = origUnitProfit + (finalNewPrice - origPrice);
      }
    }

    oldQty += q;
    newQty += newQ;
    oldRevenue += q * origPrice;
    newRevenue += newQ * finalNewPrice;
    oldProfit += q * origUnitProfit;
    newProfit += newQ * newUnitProfit;
  });

  oldRevenue = Math.round(oldRevenue);
  newRevenue = Math.round(newRevenue);
  oldProfit = Math.round(oldProfit);
  newProfit = Math.round(newProfit);

  const profitDelta = newProfit - oldProfit;
  const revenueDelta = newRevenue - oldRevenue;
  const profitDeltaPct = oldProfit > 0 ? Math.round((profitDelta / oldProfit) * 1000) / 10 : 0;

  // Break-even churn tolerance: max volume loss % before profit drops below baseline
  let unitMarginAfter = newQty > 0 ? (newProfit / newQty) : 0;
  let breakEvenDropPct = 0;
  if (oldProfit > 0 && unitMarginAfter > 0 && oldQty > 0) {
    const breakEvenQty = oldProfit / unitMarginAfter;
    breakEvenDropPct = Math.round(((oldQty - breakEvenQty) / oldQty) * 1000) / 10;
  }

  return {
    productId,
    days,
    oldQty: Math.round(oldQty * 10) / 10,
    newQty: Math.round(newQty * 10) / 10,
    oldRevenue,
    newRevenue,
    revenueDelta,
    oldProfit,
    newProfit,
    profitDelta,
    profitDeltaPct,
    volumeChangePct: Number(volumeElasticityPct) || 0,
    breakEvenDropPct
  };
}

function extractSimScenario(rawText) {
  if (!rawText || typeof rawText !== 'string') return { cleanText: rawText || '', scenario: null };
  const match = rawText.match(/<<<SIM_SCENARIO>>>([\s\S]*?)<<<END_SIM_SCENARIO>>>/);
  if (!match) return { cleanText: rawText, scenario: null };
  const cleanText = rawText.replace(/<<<SIM_SCENARIO>>>[\s\S]*?<<<END_SIM_SCENARIO>>>/g, '').trim();
  try {
    const parsed = JSON.parse(match[1].trim());
    if (parsed && typeof parsed === 'object') {
      return { cleanText, scenario: parsed };
    }
  } catch (e) {}
  return { cleanText, scenario: null };
}

function renderSimCardHtml(s) {
  if (!s || typeof s !== 'object') return '';
  const oldRev = Math.round(Number(s.oldRevenue) || 0);
  const newRev = Math.round(Number(s.newRevenue) || 0);
  const oldProf = Math.round(Number(s.oldProfit) || 0);
  const newProf = Math.round(Number(s.newProfit) || 0);
  const diffProf = newProf - oldProf;
  const isPos = diffProf >= 0;
  const beDrop = s.breakEvenDropPct !== undefined ? Number(s.breakEvenDropPct) : null;
  return `
    <div class="ai-sim-card">
      <div style="font-weight:800;font-size:13px;color:var(--accent2);">📊 ${escapeHTML(s.title || (lang==='uz'?'What-If Simulyatsiya':'Сценарий «Что если»'))}</div>
      ${s.subtitle ? `<div style="font-size:11px;color:var(--text2);margin-top:2px;">${escapeHTML(s.subtitle)}</div>` : ''}
      <div class="ai-sim-grid">
        <div class="ai-sim-col">
          <div style="font-size:10px;color:var(--text3);font-weight:700;">${lang==='uz'?'HOZIRGI HOLAT':'ТЕКУЩЕЕ'}</div>
          <div style="font-weight:700;margin-top:3px;">${fmt(oldRev)} so'm</div>
          <div style="font-size:11px;color:#56d4a0;">Foyda: ${fmt(oldProf)}</div>
        </div>
        <div class="ai-sim-col">
          <div style="font-size:10px;color:var(--text3);font-weight:700;">${lang==='uz'?'YANGI SSENARIY':'НОВЫЙ СЦЕНАРИЙ'}</div>
          <div style="font-weight:800;margin-top:3px;">${fmt(newRev)} so'm</div>
          <div style="font-size:11px;color:${isPos ? '#56d4a0' : 'var(--danger)'};font-weight:700;">Foyda: ${fmt(newProf)}</div>
        </div>
      </div>
      <div class="ai-sim-delta ${isPos ? 'pos' : 'neg'}">
        <span>${isPos ? '📈' : '📉'} Sof foyda farqi: ${isPos ? '+' : ''}${fmt(diffProf)} so'm</span>
        ${beDrop !== null ? `<span>🛡️ Mijoz yo'qotish chegarasi: ${beDrop}%</span>` : ''}
      </div>
      ${s.recommendation ? `<div style="font-size:11px;color:var(--text2);margin-top:6px;">💡 ${escapeHTML(s.recommendation)}</div>` : ''}
    </div>
  `;
}

function openAiSimulatorModal() {
  const sel = document.getElementById('simProductSelect');
  if (sel) {
    sel.innerHTML = `<option value="all">${lang==='uz'?'Barcha salatlar (Umumiy)':'Все салаты (Общий)'}</option>` +
      (PRODUCTS || []).map(p => `<option value="${escapeAttr(String(p.id))}">${p.emoji || '🥗'} ${escapeHTML(lang==='uz'?(p.nameUz||p.name):p.name)} (${fmt(p.price)} so'm)</option>`).join('');
  }
  updateAiSimulatorPreview();
  openModal('aiSimulatorModal');
}

function updateAiSimulatorPreview() {
  const container = document.getElementById('simPreviewResult');
  if (!container) return;
  const productId = document.getElementById('simProductSelect')?.value || 'all';
  const priceDeltaPct = parseFloat(document.getElementById('simPricePct')?.value || '0') || 0;
  const volumeElasticityPct = parseFloat(document.getElementById('simVolumePct')?.value || '0') || 0;
  const discountPct = parseFloat(document.getElementById('simDiscountPct')?.value || '0') || 0;

  const res = simulatePriceScenario({ productId, priceDeltaPct, volumeElasticityPct, discountPct, days: 30 });
  if (res.oldQty <= 0) {
    container.innerHTML = `<div style="padding:12px;background:var(--bg3);border-radius:12px;font-size:12px;color:var(--text3);">📊 Oxirgi 30 kunda bu mahsulot bo'yicha buyurtmalar topilmadi. Avval buyurtma ma'lumotlari to'plansin.</div>`;
    return;
  }
  const prod = productId === 'all' ? null : (PRODUCTS || []).find(p => String(p.id) === String(productId));
  const title = prod ? ((lang==='uz'?prod.nameUz:prod.name) || prod.name) : (lang==='uz'?'Barcha mahsulotlar (30 kun)':'Все продукты (30 дн.)');
  container.innerHTML = renderSimCardHtml({
    title,
    subtitle: `Narx: ${priceDeltaPct>=0?'+':''}${priceDeltaPct}% · Chegirma: ${discountPct}% · Hajm: ${volumeElasticityPct>=0?'+':''}${volumeElasticityPct}% (${res.oldQty} -> ${res.newQty} kg)`,
    oldRevenue: res.oldRevenue,
    newRevenue: res.newRevenue,
    oldProfit: res.oldProfit,
    newProfit: res.newProfit,
    breakEvenDropPct: res.breakEvenDropPct,
    recommendation: res.profitDelta >= 0
      ? (lang==='uz' ? 'Bu ssenariy foydali — mijozlarning ' + res.breakEvenDropPct + '% gacha ketishini ham bemalol qoplaydi.' : 'Сценарий прибыльный — покрывает отток до ' + res.breakEvenDropPct + '% объёма.')
      : (lang==='uz' ? 'Ehtiyot bo\'ling: bu kombinatsiya sof foydani kamaytiradi.' : 'Осторожно: при таком объеме чистая прибыль падает.')
  });
}

function askAiAboutCurrentSimulation() {
  const productId = document.getElementById('simProductSelect')?.value || 'all';
  const pricePct = parseFloat(document.getElementById('simPricePct')?.value || '0') || 0;
  const volPct = parseFloat(document.getElementById('simVolumePct')?.value || '0') || 0;
  const discPct = parseFloat(document.getElementById('simDiscountPct')?.value || '0') || 0;
  const prod = productId === 'all' ? null : (PRODUCTS || []).find(p => String(p.id) === String(productId));
  const pName = prod ? (prod.nameUz || prod.name) : 'barcha mahsulotlar';
  closeModal('aiSimulatorModal');
  if (typeof showPage === 'function') showPage('ai');
  const promptText = `Simulyator tahlili qil: Agar "${pName}" bo'yicha narxni ${pricePct >= 0 ? '+' : ''}${pricePct}%, chegirmani ${discPct}% qilsak va hajm ${volPct >= 0 ? '+' : ''}${volPct}% o'zgarsa nima bo'ladi? Menga raqamli <<<SIM_SCENARIO>>> va qaysi mijozlarga e'tibor berishni tushuntir.`;
  sendAiUserMessage(promptText);
}

// ==================== ROUTE & TERRITORY GAP ANALYSIS ====================
const TASHKENT_DISTRICTS = [
  { key: 'Chilonzor', re: /chilonzor|чиланзар|qozirabot|алгоритм|аль-хорезми|farhod/i },
  { key: 'Yunusobod', re: /yunusobod|юнусабад|ahmad donish|бодомзор|universam|универсам|minor/i },
  { key: 'Sergeli', re: /sergeli|сергели|yarmarka|спутник|quruvchilar/i },
  { key: 'Yakkasaroy', re: /yakkasaroy|яккасарай|shota rustaveli|руставели|bobur|toshkent city/i },
  { key: 'Mirzo Ulugbek', re: /mirzo ulug|мирзо улуг|ttz|ттз|buyuk ipak|буёк ипак|qorasuv|карасу|darhon/i },
  { key: 'Shayxontohur', re: /shayxontohur|шайхантаур|chorsu|чорсу|labzak|sebzar|ko'kcha|ibn sino/i },
  { key: 'Olmazor', re: /olmazor|алмазар|beruniy|беруний|qoraqamish|каракамыш|tansiqboyev/i },
  { key: 'Uchtepa', re: /uchtepa|учтепа|lutfiy|фархад|21-kvartal|22-kvartal/i },
  { key: 'Yashnobod', re: /yashnobod|яшнабад|parkent|паркент|tuzel|тузель|qadimiy|aviasozlar|лисунова/i },
  { key: 'Mirobod', re: /mirobod|мирабад|oybek|ойбек|gospital|fargona yoli|куйлюк|qo'yliq/i },
  { key: 'Bektemir', re: /bektemir|бектемир|rohat|рохат|suvsoz/i },
  { key: 'Yangihayot', re: /yangihayot|янгихаёт|yangi hayot/i }
];

function extractTashkentDistrict(addressStr) {
  const txt = String(addressStr || '').trim();
  if (!txt) return 'Manzil kiritilmagan';
  for (const d of TASHKENT_DISTRICTS) {
    if (d.re.test(txt)) return d.key;
  }
  return 'Boshqa / Aniqlanmagan hudud';
}

function buildGeoTerritorySummary() {
  const clients = state.clients || [];
  const orders30 = (state.orders || []).filter(o => o && o.status !== 'cancelled' && (Date.now() - new Date(o.date).getTime()) <= 30 * 86400000);
  const revByClient = {};
  const cntByClient = {};
  orders30.forEach(o => {
    const cid = String(o.clientId || o.client || '');
    revByClient[cid] = (revByClient[cid] || 0) + (o.total || 0);
    cntByClient[cid] = (cntByClient[cid] || 0) + 1;
  });

  const districtStats = {};
  const geoClusters = {};
  let unmappedClients = [];

  clients.forEach(c => {
    const cid = String(c.id || c.name || '');
    const rev = revByClient[cid] || 0;
    const ordCnt = cntByClient[cid] || 0;
    const dist = extractTashkentDistrict((c.address || '') + ' ' + (c.note || '') + ' ' + (c.name || ''));

    if (!districtStats[dist]) {
      districtStats[dist] = { hudud: dist, mijozlarSoni: 0, buyurtmalar30Kun: 0, tushum30Kun: 0, namunaMijozlar: [] };
    }
    districtStats[dist].mijozlarSoni++;
    districtStats[dist].buyurtmalar30Kun += ordCnt;
    districtStats[dist].tushum30Kun += rev;
    if (districtStats[dist].namunaMijozlar.length < 3) districtStats[dist].namunaMijozlar.push(c.name);

    const lat = parseFloat(c.lat);
    const lng = parseFloat(c.lng);
    if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) {
      // ~2.2km grid cluster
      const cellKey = (Math.round(lat * 45) / 45).toFixed(3) + ',' + (Math.round(lng * 45) / 45).toFixed(3);
      if (!geoClusters[cellKey]) {
        geoClusters[cellKey] = { zona: cellKey, hudud: dist, mijozlarSoni: 0, tushum30Kun: 0, mijozlar: [] };
      }
      geoClusters[cellKey].mijozlarSoni++;
      geoClusters[cellKey].tushum30Kun += rev;
      geoClusters[cellKey].mijozlar.push(c.name);
    } else {
      unmappedClients.push(c.name);
    }
  });

  const allDistList = Object.values(districtStats).sort((a, b) => b.tushum30Kun - a.tushum30Kun || b.mijozlarSoni - a.mijozlarSoni);
  const coveredKeys = new Set(Object.keys(districtStats));
  const untappedDistricts = TASHKENT_DISTRICTS.map(d => d.key).filter(k => !coveredKeys.has(k));

  const corridorGaps = allDistList
    .filter(d => d.hudud !== 'Manzil kiritilmagan' && d.hudud !== 'Boshqa / Aniqlanmagan hudud' && d.mijozlarSoni <= 2)
    .map(d => ({
      hudud: d.hudud,
      mijozlarSoni: d.mijozlarSoni,
      tushum30Kun: d.tushum30Kun,
      tavsiyaSababi: `Kuryer hozir shu yo'nalishga faqat ${d.mijozlarSoni} ta mijoz uchun bormoqda — yonidagi kafe/oshxonalarni qo'shilsa yetkazib berish xarajati tushadi.`
    }));

  const sparseClusters = Object.values(geoClusters)
    .filter(cl => cl.mijozlarSoni === 1)
    .sort((a, b) => b.tushum30Kun - a.tushum30Kun)
    .slice(0, 5);

  return {
    jamiMijozlar: clients.length,
    xaritadaBelgilangan: clients.length - unmappedClients.length,
    koordinatasizMijozlarSoni: unmappedClients.length,
    koordinatasizNamuna: unmappedClients.slice(0, 5),
    faolHududlar: allDistList.slice(0, 8),
    boshliqYonalishlar: corridorGaps,
    yakkaKuryerNuqtalari: sparseClusters,
    kirmaganTumanlar: untappedDistricts
  };
}

// ==================== NATURAL-LANGUAGE BUSINESS RULES ENGINE ====================
const DEFAULT_BIZ_RULES = [];
let aiBusinessRules = [];
let ruleUndoStack = [];

function loadBusinessRules() {
  try {
    const raw = localStorage.getItem('teegu_business_rules');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) aiBusinessRules = parsed;
    }
  } catch (e) {}
  if (state.settings && Array.isArray(state.settings.businessRules) && state.settings.businessRules.length >= 0) {
    if (!aiBusinessRules.length && state.settings.businessRules.length) {
      aiBusinessRules = JSON.parse(JSON.stringify(state.settings.businessRules));
    }
  }
  updateAiRulesBadge();
}

function saveBusinessRules() {
  try { localStorage.setItem('teegu_business_rules', JSON.stringify(aiBusinessRules)); } catch (e) {}
  if (!state.settings) state.settings = {};
  state.settings.businessRules = aiBusinessRules;
  if (typeof db !== 'undefined' && db && typeof db.collection === 'function') {
    try {
      db.collection('settings').doc('main').set({ businessRules: aiBusinessRules }, { merge: true });
    } catch (e) {}
  }
  updateAiRulesBadge();
  try { renderWarehouse(); updateWarehouseBadge(); renderProductsGrid(); } catch (e) {}
}

function syncBusinessRulesFromRemote(remoteRules) {
  if (!Array.isArray(remoteRules)) return;
  aiBusinessRules = JSON.parse(JSON.stringify(remoteRules));
  try { localStorage.setItem('teegu_business_rules', JSON.stringify(aiBusinessRules)); } catch (e) {}
  updateAiRulesBadge();
  try { renderWarehouse(); updateWarehouseBadge(); renderProductsGrid(); } catch (e) {}
}

function updateAiRulesBadge() {
  const activeCount = (aiBusinessRules || []).filter(r => r && r.enabled).length;
  const btn = document.getElementById('btnAiRules');
  if (btn) btn.textContent = `🧠 ${lang === 'uz' ? 'Qoidalar' : 'Правила'} (${activeCount})`;
  const badge = document.getElementById('aiRulesCountBadge');
  if (badge) badge.textContent = `${activeCount} ${lang === 'uz' ? 'faol' : 'акт.'}`;
}

function getClientUnpaidDebtInfo(clientId, ordersList) {
  if (clientId === undefined || clientId === null || clientId === '') return { unpaidTotal: 0, oldestUnpaidDays: 0 };
  let unpaidTotal = 0;
  let oldestUnpaidDays = 0;
  const now = Date.now();
  (ordersList || []).forEach(o => {
    if (!o || o.status === 'cancelled' || o.debtPaid) return;
    if (String(o.clientId) !== String(clientId)) return;
    if (o.payment !== 'консигнация' && o.payment !== 'Qarz') return;
    const rem = Math.max(0, (Number(o.total) || 0) - (Number(o.partialPaid) || 0));
    if (rem > 0) {
      unpaidTotal += rem;
      const daysAgo = Math.floor((now - new Date(o.date).getTime()) / 86400000);
      if (daysAgo > oldestUnpaidDays) oldestUnpaidDays = daysAgo;
    }
  });
  return { unpaidTotal, oldestUnpaidDays };
}

function evaluateOrderBusinessRules(opts = {}) {
  const { clientId, clientName, items = [], payment = '', rules = aiBusinessRules, orders = state.orders } = opts;
  const activeRules = (Array.isArray(rules) ? rules : []).filter(r => r && r.enabled);
  const errors = [];
  const warnings = [];
  const matchedRules = [];
  let largeOrderAlertKg = null;

  const isCredit = payment === 'консигнация' || payment === 'Qarz';
  const totalQty = items.reduce((s, i) => s + (Number(i.qty) || 0), 0);
  const totalKg = items.filter(i => !i.unit || !['шт', 'sht', 'dona', 'ta'].includes(String(i.unit).toLowerCase()))
    .reduce((s, i) => s + (Number(i.qty) || 0), 0) || totalQty;

  const debtInfo = getClientUnpaidDebtInfo(clientId, orders);

  activeRules.forEach(rule => {
    if (rule.type === 'block_debt_above' && isCredit) {
      const limit = Number(rule.limit) || 0;
      if (limit > 0 && debtInfo.unpaidTotal > limit) {
        matchedRules.push(rule.id);
        errors.push(
          (lang === 'uz'
            ? `Qoida bo'yicha taqiq: ${clientName || 'Mijoz'} qarzi (${fmt(debtInfo.unpaidTotal)} so'm) ${fmt(limit)} so'm limitidan oshgan — nasiya yopilgan!`
            : `Блок по правилу: долг ${clientName || 'клиента'} (${fmt(debtInfo.unpaidTotal)} сум) превышает лимит ${fmt(limit)} сум!`)
        );
      }
    } else if (rule.type === 'max_order_debt_days' && isCredit) {
      const maxDays = Number(rule.maxDays) || 0;
      if (maxDays > 0 && debtInfo.unpaidTotal > 0 && debtInfo.oldestUnpaidDays >= maxDays) {
        matchedRules.push(rule.id);
        errors.push(
          (lang === 'uz'
            ? `Qoida bo'yicha taqiq: ${debtInfo.oldestUnpaidDays} kunlik to'lanmagan qarz mavjud (limit ${maxDays} kun)!`
            : `Блок по правилу: просроченный долг ${debtInfo.oldestUnpaidDays} дн. (лимит ${maxDays} дн.)!`)
        );
      }
    } else if (rule.type === 'min_order_kg') {
      const minKg = Number(rule.minKg) || 0;
      if (minKg > 0 && totalKg > 0 && totalKg < minKg) {
        matchedRules.push(rule.id);
        errors.push(
          (lang === 'uz'
            ? `Qoida bo'yicha taqiq: eng kam buyurtma ${minKg} kg (hozir ${Math.round(totalKg * 10) / 10} kg)`
            : `Блок по правилу: минимальный заказ ${minKg} кг (сейчас ${Math.round(totalKg * 10) / 10} кг)`)
        );
      }
    } else if (rule.type === 'large_order_alert_kg') {
      const th = Number(rule.thresholdKg) || 0;
      if (th > 0 && totalKg >= th) {
        matchedRules.push(rule.id);
        largeOrderAlertKg = Math.round(totalKg * 10) / 10;
        warnings.push(`Katta buyurtma (${largeOrderAlertKg} kg) Telegramga yuboriladi`);
      }
    }
  });

  return {
    blocked: errors.length > 0,
    errors,
    warnings,
    largeOrderAlertKg,
    matchedRules
  };
}

function applyBizRuleOperation(op) {
  if (!op || typeof op !== 'object') return null;
  const action = String(op.op || 'add').toLowerCase();
  if (action === 'clear') {
    aiBusinessRules = [];
    return 'Barcha biznes qoidalar tozalandi';
  }
  if (action === 'remove') {
    const before = aiBusinessRules.length;
    aiBusinessRules = aiBusinessRules.filter(r => String(r.id) !== String(op.id) && r.type !== op.type);
    return before !== aiBusinessRules.length ? `Qoida o'chirildi: ${op.id || op.type}` : null;
  }
  if (action === 'toggle') {
    const target = aiBusinessRules.find(r => String(r.id) === String(op.id) || r.type === op.type);
    if (!target) return null;
    target.enabled = typeof op.enabled === 'boolean' ? op.enabled : !target.enabled;
    return `${target.label} (${target.enabled ? 'YOQILDI' : 'O\'CHIRILDI'})`;
  }
  if (action === 'add') {
    const validTypes = ['block_debt_above', 'min_order_kg', 'warehouse_low_alert_kg', 'large_order_alert_kg', 'max_order_debt_days'];
    if (!validTypes.includes(op.type)) return null;
    const rule = {
      id: op.id || ('rule_' + Date.now() + '_' + Math.floor(Math.random() * 1000)),
      type: op.type,
      enabled: op.enabled !== false,
      label: String(op.label || op.type),
      createdAt: new Date().toISOString()
    };
    if (op.limit !== undefined) rule.limit = Number(op.limit) || 0;
    if (op.minKg !== undefined) rule.minKg = Number(op.minKg) || 0;
    if (op.thresholdKg !== undefined) rule.thresholdKg = Number(op.thresholdKg) || 0;
    if (op.maxDays !== undefined) rule.maxDays = Number(op.maxDays) || 0;
    if (op.productId) rule.productId = String(op.productId);

    // Replace existing rule of same type+productId so AI edits cleanly instead of duplicating
    aiBusinessRules = aiBusinessRules.filter(r => !(r.type === rule.type && (r.productId || 'all') === (rule.productId || 'all')));
    aiBusinessRules.push(rule);
    return rule.label;
  }
  return null;
}

function extractAndApplyBizRules(rawText) {
  if (!rawText || typeof rawText !== 'string') return { cleanText: rawText || '', applied: [] };
  const match = rawText.match(/<<<BIZ_RULES>>>([\s\S]*?)<<<END_BIZ_RULES>>>/);
  if (!match) return { cleanText: rawText, applied: [] };
  const cleanText = rawText.replace(/<<<BIZ_RULES>>>[\s\S]*?<<<END_BIZ_RULES>>>/g, '').trim();
  const applied = [];
  try {
    const parsed = JSON.parse(match[1].trim());
    const ops = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.ops) ? parsed.ops : [parsed]);
    const prev = JSON.parse(JSON.stringify(aiBusinessRules || []));
    ops.forEach(op => {
      const msg = applyBizRuleOperation(op);
      if (msg) applied.push(msg);
    });
    if (applied.length) {
      ruleUndoStack.push(prev);
      saveBusinessRules();
      renderAiRulesModal();
    }
  } catch (e) {
    console.warn('extractAndApplyBizRules parse warn:', e);
  }
  return { cleanText, applied };
}

function undoLastRuleChange() {
  if (!ruleUndoStack.length) {
    showToast(lang === 'uz' ? 'Qaytariladigan qoida o\'zgarishi yo\'q' : 'Нет изменений для отмены', 'info');
    return;
  }
  aiBusinessRules = ruleUndoStack.pop();
  saveBusinessRules();
  renderAiRulesModal();
  showToast('↩️ Oxirgi qoida o\'zgarishi bekor qilindi', 'success');
}

function toggleBusinessRule(ruleId) {
  const prev = JSON.parse(JSON.stringify(aiBusinessRules || []));
  const r = (aiBusinessRules || []).find(x => String(x.id) === String(ruleId));
  if (!r) return;
  ruleUndoStack.push(prev);
  r.enabled = !r.enabled;
  saveBusinessRules();
  renderAiRulesModal();
}

function deleteBusinessRule(ruleId) {
  const prev = JSON.parse(JSON.stringify(aiBusinessRules || []));
  ruleUndoStack.push(prev);
  aiBusinessRules = (aiBusinessRules || []).filter(x => String(x.id) !== String(ruleId));
  saveBusinessRules();
  renderAiRulesModal();
}

function clearBusinessRules() {
  if (!aiBusinessRules.length) return;
  const prev = JSON.parse(JSON.stringify(aiBusinessRules || []));
  ruleUndoStack.push(prev);
  aiBusinessRules = [];
  saveBusinessRules();
  renderAiRulesModal();
  showToast('🗑️ Barcha biznes qoidalar o\'chirildi', 'info');
}

function applyQuickRulePreset(type) {
  const presets = {
    block_debt_above: { op: 'add', type: 'block_debt_above', limit: 500000, label: 'Qarzi 500 000 so\'mdan oshgan mijozga nasiya yopilsin' },
    min_order_kg: { op: 'add', type: 'min_order_kg', minKg: 2, label: 'Eng kam buyurtma hajmi 2 kg bo\'lsin' },
    warehouse_low_alert_kg: { op: 'add', type: 'warehouse_low_alert_kg', thresholdKg: 3, productId: 'all', label: 'Omborda salat 3 kg dan tushsa qizil ogohlantirish' },
    large_order_alert_kg: { op: 'add', type: 'large_order_alert_kg', thresholdKg: 30, label: 'Buyurtma 30 kg dan oshsa Telegramga tezkor xabar' }
  };
  const p = presets[type];
  if (!p) return;
  ruleUndoStack.push(JSON.parse(JSON.stringify(aiBusinessRules || [])));
  const res = applyBizRuleOperation(p);
  if (res) {
    saveBusinessRules();
    renderAiRulesModal();
    showToast('🧠 Qoida faollashtirildi: ' + res, 'success');
  }
}

function openAiRulesModal() {
  renderAiRulesModal();
  openModal('aiRulesModal');
}

function renderAiRulesModal() {
  updateAiRulesBadge();
  const el = document.getElementById('aiRulesList');
  if (!el) return;
  if (!aiBusinessRules || !aiBusinessRules.length) {
    el.innerHTML = `<div style="font-size:12px;color:var(--text3);padding:12px 0;text-align:center;">🧠 ${lang==='uz'?'Hozircha faol biznes qoidasi yo\'q. Yuqoridagi shablondan tanlang yoki AI chatda oddiy gap bilan yozing!':'Пока нет активных бизнес-правил. Выберите шаблон или создайте в чате с AI.'}</div>`;
    return;
  }
  el.innerHTML = aiBusinessRules.map(r => `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 10px;background:var(--bg2);border:1px solid ${r.enabled ? 'rgba(0,229,255,0.4)' : 'var(--border)'};border-radius:11px;margin-bottom:7px;">
      <div style="min-width:0;flex:1;">
        <div style="font-size:12px;font-weight:700;color:${r.enabled ? 'var(--text)' : 'var(--text3)'};">${r.enabled ? '🟢' : '⏸️'} ${escapeHTML(r.label || r.type)}</div>
        <div style="font-size:10px;color:var(--text3);margin-top:2px;">Tur: ${escapeHTML(r.type)}</div>
      </div>
      <div style="display:flex;gap:5px;flex-shrink:0;">
        <button class="chip" style="margin:0;padding:4px 8px;font-size:11px;" onclick="toggleBusinessRule('${escapeAttr(r.id)}')">${r.enabled ? 'O\'chirish' : 'Yoqish'}</button>
        <button class="chip" style="margin:0;padding:4px 8px;font-size:11px;color:var(--danger);" onclick="deleteBusinessRule('${escapeAttr(r.id)}')">✕</button>
      </div>
    </div>
  `).join('');
}

// ==================== DRIVE MODE ("RULDA REJIMI" — VOICE ORDER & "YO'LDAMAN" ETA) ====================
let driveVoiceRec = null;
let isDriveRecording = false;
let currentDriveParsedOrder = null;

function getOrderLatLng(o) {
  if (!o) return null;
  if (o.lat && o.lng && !isNaN(parseFloat(o.lat)) && !isNaN(parseFloat(o.lng))) {
    return { lat: parseFloat(o.lat), lng: parseFloat(o.lng) };
  }
  const cl = (state.clients || []).find(c => String(c.id) === String(o.clientId));
  if (cl && cl.lat && cl.lng && !isNaN(parseFloat(cl.lat)) && !isNaN(parseFloat(cl.lng))) {
    return { lat: parseFloat(cl.lat), lng: parseFloat(cl.lng) };
  }
  return null;
}

function getNextPendingDeliveryOrder() {
  const today = new Date().toDateString();
  let pending = (state.orders || []).filter(o => o && o.date && new Date(o.date).toDateString() === today && !o.delivered && o.status !== 'done' && o.status !== 'cancelled');
  if (!pending.length) return null;
  if (typeof adminOptimizedRoute !== 'undefined' && adminOptimizedRoute && Array.isArray(adminOptimizedRoute.sortedOrders)) {
    const rankMap = new Map();
    adminOptimizedRoute.sortedOrders.forEach((so, idx) => rankMap.set(String(so.id), idx));
    pending = pending.slice().sort((a, b) => {
      const ra = rankMap.has(String(a.id)) ? rankMap.get(String(a.id)) : 9999;
      const rb = rankMap.has(String(b.id)) ? rankMap.get(String(b.id)) : 9999;
      return ra - rb;
    });
  }
  return pending[0];
}

function translitCyrToLat(str) {
  const map = {
    'а':'a','б':'b','в':'v','г':'g','ғ':'g','д':'d','е':'e','ё':'yo','ж':'j','з':'z','и':'i','й':'y',
    'к':'k','қ':'q','л':'l','м':'m','н':'n','о':'o','ў':'o','п':'p','р':'r','с':'s','т':'t','у':'u',
    'ф':'f','х':'x','ҳ':'h','ц':'s','ч':'ch','ш':'sh','щ':'sh','ъ':'','ы':'i','ь':'','э':'e','ю':'yu','я':'ya'
  };
  return String(str || '').toLowerCase().split('').map(ch => map[ch] !== undefined ? map[ch] : ch).join('');
}

function replaceSpokenNumberWords(normText) {
  let out = translitCyrToLat(String(normText || ''))
    .replace(/[ʻ’`‘]/g, "'")
    .replace(/,/g, '.');

  // 1. Fractions / Halves phrases
  out = out.replace(/\bpoltora\b|\bpoltory\b/gi, '1.5');
  out = out.replace(/\bpolkilo\b|\bpolovina\b/gi, '0.5');
  out = out.replace(/\b(\d+(?:\.\d+)?)\s+(?:s\s+polovinoy|s\s+polovino[yi])\b/gi, (_, n) => String(parseFloat(n) + 0.5));
  out = out.replace(/\b(\d+(?:\.\d+)?)\s+yarim\b/gi, (_, n) => String(parseFloat(n) + 0.5));

  // 2. Dictionaries for tokens
  const tensMap = {
    "o'n": 10, "on": 10, "o'nta": 10, "onta": 10, "desyat": 10,
    "yigirma": 20, "yigirmata": 20, "dvadsat": 20, "dvadtsat": 20,
    "o'ttiz": 30, "ottiz": 30, "o'ttizta": 30, "ottizta": 30, "tridsat": 30, "tridtsat": 30,
    "qirq": 40, "qirqta": 40, "sorok": 40,
    "ellik": 50, "ellikta": 50, "pyatdesyat": 50,
    "oltmish": 60, "oltmishta": 60, "shestdesyat": 60,
    "yetmish": 70, "yetmishta": 70, "semdesyat": 70,
    "sakson": 80, "saksonta": 80, "vosemdesyat": 80,
    "to'qson": 90, "toqson": 90, "to'qsonta": 90, "toqsonta": 90, "devyanosto": 90,
    "yuz": 100, "yuzta": 100, "sto": 100
  };

  const teensMap = {
    "odinnadsat": 11, "odinnadtsat": 11,
    "dvenadsat": 12, "dvenadtsat": 12,
    "trinadsat": 13, "trinadtsat": 13,
    "chetyrnadsat": 14, "chetyrnadtsat": 14,
    "pyatnadsat": 15, "pyatnadtsat": 15,
    "shestnadsat": 16, "shestnadtsat": 16,
    "semnadsat": 17, "semnadtsat": 17,
    "vosemnadsat": 18, "vosemnadtsat": 18,
    "devyatnadsat": 19, "devyatnadtsat": 19
  };

  const onesMap = {
    "nol": 0, "nol'": 0,
    "bir": 1, "bitta": 1, "odin": 1, "odna": 1,
    "ikki": 2, "ikkita": 2, "dva": 2, "dve": 2,
    "uch": 3, "uchta": 3, "tri": 3,
    "to'rt": 4, "tort": 4, "to'rtta": 4, "tortta": 4, "chetyre": 4,
    "besh": 5, "beshta": 5, "pyat": 5,
    "olti": 6, "oltita": 6, "shest": 6,
    "yetti": 7, "yettita": 7, "sem": 7,
    "sakkiz": 8, "sakkizta": 8, "vosem": 8,
    "to'qqiz": 9, "toqqiz": 9, "to'qqizta": 9, "toqqizta": 9, "devyat": 9
  };

  const tensKeys = Object.keys(tensMap).sort((a,b) => b.length - a.length);
  const onesKeys = Object.keys(onesMap).filter(k => onesMap[k] > 0).sort((a,b) => b.length - a.length);

  // Replace Tens + Ones + yarim (e.g. yigirma besh yarim -> 25.5, dvadsat pyat s polovinoy -> 25.5)
  tensKeys.forEach(t => {
    const escT = t.replace(/'/g, "\\'");
    onesKeys.forEach(o => {
      const escO = o.replace(/'/g, "\\'");
      const val = tensMap[t] + onesMap[o];
      const reHalf = new RegExp('\\b' + escT + '\\s+' + escO + '\\s+(?:yarim|s\\s+polovino[yi])\\b', 'gi');
      out = out.replace(reHalf, String(val + 0.5));
      const reComp = new RegExp('\\b' + escT + '\\s+' + escO + '\\b', 'gi');
      out = out.replace(reComp, String(val));
    });
    // Tens + yarim (e.g. o'n yarim -> 10.5, yigirma yarim -> 20.5)
    const reTenHalf = new RegExp('\\b' + escT + '\\s+(?:yarim|s\\s+polovino[yi])\\b', 'gi');
    out = out.replace(reTenHalf, String(tensMap[t] + 0.5));
  });

  // Replace Teens
  Object.keys(teensMap).sort((a,b) => b.length - a.length).forEach(k => {
    const escK = k.replace(/'/g, "\\'");
    const val = teensMap[k];
    const reHalf = new RegExp('\\b' + escK + '\\s+(?:yarim|s\\s+polovino[yi])\\b', 'gi');
    out = out.replace(reHalf, String(val + 0.5));
    const re = new RegExp('\\b' + escK + '\\b', 'gi');
    out = out.replace(re, String(val));
  });

  // Replace standalone Tens
  tensKeys.forEach(t => {
    const escT = t.replace(/'/g, "\\'");
    const re = new RegExp('\\b' + escT + '\\b', 'gi');
    out = out.replace(re, String(tensMap[t]));
  });

  // Replace Ones + yarim (e.g. bir yarim -> 1.5, ikki yarim -> 2.5, dva s polovinoy -> 2.5)
  onesKeys.forEach(o => {
    const escO = o.replace(/'/g, "\\'");
    const reHalf = new RegExp('\\b' + escO + '\\s+(?:yarim|s\\s+polovino[yi])\\b', 'gi');
    out = out.replace(reHalf, String(onesMap[o] + 0.5));
    const re = new RegExp('\\b' + escO + '\\b', 'gi');
    out = out.replace(re, String(onesMap[o]));
  });

  out = out.replace(/(\d+(?:\.\d+)?)\s+(?:yarim|s\s+polovino[yi])\b/gi, (_, n) => String(parseFloat(n) + 0.5));
  out = out.replace(/\byarim\b/gi, '0.5');

  // Merge any consecutive tens + ones digits (e.g. "10 5" -> "15", "20 5" -> "25", "100 20" -> "120")
  out = out.replace(/\b(10|20|30|40|50|60|70|80|90)\s+([1-9](?:\.5)?)\b/g, (_, t, u) => String(Number(t) + Number(u)));

  return out;
}

const VOICE_PRODUCT_SYNONYMS = {
  funchoza: ['funchoz', 'funchuz', 'funchos', 'funchoza'],
  morkovcha: ['morkov', 'morkovcha', 'sabzi'],
  sologurc: ['sologurc', 'ogurts', 'ogurs', 'bodring', 'tuzlangan'],
  kapusta: ['kapust', 'karam', 'sladkaya'],
  kuksi: ['kuksi']
};

function parseVoiceOrderCommand(rawTranscript) {
  const original = String(rawTranscript || '').trim();
  const norm = replaceSpokenNumberWords(
    translitCyrToLat(original)
      .replace(/[ʻ’`‘]/g, "'")
      .replace(/[^\w\s'.]/g, ' ')
      .replace(/\s+/g, ' ')
  );

  // 1. Detect payment method
  let payment = 'наличные';
  if (/\b(nasiya|qarz|qarzdor|dolg|konsignats|kredit)\w*\b/i.test(norm)) {
    payment = 'консигнация';
  } else if (/\b(klik|click|karta|kart|plastik|perechislen)\w*\b/i.test(norm)) {
    payment = 'клик';
  }

  // 2. Match client cleanly against state.clients
  let matchedClient = null;
  let bestScore = 0;
  (state.clients || []).forEach(c => {
    if (!c || !c.name) return;
    const cNorm = translitCyrToLat(c.name).replace(/[ʻ’`‘]/g, "'");
    const cWords = cNorm.split(/\s+/).filter(w => w.length >= 3 && !['cafe','kafe','oshxona','food','fast','bar'].includes(w));
    const searchWords = cWords.length ? cWords : cNorm.split(/\s+/).filter(w => w.length >= 2);
    let score = 0;
    if (norm.includes(cNorm)) score += 100;
    searchWords.forEach(w => {
      if (norm.includes(w)) score += w.length * 3;
      else if (w.length >= 5 && norm.includes(w.slice(0, w.length - 1))) score += (w.length - 1) * 2;
    });
    if (score > bestScore) {
      bestScore = score;
      matchedClient = c;
    }
  });

  // 3. Match products + quantities before/near product keyword
  const tokens = norm.split(/\s+/).filter(Boolean);
  const foundMap = {};
  const unitTokens = new Set(['kg', 'kilo', 'kilogram', 'kilogramm', 'kilogramma', 'kilogrammov', 'sht', 'shtuk', 'shtuka', 'shtuki', 'dona', 'ta', 'litr', 'l']);
  const prodList = (PRODUCTS || []).map(p => {
    const id = String(p.id || '').toLowerCase();
    const stems = new Set(VOICE_PRODUCT_SYNONYMS[id] || []);
    [p.name, p.nameUz, p.id].forEach(label => {
      translitCyrToLat(label || '').split(/\s+/).forEach(w => {
        const cw = w.replace(/[^a-z0-9]/g, '');
        if (cw.length >= 3) stems.add(cw);
      });
    });
    return { prod: p, stems: Array.from(stems) };
  });

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i].replace(/'/g, '');
    const matchedProdEntry = prodList.find(entry => entry.stems.some(st => tok.startsWith(st) || tok.includes(st)));
    if (!matchedProdEntry) continue;
    const p = matchedProdEntry.prod;

    // Look back 1-3 tokens for quantity number (skipping unit words like kg/sht)
    let qty = null;
    for (let back = 1; back <= 3 && (i - back) >= 0; back++) {
      const prevTok = tokens[i - back];
      if (unitTokens.has(prevTok)) continue;
      if (/^\d+(?:\.\d+)?$/.test(prevTok)) {
        qty = parseFloat(prevTok);
        if (back + 1 <= 4 && (i - back - 1) >= 0) {
          const prevTok2 = tokens[i - back - 1];
          if (/^(?:10|20|30|40|50|60|70|80|90|100)$/.test(prevTok2) && qty < 10) {
            qty = parseFloat(prevTok2) + qty;
          }
        }
        break;
      }
      break;
    }
    // Or look ahead 1 token if spoken like "funchoza 5 kg"
    if (qty === null && (i + 1) < tokens.length && /^\d+(?:\.\d+)?$/.test(tokens[i + 1])) {
      qty = parseFloat(tokens[i + 1]);
      if ((i + 2) < tokens.length && /^\d+(?:\.\d+)?$/.test(tokens[i + 2])) {
        const next2 = parseFloat(tokens[i + 2]);
        if (qty >= 10 && next2 < 10) {
          qty += next2;
        }
      }
    }
    if (qty !== null && qty > 0) {
      const isUnit = p.unit === 'шт';
      const cleanQty = isUnit ? Math.max(1, Math.round(qty)) : Math.round(qty * 10) / 10;
      const cp = matchedClient?.customPrices?.[p.id];
      const customPrice = (cp !== undefined && cp !== null && cp !== '')
        ? Number(cp)
        : Number(p.price) || 0;
      foundMap[p.id] = {
        id: p.id,
        name: p.name || '',
        nameUz: p.nameUz || p.name || '',
        emoji: p.emoji || '🥗',
        qty: (foundMap[p.id]?.qty || 0) + cleanQty,
        price: customPrice,
        unit: p.unit || 'кг'
      };
    }
  }

  const items = Object.values(foundMap);
  const total = Math.round(items.reduce((s, it) => s + (it.qty * it.price), 0));
  return {
    raw: original,
    clientId: matchedClient ? matchedClient.id : '',
    clientName: matchedClient ? matchedClient.name : '',
    client: matchedClient,
    items,
    total,
    payment
  };
}

function openDriveModeModal(prefillText = '') {
  renderDriveModeNextStop();
  const inp = document.getElementById('driveVoiceInput');
  if (inp) {
    if (prefillText) inp.value = prefillText;
    previewDriveVoiceText(inp.value || '');
  }
  openModal('driveModeModal');
}

function renderDriveModeNextStop() {
  const box = document.getElementById('driveNextStopCard');
  if (!box) return;
  const nextOrd = getNextPendingDeliveryOrder();
  if (!nextOrd) {
    box.innerHTML = `<div class="drive-next-card" style="text-align:center;">
      <div style="font-size:28px;">🎉</div>
      <div style="font-weight:800;font-size:14px;margin-top:4px;">${lang==='uz' ? 'Bugungi barcha yetkazib berishlar bajarildi!' : 'Все доставки на сегодня выполнены!'}</div>
      <div style="font-size:12px;color:var(--text2);margin-top:3px;">${lang==='uz' ? 'Pastdan ovoz bilan yangi buyurtma qabul qilishingiz mumkin.' : 'Ниже можно создать новый заказ голосом.'}</div>
    </div>`;
    return;
  }

  const oId = String(nextOrd.id || '').replace(/[^a-zA-Z0-9_-]/g, '');
  const cl = (state.clients || []).find(c => String(c.id) === String(nextOrd.clientId));
  const phone = nextOrd.phone || cl?.phone || '';
  const cleanPhone = String(phone).replace(/[^\d+]/g, '');
  const coords = getOrderLatLng(nextOrd);
  const etaMins = Number(document.getElementById('driveEtaSelect')?.value || 15) || 15;
  const clientDebt = (state.orders || []).filter(o => o && o.status !== 'cancelled' && !o.debtPaid && String(o.clientId) === String(nextOrd.clientId) && (o.payment === 'консигнация' || o.payment === 'Qarz'))
    .reduce((s, o) => s + Math.max(0, (Number(o.total) || 0) - (Number(o.partialPaid) || 0)), 0);
  const itemsStr = (nextOrd.items || []).map(i => `${i.emoji || '🥗'} ${i.qty}${i.unit || 'кг'}`).join(' · ');
  const smsBody = encodeURIComponent(lang === 'uz'
    ? `Assalomu alaykum! TeeGu salatlari bo'yicha buyurtmangiz yo'lda — ~${etaMins} daqiqada yetib boramiz.`
    : `Здравствуйте! Ваш заказ салатов TeeGu уже в пути — будем примерно через ${etaMins} мин.`);
  const navUrl = coords ? `https://yandex.ru/maps/?rtext=~${coords.lat},${coords.lng}` : '#';
  const etaSentBadge = nextOrd.etaNotifiedAt ? `<span style="color:var(--green);font-size:11px;font-weight:800;">✅ Xabar yuborildi</span>` : '';

  box.innerHTML = `
    <div class="drive-next-card">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
        <span style="font-size:11px;font-weight:800;color:var(--accent2);text-transform:uppercase;">🚚 ${lang==='uz'?'Keyingi manzil':'Следующая точка'} ${nextOrd.stepNum ? '#' + nextOrd.stepNum : ''}</span>
        ${etaSentBadge}
      </div>
      <div style="font-size:18px;font-weight:900;margin-top:4px;">${escapeHTML(nextOrd.client || 'Mijoz')}</div>
      <div style="font-size:12px;color:var(--text2);margin-top:3px;">${itemsStr} · <b>${fmt(nextOrd.total || 0)} so'm</b> (${escapeHTML(nextOrd.payment || 'Naqd')})</div>
      ${clientDebt > 0 ? `<div style="font-size:11px;color:var(--orange);font-weight:700;margin-top:4px;">⚠️ Eski qarzi: ${fmt(clientDebt)} so'm</div>` : ''}
      <div class="drive-big-grid">
        ${coords
          ? `<a class="drive-big-btn nav" href="${navUrl}" target="_blank">🧭 Navigator</a>`
          : `<button class="drive-big-btn nav" onclick="openCoordModal('${escapeAttr(String(nextOrd.clientId || ''))}')">📍 Xarita belgilash</button>`}
        <button class="drive-big-btn eta" onclick="sendOnMyWayNotification('${oId}')">📲 Yo'ldaman (~${etaMins}d)</button>
        ${cleanPhone
          ? `<a class="drive-big-btn sms" href="sms:${escapeAttr(cleanPhone)}?body=${smsBody}">💬 SMS</a>`
          : `<button class="drive-big-btn sms" onclick="showToast('Telefon raqam kiritilmagan','info')">💬 SMS yo'q</button>`}
        <button class="drive-big-btn done" onclick="markDelivered('${oId}')">✅ Yetkazildi</button>
      </div>
    </div>
  `;
}

async function sendOnMyWayNotification(orderId, customEta = null) {
  const o = (state.orders || []).find(x => String(x.id) === String(orderId));
  if (!o) return { ok: false, reason: 'order_not_found' };
  const cl = (state.clients || []).find(c => String(c.id) === String(o.clientId));
  const etaMins = Number(customEta || document.getElementById('driveEtaSelect')?.value || 15) || 15;
  const tgId = cl?.tgId || cl?.chatId || cl?.telegramId || o.tgId;
  const phone = o.phone || cl?.phone || '';
  const cleanPhone = String(phone).replace(/[^\d+]/g, '');

  const msgText = lang === 'uz'
    ? `🚚 Assalomu alaykum, ${o.client || 'hurmatli mijoz'}! TeeGu salatlari bo'yicha buyurtmangiz yo'lda — taxminan ${etaMins} daqiqada yetib boramiz.`
    : `🚚 Здравствуйте, ${o.client || 'уважаемый клиент'}! Ваш заказ салатов TeeGu в пути — будем примерно через ${etaMins} мин.`;
  const smsUri = cleanPhone ? `sms:${cleanPhone}?body=${encodeURIComponent(msgText)}` : '';
  const tgToken = (state.settings && state.settings.tgToken) || atob('ODc5NjU4ODA3MTpBQUc4Wl9SOGhQOUVTWlpfM0x4VWFrRDhQQ1hqNUM1WlA2WQ==');

  let channel = 'none';
  if (tgId && tgToken) {
    try {
      const resp = await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: String(tgId), text: msgText })
      });
      const json = resp && typeof resp.json === 'function' ? await resp.json() : { ok: true };
      if (json && json.ok !== false) channel = 'telegram';
    } catch (e) {}
  }

  if (channel !== 'telegram') {
    if (smsUri) {
      channel = 'sms';
      try {
        if (typeof window !== 'undefined' && typeof window.open === 'function') window.open(smsUri, '_self');
      } catch (e) {}
      showToast('📱 Mijozda Telegram ID yo\'q — SMS xabar ochildi', 'info');
    } else {
      showToast('⚠️ Mijozda Telegram ID ham, telefon raqam ham kiritilmagan', 'error');
      return { ok: false, channel: 'none', text: msgText };
    }
  } else {
    showToast(`📲 "${o.client}" ga Telegramdan "Yo'ldaman (~${etaMins} daq)" yuborildi!`, 'success');
  }

  o.etaNotifiedAt = new Date().toISOString();
  try {
    db.collection('orders').doc(String(o.id)).update({ etaNotifiedAt: o.etaNotifiedAt });
  } catch (e) {}
  try { renderDelivery(); renderDriveModeNextStop(); } catch (e) {}
  return { ok: true, channel, text: msgText, smsUri };
}

function toggleDriveVoiceOrder() {
  try { if (typeof unlockAiAudioPlayback === 'function') unlockAiAudioPlayback(); } catch (e) {}
  const btn = document.getElementById('driveVoiceOrderBtn');

  if (typeof geminiMicState !== 'undefined' && geminiMicState.active && geminiMicState.mode === 'drive') {
    if (typeof stopGeminiMicRecorder === 'function') stopGeminiMicRecorder();
    return;
  }
  if (isDriveRecording && driveVoiceRec) {
    try { driveVoiceRec.stop(); } catch (e) {}
    isDriveRecording = false;
    if (btn) btn.classList.remove('recording');
    return;
  }

  const recLang = typeof getVoiceRecognitionLang === 'function' ? getVoiceRecognitionLang() : (lang === 'uz' ? 'uz-UZ' : 'ru-RU');
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) {
    if (typeof startGeminiMicRecorder === 'function' && typeof canUseGeminiMicRecorder === 'function' && canUseGeminiMicRecorder()) {
      startGeminiMicRecorder('drive', recLang);
    } else {
      showToast(lang === 'uz' ? 'Brauzerda ovozli kiritish qo\'llanmaydi — pastdagi qatorga yozing' : 'Голосовой ввод не поддерживается', 'info');
    }
    return;
  }

  try {
    driveVoiceRec = new SpeechRec();
    driveVoiceRec.lang = recLang;
    driveVoiceRec.interimResults = false;
    driveVoiceRec.maxAlternatives = 1;
    let fallbackTriggered = false;
    driveVoiceRec.onstart = () => {
      isDriveRecording = true;
      if (btn) btn.classList.add('recording');
      showToast(recLang === 'uz-UZ' ? '🎤 Buyurtmani o\'zbekcha ayting...' : '🎤 Назовите заказ по-русски...', 'info');
    };
    driveVoiceRec.onresult = event => {
      const txt = event?.results?.[0]?.[0]?.transcript || '';
      const inp = document.getElementById('driveVoiceInput');
      if (inp) inp.value = txt;
      previewDriveVoiceText(txt);
    };
    driveVoiceRec.onerror = ev => {
      const errCode = ev && ev.error ? String(ev.error) : '';
      isDriveRecording = false;
      if (btn) btn.classList.remove('recording');
      if (!fallbackTriggered && (errCode === 'language-not-supported' || errCode === 'service-not-allowed' || errCode === 'network') && typeof startGeminiMicRecorder === 'function' && typeof canUseGeminiMicRecorder === 'function' && canUseGeminiMicRecorder()) {
        fallbackTriggered = true;
        startGeminiMicRecorder('drive', recLang);
      }
    };
    driveVoiceRec.onend = () => {
      isDriveRecording = false;
      if (btn && !(typeof geminiMicState !== 'undefined' && geminiMicState.active && geminiMicState.mode === 'drive')) {
        btn.classList.remove('recording');
      }
    };
    driveVoiceRec.start();
  } catch (e) {
    isDriveRecording = false;
    if (btn) btn.classList.remove('recording');
    if (typeof startGeminiMicRecorder === 'function' && typeof canUseGeminiMicRecorder === 'function' && canUseGeminiMicRecorder()) {
      startGeminiMicRecorder('drive', recLang);
    }
  }
}

function renderDriveParsedPreviewBox() {
  const box = document.getElementById('driveVoiceParsedPreview');
  const parsed = currentDriveParsedOrder;
  if (!box) return;
  if (!parsed) {
    box.innerHTML = '';
    return;
  }
  const clientOpts = `<option value="">— Mijozni tanlang —</option>` +
    (state.clients || []).map(c => `<option value="${escapeAttr(String(c.id))}" ${String(c.id) === String(parsed.clientId) ? 'selected' : ''}>${escapeHTML(c.name)}</option>`).join('');
  const payLabel = { 'наличные': '💵 Naqd', 'клик': '📱 Click', 'консигнация': '📝 Nasiya' }[parsed.payment] || parsed.payment;
  const itemsHtml = parsed.items.length
    ? parsed.items.map(i => `<div>${i.emoji} <b>${escapeHTML(i.nameUz || i.name)}</b>: ${i.qty} ${escapeHTML(i.unit)} · ${fmt(i.qty * i.price)} so'm</div>`).join('')
    : `<div style="color:var(--danger);font-size:12px;">⚠️ Mahsulot va miqdor aniqlanmadi (masalan: "5 kg funchoza")</div>`;

  box.innerHTML = `
    <div class="drive-parsed-box">
      <div style="font-size:11px;font-weight:800;color:var(--accent2);margin-bottom:6px;">📋 ANIQLANGAN BUYURTMA:</div>
      <select id="driveParsedClientSelect" class="form-input" style="padding:7px 10px;font-size:13px;margin-bottom:8px;" onchange="onDriveParsedClientChange(this.value)">${clientOpts}</select>
      <div style="line-height:1.6;">${itemsHtml}</div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;padding-top:8px;border-top:1px solid var(--border);font-weight:800;">
        <span>${payLabel}</span>
        <span style="color:var(--green);font-size:15px;">Jami: ${fmt(parsed.total)} so'm</span>
      </div>
      <div class="row" style="gap:8px;margin-top:10px;">
        <button class="btn btn-outline" style="padding:10px;font-size:12px;" onclick="confirmDriveVoiceOrder(true)">✏️ Formaga</button>
        <button class="btn btn-success" style="padding:10px;font-size:13px;" onclick="confirmDriveVoiceOrder(false)">✅ Darhol Saqlash</button>
      </div>
    </div>
  `;
}

function previewDriveVoiceText(rawText) {
  if (!String(rawText || '').trim()) {
    currentDriveParsedOrder = null;
    renderDriveParsedPreviewBox();
    return;
  }
  currentDriveParsedOrder = parseVoiceOrderCommand(rawText);
  renderDriveParsedPreviewBox();
}

function onDriveParsedClientChange(clientId) {
  if (!currentDriveParsedOrder) return;
  const cl = (state.clients || []).find(c => String(c.id) === String(clientId)) || null;
  currentDriveParsedOrder.clientId = cl ? cl.id : '';
  currentDriveParsedOrder.clientName = cl ? cl.name : '';
  currentDriveParsedOrder.client = cl;
  currentDriveParsedOrder.items.forEach(it => {
    const p = (PRODUCTS || []).find(x => String(x.id) === String(it.id));
    const cp = cl?.customPrices?.[it.id];
    it.price = (cp !== undefined && cp !== null && cp !== '') ? Number(cp) : (Number(p?.price) || it.price);
  });
  currentDriveParsedOrder.total = Math.round(currentDriveParsedOrder.items.reduce((s, i) => s + i.qty * i.price, 0));
  renderDriveParsedPreviewBox();
}

let isDriveOrderSubmitting = false;
async function confirmDriveVoiceOrder(sendToForm = false) {
  if (!sendToForm && isDriveOrderSubmitting) return false;
  const selId = document.getElementById('driveParsedClientSelect')?.value || currentDriveParsedOrder?.clientId;
  const cl = (state.clients || []).find(c => String(c.id) === String(selId));
  if (!cl) {
    showToast('⚠️ Avval mijozni tanlang', 'error');
    return false;
  }
  if (!currentDriveParsedOrder || !currentDriveParsedOrder.items || !currentDriveParsedOrder.items.length) {
    showToast('⚠️ Kamida bitta mahsulot va miqdor kiriting', 'error');
    return false;
  }

  // Re-sync item prices to selected client customPrices
  const items = currentDriveParsedOrder.items.map(it => {
    const p = (PRODUCTS || []).find(x => String(x.id) === String(it.id));
    const cp = cl?.customPrices?.[it.id];
    const price = (cp !== undefined && cp !== null && cp !== '') ? Number(cp) : (Number(p?.price) || Number(it.price) || 0);
    return { ...it, price };
  });
  const total = Math.round(items.reduce((s, i) => s + i.qty * i.price, 0));
  const payment = currentDriveParsedOrder.payment || 'наличные';

  if (sendToForm) {
    closeModal('driveModeModal');
    showPage('new-order');
    const cSel = document.getElementById('clientSelect');
    if (cSel) cSel.value = cl.id;
    state.quantities = {};
    items.forEach(i => { state.quantities[i.id] = i.qty; });
    renderProductsGrid();
    items.forEach(i => {
      const qEl = document.getElementById('qty-' + i.id);
      const pEl = document.getElementById('pc-' + i.id);
      if (qEl) qEl.textContent = i.qty;
      if (pEl && pEl.classList) pEl.classList.toggle('selected', i.qty > 0);
    });
    const payPill = Array.from(document.querySelectorAll('.payment-pills .pill')).find(el => el.dataset?.pay === payment);
    if (payPill && typeof selectPayment === 'function') selectPayment(payPill);
    updateSummary();
    showToast('✏️ Buyurtma formaga o\'tkazildi', 'info');
    return true;
  }

  const ruleCheck = typeof evaluateOrderBusinessRules === 'function'
    ? evaluateOrderBusinessRules({ clientId: cl.id, clientName: cl.name, items, payment, rules: aiBusinessRules, orders: state.orders })
    : { blocked: false, errors: [], largeOrderAlertKg: null };
  if (ruleCheck.blocked) {
    showToast('🚫 ' + ruleCheck.errors[0], 'error');
    return false;
  }

  isDriveOrderSubmitting = true;
  try {
    const order = {
      id: Date.now(),
      date: new Date().toISOString(),
      client: cl.name,
      clientId: cl.id,
      phone: cl.phone || '',
      type: cl.type || 'кафе',
      items,
      total,
      payment,
      note: '🎙️ Rulda ovozli buyurtma',
      sent: false,
      sentSheets: false,
      debtPaid: !['консигнация','qarz','nasiya','долг'].includes((payment||'').toLowerCase()),
      partialPaid: 0,
      delivered: false,
      courier: '',
      status: 'new',
      stockDeducted: true
    };

    commitAdminOrderAndStock(order, cl, ruleCheck);
    try {
      const tgOk = await sendToTelegram(order);
      if (tgOk) {
        order.sent = true;
        db.collection('orders').doc(String(order.id)).update({ sent: true }).catch(()=>{});
      }
    } catch (e) {}

    currentDriveParsedOrder = null;
    const inp = document.getElementById('driveVoiceInput');
    if (inp) inp.value = '';
    const prevBox = document.getElementById('driveVoiceParsedPreview');
    if (prevBox) prevBox.innerHTML = '';
    renderDriveModeNextStop();
    updateBadges();
    showToast(`✅ Buyurtma saqlandi: ${cl.name} (${fmt(total)} so'm)`, 'success');
    return order;
  } finally {
    isDriveOrderSubmitting = false;
  }
}

function extractVoiceOrder(rawText) {
  if (!rawText || typeof rawText !== 'string') return { cleanText: rawText || '', voiceOrder: null };
  const match = rawText.match(/<<<VOICE_ORDER>>>([\s\S]*?)<<<END_VOICE_ORDER>>>/);
  if (!match) return { cleanText: rawText, voiceOrder: null };
  const cleanText = rawText.replace(/<<<VOICE_ORDER>>>[\s\S]*?<<<END_VOICE_ORDER>>>/g, '').trim();
  try {
    const parsed = JSON.parse(match[1].trim());
    if (parsed && Array.isArray(parsed.items) && parsed.items.length) {
      return { cleanText, voiceOrder: parsed };
    }
  } catch (e) {}
  return { cleanText, voiceOrder: null };
}

function renderAiVoiceOrderCard(vo, msgIdx) {
  if (!vo || !Array.isArray(vo.items) || !vo.items.length) return '';
  const itemsDesc = vo.items.map(it => {
    const p = (PRODUCTS || []).find(x => String(x.id) === String(it.id));
    return `${p?.emoji || '🥗'} ${escapeHTML(p?.nameUz || p?.name || it.id)}: <b>${Number(it.qty)} ${escapeHTML(p?.unit || 'kg')}</b>`;
  }).join(' · ');
  return `
    <div class="drive-parsed-box">
      <div style="font-size:11px;font-weight:800;color:var(--accent2);">🎙️ TAYYOR BUYURTMA QORALAMASI</div>
      <div style="font-weight:800;margin-top:3px;">👤 ${escapeHTML(vo.clientName || 'Mijoz')}</div>
      <div style="font-size:12px;margin-top:2px;">${itemsDesc}</div>
      <div class="row" style="gap:6px;margin-top:8px;">
        <button class="chip" style="margin:0;padding:6px 10px;font-size:11px;" onclick="fillOrderFormFromVoiceChat(${msgIdx})">🚗 Rulda oynasida ochish</button>
        <button class="chip" style="margin:0;padding:6px 10px;font-size:11px;background:rgba(86,212,160,0.2);color:#56d4a0;border-color:rgba(86,212,160,0.4);" onclick="commitVoiceOrderFromChat(${msgIdx})">✅ Darhol Saqlash</button>
      </div>
    </div>
  `;
}

function resolveChatVoiceOrderDraft(msgIdx) {
  const m = Array.isArray(aiChatHistory) ? aiChatHistory[msgIdx] : null;
  if (!m || !m.voiceOrder) return null;
  const vo = m.voiceOrder;
  const cl = (state.clients || []).find(c =>
    (vo.clientId && String(c.id) === String(vo.clientId)) ||
    (vo.clientName && translitCyrToLat(c.name).includes(translitCyrToLat(vo.clientName)))
  ) || null;
  const items = (vo.items || []).map(it => {
    const p = (PRODUCTS || []).find(x => String(x.id) === String(it.id) || translitCyrToLat(x.name).includes(translitCyrToLat(it.id || '')));
    if (!p) return null;
    const price = (cl && cl.customPrices && cl.customPrices[p.id]) ? Number(cl.customPrices[p.id]) : (Number(p.price) || 0);
    return {
      id: p.id, name: p.name || '', nameUz: p.nameUz || p.name || '',
      emoji: p.emoji || '🥗', qty: Number(it.qty) || 0, price, unit: p.unit || 'кг'
    };
  }).filter(i => i && i.qty > 0);
  const total = Math.round(items.reduce((s, i) => s + i.qty * i.price, 0));
  return { client: cl, clientId: cl ? cl.id : '', clientName: cl ? cl.name : (vo.clientName || ''), items, total, payment: vo.payment || 'наличные' };
}

function fillOrderFormFromVoiceChat(msgIdx) {
  const draft = resolveChatVoiceOrderDraft(msgIdx);
  if (!draft) return;
  openDriveModeModal();
  currentDriveParsedOrder = draft;
  const inp = document.getElementById('driveVoiceInput');
  if (inp) inp.value = `${draft.clientName}: ${draft.items.map(i => `${i.qty} ${i.unit} ${i.nameUz || i.name}`).join(', ')}`;
  renderDriveParsedPreviewBox();
}

async function commitVoiceOrderFromChat(msgIdx) {
  const draft = resolveChatVoiceOrderDraft(msgIdx);
  if (!draft || !draft.client || !draft.items.length) {
    fillOrderFormFromVoiceChat(msgIdx);
    return false;
  }
  currentDriveParsedOrder = draft;
  return await confirmDriveVoiceOrder(false);
}

// ==================== BOOTSTRAP (after all declarations) ====================
verifyAuth();
if ('serviceWorker' in navigator) { navigator.serviceWorker.register('../sw.js').catch(() => {}); }
