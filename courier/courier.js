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
let deliveredOrders = [];
let SETTINGS = {};
let loggedCourierName = localStorage.getItem('courierAuth') || null;
let routeSummary = null;

// Listen to settings / shared UI config
db.collection('settings').doc('main').onSnapshot(snap => {
  if (snap.exists) {
    SETTINGS = snap.data() || {};
    if (SETTINGS.uiConfig && typeof applySharedUiConfig === 'function') {
      applySharedUiConfig(SETTINGS.uiConfig, 'courier');
    }
  }
});

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
      const allDocs = snap.docs.map(d => d.data());
      const today = new Date().toISOString().slice(0, 10);

      deliveredOrders = allDocs.filter(o => {
        const isDone = o.delivered || o.status === 'done';
        if (!isDone) return false;
        const dStr = (o.deliveredAt || o.date || '').slice(0, 10);
        return dStr === today || !dStr;
      });

      myOrders = allDocs
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
  renderCashReconciliation();

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
      mapBtn = `<a href="yandexnavi://build_route_on_map?lat_to=${coords.lat}&lon_to=${coords.lng}" data-web-fallback="https://yandex.ru/maps/?rtext=~${coords.lat},${coords.lng}" onclick="openNavigator(event, ${coords.lat}, ${coords.lng})" target="_blank" class="btn btn-outline" style="padding:10px; flex:1" title="Yandex Navigator">🧭 Navigator</a>`;
    }
    
    let stepBadge = '';
    if (o.stepNum) {
      const distText = o.distKm < 1 ? Math.round(o.distKm * 1000) + ' metr' : o.distKm + ' km';
      stepBadge = `<div style="background:linear-gradient(135deg,var(--accent),#9b8bf7);color:white;font-weight:800;font-size:12px;padding:4px 10px;border-radius:8px;display:inline-flex;align-items:center;gap:4px;margin-bottom:8px;">
        📍 ${o.stepNum}-manzil (${distText})
      </div>`;
    }

    const isDelivering = o.status === 'delivering';
    const statusPill = isDelivering
      ? `<div style="background:rgba(255,152,0,0.18); color:#ff9800; font-weight:800; font-size:12px; padding:3px 8px; border-radius:6px; display:inline-block; margin-bottom:6px;">🛵 Yo'lda</div>`
      : '';
    
    const oId = String(o.id || '');
    return `
      <div class="order-card" style="${o.stepNum ? 'border-color:rgba(124,106,247,0.4);' : ''}">
        ${stepBadge}
        ${statusPill}
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
        
        <div style="display:flex; flex-direction:column; gap:8px;">
          <div style="display:flex; gap:8px;">
            ${mapBtn}
            <button class="btn btn-primary" style="padding:10px; flex:1; font-size:13px; background:linear-gradient(135deg, #7c6af7, #ff9800);" onclick="sendOnMyWayNotification('${oId}')">
              📲 Yo'ldaman (~15 daq)
            </button>
          </div>
          <button class="btn btn-success" style="padding:11px; width:100%;" onclick="markDelivered('${oId}')">✅ Topshirdim</button>
        </div>
      </div>
    `;
  }).join('');
}

function openNavigator(e, lat, lng) {
  if (e && typeof e.preventDefault === 'function') {
    // If mobile browser blocks custom scheme without user gesture, allow default
  }
  const naviUrl = `yandexnavi://build_route_on_map?lat_to=${lat}&lon_to=${lng}`;
  const webUrl = `https://yandex.ru/maps/?rtext=~${lat},${lng}`;
  try {
    if (typeof window !== 'undefined' && window.location) {
      window.location.href = naviUrl;
      setTimeout(() => {
        if (typeof document !== 'undefined' && document.hasFocus && document.hasFocus()) {
          window.open(webUrl, '_blank');
        }
      }, 1200);
    }
  } catch(err) {
    if (typeof window !== 'undefined') window.open(webUrl, '_blank');
  }
}
if (typeof window !== 'undefined') window.openNavigator = openNavigator;

