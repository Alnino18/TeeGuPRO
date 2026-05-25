const DEFAULT_PRODUCTS=[
  {id:'funchoza', name:'Фунчоза',       nameUz:'Funchoza',        price:25000,cost:0,emoji:'🍜'},
  {id:'morkovcha',name:'Морковча',       nameUz:'Sabzi',           price:25000,cost:0,emoji:'🥕'},
  {id:'sologurc', name:'Сол огурцы',    nameUz:'Tuzlangan bodring',price:20000,cost:0,emoji:'🥒'},
  {id:'kapusta',  name:'Сладкая капуста',nameUz:'Shirin karam',   price:20000,cost:0,emoji:'🥬'},
  {id:'kuksi',    name:'Кукси',          nameUz:'Kuksi',           price:35000,cost:0,emoji:'🍝',unit:'шт',step:1},
];
let PRODUCTS=JSON.parse(localStorage.getItem('products')||'null')||DEFAULT_PRODUCTS;
function saveProducts(){localStorage.setItem('products',JSON.stringify(PRODUCTS));}

let lang=localStorage.getItem('lang')||'ru';
let theme=localStorage.getItem('theme')||'dark';
let chartPeriod='week';
let partialClientId=null;
let editingClientId=null;
let editingOrderId=null;

let state={
  clients:JSON.parse(localStorage.getItem('clients')||'[]'),
  orders:JSON.parse(localStorage.getItem('orders')||'[]'),
  settings:JSON.parse(localStorage.getItem('settings')||'{}'),
  deliveryStatus:JSON.parse(localStorage.getItem('deliveryStatus')||'{}'),
  templates:JSON.parse(localStorage.getItem('templates')||'[]'),
  quantities:{},selectedPayment:'наличные',currentOrderId:null,dateFilter:'all',
};

// THEME
function applyTheme(){document.body.classList.toggle('light',theme==='light');document.getElementById('themeBtn').textContent=theme==='light'?'🌙':'☀️';}
function toggleTheme(){theme=theme==='dark'?'light':'dark';localStorage.setItem('theme',theme);applyTheme();}

// LANG
const T={
  ru:{headerSub:'Система управления заказами',noOrders:'Нет заказов',noClients:'Нет клиентов',noDebts:'Нет долгов! Все оплатили',totalOrders:'Всего заказов',todayOrders:'Сегодня',totalRev:'Сумма (so\'m)',todayRev:'Сегодня (so\'m)',products:'Продукты',avg:'Средний чек',weekDays:['Пн','Вт','Ср','Чт','Пт','Сб','Вс'],tomorrow:'Завтра'},
  uz:{headerSub:'Buyurtmalarni boshqarish',noOrders:'Buyurtma yo\'q',noClients:'Mijoz yo\'q',noDebts:'Qarz yo\'q! Hammasi to\'lashdi',totalOrders:'Jami buyurtmalar',todayOrders:'Bugun',totalRev:'Summa (so\'m)',todayRev:'Bugun (so\'m)',products:'Mahsulotlar',avg:'O\'rtacha chek',weekDays:['Du','Se','Ch','Pa','Ju','Sh','Ya'],tomorrow:'Ertaga'},
};

function applyLang(){
  document.getElementById('langBtn').textContent=lang==='ru'?'UZ':'RU';
  document.getElementById('headerSub').textContent=T[lang].headerSub;
  document.querySelectorAll('.t').forEach(el=>{const v=el.dataset[lang];if(v)el.textContent=v;});
}
function toggleLang(){lang=lang==='ru'?'uz':'ru';localStorage.setItem('lang',lang);applyLang();renderAll();}
function renderAll(){renderProductsGrid();renderOrdersList();renderClientsList();renderStats();renderDebts();renderDelivery();renderFavorites();}

// INIT
function startApp(){
  applyTheme();applyLang();
  renderProductsGrid();populateClientSelect();renderClientsList();
  renderOrdersList();renderStats();renderDebts();renderDelivery();renderFavorites();
  loadSettings();updateBadges();showScriptCode();renderProductsSettings();
  document.getElementById('partialAmount').addEventListener('input',updatePartialRemaining);
  renderDashboard();
  setupOfflineSync();
  // Telegram Mini App init
  if(window.Telegram?.WebApp){window.Telegram.WebApp.ready();window.Telegram.WebApp.expand();}
  // Live dashboard refresh every 60s
  setInterval(()=>{if(document.getElementById('page-dashboard').classList.contains('active'))renderDashboard();},60000);
}
function init(){
  startApp();
}

function backupData(){
  const data={clients:state.clients,orders:state.orders,settings:state.settings,templates:state.templates,products:PRODUCTS,exportedAt:new Date().toISOString(),version:'v7'};
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='СалатПро_backup_'+new Date().toLocaleDateString('ru-RU').replace(/\./g,'-')+'.json';
  a.click();
  showToast('💾 '+(lang==='uz'?'Saqlandi':'Сохранено'),'success');
}
function restoreData(){
  const input=document.createElement('input');input.type='file';input.accept='.json';
  input.onchange=e=>{
    const file=e.target.files[0];if(!file)return;
    const reader=new FileReader();
    reader.onload=ev=>{
      try{
        const data=JSON.parse(ev.target.result);
        if(!data.clients||!data.orders)throw new Error('Неверный формат');
        if(!confirm(lang==='uz'?'Barcha ma\'lumotlarni almashtirish?':'Заменить все текущие данные из файла?'))return;
        state.clients=data.clients||[];
        state.orders=data.orders||[];
        state.settings=data.settings||{};
        state.templates=data.templates||[];
        if(data.products){localStorage.setItem('products',JSON.stringify(data.products));}
        localStorage.setItem('clients',JSON.stringify(state.clients));
        localStorage.setItem('orders',JSON.stringify(state.orders));
        localStorage.setItem('settings',JSON.stringify(state.settings));
        localStorage.setItem('templates',JSON.stringify(state.templates));
        populateClientSelect();renderAll();loadSettings();updateBadges();
        showToast('✅ '+(lang==='uz'?'Tiklandi':'Восстановлено'),'success');
      }catch(err){showToast('❌ '+(lang==='uz'?'Xato fayl':'Неверный файл'),'error');}
    };
    reader.readAsText(file);
  };
  input.click();
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
  localStorage.setItem('templates',JSON.stringify(state.templates));
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
  localStorage.setItem('templates',JSON.stringify(state.templates));
  renderTemplates();
}
function openTemplatesModal(){renderTemplates();openModal('templatesModal');}
// NAV
function showPage(id){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  document.getElementById('page-'+id).classList.add('active');
  const tab=document.querySelector(`.tab[data-page="${id}"]`);if(tab)tab.classList.add('active');
  if(id==='orders')renderOrdersList();
  if(id==='clients')renderClientsList();
  if(id==='stats')renderStats();
  if(id==='debts')renderDebts();
  if(id==='delivery')renderDelivery();
  if(id==='new-order')renderFavorites();
  if(id==='dashboard')renderDashboard();
  if(id==='map')renderMap();
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
  document.getElementById('productsGrid').innerHTML=PRODUCTS.map(p=>`
    <div class="product-card" id="pc-${p.id}">
      <div class="product-name">${p.emoji} ${lang==='uz'?p.nameUz:p.name}</div>
      <div class="product-price">${fmt(p.price)} / ${p.unit||'кг'}</div>
      <div class="product-qty">
        <div class="qty-btn" onclick="changeQty('${p.id}',${-(p.step||0.5)})">−</div>
        <div><span class="qty-val" id="qty-${p.id}">0</span> <span class="qty-unit">${p.unit||'кг'}</span></div>
        <div class="qty-btn" onclick="changeQty('${p.id}',${p.step||0.5})">+</div>
      </div>
    </div>`).join('');
}
function changeQty(id,delta){
  const p=PRODUCTS.find(x=>x.id===id);
  const isUnit=p&&p.unit==='шт';
  const n=isUnit?Math.max(0,Math.round((state.quantities[id]||0)+delta)):Math.max(0,Math.round(((state.quantities[id]||0)+delta)*10)/10);
  state.quantities[id]=n;
  document.getElementById('qty-'+id).textContent=n;
  document.getElementById('pc-'+id).classList.toggle('selected',n>0);
  updateSummary();
}
function updateSummary(){
  const items=getOrderItems();
  const block=document.getElementById('summaryBlock');
  if(!items.length){block.style.display='none';return;}
  block.style.display='block';
  let total=0,html='';
  items.forEach(i=>{const sub=i.qty*i.price;total+=sub;const u=i.unit||'кг';html+=`<div class="summary-row"><span class="summary-name">${i.emoji} ${lang==='uz'?i.nameUz:i.name}</span><span><span class="summary-qty">${i.qty} ${u}</span><span class="summary-price"> · ${fmt(sub)}</span></span></div>`;});
  html+=`<div class="total-row"><span class="total-label">${lang==='uz'?'Jami:':'Итого:'}</span><span class="total-amount">${fmt(total)} so'm</span></div>`;
  document.getElementById('orderSummary').innerHTML=html;
}
function getOrderItems(){return PRODUCTS.filter(p=>(state.quantities[p.id]||0)>0).map(p=>({...p,qty:state.quantities[p.id]}));}
function getTotal(){return getOrderItems().reduce((s,i)=>s+i.qty*i.price,0);}
function selectPayment(el){document.querySelectorAll('.payment-pills .pill').forEach(p=>p.classList.remove('selected'));el.classList.add('selected');state.selectedPayment=el.dataset.pay;}

