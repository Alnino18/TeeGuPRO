const firebaseConfig = {
  apiKey: "AIzaSyBpa1Bfj4L8q1itRh1BjHgyzIyIi-rzmSk",
  authDomain: "dostavka-b53d8.firebaseapp.com",
  projectId: "dostavka-b53d8",
  storageBucket: "dostavka-b53d8.firebasestorage.app",
  messagingSenderId: "1029089462422",
  appId: "1:1029089462422:web:937317b437139f31771ab7"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

let allAgents = [];
let myOrders = [];

const DEFAULT_PRODUCTS = [
  {id:'funchoza', name:'Фунчоза', nameUz:'Funchoza', price:25000, emoji:'🍜', unit:'kg'},
  {id:'morkovcha',name:'Морковча', nameUz:'Sabzi', price:25000, emoji:'🥕', unit:'kg'},
  {id:'sologurc', name:'Сол огурцы', nameUz:'Tuzlangan bodring', price:20000, emoji:'🥒', unit:'kg'},
  {id:'kapusta', name:'Сладкая капуста', nameUz:'Shirin karam', price:20000, emoji:'🥬', unit:'kg'},
  {id:'kuksi', name:'Кукси', nameUz:'Kuksi', price:35000, emoji:'🍝', unit:'шт'},
];
let PRODUCTS = DEFAULT_PRODUCTS;

let CLIENTS = [];
let cart = {};

let currentLat = null;
let currentLng = null;
let agentMapInstance = null;
let SETTINGS = {};
let AGENT_RULES = [];
try {
  const _cachedRules = JSON.parse(localStorage.getItem('teegu_business_rules') || 'null');
  if (Array.isArray(_cachedRules)) AGENT_RULES = _cachedRules;
} catch (e) {}
let UNPAID_ORDERS = [];

let loggedAgentName = localStorage.getItem('agentAuth') || null;

db.collection('settings').doc('main').onSnapshot(snap => {
  if (snap.exists) {
    SETTINGS = snap.data();
    if (Array.isArray(SETTINGS.businessRules)) {
      AGENT_RULES = SETTINGS.businessRules;
      try { localStorage.setItem('teegu_business_rules', JSON.stringify(AGENT_RULES)); } catch (e) {}
      try { renderProducts(); } catch (e) {}
    }
    if (SETTINGS.uiConfig && typeof applySharedUiConfig === 'function') {
      applySharedUiConfig(SETTINGS.uiConfig, 'agent');
    }
  }
});

db.collection('agents').onSnapshot(snap => {
  allAgents = snap.docs.map(d => d.data());
  const select = document.getElementById('agentSelect');
  if(select) {
    select.innerHTML = '<option value="">-- Tanlang --</option>' + allAgents.map(a => `<option value="${a.name}">${a.name}</option>`).join('');
  }
}, err => {
  alert("Firebase xatosi: " + err.message + "\nIltimos, Firebase Rules'da agents uchun ruxsat borligini tekshiring.");
});

function init() {
  if (loggedAgentName) {
    showMainScreen();
    startListeners();
  } else {
    showLoginScreen();
  }
}

function showLoginScreen() {
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('mainScreen').style.display = 'none';
}

function showMainScreen() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('mainScreen').style.display = 'block';
  document.getElementById('agentNameDisplay').innerText = loggedAgentName;
}

function login() {
  const name = document.getElementById('agentSelect').value;
  const pin = document.getElementById('agentPin').value;
  
  if(!name || !pin) {
    showToast('Agent va PIN kodni kiriting', 'error');
    return;
  }
  
  const agent = allAgents.find(a => a.name === name);
  if(agent && String(agent.pin) === String(pin)) {
    loggedAgentName = name;
    localStorage.setItem('agentAuth', name);
    showToast('Tizimga kirdingiz', 'success');
    showMainScreen();
    startListeners();
  } else {
    showToast("Noto'g'ri PIN kod", 'error');
  }
}

function logout() {
  localStorage.removeItem('agentAuth');
  loggedAgentName = null;
  showLoginScreen();
}