async function sendOnMyWayNotification(orderId, customEta = 15) {
  const o = myOrders.find(x => String(x.id) === String(orderId));
  if (!o) return { ok: false, reason: 'not_found' };

  const etaMins = Number(customEta) || 15;
  const clientInfo = allClientsMap[o.clientId] || {};
  const tgId = clientInfo.tgId || o.tgId;
  const phone = o.phone || clientInfo.phone || '';
  const cleanPhone = String(phone).replace(/[^\d+]/g, '');

  o.status = 'delivering';
  o.etaNotifiedAt = new Date().toISOString();

  db.collection('orders').doc(String(o.id)).update({
    status: 'delivering',
    etaNotifiedAt: o.etaNotifiedAt
  }).catch(e => console.error("Error updating order status:", e));

  const msgText = `🚚 Assalomu alaykum, ${o.client || 'hurmatli mijoz'}! TeeGu buyurtmangiz yo'lda — taxminan ${etaMins} daqiqada yetib boramiz.`;
  const smsUri = cleanPhone ? `sms:${cleanPhone}?body=${encodeURIComponent(msgText)}` : '';
  const defaultTgToken = '8796588071:AAG8Z_R8hP9ESZZ_3LxUakD8PCXj5C5ZP6Y';
  const tgToken = (SETTINGS && SETTINGS.tgToken) || (typeof atob === 'function' ? atob('ODc5NjU4ODA3MTpBQUc4Wl9SOGhQOUVTWlpfM0x4VWFrRDhQQ1hqNUM1WlA2WQ==') : defaultTgToken);

  let sentTg = false;
  if (tgId && tgToken) {
    try {
      const resp = await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: String(tgId), text: msgText })
      });
      const data = await resp.json();
      if (data && data.ok) sentTg = true;
    } catch (e) {}
  }

  if (sentTg) {
    showToast(`📲 "${o.client}" ga Telegramdan "Yo'ldaman (~${etaMins} daq)" yuborildi!`, 'success');
  } else if (smsUri) {
    try {
      if (typeof window !== 'undefined' && typeof window.open === 'function') {
        window.open(smsUri, '_self');
      }
    } catch (e) {}
    showToast(`📱 SMS xabar tayyorlandi: "${o.client}"`, 'info');
  } else {
    showToast(`🛵 Buyurtma "Yo'lda" holatiga o'tkazildi!`, 'success');
  }

  renderOrders();
  return { ok: true, status: 'delivering', msgText, smsUri };
}
if (typeof window !== 'undefined') {
  window.sendOnMyWayNotification = sendOnMyWayNotification;
  window.notifyOnMyWay = sendOnMyWayNotification;
}

function getCashReconciliation() {
  const count = deliveredOrders.length;
  const cashTotal = deliveredOrders
    .filter(o => o.payment === 'Naqd' || o.payment === 'наличные' || !o.payment)
    .reduce((sum, o) => sum + (Number(o.total) || 0), 0);
  const grandTotal = deliveredOrders.reduce((sum, o) => sum + (Number(o.total) || 0), 0);
  return {
    count,
    cashTotal,
    grandTotal,
    orders: deliveredOrders
  };
}
if (typeof window !== 'undefined') window.getCashReconciliation = getCashReconciliation;

function toggleCashDetails() {
  const d = document.getElementById('cashOrdersDetails');
  if (d) d.style.display = d.style.display === 'none' ? 'block' : 'none';
}
if (typeof window !== 'undefined') window.toggleCashDetails = toggleCashDetails;

function renderCashReconciliation() {
  const box = document.getElementById('cashReconciliationBox');
  if (!box) return;
  const rec = getCashReconciliation();
  box.innerHTML = `
    <div id="cashDrawer" class="cash-drawer" style="background:var(--bg2); border:1px solid var(--border); border-radius:14px; padding:14px; margin-bottom:14px;">
      <div style="display:flex; justify-content:space-between; align-items:center; cursor:pointer;" onclick="toggleCashDetails()">
        <div>
          <div style="font-size:12px; color:var(--text2); font-weight:700;">💼 Bugungi hisobot</div>
          <div style="font-size:15px; font-weight:900; color:var(--green); margin-top:2px;">
            Kassaga topshiriladigan summa: ${rec.cashTotal.toLocaleString('ru-RU')} so'm
          </div>
        </div>
        <div style="text-align:right;">
          <span class="tag" style="background:rgba(86,212,160,0.15); color:var(--green); font-size:12px;">✅ ${rec.count} ta yetkazildi</span>
        </div>
      </div>
      <div id="cashOrdersDetails" style="display:none; margin-top:12px; padding-top:10px; border-top:1px dashed var(--border); font-size:12px;">
        ${rec.orders.length === 0 ? '<div style="color:var(--text2)">Bugun hali buyurtma topshirilmadi</div>' :
          rec.orders.map(o => `
            <div style="display:flex; justify-content:space-between; margin-bottom:6px; color:var(--text2)">
              <span>#${String(o.id).slice(-4)} ${o.client || 'Mijoz'} (${o.payment || 'Naqd'})</span>
              <b style="color:var(--text)">${(Number(o.total)||0).toLocaleString('ru-RU')} so'm</b>
            </div>
          `).join('')}
      </div>
    </div>
  `;
}

function markDelivered(id) {
  if(confirm("Buyurtmani topshirganingizni tasdiqlaysizmi?")) {
    const oIdStr = String(id);
    const orderIndex = myOrders.findIndex(x => String(x.id) === oIdStr);
    if (orderIndex !== -1) {
      const deliveredOrder = { ...myOrders[orderIndex], status: 'done', delivered: true, deliveredAt: new Date().toISOString() };
      deliveredOrders.unshift(deliveredOrder);
      myOrders.splice(orderIndex, 1);
    }
    db.collection('orders').doc(oIdStr).update({
      status: 'done',
      delivered: true,
      deliveredAt: new Date().toISOString()
    }).catch(err => console.error("Error updating delivered:", err));
    showToast('Buyurtma topshirildi!', 'success');
    renderOrders();
  }
}

function showToast(msg, type='info') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast ' + type + ' show';
  setTimeout(() => { t.className = 'toast ' + type; }, 3000);
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

try {
  const cachedUi = JSON.parse(localStorage.getItem('teegu_ui_config') || 'null');
  if (cachedUi) applySharedUiConfig(cachedUi, 'courier');
} catch (e) {}

init();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('../sw.js').catch(()=>{});
}