// SUBMIT
async function submitOrder(){
  const clientId=document.getElementById('clientSelect').value;
  if(!clientId){showToast('⚠️ '+(lang==='uz'?'Mijozni tanlang':'Выберите клиента'),'error');return;}
  const items=getOrderItems();
  if(!items.length){showToast('⚠️ '+(lang==='uz'?'Mahsulot qo\'shing':'Добавьте продукт'),'error');return;}
  const client=state.clients.find(c=>c.id==clientId);
  const order={
    id:Date.now(),date:new Date().toISOString(),
    client:client.name,clientId:client.id,
    phone:document.getElementById('clientPhone').value||client.phone||'',
    type:document.getElementById('clientType').value,
    items,total:getTotal(),payment:state.selectedPayment,
    note:document.getElementById('orderNote').value,
    sent:false,sentSheets:false,
    debtPaid:state.selectedPayment!=='консигнация',
    partialPaid:0,
    delivered:false,
  };
  state.orders.unshift(order);save();updateBadges();
  const btn=document.getElementById('submitBtn');btn.innerHTML='<div class="spinner"></div>';btn.disabled=true;
  let tgOk=false,sheetOk=false;
  try{tgOk=await sendToTelegram(order);}catch(e){}
  try{sheetOk=await sendToSheets(order);}catch(e){}
  if(tgOk)order.sent=true;if(sheetOk)order.sentSheets=true;save();
  btn.innerHTML='✅ '+(lang==='uz'?'Buyurtmani rasmiylashtirish':'Оформить заказ');btn.disabled=false;
  showToast(tgOk||sheetOk?'✅ '+(lang==='uz'?'Yuborildi':'Отправлено'):'⚠️ Локально',tgOk||sheetOk?'success':'info');
  resetOrder();updateBadges();renderFavorites();
}

// TELEGRAM
async function sendToTelegram(order){
  const{tgToken,tgChatId}=state.settings;if(!tgToken||!tgChatId)return false;
  if(!navigator.onLine){
    offlineQueue.push({id:order.id,type:'telegram',text:buildTgMsg(order)});
    localStorage.setItem('offlineQueue',JSON.stringify(offlineQueue));
    return false;
  }
  const r=await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:tgChatId,text:buildTgMsg(order),parse_mode:'HTML'})});
  return(await r.json()).ok;
}
function buildTgMsg(order){
  const pi={'наличные':'💵','клик':'📱','консигнация':'📝'};
  const d=new Date(order.date);
  const ds=d.toLocaleDateString('ru-RU')+' '+d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
  let l=[`🥗 <b>НОВЫЙ ЗАКАЗ</b>`,``,`👤 <b>${order.client}</b>`];
  if(order.phone)l.push(`📞 ${order.phone}`);
  l.push(``,'📦 <b>Заказ:</b>');
  order.items.forEach((i,n)=>l.push(`  ${n+1}. ${i.emoji} ${i.name} — <b>${i.qty}${i.unit||'кг'}</b> (${fmt(i.qty*i.price)} so'm)`));
  l.push(``,`💰 <b>Итого: ${fmt(order.total)} so'm</b>`,`${pi[order.payment]||'💳'} ${order.payment}`);
  if(order.note)l.push(`📝 ${order.note}`);
  l.push(``,`🕐 ${ds}`);
  return l.join('\n');
}
async function sendToSheets(order){
  const url=state.settings.sheetsUrl;if(!url)return false;
  await fetch(url,{method:'POST',mode:'no-cors',headers:{'Content-Type':'application/json'},body:JSON.stringify({date:new Date(order.date).toLocaleString('ru-RU'),client:order.client,phone:order.phone,type:order.type,payment:order.payment,total:order.total,note:order.note||'',items:order.items.map(i=>`${i.name}:${i.qty}${i.unit||'кг'}`).join(', '),funchoza:order.items.find(i=>i.id==='funchoza')?.qty||0,morkovcha:order.items.find(i=>i.id==='morkovcha')?.qty||0,sologurc:order.items.find(i=>i.id==='sologurc')?.qty||0,kapusta:order.items.find(i=>i.id==='kapusta')?.qty||0,kuksi:order.items.find(i=>i.id==='kuksi')?.qty||0})});
  return true;
}

// DAY SUMMARY TELEGRAM
async function sendDaySummary(){
  const{tgToken,tgChatId}=state.settings;
  if(!tgToken||!tgChatId){showToast('⚠️ Настройте Telegram','error');return;}
  const today=new Date().toDateString();
  const todayOrders=state.orders.filter(o=>new Date(o.date).toDateString()===today);
  const totalRev=todayOrders.reduce((s,o)=>s+o.total,0);
  const debts=state.orders.filter(o=>o.payment==='консигнация'&&!o.debtPaid);
  const totalDebt=debts.reduce((s,o)=>s+o.total-(o.partialPaid||0),0);
  const prodTotals={};PRODUCTS.forEach(p=>{prodTotals[p.id]=0;});
  todayOrders.forEach(o=>o.items.forEach(i=>{if(prodTotals[i.id]!==undefined)prodTotals[i.id]+=i.qty;}));
  const prodLines=PRODUCTS.map(p=>prodTotals[p.id]>0?`  ${p.emoji} ${p.name}: <b>${prodTotals[p.id]}${p.unit||'кг'}</b>`:'').filter(Boolean);
  const d=new Date();
  const lines=[
    `📊 <b>СВОДКА ЗА ДЕНЬ — ${d.toLocaleDateString('ru-RU')}</b>`,``,
    `📦 <b>Заказов:</b> ${todayOrders.length}`,
    `💰 <b>Выручка:</b> ${fmt(totalRev)} so'm`,``,
    `📦 <b>Продано:</b>`,
    ...prodLines,``,
    `💸 <b>Общий долг (консигнация):</b> ${fmt(totalDebt)} so'm`,
    `👥 <b>Должников:</b> ${new Set(debts.map(o=>o.clientId)).size}`,
  ];
  try{
    const r=await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:tgChatId,text:lines.join('\n'),parse_mode:'HTML'})});
    if((await r.json()).ok)showToast('✅ Сводка отправлена!','success');else showToast('❌ Ошибка Telegram','error');
  }catch(e){showToast('❌ Сеть','error');}
}

// ORDERS LIST
function renderOrdersList(filterText='',dateFilter=state.dateFilter){
  state.dateFilter=dateFilter;
  let orders=[...state.orders];
  if(filterText)orders=orders.filter(o=>o.client.toLowerCase().includes(filterText.toLowerCase()));
  const now=new Date();
  if(dateFilter==='today')orders=orders.filter(o=>new Date(o.date).toDateString()===now.toDateString());
  else if(dateFilter==='week'){const w=new Date(now-7*86400000);orders=orders.filter(o=>new Date(o.date)>w);}
  const list=document.getElementById('ordersList');
  if(!orders.length){list.innerHTML=`<div class="empty"><div class="empty-icon">📋</div><div class="empty-text">${T[lang].noOrders}</div></div>`;return;}
  const pi={'наличные':'💵','клик':'📱','консигнация':'📝'};
  const pc={'наличные':'','клик':'click','консигнация':'consign'};
  list.innerHTML=orders.map(o=>{
    const d=new Date(o.date);
    const ds=d.toLocaleDateString('ru-RU')+' '+d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
    return`<div class="order-item payment-${pc[o.payment]}">
      <div class="order-top">
        <div><div class="order-client">${o.client}</div><div class="order-meta">${ds} · ${o.type}</div></div>
        <div><div class="order-badge ${pc[o.payment]}">${pi[o.payment]||'💳'} ${o.payment}</div>
        <div style="margin-top:4px">${o.sent?'<span class="sent-badge">✅ TG</span>':'<span class="unsent-badge">❌ TG</span>'}</div></div>
      </div>
      <div class="order-items">${o.items.map(i=>`${i.emoji} ${lang==='uz'?i.nameUz:i.name}: <b>${i.qty}${i.unit||'кг'}</b>`).join(' · ')}</div>
      ${o.note?`<div style="font-size:12px;color:var(--text3);margin-top:4px">📝 ${o.note}</div>`:''}
      <div class="order-total">${fmt(o.total)} so'm ${o.payment==='консигнация'&&!o.debtPaid?`<span class="tag orange">${lang==='uz'?'Qarz':'Долг'} ${o.partialPaid?fmt(o.partialPaid)+' to\'landi':''}</span>`:''}</div>
      <div class="order-actions">
        <button class="btn btn-primary btn-sm" onclick="showOrderDetail(${o.id})">👁</button>
        <button class="btn btn-outline btn-sm" onclick="openEditOrderModal(${o.id})">✏️</button>
        <button class="btn btn-outline btn-sm" onclick="copyOrder(${o.id})" title="${lang==='uz'?'Nusxa':'Копировать'}">📋</button>
        <button class="btn btn-outline btn-sm" onclick="printInvoice(${o.id})">🖨️</button>
        <button class="btn btn-outline btn-sm" onclick="resendOrderById(${o.id})">📤</button>
        <button class="btn btn-danger btn-sm" onclick="deleteOrder(${o.id})">🗑</button>
      </div>
    </div>`;
  }).join('');
}
function filterOrders(v){renderOrdersList(v);}
function filterByDate(f,el){document.querySelectorAll('#page-orders .pill').forEach(p=>p.classList.remove('selected'));el.classList.add('selected');renderOrdersList(document.getElementById('ordersSearch').value,f);}

