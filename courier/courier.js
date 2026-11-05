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
let allClientsMap = {};
let myOrders = [];
let loggedCourierName = localStorage.getItem('courierAuth') || null;
let routeSummary = null;

// Listen to couriers
db.collection('couriers').onSnapshot(snap => {
  allCouriers = snap.docs.map(d => d.data());
  const select = document.getElementById('courierSelect');
  if(select) {
    select.innerHTML = '<option value="">-- Tanlang --</option>' + allCouriers.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
  }
}, err => {
  alert("Firebase xatosi: " + err.message);
});

// Listen to clients for coordinates fallback
db.collection('clients').onSnapshot(snap => {
  snap.docs.forEach(d => {
    allClientsMap[d.id] = d.data();
  });
  if (myOrders.length) renderOrders();
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
  routeSummary = null;
  showLoginScreen();
}

function startOrdersListener() {
  if(!loggedCourierName) return;
  
  db.collection('orders')
    .where('courier', '==', loggedCourierName)
    .onSnapshot(snap => {
      myOrders = snap.docs.map(d => d.data())
        .filter(o => !o.delivered && o.status !== 'done' && o.status !== 'cancelled')
        .sort((a,b) => new Date(b.date) - new Date(a.date));
      routeSummary = null;
      renderOrders();
    }, err => {
      console.error("Courier orders error:", err);
    });
}

function getOrderCoords(o) {
  if (o.lat && o.lng) return { lat: parseFloat(o.lat), lng: parseFloat(o.lng) };
  const c = allClientsMap[o.clientId];
  if (c && c.lat && c.lng) return { lat: parseFloat(c.lat), lng: parseFloat(c.lng) };
  return null;
}

function calcDistKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// 🗺️ AQLLI MARSHRUT (TSP NEAREST NEIGHBOR)
function optimizeCourierRoute() {
  if (!myOrders.length) {
    showToast("Yetkaziladigan buyurtmalar yo'q", 'info');
    return;
  }
  showToast("📍 Joylashuv aniqlanmoqda...", 'info');

  const runTSP = (startLat, startLng) => {
    const withCoords = [];
    const withoutCoords = [];

    myOrders.forEach(o => {
      const coords = getOrderCoords(o);
      if (coords) {
        withCoords.push({ ...o, _coords: coords });
      } else {
        withoutCoords.push(o);
      }
    });

    if (!withCoords.length) {
      showToast("Buyurtmalarda koordinata topilmadi", 'error');
      return;
    }

    let current = { lat: startLat, lng: startLng };
    let remaining = [...withCoords];
    const sorted = [];
    let totalDistance = 0;

    while (remaining.length > 0) {
      let bestIdx = 0;
      let minD = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const d = calcDistKm(current.lat, current.lng, remaining[i]._coords.lat, remaining[i]._coords.lng);
        if (d < minD) {
          minD = d;
          bestIdx = i;
        }
      }
      const next = remaining.splice(bestIdx, 1)[0];
      next.stepNum = sorted.length + 1;
      next.distKm = Math.round(minD * 10) / 10;
      totalDistance += minD;
      current = next._coords;
      sorted.push(next);
    }

    myOrders = [...sorted, ...withoutCoords];

    const points = [`${startLat.toFixed(6)},${startLng.toFixed(6)}`, ...sorted.map(s => `${s._coords.lat},${s._coords.lng}`)];
    const yandexMultiUrl = `https://yandex.ru/maps/?rtext=${points.join('~')}&rtt=auto`;

    routeSummary = {
      totalKm: Math.round(totalDistance * 10) / 10,
      count: sorted.length,
      yandexUrl: yandexMultiUrl
    };

    showToast(`✅ Marshrut tuzildi: ~${routeSummary.totalKm} km!`, 'success');
    renderOrders();
  };

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      pos => runTSP(pos.coords.latitude, pos.coords.longitude),
      err => {
        console.warn("GPS ruxsat berilmadi, standart markazdan boshlanadi:", err.message);
        runTSP(41.2995, 69.2401);
      },
      { timeout: 7000 }
    );
  } else {
    runTSP(41.2995, 69.2401);
  }
}