function startListeners() {
  if(!loggedAgentName) return;
  
  // Listen for products
  db.collection('products').onSnapshot(snap => {
    PRODUCTS = snap.docs.map(d => d.data()).filter(Boolean).sort((a,b) => (a.order ?? 999) - (b.order ?? 999));
    renderProducts();
  });
  
  // Listen for clients
  db.collection('clients').onSnapshot(snap => {
    CLIENTS = snap.docs.map(d => d.data());
    const list = document.getElementById('clientList');
    list.innerHTML = CLIENTS.map(c => `<option value="${c.name}${c.phone ? ' — ' + c.phone : ''}"></option>`).join('');
  });
  
  // Listen for agent's recent orders
  db.collection('orders')
    .where('agent', '==', loggedAgentName)
    .onSnapshot(snap => {
      myOrders = snap.docs.map(d => d.data());
      // sort manually to avoid requiring Firestore composite index
      myOrders.sort((a,b) => b.id - a.id);
      renderHistory();
    }, err => {
      console.error("Orders listener error:", err);
    });

  // Track unpaid credit orders for dynamic business rule enforcement
  db.collection('orders')
    .where('debtPaid', '==', false)
    .onSnapshot(snap => {
      UNPAID_ORDERS = snap.docs.map(d => d.data());
    }, () => {});
}

function switchTab(tab) {
  document.getElementById('tab-new').classList.remove('active');
  document.getElementById('tab-history').classList.remove('active');
  
  document.getElementById('view-new').style.display = 'none';
  document.getElementById('view-history').style.display = 'none';
  
  document.getElementById('tab-'+tab).classList.add('active');
  document.getElementById('view-'+tab).style.display = 'block';
}


function onClientSelectChange() {
  const clientInput = document.getElementById('orderClient').value.trim();
  const found = CLIENTS.find(c => {
    const s = c.name + (c.phone ? ' — ' + c.phone : '');
    return s === clientInput || c.name === clientInput;
  });
  if (found) {
    if (found.address && !document.getElementById('orderAddress').value) {
      document.getElementById('orderAddress').value = found.address;
    }
    if (found.lat && found.lng) {
      currentLat = parseFloat(found.lat);
      currentLng = parseFloat(found.lng);
      document.getElementById('coordDisplay').style.display = 'block';
      document.getElementById('coordVal').innerText = currentLat.toFixed(5) + ', ' + currentLng.toFixed(5);
    }
  }
  renderProducts();
}

function getProductPrice(p) {
  const clientInput = document.getElementById('orderClient')?.value.trim();
  if (clientInput) {
    const found = CLIENTS.find(c => {
      const s = c.name + (c.phone ? ' — ' + c.phone : '');
      return s === clientInput || c.name === clientInput;
    });
    if (found && found.customPrices && found.customPrices[p.id]) {
      return found.customPrices[p.id];
    }
  }
  return p.price || 0;
}

function renderProducts() {
  const container = document.getElementById('productsList');
  if(!PRODUCTS.length) {
    container.innerHTML = 'Yuklanmoqda...';
    return;
  }
  
  container.innerHTML = PRODUCTS.map(p => {
    const qty = cart[p.id] || 0;
    const price = getProductPrice(p);
    const pName = p.nameUz || p.name || 'Mahsulot';
    const hasStock = p.stock !== undefined && p.stock !== null && p.stock !== '' && !isNaN(Number(p.stock));
    const stockVal = hasStock ? Math.round(Number(p.stock) * 100) / 100 : null;
    const minSt = getAgentProductMinStock(p);
    const stockBadge = hasStock
      ? `<span style="display:inline-block;margin-left:6px;padding:2px 7px;border-radius:8px;font-size:10px;font-weight:700;background:${stockVal <= minSt ? 'rgba(247,90,90,.16)' : 'rgba(45,212,160,.14)'};color:${stockVal <= minSt ? '#f75a5a' : '#2dd4a0'}">${stockVal <= 0 ? 'Tugagan (0 ' + (p.unit||'kg') + ')' : 'Sklad: ' + stockVal + ' ' + (p.unit||'kg')}</span>`
      : '';
    return `
      <div class="product-row">
        <div style="flex:1">
          <div style="font-weight:700; font-size:15px;">${p.emoji || '🥗'} ${pName}${stockBadge}</div>
          <div style="font-size:12px; color:var(--text2)">${Number(price).toLocaleString('ru-RU')} so'm / ${p.unit||'kg'}</div>
        </div>
        <div style="display:flex; align-items:center; gap:12px;">
          <button class="qty-btn" onclick="updateQty('${p.id}', -1)">-</button>
          <div style="font-weight:900; font-size:16px; width:24px; text-align:center;">${qty}</div>
          <button class="qty-btn" onclick="updateQty('${p.id}', 1)">+</button>
        </div>
      </div>
    `;
  }).join('');
  
  calcTotal();
}