async function resendOrderById(id){
  const o=state.orders.find(x=>x.id==id);if(!o)return;
  showToast('📤...','info');
  try{if(await sendToTelegram(o)){o.sent=true;save();showToast('✅ TG','success');renderOrdersList();}else showToast('❌','error');}catch(e){showToast('❌','error');}
}
function deleteOrder(id){
  if(!confirm(lang==='uz'?'O\'chirishni tasdiqlaysizmi?':'Удалить заказ?'))return;
  state.orders=state.orders.filter(o=>o.id!=id);save();renderOrdersList();updateBadges();
}
function copyOrder(id){
  const o=state.orders.find(x=>x.id==id);if(!o)return;
  document.getElementById('clientSelect').value=o.clientId;
  state.quantities={};
  o.items.forEach(i=>{state.quantities[i.id]=i.qty;});
  state.selectedPayment=o.payment||'наличные';
  document.querySelectorAll('.payment-pills .pill').forEach(p=>{p.classList.toggle('selected',p.dataset.pay===state.selectedPayment);});
  document.getElementById('orderNote').value=o.note||'';
  renderProductsGrid();
  o.items.forEach(i=>{const el=document.getElementById('qty-'+i.id);if(el)el.textContent=i.qty;const pc=document.getElementById('pc-'+i.id);if(pc&&i.qty>0)pc.classList.add('selected');});
  updateSummary();showPage('new-order');
  showToast('📋 '+(lang==='uz'?'Nusxa olindi':'Скопировано'),'info');
}
function openEditOrderModal(id){
  const o=state.orders.find(x=>x.id==id);if(!o)return;
  editingOrderId=id;
  document.getElementById('editOrderClient').value=o.clientId||'';
  document.getElementById('editOrderNote').value=o.note||'';
  document.getElementById('editOrderPayment').value=o.payment||'наличные';
  const qWrap=document.getElementById('editOrderQtys');
  qWrap.innerHTML=PRODUCTS.map(p=>{
    const item=o.items.find(i=>i.id===p.id);
    const qty=item?item.qty:0;
    const u=p.unit||'кг';const st=p.step||0.5;
    return`<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)">
      <div><div style="font-weight:600">${p.emoji} ${p.name}</div><div style="font-size:12px;color:var(--text2)">${fmt(p.price)} / ${u}</div></div>
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
  const clientId=document.getElementById('editOrderClient').value;
  const client=state.clients.find(c=>c.id==clientId);
  if(clientId&&client){o.clientId=clientId;o.client=client.name;}
  o.payment=document.getElementById('editOrderPayment').value;
  o.note=document.getElementById('editOrderNote').value;
  o.debtPaid=o.payment!=='консигнация';
  const newItems=PRODUCTS.map(p=>{
    const qty=parseFloat(document.getElementById('eqty-'+p.id).textContent)||0;
    return qty>0?{...p,qty}:null;
  }).filter(Boolean);
  o.items=newItems;o.total=newItems.reduce((s,i)=>s+i.qty*i.price,0);o.sent=false;
  save();closeModal('editOrderModal');renderOrdersList();renderDebts();updateBadges();
  showToast('✅ '+(lang==='uz'?'Saqlandi':'Сохранено'),'success');
}
function showOrderDetail(id){
  const o=state.orders.find(x=>x.id==id);if(!o)return;
  state.currentOrderId=id;
  document.getElementById('detailTitle').textContent='📋 '+o.client;
  const pi={'наличные':'💵','клик':'📱','консигнация':'📝'};
  const d=new Date(o.date);
  document.getElementById('detailContent').innerHTML=`
    <div class="order-summary">
      ${o.items.map(i=>`<div class="summary-row"><span class="summary-name">${i.emoji} ${lang==='uz'?i.nameUz:i.name}</span><span class="summary-qty">${i.qty}${i.unit||'кг'} · ${fmt(i.qty*i.price)} so'm</span></div>`).join('')}
      <div class="total-row"><span class="total-label">${lang==='uz'?'Jami:':'Итого:'}</span><span class="total-amount">${fmt(o.total)} so'm</span></div>
    </div>
    <div style="font-size:13px;color:var(--text2);line-height:2">
      ${pi[o.payment]||'💳'} <b>${o.payment}</b> · 📅 ${d.toLocaleDateString('ru-RU')} ${d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}
      ${o.phone?`<br>📞 ${o.phone}`:''}${o.note?`<br>📝 ${o.note}`:''}
    </div>`;
  openModal('orderDetailModal');
}
async function resendOrder(){
  if(!state.currentOrderId)return;
  const o=state.orders.find(x=>x.id==state.currentOrderId);if(!o)return;
  const btn=document.getElementById('detailSendBtn');btn.innerHTML='<div class="spinner"></div>';btn.disabled=true;
  let ok=false;try{ok=await sendToTelegram(o);}catch(e){}
  if(ok){o.sent=true;save();}
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
  const debtOrders=state.orders.filter(o=>o.payment==='консигнация'&&!o.debtPaid);
  const byClient={};
  debtOrders.forEach(o=>{
    if(!byClient[o.clientId])byClient[o.clientId]={name:o.client,total:0,paid:0,orders:[]};
    byClient[o.clientId].total+=o.total;
    byClient[o.clientId].paid+=(o.partialPaid||0);
    byClient[o.clientId].orders.push(o);
  });
  const totalDebt=Object.values(byClient).reduce((s,c)=>s+(c.total-c.paid),0);
  document.getElementById('totalDebtAmount').textContent=fmt(totalDebt)+' so\'m';
  document.getElementById('debtsCount').textContent=Object.keys(byClient).length;
  const list=document.getElementById('debtsList');
  if(!Object.keys(byClient).length){list.innerHTML=`<div class="empty"><div class="empty-icon">✅</div><div class="empty-text">${T[lang].noDebts}</div></div>`;return;}
  list.innerHTML=Object.entries(byClient).map(([cid,data])=>{
    const remaining=data.total-data.paid;
    return`<div class="debt-item">
      <div class="debt-client">${data.name}</div>
      <div class="debt-amount">${fmt(remaining)} so'm</div>
      ${data.paid>0?`<div style="font-size:12px;color:var(--green)">✅ ${lang==='uz'?'To\'langan':'Оплачено'}: ${fmt(data.paid)} so'm</div>`:''}
      <div class="debt-meta">${lang==='uz'?'Buyurtmalar':'Заказов'}: ${data.orders.length}</div>
      <div class="debt-orders">${data.orders.map(o=>{const d=new Date(o.date);return`• ${d.toLocaleDateString('ru-RU')} — ${fmt(o.total)} so'm${o.partialPaid?` (${lang==='uz'?'qoldi':'осталось'}: ${fmt(o.total-o.partialPaid)})`:''}`}).join('<br>')}</div>
      <button class="debt-paid-btn" onclick="markDebtPaid('${cid}')">✅ ${lang==='uz'?"To'ladi":'Оплатил'}</button>
      <button class="debt-partial-btn" onclick="openPartialPay('${cid}',${remaining},'${data.name}')">💰 ${lang==='uz'?'Qisman to\'lov':'Частично'}</button>
    </div>`;
  }).join('');
}
function markDebtPaid(clientId){
  if(!confirm(lang==='uz'?"To'lashni tasdiqlaysizmi?":'Отметить как оплаченный?'))return;
  state.orders.forEach(o=>{if(o.clientId==clientId&&o.payment==='консигнация')o.debtPaid=true;});
  save();renderDebts();updateBadges();showToast('✅ '+(lang==='uz'?"To'landi":'Оплачено'),'success');
}
function openPartialPay(clientId,remaining,name){
  partialClientId=clientId;
  document.getElementById('partialClientInfo').textContent=`${name} — ${lang==='uz'?'Qarz':'Долг'}: ${fmt(remaining)} so'm`;
  document.getElementById('partialAmount').value='';
  document.getElementById('partialRemaining').textContent='';
  openModal('partialPayModal');
}
function updatePartialRemaining(){
  if(!partialClientId)return;
  const debtOrders=state.orders.filter(o=>o.clientId==partialClientId&&o.payment==='консигнация'&&!o.debtPaid);
  const total=debtOrders.reduce((s,o)=>s+o.total-(o.partialPaid||0),0);
  const paid=parseFloat(document.getElementById('partialAmount').value)||0;
  const rem=Math.max(0,total-paid);
  document.getElementById('partialRemaining').textContent=`${lang==='uz'?'Qoladi':'Останется'}: ${fmt(rem)} so'm`;
}
function applyPartialPayment(){
  if(!partialClientId)return;
  const paid=parseFloat(document.getElementById('partialAmount').value)||0;
  if(paid<=0){showToast('⚠️ Введите сумму','error');return;}
  let rem=paid;
  const debtOrders=state.orders.filter(o=>o.clientId==partialClientId&&o.payment==='консигнация'&&!o.debtPaid);
  debtOrders.forEach(o=>{
    const owed=o.total-(o.partialPaid||0);
    if(rem>=owed){o.debtPaid=true;rem-=owed;}
    else{o.partialPaid=(o.partialPaid||0)+rem;rem=0;}
  });
  save();closeModal('partialPayModal');renderDebts();updateBadges();
  showToast('✅ '+fmt(paid)+' so\'m '+( lang==='uz'?'qo\'shildi':'зачислено'),'success');
}

// DELIVERY
function renderDelivery(){
  const today=new Date().toDateString();
  const todayOrders=state.orders.filter(o=>new Date(o.date).toDateString()===today);
  const total=todayOrders.length;
  const done=todayOrders.filter(o=>o.delivered).length;
  document.getElementById('deliveryCount').textContent=total-done||'';
  document.getElementById('deliverySubtitle').textContent=`${lang==='uz'?'Jami':'Всего'}: ${total} · ${lang==='uz'?'Bajarildi':'Доставлено'}: ${done}`;
  const list=document.getElementById('deliveryList');
  if(!total){list.innerHTML=`<div class="empty"><div class="empty-icon">🚚</div><div class="empty-text">${T[lang].noOrders}</div></div>`;return;}
  list.innerHTML=todayOrders.map((o,i)=>`
    <div class="delivery-item ${o.delivered?'done':''}" id="ditem-${o.id}">
      ${o.delivered?'<div class="delivery-check">✅</div>':`<div class="delivery-num">${i+1}</div>`}
      <div class="delivery-info">
        <div class="delivery-client">${o.client}</div>
        <div class="delivery-details">${o.items.map(i=>`${i.emoji}${i.qty}${i.unit||'кг'}`).join(' ')} · ${fmt(o.total)} so'm</div>
        ${o.phone?`<div class="delivery-details">📞 ${o.phone}</div>`:''}
      </div>
      ${!o.delivered?`<button class="delivery-done-btn" onclick="markDelivered(${o.id})">✅ ${lang==='uz'?'Yetkazildi':'Доставлено'}</button>`:`<span style="font-size:12px;color:var(--green);font-weight:700">${lang==='uz'?'Bajarildi':'Доставлено'}</span>`}
    </div>`).join('');
}
function markDelivered(id){
  const o=state.orders.find(x=>x.id==id);if(!o)return;
  o.delivered=true;save();renderDelivery();showToast('✅ '+(lang==='uz'?'Yetkazildi':'Доставлено'),'success');
}
function resetDelivery(){
  const today=new Date().toDateString();
  state.orders.filter(o=>new Date(o.date).toDateString()===today).forEach(o=>o.delivered=false);
  save();renderDelivery();
}

// CLIENTS
function populateClientSelect(){
  const sel=document.getElementById('clientSelect');const cur=sel.value;
  sel.innerHTML=`<option value="">${lang==='uz'?'— Mijozni tanlang —':'— Выберите клиента —'}</option>`+
    state.clients.map(c=>`<option value="${c.id}">${c.name} (${c.type})</option>`).join('');
  if(cur)sel.value=cur;
}
function renderClientsList(filterText=''){
  const list=document.getElementById('clientsList');
  let clients=state.clients;
  if(filterText)clients=clients.filter(c=>c.name.toLowerCase().includes(filterText.toLowerCase()));
  if(!clients.length){list.innerHTML=`<div class="empty"><div class="empty-icon">👥</div><div class="empty-text">${T[lang].noClients}</div></div>`;return;}
  const ti={'кафе':'☕','фаст-фуд':'🍔','ресторан':'🍽️','другое':'📍'};
  list.innerHTML=clients.map(c=>{
    const orders=state.orders.filter(o=>o.clientId==c.id);
    const debt=state.orders.filter(o=>o.clientId==c.id&&o.payment==='консигнация'&&!o.debtPaid).reduce((s,o)=>s+(o.total-(o.partialPaid||0)),0);
    return`<div class="client-item" id="citem-${c.id}">
      <div class="client-avatar" onclick="showClientHistory('${c.id}')" style="cursor:pointer">${c.name.charAt(0).toUpperCase()}</div>
      <div style="flex:1;min-width:0;cursor:pointer" onclick="showClientHistory('${c.id}')">
        <div class="client-name">${c.name} ${debt>0?`<span class="tag orange">💰${fmt(debt)}</span>`:''}</div>
        <div class="client-info">${ti[c.type]||'📍'} ${c.type}${c.phone?' · '+c.phone:''}</div>
        <div class="client-info">${lang==='uz'?'Buyurtmalar':'Заказов'}: <b>${orders.length}</b> · ${fmt(orders.reduce((s,o)=>s+o.total,0))} so'm</div>
      </div>
      <div style="display:flex;gap:5px;flex-shrink:0">
        <button onclick="openCoordModal(${c.id})" style="background:rgba(90,180,247,.12);border:1px solid rgba(90,180,247,.3);color:var(--blue);border-radius:10px;padding:8px 9px;cursor:pointer;font-size:14px;transition:all .2s" title="Координаты">${c.lat?'📍':'🗺️'}</button>
        <button onclick="openEditClientModal(${c.id})" style="background:rgba(124,106,247,.12);border:1px solid rgba(124,106,247,.3);color:var(--accent);border-radius:10px;padding:8px 9px;cursor:pointer;font-size:14px;transition:all .2s">✏️</button>
        <button onclick="deleteClient(${c.id})" style="background:rgba(247,90,90,.12);border:1px solid rgba(247,90,90,.3);color:var(--danger);border-radius:10px;padding:8px 9px;cursor:pointer;font-size:14px;transition:all .2s">🗑</button>
      </div>
    </div>`;
  }).join('');
}
function filterClients(v){renderClientsList(v);}
function deleteClient(id){
  const c=state.clients.find(x=>x.id==id);if(!c)return;
  const orderCount=state.orders.filter(o=>o.clientId==id).length;
  const msg=lang==='uz'
    ?`"${c.name}"ni o'chirishni tasdiqlaysizmi?${orderCount?' ('+orderCount+' ta buyurtma ham o\'chadi)':''}`
    :`Удалить клиента "${c.name}"?${orderCount?' ('+orderCount+' заказов тоже будут удалены)':''}`;
  if(!confirm(msg))return;
  state.clients=state.clients.filter(x=>x.id!=id);
  state.orders=state.orders.filter(o=>o.clientId!=id);
  save();populateClientSelect();renderClientsList();updateBadges();
  showToast('🗑 '+(lang==='uz'?"O'chirildi":'Удалён'),'info');
  syncClientsToSheets(true);
}
async function syncClientsToSheets(silent=false){
  const url=state.settings.sheetsUrl;
  if(!url){if(!silent)showToast('⚠️ '+(lang==='uz'?"Sheets URL yo'q":'Нет Sheets URL'),'error');return;}
  const btn=document.getElementById('syncBtn');
  if(btn&&!silent){btn.innerHTML='<div class="spinner" style="border-color:rgba(255,255,255,.3);border-top-color:white;display:inline-block"></div>';btn.disabled=true;}
  try{
    await fetch(url,{method:'POST',mode:'no-cors',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({action:'sync_clients',clients:state.clients})});
    if(!silent)showToast('✅ '+(lang==='uz'?'Mijozlar sinxronlandi':'Клиенты синхронизированы'),'success');
  }catch(e){
    if(!silent)showToast('❌ Ошибка','error');
  }finally{
    if(btn&&!silent){btn.innerHTML='☁️ '+(lang==='uz'?'Mijozlarni Sheetsga yuklash':'Синхронизировать клиентов → Sheets');btn.disabled=false;}
  }
}
function openEditClientModal(id){
  const c=state.clients.find(x=>x.id==id);if(!c)return;
  editingClientId=id;
  document.getElementById('editClientName').value=c.name||'';
  document.getElementById('editClientPhone').value=c.phone||'';
  document.getElementById('editClientType').value=c.type||'кафе';
  document.getElementById('editClientAddress').value=c.address||'';
  openModal('editClientModal');
}
function saveEditClient(){
  const name=document.getElementById('editClientName').value.trim();
  if(!name){showToast('⚠️ Введите имя','error');return;}
  const c=state.clients.find(x=>x.id==editingClientId);if(!c)return;
  c.name=name;c.phone=document.getElementById('editClientPhone').value.trim();
  c.type=document.getElementById('editClientType').value;c.address=document.getElementById('editClientAddress').value.trim();
  state.orders.forEach(o=>{if(o.clientId==editingClientId)o.client=name;});
  save();populateClientSelect();renderClientsList();closeModal('editClientModal');
  showToast('✅ '+(lang==='uz'?'Saqlandi':'Сохранено'),'success');
  syncClientsToSheets(true);
}
function showClientHistory(clientId){
  const client=state.clients.find(c=>c.id==clientId);if(!client)return;
  const orders=state.orders.filter(o=>o.clientId==clientId).sort((a,b)=>new Date(b.date)-new Date(a.date));
  document.getElementById('historyTitle').textContent='📋 '+client.name;
  const prodCount={};orders.forEach(o=>o.items.forEach(i=>{prodCount[i.id]=(prodCount[i.id]||0)+i.qty;}));
  const favProds=Object.entries(prodCount).sort((a,b)=>b[1]-a[1]).slice(0,3)
    .map(([id,qty])=>{const p=PRODUCTS.find(x=>x.id===id);return p?`<span class="fav-product-tag">${p.emoji} ${lang==='uz'?p.nameUz:p.name} ${qty}${p.unit||'кг'}`:'';}).join('');
  document.getElementById('historyFavProducts').innerHTML=favProds?`<div style="font-size:12px;color:var(--text2);margin-bottom:5px">❤️ ${lang==='uz'?'Sevimli':'Любимые'}:</div><div class="fav-products">${favProds}</div>`:'';
  document.getElementById('historyContent').innerHTML=!orders.length
    ?`<div class="empty" style="padding:20px"><div class="empty-text">${T[lang].noOrders}</div></div>`
    :orders.map(o=>{
      const d=new Date(o.date);const pi={'наличные':'💵','клик':'📱','консигнация':'📝'};
      return`<div class="history-order">
        <div class="history-date">${d.toLocaleDateString('ru-RU')} ${d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})} · ${pi[o.payment]||''} ${o.payment}</div>
        <div class="history-items">${o.items.map(i=>`${i.emoji} ${lang==='uz'?i.nameUz:i.name}: ${i.qty}${i.unit||'кг'}`).join(' · ')}</div>
        ${o.note?`<div style="font-size:11px;color:var(--text3);margin-top:3px">📝 ${o.note}</div>`:''}
        <div class="history-total">${fmt(o.total)} so'm ${o.payment==='консигнация'&&!o.debtPaid?`<span class="tag orange">${lang==='uz'?'Qarz':'Долг'}</span>`:''}</div>
      </div>`;
    }).join('');
  openModal('clientHistoryModal');
}
function openNewClientModal(){['newClientName','newClientPhone','newClientAddress'].forEach(id=>document.getElementById(id).value='');openModal('newClientModal');}
function saveNewClient(){
  const name=document.getElementById('newClientName').value.trim();
  if(!name){showToast('⚠️ '+(lang==='uz'?'Ism kiriting':'Введите имя'),'error');return;}
  state.clients.push({id:Date.now(),name,phone:document.getElementById('newClientPhone').value.trim(),type:document.getElementById('newClientType').value,address:document.getElementById('newClientAddress').value.trim(),createdAt:new Date().toISOString()});
  save();populateClientSelect();renderClientsList();closeModal('newClientModal');showToast('✅ '+name,'success');syncClientsToSheets(true);
}

// STATS
function renderStats(){
  const orders=state.orders;
  const today=new Date().toDateString();
  const todayO=orders.filter(o=>new Date(o.date).toDateString()===today);
  const totalRev=orders.reduce((s,o)=>s+o.total,0);
  const todayRev=todayO.reduce((s,o)=>s+o.total,0);
  document.getElementById('statsGrid').innerHTML=`
    <div class="stat-card"><div class="stat-val">${orders.length}</div><div class="stat-label">${T[lang].totalOrders}</div></div>
    <div class="stat-card"><div class="stat-val">${todayO.length}</div><div class="stat-label">${T[lang].todayOrders}</div></div>
    <div class="stat-card"><div class="stat-val" style="font-size:16px">${fmt(totalRev)}</div><div class="stat-label">${T[lang].totalRev}</div></div>
    <div class="stat-card"><div class="stat-val" style="font-size:16px">${fmt(todayRev)}</div><div class="stat-label">${T[lang].todayRev}</div></div>`;
  renderAvgStats();renderWeekCompare();renderChart();renderForecast();renderTopClients();renderMonthlyReport();renderSeasonality();
  const ps={};PRODUCTS.forEach(p=>{ps[p.id]={name:lang==='uz'?p.nameUz:p.name,emoji:p.emoji,qty:0,rev:0,cost:p.cost||0,unit:p.unit||'кг'};});
  orders.forEach(o=>o.items.forEach(i=>{if(ps[i.id]){ps[i.id].qty+=i.qty;ps[i.id].rev+=i.qty*i.price;}}));
  const sorted=Object.values(ps).sort((a,b)=>b.qty-a.qty);
  const hasCosts=PRODUCTS.some(p=>p.cost>0);
  document.getElementById('productStats').innerHTML=`<div class="card-title" style="margin-bottom:12px">📦 ${T[lang].products}</div>${sorted.map(p=>{
    const margin=p.cost>0?p.rev-(p.qty*p.cost):null;
    return`<div class="summary-row"><span>${p.emoji} ${p.name}</span><div style="text-align:right"><div><b>${p.qty}${p.unit}</b> · <span class="summary-price">${fmt(p.rev)} so'm</span></div>${margin!==null?`<div style="font-size:11px;color:${margin>=0?'var(--green)':'var(--danger)'}">${lang==='uz'?'Foyda':'Маржа'}: ${fmt(margin)} so'm</div>`:''}</div></div>`;
  }).join('')}`;
}

function renderAvgStats(){
  const orders=state.orders;
  if(!orders.length){document.getElementById('avgStats').innerHTML=`<div style="color:var(--text3);font-size:13px">${T[lang].noOrders}</div>`;return;}
  const avg=orders.reduce((s,o)=>s+o.total,0)/orders.length;
  // By day of week
  const byDay=[0,0,0,0,0,0,0],cntDay=[0,0,0,0,0,0,0];
  orders.forEach(o=>{const wd=(new Date(o.date).getDay()+6)%7;byDay[wd]+=o.total;cntDay[wd]++;});
  const maxDay=Math.max(...byDay.map((s,i)=>cntDay[i]?s/cntDay[i]:0),1);
  // By client
  const byC={};orders.forEach(o=>{if(!byC[o.clientId])byC[o.clientId]={name:o.client,total:0,cnt:0};byC[o.clientId].total+=o.total;byC[o.clientId].cnt++;});
  const topC=Object.values(byC).sort((a,b)=>(b.total/b.cnt)-(a.total/a.cnt)).slice(0,3);
  document.getElementById('avgStats').innerHTML=`
    <div class="avg-chip"><span>📊</span><span style="font-weight:700">${lang==='uz'?'Umumiy o\'rtacha':'Общий средний чек'}:</span><span style="color:var(--accent);font-weight:900">${fmt(avg)} so'm</span></div>
    <div style="margin-bottom:12px">
      <div style="font-size:12px;color:var(--text2);margin-bottom:8px;font-weight:600">${lang==='uz'?'Hafta kunlari bo\'yicha':'По дням недели'}:</div>
      ${T[lang].weekDays.map((d,i)=>{
        const a=cntDay[i]?byDay[i]/cntDay[i]:0;const w=Math.round(a/maxDay*100);
        return`<div class="compare-bar-wrap"><div class="compare-label"><span>${d}</span><span>${a?fmt(a)+' so\'m':'-'}</span></div><div class="compare-bar-bg"><div class="compare-bar-fill" style="width:${w}%;background:linear-gradient(90deg,var(--accent),var(--accent2))"></div></div></div>`;
      }).join('')}
    </div>
    <div style="font-size:12px;color:var(--text2);margin-bottom:8px;font-weight:600">${lang==='uz'?'Mijozlar bo\'yicha top':'Топ по среднему чеку'}:</div>
    ${topC.map((c,i)=>`<div class="top-client-row"><div class="top-rank">${['🥇','🥈','🥉'][i]}</div><div style="flex:1"><div style="font-weight:700">${c.name}</div><div style="font-size:12px;color:var(--text2)">${c.cnt} ${lang==='uz'?'buyurtma':'заказов'}</div></div><div style="font-weight:800;color:var(--accent2)">${fmt(c.total/c.cnt)} so'm</div></div>`).join('')}`;
}

function renderWeekCompare(){
  const now=new Date();
  const startThisWeek=new Date(now);startThisWeek.setDate(now.getDate()-(now.getDay()+6)%7);startThisWeek.setHours(0,0,0,0);
  const startLastWeek=new Date(startThisWeek);startLastWeek.setDate(startThisWeek.getDate()-7);
  const thisWeekO=state.orders.filter(o=>new Date(o.date)>=startThisWeek);
  const lastWeekO=state.orders.filter(o=>new Date(o.date)>=startLastWeek&&new Date(o.date)<startThisWeek);
  const thisRev=thisWeekO.reduce((s,o)=>s+o.total,0);
  const lastRev=lastWeekO.reduce((s,o)=>s+o.total,0);
  const maxRev=Math.max(thisRev,lastRev,1);
  const diff=lastRev?Math.round((thisRev-lastRev)/lastRev*100):100;
  const arrow=diff>=0?'📈':'📉';
  document.getElementById('weekCompare').innerHTML=`
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
  for(let i=days-1;i>=0;i--){
    const d=new Date();d.setDate(d.getDate()-i);d.setHours(0,0,0,0);
    const k=d.toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'});cur[k]=0;
    const d2=new Date(d);d2.setDate(d2.getDate()-days);
    const k2=d2.toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'});prev[k2]=0;
  }
  state.orders.forEach(o=>{
    const d=new Date(o.date);d.setHours(0,0,0,0);
    const k=d.toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'});
    if(cur[k]!==undefined)cur[k]+=o.total;
    const d2=new Date(d);d2.setDate(d2.getDate()+days);
    const k2=d2.toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'});
    if(prev[k2]!==undefined)prev[k2]+=o.total;
  });
  const curE=Object.entries(cur);const prevE=Object.entries(prev);
  const maxV=Math.max(...curE.map(e=>e[1]),...prevE.map(e=>e[1]),1);
  document.getElementById('chartBars').innerHTML=curE.map(([label,val],i)=>{
    const hc=Math.max(3,Math.round(val/maxV*90));
    const hp=Math.max(3,Math.round((prevE[i]?.[1]||0)/maxV*90));
    return`<div class="chart-bar-col">
      <div style="display:flex;gap:2px;align-items:flex-end">
        <div class="chart-bar prev" style="height:${hp}px" title="${fmt(prevE[i]?.[1]||0)}"></div>
        <div class="chart-bar cur" style="height:${hc}px" title="${fmt(val)}"></div>
      </div>
      <div class="chart-label">${label}</div>
    </div>`;
  }).join('');
  document.getElementById('chartLegend').innerHTML=`
    <div><span class="legend-dot" style="background:linear-gradient(var(--accent),var(--accent2))"></span>${lang==='uz'?'Bu davr':'Текущий'}</div>
    <div><span class="legend-dot" style="background:rgba(124,106,247,.4)"></span>${lang==='uz'?'Oldingi':'Предыдущий'}</div>`;
}

