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

let allCouriers = [];
let myOrders = [];
let loggedCourierName = localStorage.getItem('courierAuth') || null;

db.collection('couriers').onSnapshot(snap => {
  allCouriers = snap.docs.map(d => d.data());
  const select = document.getElementById('courierSelect');
  if(select) {
    select.innerHTML = '<option value="">-- Tanlang --</option>' + allCouriers.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
  }
}, err => {
  alert("Firebase xatosi: " + err.message + "\nIltimos, Firebase Rules'da couriers uchun ruxsat borligini tekshiring.");
});

function init() {
  if (loggedCourierName) {
    showMainScreen();
    startOrdersListener();
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
  document.getElementById('courierNameDisplay').innerText = loggedCourierName;
}

function login() {
  const name = document.getElementById('courierSelect').value;
  const pin = document.getElementById('courierPin').value;
  
  if(!name || !pin) {
    showToast('Kuryer va PIN kodni kiriting', 'error');
    return;
  }
  
  const courier = allCouriers.find(c => c.name === name);
  if(courier && String(courier.pin) === String(pin)) {
    loggedCourierName = name;
    localStorage.setItem('courierAuth', name);
    showToast('Tizimga kirdingiz', 'success');
    showMainScreen();
    startOrdersListener();
  } else {
    showToast("Noto'g'ri PIN kod", 'error');
  }
}

function logout() {
  localStorage.removeItem('courierAuth');
  loggedCourierName = null;
  showLoginScreen();
}

function startOrdersListener() {
  if(!loggedCourierName) return;
  
  db.collection('orders')
    .where('courier', '==', loggedCourierName)
    .where('status', '==', 'delivering')
    .onSnapshot(snap => {
      myOrders = snap.docs.map(d => d.data()).sort((a,b) => new Date(b.date) - new Date(a.date));
      renderOrders();
    });
}

function renderOrders() {
  const container = document.getElementById('ordersList');
  if(!myOrders.length) {
    container.innerHTML = `<div style="text-align:center; padding:40px; color:var(--text2)">
      <div style="font-size:40px; margin-bottom:10px;">🎉</div>
      Sizda hozircha buyurtmalar yo'q. Dam oling!
    </div>`;
    return;
  }
  
  container.innerHTML = myOrders.map(o => {
    const d = new Date(o.date);
    const dateStr = d.toLocaleTimeString('ru-RU', {hour:'2-digit', minute:'2-digit'});
    
    let mapBtn = '';
    if (o.lat && o.lng) {
      mapBtn = `<a href="https://yandex.ru/maps/?rtext=~${o.lat},${o.lng}" target="_blank" class="btn btn-outline" style="padding:10px; flex:1">📍 Xaritada ochish</a>`;
    }
    
    return `
      <div class="order-card">
        <div class="order-header">
          <div class="order-id">#${o.id.toString().slice(-4)}</div>
          <div class="order-date">${dateStr}</div>
        </div>
        <div class="order-client">${o.client}</div>
        <a href="tel:${o.phone}" class="order-phone">📞 ${o.phone}</a>
        <div class="order-address">📍 ${o.address || 'Manzil kiritilmagan'}</div>
        
        <div class="order-items">
          ${o.items.map(i => `<div>${i.emoji} ${i.name} — ${i.qty}${i.unit||'kg'}</div>`).join('')}
        </div>
        
        ${o.note ? `<div style="font-size:12px; color:var(--text2); margin-bottom:12px; padding:8px; background:rgba(0,0,0,0.2); border-radius:8px;">📝 Izoh: ${o.note}</div>` : ''}
        
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
          <div style="font-size:12px; color:var(--text2)">To'lov usuli: <br><b style="color:white">${o.payment}</b></div>
          <div class="order-total">${o.total.toLocaleString('ru-RU')} so'm</div>
        </div>
        
        <div style="display:flex; gap:8px;">
          ${mapBtn}
          <button class="btn btn-success" style="padding:10px; flex:1" onclick="markDelivered(${o.id})">✅ Topshirdim</button>
        </div>
      </div>
    `;
  }).join('');
}

function markDelivered(id) {
  if(confirm("Buyurtmani topshirganingizni tasdiqlaysizmi?")) {
    db.collection('orders').doc(String(id)).update({
      status: 'done',
      delivered: true,
      deliveredAt: new Date().toISOString()
    });
    showToast('Buyurtma topshirildi!', 'success');
  }
}

function showToast(msg, type='info') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast ' + type + ' show';
  setTimeout(() => { t.className = 'toast ' + type; }, 3000);
}

init();
