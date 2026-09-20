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

let loggedAgentName = localStorage.getItem('agentAuth') || null;

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
  
  // Listen for agent's recent orders (last 50)
  db.collection('orders')
    .where('agent', '==', loggedAgentName)
    .orderBy('id', 'desc')
    .limit(50)
    .onSnapshot(snap => {
      myOrders = snap.docs.map(d => d.data());
      renderHistory();
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

function updateQty(id, diff) {
  if(!cart[id]) cart[id] = 0;
  cart[id] += diff;
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
        name: p.name,
        emoji: p.emoji,
        qty: cart[p.id],
        price: p.price,
        unit: p.unit
      });
      total += cart[p.id] * p.price;
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
  
  const orderId = Date.now();
  const orderData = {
    id: orderId,
    date: new Date().toISOString(),
    client: cName,
    clientId: cPhone.replace(/\D/g,'') || cName,
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
    .then(() => {
      // Also save client if new
      const cIdStr = String(orderData.clientId);
      if(!CLIENTS.find(c => String(c.id) === cIdStr)) {
        db.collection('clients').doc(cIdStr).set({
          id: cIdStr,
          name: cName,
          phone: cPhone,
          address: address,
          type: 'Oddiy'
        });
      }
      
      showToast("Buyurtma yuborildi!", 'success');
      
      // Reset form
      document.getElementById('orderClient').value = '';
      document.getElementById('orderAddress').value = '';
      document.getElementById('orderNote').value = '';
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
    
    let statusText = o.status === 'done' ? '✅ Yetkazildi' : (o.status === 'delivering' ? '🛵 Yuborildi' : '⏳ Yangi');
    let statusColor = o.status === 'done' ? 'var(--green)' : (o.status === 'delivering' ? 'var(--accent)' : 'var(--text2)');
    
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

init();