function renderForecast(){
  const byDay=[{s:0,c:0},{s:0,c:0},{s:0,c:0},{s:0,c:0},{s:0,c:0},{s:0,c:0},{s:0,c:0}];
  state.orders.forEach(o=>{const wd=(new Date(o.date).getDay()+6)%7;byDay[wd].s+=o.total;byDay[wd].c++;});
  const tmrWd=(new Date().getDay()+7)%7;// tomorrow
  const tmr=new Date();tmr.setDate(tmr.getDate()+1);
  const tmrDayWd=(tmr.getDay()+6)%7;
  const forecast=byDay[tmrDayWd];
  const avgF=forecast.c?Math.round(forecast.s/forecast.c):0;
  // Product forecast
  const prodByDay=PRODUCTS.map(p=>{
    let s=0,c=0;
    state.orders.forEach(o=>{if((new Date(o.date).getDay()+6)%7===tmrDayWd){const it=o.items.find(i=>i.id===p.id);if(it){s+=it.qty;c++;}}});
    return{...p,avgQty:c?Math.round(s/c*10)/10:0};
  }).filter(p=>p.avgQty>0);
  document.getElementById('forecastBlock').innerHTML=!avgF
    ?`<div style="color:var(--text3);font-size:13px">${lang==='uz'?'Ma\'lumot yetarli emas':'Недостаточно данных'}</div>`
    :`<div class="avg-chip" style="margin-bottom:10px"><span>📅</span><span>${T[lang].tomorrow} (${T[lang].weekDays[tmrDayWd]})</span></div>
    <div style="font-size:22px;font-weight:900;color:var(--accent);margin-bottom:8px">~${fmt(avgF)} so'm</div>
    <div style="font-size:13px;color:var(--text2);margin-bottom:10px">${lang==='uz'?'Kutilayotgan buyurtmalar':'Ожид. заказов'}: ~${forecast.c}</div>
    ${prodByDay.length?`<div style="font-size:12px;color:var(--text2);margin-bottom:6px;font-weight:600">${lang==='uz'?'Taxminiy kerak':'Примерно нужно'}:</div>${prodByDay.map(p=>`<div class="forecast-row"><div class="forecast-day">${p.emoji} ${lang==='uz'?p.nameUz:p.name}</div><div class="forecast-amt">~${p.avgQty}${p.unit||'кг'}</div></div>`).join('')}`:''}`;
}