function updateQty(id, sign) {
  if(!cart[id]) cart[id] = 0;
  
  const p = PRODUCTS.find(x => x.id === id);
  let step = 0.5;
  if(p && (p.unit === 'sht' || p.unit === 'dona' || p.unit === 'ta' || p.unit === 'шт')) {
    step = 1;
  }
  
  cart[id] += sign * step;
  
  // round to avoid floating point issues
  cart[id] = Math.round(cart[id] * 10) / 10;
  
  if(cart[id] < 0) cart[id] = 0;
  renderProducts();
}

function calcTotal() {
  let total = 0;
  PRODUCTS.forEach(p => {
    if(cart[p.id]) total += cart[p.id] * getProductPrice(p);
  });
  document.getElementById('orderTotalSum').innerText = Math.round(total).toLocaleString('ru-RU');
}

function submitOrder() {
  const clientInput = document.getElementById('orderClient').value.trim();
  const address = document.getElementById('orderAddress').value.trim();
  const payment = document.getElementById('orderPayment').value;
  const note = document.getElementById('orderNote').value.trim();
  
  if(!clientInput) {
    showToast('Mijozni kiriting yoki tanlang', 'error');
    return;
  }
  
  const items = [];
  let total = 0;
  PRODUCTS.forEach(p => {
    if(cart[p.id] > 0) {
      const price = getProductPrice(p);
      items.push({
        id: p.id,
        name: p.name || '',
        nameUz: p.nameUz || p.name || '',
        emoji: p.emoji || '🥗',
        qty: Number(cart[p.id]),
        price: Number(price) || 0,
        unit: p.unit || 'kg'
      });
      total += Number(cart[p.id]) * (Number(price) || 0);
    }
  });
  
  if(items.length === 0) {
    showToast("Hech qanday mahsulot tanlanmadi", 'error');
    return;
  }
  
  // Parse client name and phone
  let cName = clientInput;
  let cPhone = '';
  
  if(clientInput.includes(' — ')) {
    const parts = clientInput.split(' — ');
    cName = parts[0];
    cPhone = parts[1];
  } else {
    // try to extract phone if any
    const m = clientInput.match(/[\d\+\s\-\(\)]{9,}/);
    if(m) {
      cPhone = m[0].trim();
      cName = clientInput.replace(cPhone, '').trim();
    }
  }
  
  // Find existing client to reuse their ID, or create new ID
  let finalClientId = Date.now();
  const existingClient = CLIENTS.find(c => {
    const displayStr = c.name + (c.phone ? ' — ' + c.phone : '');
    return displayStr === clientInput || (c.name === cName && c.phone === cPhone) || c.name === cName;
  });
  
  if (existingClient && existingClient.id) {
    finalClientId = existingClient.id;
  }

  const ruleCheck = evaluateAgentOrderRules({
    clientId: existingClient ? existingClient.id : finalClientId,
    clientName: cName,
    items,
    payment,
    rules: AGENT_RULES,
    orders: UNPAID_ORDERS.length ? UNPAID_ORDERS : myOrders
  });
  if (ruleCheck.blocked) {
    showToast('🚫 ' + ruleCheck.errors[0], 'error');
    return;
  }

  const orderId = Date.now();
  const isDebt = payment === 'Qarz' || payment === 'консигнация';
  const orderData = {
    id: orderId,
    date: new Date().toISOString(),
    client: cName,
    clientId: finalClientId,
    phone: cPhone,
    address: address,
    items: items,
    total: total,
    payment: payment,
    note: note,
    status: 'new',
    type: 'Dostavka',
    agent: loggedAgentName,
    sent: false,
    delivered: false,
    sentSheets: false,
    courier: '',
    partialPaid: 0,
    debtPaid: !isDebt,
    stockDeducted: true
  };

  const batch = db.batch();
  const tgToken = SETTINGS.tgToken || atob('ODc5NjU4ODA3MTpBQUc4Wl9SOGhQOUVTWlpfM0x4VWFrRDhQQ1hqNUM1WlA2WQ==');
  const tgChatId = SETTINGS.tgChatId || '483325961';
  items.forEach(i => {
    const p = PRODUCTS.find(x => String(x.id) === String(i.id));
    if (p && p.stock !== undefined && p.stock !== null && p.stock !== '' && !isNaN(Number(p.stock))) {
      const newVal = Math.round((Number(p.stock) - Number(i.qty)) * 100) / 100;
      p.stock = newVal;
      const prodRef = db.collection('products').doc(String(p.id));
      const incVal = (typeof firebase !== 'undefined' && firebase.firestore && firebase.firestore.FieldValue && firebase.firestore.FieldValue.increment)
        ? firebase.firestore.FieldValue.increment(-i.qty)
        : newVal;
      batch.update(prodRef, { stock: incVal });
      const minSt = getAgentProductMinStock(p);
      if (newVal <= minSt && tgToken && tgChatId) {
        const warning = `⚠️ Diqqat! ${p.nameUz || p.name} zaxirasi kam qoldi (Agent buyurtmasi)! Qoldiq: ${newVal} ${p.unit||'kg'}`;
        fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: tgChatId, text: warning })
        }).catch(() => {});
      }
    }
  });
  batch.set(db.collection('orders').doc(String(orderId)), orderData);

  batch.commit()
    .then(async () => {
      // Also save client if new, or update coordinates if provided
      const cIdStr = String(orderData.clientId);
      
      const clientUpdate = {
        id: cIdStr,
        name: cName,
        phone: cPhone,
        address: address,
        type: existingClient ? (existingClient.type || 'кафе') : 'кафе'
      };
      
      if(currentLat && currentLng) {
        clientUpdate.lat = currentLat;
        clientUpdate.lng = currentLng;
      }
      
      if(!existingClient || (currentLat && currentLng)) {
        db.collection('clients').doc(cIdStr).set(clientUpdate, {merge: true});
      }
      
      sendToTelegram(orderData).then(ok => {
        if(ok) {
          db.collection('orders').doc(String(orderId)).update({sent: true});
        }
      });
      if (ruleCheck.largeOrderAlertKg && tgToken && tgChatId) {
        const bigMsg = `🚨 KATTA BUYURTMA (Agent: ${loggedAgentName}, ${ruleCheck.largeOrderAlertKg} kg)!\n👤 Mijoz: ${cName}`;
        fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: tgChatId, text: bigMsg })
        }).catch(() => {});
      }
      
      showToast("Buyurtma yuborildi!", 'success');
      
      // Reset form safely
      try {
        if(document.getElementById('orderClient')) document.getElementById('orderClient').value = '';
        if(document.getElementById('orderAddress')) document.getElementById('orderAddress').value = '';
        if(document.getElementById('orderNote')) document.getElementById('orderNote').value = '';
        if(document.getElementById('orderPayment')) document.getElementById('orderPayment').value = 'Naqd';
        if(document.getElementById('coordDisplay')) document.getElementById('coordDisplay').style.display = 'none';
      } catch(e) {}
      
      currentLat = null;
      currentLng = null;
      
      // Clear cart keys explicitly to avoid any reference issues
      Object.keys(cart).forEach(k => delete cart[k]);
      cart = {};
      
      renderProducts();
      switchTab('history');
    })
    .catch(err => {
      showToast("Xatolik: " + err.message, 'error');
    });
}

