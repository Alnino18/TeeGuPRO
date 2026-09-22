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
let PRODUCTS = [];
let CLIENTS = [];
let cart = {};

let currentLat = null;
let currentLng = null;
let agentMapInstance = null;
let SETTINGS = {};

let loggedAgentName = localStorage.getItem('agentAuth') || null;

db.collection('settings').doc('main').onSnapshot(snap => {
  if (snap.exists) SETTINGS = snap.data();
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
    PRODUCTS = snap.docs.map(d => d.data()).sort((a,b) => a.order - b.order);
    renderProducts();
  });
  
  // Listen for clients
  db.collection('clients').onSnapshot(snap => {
    CLIENTS = snap.docs.map(d => d.data());
    const list = document.getElementById('clientList');
    list.innerHTML = CLIENTS.map(c => `<option value="${c.name} — ${c.phone}"></option>`).join('');
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
}

function switchTab(tab) {
  document.getElementById('tab-new').classList.remove('active');
  document.getElementById('tab-history').classList.remove('active');
  
  document.getElementById('view-new').style.display = 'none';
  document.getElementById('view-history').style.display = 'none';
  
  document.getElementById('tab-'+tab).classList.add('active');
  document.getElementById('view-'+tab).style.display = 'block';
}

function renderProducts() {
  const container = document.getElementById('productsList');
  if(!PRODUCTS.length) {
    container.innerHTML = 'Yuklanmoqda...';
    return;
  }
  
  container.innerHTML = PRODUCTS.map(p => {
    const qty = cart[p.id] || 0;
    return `
      <div class="product-row">
        <div style="flex:1">
          <div style="font-weight:700; font-size:15px;">${p.emoji} ${p.name}</div>
          <div style="font-size:12px; color:var(--text2)">${p.price.toLocaleString('ru-RU')} so'm / ${p.unit||'kg'}</div>
        </div>
        <div style="display:flex; align-items:center; gap:12px;">
          <button class="qty-btn" onclick="updateQty('${p.id}', -1)">-</button>
          <div style="font-weight:900; font-size:16px; width:20px; text-align:center;">${qty}</div>
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
  if(p && (p.unit === 'sht' || p.unit === 'dona' || p.unit === 'ta')) {
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
    if(cart[p.id]) total += cart[p.id] * p.price;
  });
  document.getElementById('orderTotalSum').innerText = total.toLocaleString('ru-RU');
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
      items.push({
        id: p.id,
        name: p.name || '',
        emoji: p.emoji || '',
        qty: cart[p.id],
        price: p.price || 0,
        unit: p.unit || ''
      });
      total += cart[p.id] * (p.price || 0);
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
    return displayStr === clientInput || (c.name === cName && c.phone === cPhone);
  });
  
  if (existingClient) {
    finalClientId = existingClient.id;
  }
  
  const orderId = Date.now();
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
    sent: false
  };
  
  db.collection('orders').doc(String(orderId)).set(orderData)
    .then(async () => {
      // Also save client if new, or update coordinates if provided
      const cIdStr = String(orderData.clientId);
      
      const clientUpdate = {
        id: cIdStr,
        name: cName,
        phone: cPhone,
        address: address,
        type: existingClient ? (existingClient.type || 'Oddiy') : 'Oddiy'
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
async function sendToTelegram(order) {
  const tgToken = SETTINGS.tgToken || '8796588071:AAG8Z_R8hP9ESZZ_3LxUakD8PCXj5C5ZP6Y';
  const tgChatId = SETTINGS.tgChatId || '483325961';
  if(!tgToken || !tgChatId) return false;
  
  const pi = {'Naqd': '💵', 'Karta': '💳', 'Qarz': '📒'};
  const d = new Date(order.date);
  const ds = d.toLocaleDateString('ru-RU') + ' ' + d.toLocaleTimeString('ru-RU', {hour:'2-digit', minute:'2-digit'});
  let l = [`🆕 <b>Yangi buyurtma (Agent)</b>`, ``, `👤 <b>${order.client}</b>`];
  if(order.phone) l.push(`📞 ${order.phone}`);
  if(order.agent) l.push(`👨‍💼 Agent: <b>${order.agent}</b>`);
  l.push(``, `🛒 <b>Buyurtma:</b>`);
  order.items.forEach((i, n) => {
    l.push(`  ${n+1}. ${i.emoji} ${i.name} - <b>${i.qty}${i.unit||'kg'}</b> (${Math.round(i.qty*i.price).toLocaleString('ru-RU')} so'm)`);
  });
  l.push(``, `💰 <b>Jami: ${Math.round(order.total).toLocaleString('ru-RU')} so'm</b>`, `${pi[order.payment]||'💳'} ${order.payment}`);
  if(order.note) l.push(`📝 ${order.note}`);
  if(order.address) l.push(`📍 ${order.address}`);
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

init();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('../sw.js').catch(()=>{});
}