function renderTopClients(){
  const byC={};state.orders.forEach(o=>{if(!byC[o.clientId])byC[o.clientId]={name:o.client,total:0,count:0};byC[o.clientId].total+=o.total;byC[o.clientId].count++;});
  const top=Object.values(byC).sort((a,b)=>b.total-a.total).slice(0,5);
  const ranks=['🥇','🥈','🥉','4️⃣','5️⃣'];
  document.getElementById('topClients').innerHTML=!top.length
    ?`<div style="color:var(--text3);font-size:13px">${T[lang].noOrders}</div>`
    :top.map((c,i)=>`<div class="top-client-row"><div class="top-rank">${ranks[i]}</div><div style="flex:1"><div style="font-weight:700">${c.name}</div><div style="font-size:12px;color:var(--text2)">${c.count} ${lang==='uz'?'buyurtma':'заказов'}</div></div><div style="font-weight:800;color:var(--accent2)">${fmt(c.total)} so'm</div></div>`).join('');
}

// ==================== MONTHLY REPORT + SEASONALITY ====================
function renderMonthlyReport(){
  const el=document.getElementById('monthlyReport');if(!el)return;
  const months={};
  state.orders.forEach(o=>{
    const d=new Date(o.date);
    const key=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
    if(!months[key])months[key]={label:d.toLocaleDateString(lang==='uz'?'uz-UZ':'ru-RU',{month:'long',year:'numeric'}),rev:0,count:0,debt:0};
    months[key].rev+=o.total;months[key].count++;
    if(o.payment==='консигнация'&&!o.debtPaid)months[key].debt+=(o.total-(o.partialPaid||0));
  });
  const entries=Object.entries(months).sort((a,b)=>b[0].localeCompare(a[0])).slice(0,12);
  if(!entries.length){el.innerHTML=`<div style="color:var(--text3);font-size:13px">${T[lang].noOrders}</div>`;return;}
  const maxRev=Math.max(...entries.map(e=>e[1].rev),1);
  el.innerHTML=entries.map(([key,m])=>`
    <div style="padding:8px 0;border-bottom:1px solid var(--border)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <div style="font-weight:600;font-size:13px;text-transform:capitalize">${m.label}</div>
        <div style="text-align:right">
          <div style="font-weight:800;color:var(--accent2)">${fmt(m.rev)} so'm</div>
          <div style="font-size:11px;color:var(--text3)">${m.count} ${lang==='uz'?'buyurtma':'заказов'}${m.debt>0?' · <span style="color:var(--orange)">💰'+fmt(m.debt)+'</span>':''}</div>
        </div>
      </div>
      <div style="background:var(--bg3);border-radius:100px;height:6px;overflow:hidden">
        <div style="height:100%;border-radius:100px;background:linear-gradient(90deg,var(--accent),var(--accent2));width:${Math.round(m.rev/maxRev*100)}%;transition:width .6s"></div>
      </div>
    </div>`).join('');
}
function renderSeasonality(){
  const el=document.getElementById('seasonalityBlock');if(!el)return;
  const days=[0,0,0,0,0,0,0],cnts=[0,0,0,0,0,0,0];
  state.orders.forEach(o=>{const wd=(new Date(o.date).getDay()+6)%7;days[wd]+=o.total;cnts[wd]++;});
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
  el.innerHTML=PRODUCTS.map((p,i)=>`
    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:12px;margin-bottom:8px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <span style="font-size:22px">${p.emoji}</span>
        <div style="flex:1;font-weight:700">${p.name} <span style="font-size:11px;font-weight:400;color:var(--text3)">(${p.unit||'кг'})</span></div>
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
    </div>`).join('');
}
function updateProductPrice(idx,val){
  const newPrice=parseInt(val)||0;if(!newPrice)return;
  const p=PRODUCTS[idx];p.price=newPrice;saveProducts();
  if(confirm(lang==='uz'?`Eski buyurtmalarni qayta hisoblash? (${p.name})`:`Пересчитать старые заказы по новой цене? (${p.name})`)){
    state.orders.forEach(o=>{const item=o.items.find(i=>i.id===p.id);if(item){item.price=newPrice;o.total=o.items.reduce((s,i)=>s+i.qty*i.price,0);}});
    save();
  }
  renderProductsGrid();renderProductsSettings();showToast('✅ '+(lang==='uz'?'Narx yangilandi':'Цена обновлена'),'success');
}
function updateProductCost(idx,val){
  PRODUCTS[idx].cost=parseInt(val)||0;saveProducts();renderProductsSettings();
  showToast('✅ '+(lang==='uz'?'Tannarx saqlandi':'Себестоимость сохранена'),'success');
}
function deleteProduct(idx){
  const p=PRODUCTS[idx];
  if(!confirm(lang==='uz'?`"${p.name}"ni o'chirishni tasdiqlaysizmi?`:`Удалить продукт "${p.name}"?`))return;
  PRODUCTS.splice(idx,1);saveProducts();renderProductsGrid();renderProductsSettings();
  showToast('🗑 '+(lang==='uz'?"O'chirildi":'Удалён'),'info');
}
function openAddProductModal(){
  ['newProdName','newProdNameUz','newProdEmoji','newProdPrice','newProdCost'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('newProdUnit').value='кг';
  openModal('addProductModal');
}
function saveNewProduct(){
  const name=document.getElementById('newProdName').value.trim();
  const price=parseInt(document.getElementById('newProdPrice').value)||0;
  if(!name||!price){showToast('⚠️ '+(lang==='uz'?'Nom va narx kiriting':'Введите название и цену'),'error');return;}
  const unit=document.getElementById('newProdUnit').value;
  PRODUCTS.push({id:'prod_'+Date.now(),name,nameUz:document.getElementById('newProdNameUz').value.trim()||name,
    price,cost:parseInt(document.getElementById('newProdCost').value)||0,
    emoji:document.getElementById('newProdEmoji').value.trim()||'📦',unit,step:unit==='шт'?1:0.5});
  saveProducts();closeModal('addProductModal');renderProductsGrid();renderProductsSettings();
  showToast('✅ '+name,'success');
}
function exportToExcel(){
  const rows=[['Дата','Клиент','Телефон','Тип','Оплата','Фунчоза','Морковча','Сол огурцы','Капуста','Куксу','Итого','Примечание']];
  state.orders.forEach(o=>{const d=new Date(o.date);rows.push([d.toLocaleDateString('ru-RU')+' '+d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}),o.client,o.phone,o.type,o.payment,o.items.find(i=>i.id==='funchoza')?.qty||0,o.items.find(i=>i.id==='morkovcha')?.qty||0,o.items.find(i=>i.id==='sologurc')?.qty||0,o.items.find(i=>i.id==='kapusta')?.qty||0,o.items.find(i=>i.id==='kuksi')?.qty||0,o.total,o.note||'']);});
  const csv=rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8;'}));
  a.download='СалатПро_'+new Date().toLocaleDateString('ru-RU').replace(/\./g,'-')+'.csv';a.click();
  showToast('📊 '+(lang==='uz'?'Yuklandi':'Скачано'),'success');
}