function renderOrders() {
  const container = document.getElementById('ordersList');
  const summaryBox = document.getElementById('routeSummaryBox');

  if(!myOrders.length) {
    if (summaryBox) summaryBox.innerHTML = '';
    container.innerHTML = `<div style="text-align:center; padding:40px; color:var(--text2)">
      <div style="font-size:40px; margin-bottom:10px;">🎉</div>
      Sizda hozircha buyurtmalar yo'q. Dam oling!
    </div>`;
    return;
  }

  if (summaryBox) {
    if (routeSummary) {
      summaryBox.innerHTML = `
        <div style="background:linear-gradient(135deg,rgba(124,106,247,0.18),rgba(86,212,160,0.15));border:1px solid var(--accent);border-radius:14px;padding:14px;margin-bottom:14px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <span style="font-weight:800;font-size:14px;">🧭 Optimal ketma-ketlik</span>
            <span style="font-weight:900;color:var(--green);font-size:15px;">~${routeSummary.totalKm} km</span>
          </div>
          <div style="font-size:12px;color:var(--text2);margin-bottom:10px;">
            ${routeSummary.count} ta do'kon eng qisqa yo'l bo'yicha saralandi.
          </div>
          <a href="${routeSummary.yandexUrl}" target="_blank" class="btn btn-primary" style="padding:11px;text-decoration:none;font-size:13px;">
            🚀 Barcha marshrutni Yandex Xaritalarda ochish
          </a>
        </div>`;
    } else {
      summaryBox.innerHTML = '';
    }
  }

  container.innerHTML = myOrders.map(o => {
    const d = new Date(o.date);
    const dateStr = d.toLocaleTimeString('ru-RU', {hour:'2-digit', minute:'2-digit'});
    const coords = getOrderCoords(o);
    
    let mapBtn = '';
    if (coords) {
      mapBtn = `<a href="https://yandex.ru/maps/?rtext=~${coords.lat},${coords.lng}" target="_blank" class="btn btn-outline" style="padding:10px; flex:1">📍 Xaritada ochish</a>`;
    }
    
    let stepBadge = '';
    if (o.stepNum) {
      const distText = o.distKm < 1 ? Math.round(o.distKm * 1000) + ' metr' : o.distKm + ' km';
      stepBadge = `<div style="background:linear-gradient(135deg,var(--accent),#9b8bf7);color:white;font-weight:800;font-size:12px;padding:4px 10px;border-radius:8px;display:inline-flex;align-items:center;gap:4px;margin-bottom:8px;">
        📍 ${o.stepNum}-manzil (${distText})
      </div>`;
    }
    
    const oId = String(o.id || '');
    return `
      <div class="order-card" style="${o.stepNum ? 'border-color:rgba(124,106,247,0.4);' : ''}">
        ${stepBadge}
        <div class="order-header">
          <div class="order-id">#${oId.slice(-4)}</div>
          <div class="order-date">${dateStr}</div>
        </div>
        <div class="order-client">${o.client || 'Mijoz'}</div>
        ${(o.phone || (allClientsMap[o.clientId]?.phone)) ? `<a href="tel:${o.phone || allClientsMap[o.clientId]?.phone}" class="order-phone">📞 ${o.phone || allClientsMap[o.clientId]?.phone}</a>` : ''}
        <div class="order-address">📍 ${o.address || (allClientsMap[o.clientId]?.address) || 'Manzil kiritilmagan'}</div>
        
        <div class="order-items">
          ${(o.items || []).map(i => `<div>${i.emoji || '🥗'} ${i.nameUz || i.name || 'Mahsulot'} — <b>${i.qty}${i.unit||'kg'}</b></div>`).join('')}
        </div>
        
        ${o.note ? `<div style="font-size:12px; color:var(--text2); margin-bottom:12px; padding:8px; background:rgba(0,0,0,0.2); border-radius:8px;">📝 Izoh: ${o.note}</div>` : ''}
        
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
          <div style="font-size:12px; color:var(--text2)">To'lov usuli: <br><b style="color:white">${o.payment || 'Naqd'}</b></div>
          <div class="order-total">${(Number(o.total) || 0).toLocaleString('ru-RU')} so'm</div>
        </div>
        
        <div style="display:flex; gap:8px;">
          ${mapBtn}
          <button class="btn btn-success" style="padding:10px; flex:1" onclick="markDelivered('${oId}')">✅ Topshirdim</button>
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

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('../sw.js').catch(()=>{});
}