function renderHistory() {
  const container = document.getElementById('historyList');
  if(!myOrders.length) {
    container.innerHTML = `<div style="text-align:center; padding:40px; color:var(--text2)">Sizda hozircha buyurtmalar yo'q</div>`;
    return;
  }
  
  container.innerHTML = myOrders.map(o => {
    const d = new Date(o.date);
    const dateStr = d.toLocaleDateString('ru-RU') + ' ' + d.toLocaleTimeString('ru-RU', {hour:'2-digit', minute:'2-digit'});
    
    let statusText = '⏳ Yangi';
    let statusColor = 'var(--text2)';
    
    if (o.status === 'done') { statusText = '✅ Yetkazildi'; statusColor = 'var(--green)'; }
    else if (o.status === 'delivering') { statusText = '🛵 Yuborildi'; statusColor = 'var(--accent)'; }
    else if (o.status === 'accepted') { statusText = '🧑‍🍳 Tayyorlanmoqda'; statusColor = '#3b82f6'; }
    else if (o.status === 'cancelled') { statusText = '❌ Bekor qilindi'; statusColor = 'var(--danger)'; }
    
    return `
      <div class="order-card">
        <div class="order-header">
          <div class="order-id">#${o.id.toString().slice(-4)}</div>
          <div class="order-date">${dateStr}</div>
        </div>
        <div class="order-client">${o.client}</div>
        <div style="font-size:13px; color:var(--text2); margin-bottom:8px;">${o.items.map(i => i.qty + i.unit + ' ' + i.name).join(', ')}</div>
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div style="font-weight:900; font-size:16px;">${o.total.toLocaleString('ru-RU')} so'm</div>
          <div style="font-weight:700; font-size:13px; color:${statusColor}">${statusText}</div>
        </div>
      </div>
    `;
  }).join('');
}