// SETTINGS
function loadSettings(){const s=state.settings;if(s.tgToken)document.getElementById('tgToken').value=s.tgToken;if(s.tgChatId)document.getElementById('tgChatId').value=s.tgChatId;if(s.sheetsUrl)document.getElementById('sheetsUrl').value=s.sheetsUrl;}
function saveSettings(){state.settings.tgToken=document.getElementById('tgToken').value.trim();state.settings.tgChatId=document.getElementById('tgChatId').value.trim();state.settings.sheetsUrl=document.getElementById('sheetsUrl').value.trim();localStorage.setItem('settings',JSON.stringify(state.settings));showToast('✅ '+(lang==='uz'?'Saqlandi':'Сохранено'),'success');}
async function testTelegram(){saveSettings();const{tgToken,tgChatId}=state.settings;if(!tgToken||!tgChatId){showToast('⚠️','error');return;}try{const r=await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:tgChatId,text:'🥗 <b>СалатПро</b> — тест ✅',parse_mode:'HTML'})});if((await r.json()).ok)showToast('✅ Telegram OK!','success');else showToast('❌','error');}catch(e){showToast('❌','error');}}
function showScriptCode(){document.getElementById('scriptCode').textContent=`function doPost(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var data = JSON.parse(e.postData.contents);

  // Тест
  if (data.test) return ContentService.createTextOutput("OK").setMimeType(ContentService.MimeType.TEXT);

  // Синхронизация клиентов
  if (data.action === 'sync_clients') {
    var cs = ss.getSheetByName("Клиенты") || ss.insertSheet("Клиенты");
    cs.clear();
    cs.appendRow(["ID","Имя / Заведение","Телефон","Тип","Адрес","Дата добавления"]);
    var clients = data.clients;
    if (clients && clients.length > 0) {
      var rows = clients.map(function(c) {
        return [c.id, c.name, c.phone||'', c.type||'', c.address||'',
                new Date(c.createdAt).toLocaleString('ru-RU')];
      });
      cs.getRange(2,1,rows.length,rows[0].length).setValues(rows);
    }
    return ContentService.createTextOutput("Clients Synced").setMimeType(ContentService.MimeType.TEXT);
  }

  // Сохранение заказа
  var sheet = ss.getSheetByName("Заказы") || ss.insertSheet("Заказы");
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["Дата","Клиент","Телефон","Тип",
      "Фунчоза (кг)","Морковча (кг)","Сол огурцы (кг)",
      "Сладкая капуста (кг)","Куксу (шт)",
      "Итого (сум)","Оплата","Примечание"]);
  }
  sheet.appendRow([data.date,data.client,data.phone||'',data.type||'',
    data.funchoza||0,data.morkovcha||0,data.sologurc||0,
    data.kapusta||0,data.kuksi||0,
    data.total,data.payment,data.note||'']);
  return ContentService.createTextOutput("OK").setMimeType(ContentService.MimeType.TEXT);
}`;}
function copyScript(){navigator.clipboard.writeText(document.getElementById('scriptCode').textContent).then(()=>showToast('📋 '+(lang==='uz'?'Nusxalandi':'Скопировано'),'success'));}
function clearAllData(){if(!confirm(lang==='uz'?'Barchasini o\'chirishni tasdiqlaysizmi?':'Очистить ВСЕ данные?'))return;localStorage.clear();state.clients=[];state.orders=[];state.settings={};populateClientSelect();renderAll();showToast('🗑️','info');}