function showToast(msg, type='info') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast ' + type + ' show';
  setTimeout(() => { t.className = 'toast ' + type; }, 3000);
}

// TELEGRAM LOGIC

function escapeHTML(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function sendToTelegram(order) {
  const tgToken = SETTINGS.tgToken || '8796588071:AAG8Z_R8hP9ESZZ_3LxUakD8PCXj5C5ZP6Y';
  const tgChatId = SETTINGS.tgChatId || '483325961';
  if(!tgToken || !tgChatId) return false;
  
  const pi = {'Naqd': '💵', 'Karta': '💳', 'Qarz': '📒'};
  const d = new Date(order.date);
  const ds = d.toLocaleDateString('ru-RU') + ' ' + d.toLocaleTimeString('ru-RU', {hour:'2-digit', minute:'2-digit'});
  let l = [`🆕 <b>Yangi buyurtma (Agent)</b>`, ``, `👤 <b>${escapeHTML(order.client)}</b>`];
  if(order.phone) l.push(`📞 ${escapeHTML(order.phone)}`);
  if(order.agent) l.push(`👨‍💼 Agent: <b>${escapeHTML(order.agent)}</b>`);
  l.push(``, `🛒 <b>Buyurtma:</b>`);
  order.items.forEach((i, n) => {
    l.push(`  ${n+1}. ${i.emoji||''} ${escapeHTML(i.name)} - <b>${i.qty}${escapeHTML(i.unit||'kg')}</b> (${Math.round(i.qty*i.price).toLocaleString('ru-RU')} so'm)`);
  });
  l.push(``, `💰 <b>Jami: ${Math.round(order.total).toLocaleString('ru-RU')} so'm</b>`, `${pi[order.payment]||'💳'} ${escapeHTML(order.payment)}`);
  if(order.note) l.push(`📝 ${escapeHTML(order.note)}`);
  if(order.address) l.push(`📍 ${escapeHTML(order.address)}`);
  l.push(``, `🕒 ${ds}`);
  
  try {
    const r = await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({chat_id: tgChatId, text: l.join('\n'), parse_mode: 'HTML'})
    });
    return (await r.json()).ok;
  } catch(e) {
    return false;
  }
}

// MAP LOGIC
function openAgentMap() {
  document.getElementById('agentMapModal').style.display = 'flex';
  
  if(!agentMapInstance && window.ymaps) {
    ymaps.ready(() => {
      const center = (currentLat && currentLng) ? [currentLat, currentLng] : [41.2995, 69.2401]; // Tashkent default
      agentMapInstance = new ymaps.Map("agentYandexMap", {
        center: center,
        zoom: 14,
        controls: ['zoomControl']
      });
    });
  } else if (agentMapInstance && currentLat && currentLng) {
    agentMapInstance.setCenter([currentLat, currentLng]);
  }
}

function closeAgentMap() {
  document.getElementById('agentMapModal').style.display = 'none';
}

function saveAgentMap() {
  if (agentMapInstance) {
    const center = agentMapInstance.getCenter();
    currentLat = center[0];
    currentLng = center[1];
    
    document.getElementById('coordDisplay').style.display = 'block';
    document.getElementById('coordVal').innerText = currentLat.toFixed(5) + ', ' + currentLng.toFixed(5);
    
    showToast("Joylashuv saqlandi!", 'success');
  }
  closeAgentMap();
}

function getMyLocation() {
  if (navigator.geolocation) {
    showToast("Joylashuv aniqlanmoqda...", 'info');
    navigator.geolocation.getCurrentPosition(
      position => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        if(agentMapInstance) {
          agentMapInstance.setCenter([lat, lng], 16);
        }
        showToast("Joylashuv topildi", 'success');
      },
      err => {
        showToast("Joylashuvni aniqlab bo'lmadi. GPS yoniqligiga ishonch hosil qiling.", 'error');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  } else {
    showToast("Qurilmangiz joylashuv aniqlashni qo'llab-quvvatlamaydi", 'error');
  }
}

function applySharedUiConfig(cfg, appName) {
  if (!cfg || typeof cfg !== 'object') return;
  try { localStorage.setItem('teegu_ui_config', JSON.stringify(cfg)); } catch (e) {}
  const cssLines = [];
  const rootRules = [];
  Object.entries(cfg.themeVars || {}).forEach(([k, v]) => {
    if (/^--[a-zA-Z0-9-]+$/.test(k) && v) {
      rootRules.push(`${k}: ${v} !important;`);
      if (typeof document !== 'undefined' && document.documentElement && document.documentElement.style && typeof document.documentElement.style.setProperty === 'function') {
        document.documentElement.style.setProperty(k, v);
      }
    }
  });
  if (cfg.layout && cfg.layout.radius) {
    rootRules.push(`--r: ${cfg.layout.radius} !important; --r2: ${cfg.layout.radius} !important;`);
  }
  if (rootRules.length) cssLines.push(`:root { ${rootRules.join(' ')} }`);
  if (cfg.layout && cfg.layout.fontScale) {
    cssLines.push(`body { font-size: ${Math.round(14 * cfg.layout.fontScale)}px !important; }`);
  }
  Object.entries(cfg.styles || {}).forEach(([sel, entry]) => {
    if (!entry) return;
    const sc = entry.scope || 'admin';
    if (sc !== 'all' && sc !== appName) return;
    const decls = Object.entries(entry.props || entry)
      .filter(([pk, pv]) => pk !== 'scope' && pv !== undefined && pv !== '')
      .map(([pk, pv]) => `${pk}: ${pv} !important;`);
    if (decls.length) cssLines.push(`${sel} { ${decls.join(' ')} }`);
  });
  Object.entries(cfg.visibility || {}).forEach(([sel, vis]) => {
    if (vis === false && sel && !/[<>{};]/.test(sel)) cssLines.push(`${sel} { display: none !important; }`);
  });
  if (typeof document !== 'undefined') {
    let styleEl = document.getElementById('teeguAiCustomStyles');
    if (!styleEl && document.head && typeof document.createElement === 'function') {
      styleEl = document.createElement('style');
      styleEl.id = 'teeguAiCustomStyles';
      if (typeof document.head.appendChild === 'function') document.head.appendChild(styleEl);
    }
    if (styleEl) styleEl.textContent = cssLines.join('\n');
    Object.entries(cfg.renames || {}).forEach(([sel, entry]) => {
      const val = typeof entry === 'string' ? entry : (entry && entry.text);
      const sc = typeof entry === 'object' && entry ? (entry.scope || 'admin') : 'admin';
      if (val && (sc === 'all' || sc === appName)) {
        try { const el = document.querySelector(sel); if (el) el.textContent = val; } catch (e) {}
      }
    });
  }
}

function getAgentProductMinStock(p) {
  if (Array.isArray(AGENT_RULES)) {
    const sp = AGENT_RULES.find(r => r && r.enabled && r.type === 'warehouse_low_alert_kg' && p && String(r.productId) === String(p.id));
    if (sp && !isNaN(Number(sp.thresholdKg))) return Math.max(0, Number(sp.thresholdKg));
    const gl = AGENT_RULES.find(r => r && r.enabled && r.type === 'warehouse_low_alert_kg' && (!r.productId || r.productId === 'all'));
    if (gl && !isNaN(Number(gl.thresholdKg))) return Math.max(0, Number(gl.thresholdKg));
  }
  return (p && p.minStock !== undefined && p.minStock !== null && p.minStock !== '' && !isNaN(Number(p.minStock))) ? Number(p.minStock) : 5;
}

function evaluateAgentOrderRules(opts = {}) {
  const { clientId, clientName, items = [], payment = '', rules = AGENT_RULES, orders = [] } = opts;
  const activeRules = (Array.isArray(rules) ? rules : []).filter(r => r && r.enabled);
  const errors = [];
  let largeOrderAlertKg = null;
  const isCredit = payment === 'Qarz' || payment === 'консигнация';
  const totalQty = items.reduce((s, i) => s + (Number(i.qty) || 0), 0);
  const totalKg = items.filter(i => !i.unit || !['шт', 'sht', 'dona', 'ta'].includes(String(i.unit).toLowerCase()))
    .reduce((s, i) => s + (Number(i.qty) || 0), 0) || totalQty;

  let unpaidTotal = 0;
  let oldestUnpaidDays = 0;
  const now = Date.now();
  (orders || []).forEach(o => {
    if (!o || o.status === 'cancelled' || o.debtPaid) return;
    if (String(o.clientId) !== String(clientId)) return;
    if (o.payment !== 'Qarz' && o.payment !== 'консигнация') return;
    const rem = Math.max(0, (Number(o.total) || 0) - (Number(o.partialPaid) || 0));
    if (rem > 0) {
      unpaidTotal += rem;
      const dAge = Math.floor((now - new Date(o.date).getTime()) / 86400000);
      if (dAge > oldestUnpaidDays) oldestUnpaidDays = dAge;
    }
  });

  activeRules.forEach(rule => {
    if (rule.type === 'block_debt_above' && isCredit && Number(rule.limit) > 0 && unpaidTotal > Number(rule.limit)) {
      errors.push(`Qoida: ${clientName || 'Mijoz'} qarzi (${Math.round(unpaidTotal).toLocaleString('ru-RU')} so'm) ${Math.round(Number(rule.limit)).toLocaleString('ru-RU')} limitidan oshgan — qarzga berilmaydi!`);
    } else if (rule.type === 'max_order_debt_days' && isCredit && Number(rule.maxDays) > 0 && unpaidTotal > 0 && oldestUnpaidDays >= Number(rule.maxDays)) {
      errors.push(`Qoida: ${oldestUnpaidDays} kunlik to'lanmagan qarz bor (limit ${rule.maxDays} kun)!`);
    } else if (rule.type === 'min_order_kg' && Number(rule.minKg) > 0 && totalKg > 0 && totalKg < Number(rule.minKg)) {
      errors.push(`Qoida: eng kam buyurtma ${rule.minKg} kg (hozir ${Math.round(totalKg * 10) / 10} kg)!`);
    } else if (rule.type === 'large_order_alert_kg' && Number(rule.thresholdKg) > 0 && totalKg >= Number(rule.thresholdKg)) {
      largeOrderAlertKg = Math.round(totalKg * 10) / 10;
    }
  });

  return { blocked: errors.length > 0, errors, largeOrderAlertKg };
}

try {
  const cachedUi = JSON.parse(localStorage.getItem('teegu_ui_config') || 'null');
  if (cachedUi) applySharedUiConfig(cachedUi, 'agent');
} catch (e) {}

init();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('../sw.js').catch(()=>{});
}