// UTILS
function fmt(n){return Math.round(n).toLocaleString('ru-RU');}
// ==================== DASHBOARD ====================
function renderDashboard(){
  const el=document.getElementById('dashboardContent');if(!el)return;
  const now=new Date();
  const todayStr=now.toDateString();
  const todayOrders=state.orders.filter(o=>new Date(o.date).toDateString()===todayStr);
  const todayRev=todayOrders.reduce((s,o)=>s+o.total,0);
  const todayCount=todayOrders.length;
  const todayDelivered=todayOrders.filter(o=>o.delivered).length;
  const allDebts=state.orders.filter(o=>o.payment==='консигнация'&&!o.debtPaid);
  const totalDebt=allDebts.reduce((s,o)=>s+(o.total-(o.partialPaid||0)),0);
  const debtClients=new Set(allDebts.map(o=>o.clientId)).size;
  const unsent=state.orders.filter(o=>!o.sent).length;
  const weekStart=new Date(now);weekStart.setDate(now.getDate()-(now.getDay()+6)%7);weekStart.setHours(0,0,0,0);
  const weekRev=state.orders.filter(o=>new Date(o.date)>=weekStart).reduce((s,o)=>s+o.total,0);
  const prodToday={};PRODUCTS.forEach(p=>prodToday[p.id]=0);
  todayOrders.forEach(o=>o.items.forEach(i=>{if(prodToday[i.id]!==undefined)prodToday[i.id]+=i.qty;}));
  const prodRows=PRODUCTS.filter(p=>prodToday[p.id]>0).map(p=>`
    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.08)">
      <span style="font-size:15px">${p.emoji} ${lang==='uz'?p.nameUz:p.name}</span>
      <span style="font-weight:800;font-size:18px">${prodToday[p.id]} <span style="font-size:11px;opacity:.7">${p.unit||'кг'}</span></span>
    </div>`).join('')||`<div style="opacity:.5;font-size:13px;padding:12px 0">${lang==='uz'?'Bugun buyurtma yo\'q':'Сегодня заказов нет'}</div>`;
  const timeStr=now.toLocaleTimeString(lang==='uz'?'uz':'ru-RU',{hour:'2-digit',minute:'2-digit'});
  const dateStr=now.toLocaleDateString(lang==='uz'?'uz':'ru-RU',{weekday:'long',day:'numeric',month:'long'});
  el.innerHTML=`
    <div style="text-align:center;margin-bottom:20px">
      <div style="font-size:56px;font-weight:900;letter-spacing:-2px;background:linear-gradient(135deg,var(--accent),var(--accent2));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;line-height:1">${timeStr}</div>
      <div style="font-size:13px;color:var(--text2);margin-top:4px;text-transform:capitalize">${dateStr}</div>
      <div style="display:inline-flex;align-items:center;gap:6px;margin-top:6px;font-size:11px;color:var(--text3)"><div id="onlineIndicator" style="width:8px;height:8px;border-radius:50%;background:var(--green);flex-shrink:0"></div>${lang==='uz'?'Onlayn':'Онлайн'}</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
      <div style="background:linear-gradient(135deg,rgba(124,106,247,.2),rgba(86,212,160,.1));border:1px solid rgba(124,106,247,.3);border-radius:16px;padding:16px;text-align:center">
        <div style="font-size:10px;color:var(--text2);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">${lang==='uz'?'Bugun':'Сегодня'}</div>
        <div style="font-size:26px;font-weight:900;color:var(--accent2)">${fmt(todayRev)}</div>
        <div style="font-size:10px;color:var(--text3);margin-top:2px">so'm · ${todayCount} ${lang==='uz'?'ta':'шт'}</div>
      </div>
      <div style="background:linear-gradient(135deg,rgba(90,180,247,.15),rgba(124,106,247,.1));border:1px solid rgba(90,180,247,.3);border-radius:16px;padding:16px;text-align:center">
        <div style="font-size:10px;color:var(--text2);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">${lang==='uz'?'Bu hafta':'Эта неделя'}</div>
        <div style="font-size:26px;font-weight:900;color:var(--blue)">${fmt(weekRev)}</div>
        <div style="font-size:10px;color:var(--text3);margin-top:2px">so'm</div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px">
      <div onclick="showPage('delivery')" style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px;text-align:center;cursor:pointer" active>
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
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <button onclick="showPage('new-order')" class="btn btn-primary" style="border-radius:14px;padding:14px 10px;font-size:13px">➕ ${lang==='uz'?'Buyurtma':'Заказ'}</button>
      <button onclick="sendDaySummary()" class="btn btn-outline" style="border-radius:14px;padding:14px 10px;font-size:13px">📤 ${lang==='uz'?'Xisobot':'Отчёт'}</button>
    </div>`;
  updateOnlineIndicator();
}

// ==================== MAP ====================
let mapInstance=null;
let markersLayer=null;

function renderMap(){
  const el=document.getElementById('mapContainer');if(!el)return;
  const today=new Date().toDateString();
  const todayOrders=state.orders.filter(o=>new Date(o.date).toDateString()===today);
  const todayClientIds=new Set(todayOrders.map(o=>String(o.clientId)));
  const clientsWithCoords=state.clients.filter(c=>c.lat&&c.lng);
  const routeClients=clientsWithCoords.filter(c=>todayClientIds.has(String(c.id)));
  const routeEl=document.getElementById('mapRouteList');
  if(routeEl){
    routeEl.innerHTML=routeClients.length?routeClients.map((c,i)=>{
      const ord=todayOrders.filter(o=>o.clientId==c.id);
      return`<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
        <div style="width:26px;height:26px;border-radius:50%;background:linear-gradient(135deg,var(--accent),var(--accent2));display:flex;align-items:center;justify-content:center;color:white;font-weight:900;font-size:12px;flex-shrink:0">${i+1}</div>
        <div style="flex:1"><div style="font-weight:700;font-size:14px">${c.name}</div><div style="font-size:12px;color:var(--text2)">${ord.map(o=>o.items.map(i=>`${i.emoji}${i.qty}${i.unit||'кг'}`).join(' ')).join(' | ')}</div></div>
        <a href="https://maps.google.com/?q=${c.lat},${c.lng}" target="_blank" style="padding:6px 10px;background:var(--bg3);border:1px solid var(--border);border-radius:8px;color:var(--accent);font-size:12px;font-weight:700;text-decoration:none">🗺️</a>
      </div>`;
    }).join(''):`<div style="color:var(--text3);font-size:13px;padding:8px 0">${lang==='uz'?'Koordinata yo\'q':'Нет координат у клиентов с заказами'}</div>`;
  }
  const mapsBtn=document.getElementById('openMapsBtn');
  if(mapsBtn&&routeClients.length>=1){
    const wps=routeClients.map(c=>`${c.lat},${c.lng}`).join('/');
    mapsBtn.href=`https://www.google.com/maps/dir/${wps}`;
    mapsBtn.style.display='flex';
  } else if(mapsBtn){mapsBtn.style.display='none';}
  if(!window.L){
    const lnk=document.createElement('link');lnk.rel='stylesheet';lnk.href='https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';document.head.appendChild(lnk);
    const scr=document.createElement('script');scr.src='https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    scr.onload=()=>initLeafletMap(clientsWithCoords,routeClients);document.head.appendChild(scr);
  } else if(!mapInstance){initLeafletMap(clientsWithCoords,routeClients);}
  else{updateLeafletMarkers(clientsWithCoords,routeClients);}
}
function initLeafletMap(all,route){
  const center=all.length?[all[0].lat,all[0].lng]:[41.2995,69.2401];
  mapInstance=L.map('leafletMap').setView(center,12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OSM'}).addTo(mapInstance);
  markersLayer=L.layerGroup().addTo(mapInstance);
  updateLeafletMarkers(all,route);
}
function updateLeafletMarkers(all,route){
  if(!mapInstance||!markersLayer)return;
  markersLayer.clearLayers();
  const rIds=new Set(route.map(c=>c.id));
  all.forEach((c,idx)=>{
    const isR=rIds.has(c.id);
    const num=isR?route.findIndex(x=>x.id===c.id)+1:c.name.charAt(0);
    const clr=isR?'#7c6af7':'#56d4a0';
    const icon=L.divIcon({html:`<div style="background:${clr};color:white;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:13px;border:2px solid white;box-shadow:0 2px 8px rgba(0,0,0,.3)">${num}</div>`,className:'',iconSize:[32,32],iconAnchor:[16,16]});
    const debt=state.orders.filter(o=>o.clientId==c.id&&o.payment==='консигнация'&&!o.debtPaid).reduce((s,o)=>s+(o.total-(o.partialPaid||0)),0);
    L.marker([c.lat,c.lng],{icon}).addTo(markersLayer).bindPopup(`<b>${c.name}</b><br>${c.type}<br>${state.orders.filter(o=>o.clientId==c.id).length} заказов${debt>0?'<br>💰 '+fmt(debt)+' so\'m':''}`);
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
  c.lat=lat;c.lng=lng;save();syncClientsToSheets(true);closeModal('coordModal');
  if(mapInstance){updateLeafletMarkers(state.clients.filter(x=>x.lat&&x.lng),state.clients.filter(x=>x.lat&&x.lng));}
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
    sent.forEach(qid=>{const o=state.orders.find(x=>x.id==qid);if(o)o.sent=true;});
    save();updateBadges();renderOrdersList();
    showToast(`✅ ${sent.length} ${lang==='uz'?'ta yuborildi':'отправлено (оффлайн очередь)'}`, 'success');
  }
}

function save(){localStorage.setItem('clients',JSON.stringify(state.clients));localStorage.setItem('orders',JSON.stringify(state.orders));}
function updateBadges(){
  const unsent=state.orders.filter(o=>!o.sent).length;
  const badge=document.getElementById('pendingBadge');badge.style.display=unsent?'flex':'none';badge.textContent=unsent;
  document.getElementById('ordersCount').textContent=state.orders.length;
  const debtClients=new Set(state.orders.filter(o=>o.payment==='консигнация'&&!o.debtPaid).map(o=>o.clientId)).size;
  document.getElementById('debtsCount').textContent=debtClients||'';
  const today=new Date().toDateString();
  const pendingDelivery=state.orders.filter(o=>new Date(o.date).toDateString()===today&&!o.delivered).length;
  document.getElementById('deliveryCount').textContent=pendingDelivery||'';
}
function resetOrder(){state.quantities={};state.selectedPayment='наличные';document.getElementById('clientSelect').value='';document.getElementById('clientPhone').value='';document.getElementById('orderNote').value='';document.getElementById('summaryBlock').style.display='none';renderProductsGrid();document.querySelectorAll('.payment-pills .pill').forEach((p,i)=>p.classList.toggle('selected',i===0));}
function showToast(msg,type='info'){const t=document.getElementById('toast');t.textContent=msg;t.className='toast '+type+' show';setTimeout(()=>t.className='toast '+type,3000);}
function openModal(id){document.getElementById(id).classList.add('open');}
function closeModal(id){document.getElementById(id).classList.remove('open');}
document.querySelectorAll('.modal-overlay').forEach(overlay=>{overlay.addEventListener('click',e=>{if(e.target===overlay)overlay.classList.remove('open');});});

init();
if('serviceWorker' in navigator){navigator.serviceWorker.register('sw.js').catch(()=>{});}
// ==================== SWIPE NAVIGATION ====================
const PAGE_ORDER = [
  'dashboard','new-order','orders','debts',
  'delivery','clients','stats','products','map','settings'
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
