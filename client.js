
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

let tg = window.Telegram?.WebApp;
if(tg && tg.initData) {
  tg.ready(); tg.expand();
  tg.expand();
}

let tgUser = tg?.initDataUnsafe?.user || { id: Date.now(), first_name: "Клиент" };

let currentClient = null;
let products = [];
let cart = {};

async function init() {
  try {
    const cSnap = await db.collection('clients').where('tgId', '==', tgUser.id).get();
    if(!cSnap.empty) {
      currentClient = cSnap.docs[0].data();
    }
  } catch(e) {
    console.error("Ошибка при поиске клиента:", e);
  }
  loadMenu();
}

async function loadMenu() {
  document.getElementById('loading').style.display = 'flex';
  try {
    const pSnap = await db.collection('products').get();
    products = pSnap.docs.map(d => d.data()).sort((a,b)=>a.order-b.order);
    
    document.getElementById('loading').style.display = 'none';
    document.getElementById('menuScreen').style.display = 'block';
    renderProducts();
  } catch(e) {
    alert("Ошибка загрузки меню: " + e.message);
    document.getElementById('loading').innerHTML = "Ошибка: " + e.message;
  }
}

function fmt(n) { return Number(n).toLocaleString('ru-RU'); }

function getPrice(p) {
  if (currentClient && currentClient.customPrices && currentClient.customPrices[p.id]) {
    return currentClient.customPrices[p.id];
  }
  return p.price || 0;
}

function renderProducts() {
  const html = products.map(p => {
    const price = getPrice(p);
    const qty = cart[p.id] || 0;
    const hasCustomPrice = currentClient?.customPrices?.[p.id] ? '<span style="color:var(--orange)">★</span>' : '';
    return `
    <div class="product-card ${qty > 0 ? 'selected' : ''}" id="pc-${p.id}" style="padding:15px; position:relative;">
      <div class="product-name">${p.emoji} ${p.name} ${hasCustomPrice}</div>
      <div class="product-price">${fmt(price)} / ${p.unit || 'кг'}</div>
      <div class="product-qty" style="margin-top:10px">
        <div class="qty-btn" onclick="changeQty('${p.id}', ${-(p.step || 0.5)})">−</div>
        <div><span class="qty-val" id="qty-${p.id}">${qty}</span> <span class="qty-unit">${p.unit || 'кг'}</span></div>
        <div class="qty-btn" onclick="changeQty('${p.id}', ${p.step || 0.5})">+</div>
      </div>
    </div>`;
  }).join('');
  document.getElementById('productsGrid').innerHTML = html;
}

function changeQty(id, delta) {
  const p = products.find(x => x.id === id);
  const isUnit = p && p.unit === 'шт';
  let n = (cart[id] || 0) + delta;
  if(isUnit) n = Math.round(n);
  n = Math.max(0, Math.round(n * 10) / 10);
  
  if (n > 0) cart[id] = n;
  else delete cart[id];
  
  document.getElementById('qty-'+id).innerText = n;
  document.getElementById('pc-'+id).classList.toggle('selected', n > 0);
  
  updateCart();
}

function updateCart() {
  let total = 0;
  for(let id in cart) {
    const p = products.find(x => x.id === id);
    if(p) total += cart[id] * getPrice(p);
  }
  document.getElementById('cartTotal').innerText = fmt(total) + ' сум';
  document.getElementById('cartBar').style.display = total > 0 ? 'flex' : 'none';
}

function placeOrder() {
  document.getElementById('checkoutOverlay').classList.add('open');
  document.getElementById('cartBar').style.display = 'none';
  if(currentClient) {
    document.getElementById('orderName').value = currentClient.name || '';
    document.getElementById('orderPhone').value = currentClient.phone || '';
    document.getElementById('orderAddress').value = currentClient.address || '';
  }
}

function closeCheckout() {
  document.getElementById('checkoutOverlay').classList.remove('open');
  updateCart();
}

async function submitOrder() {
  const name = document.getElementById('orderName').value.trim();
  const phone = document.getElementById('orderPhone').value.trim();
  const address = document.getElementById('orderAddress').value.trim();
  const note = document.getElementById('orderNote').value.trim();
  const paymentMethod = document.getElementById('orderPayment') ? document.getElementById('orderPayment').value : 'наличные';
  
  if(!name) return alert('Пожалуйста, введите ваше имя');
  if(!phone) return alert('Пожалуйста, введите номер телефона');
  
  document.getElementById('submitBtn').disabled = true;
  document.getElementById('submitBtn').innerText = 'Отправка...';
  
  try {
    // If no currentClient, search by phone or create new
    if(!currentClient) {
      let formattedPhone = phone;
      if(!formattedPhone.startsWith('+')) formattedPhone = '+' + formattedPhone.replace(/\D/g, '');
      
      const cSnap = await db.collection('clients').where('phone', '==', formattedPhone).get();
      if(!cSnap.empty) {
        currentClient = cSnap.docs[0].data();
        currentClient.tgId = tgUser.id;
        currentClient.name = name;
        currentClient.address = address;
        await db.collection('clients').doc(String(currentClient.id)).update({ tgId: tgUser.id, name: name, address: address });
      } else {
        currentClient = {
          id: Date.now(),
          name: name,
          tgId: tgUser.id,
          phone: formattedPhone,
          address: address,
          lat: clientLat || null,
          lng: clientLng || null,
          customPrices: {}
        };
        await db.collection('clients').doc(String(currentClient.id)).set(currentClient);
      }
    } else {
      // Update existing client info if changed
      let updates = {};
      if(address !== currentClient.address) { currentClient.address = address; updates.address = address; }
      if(name !== currentClient.name) { currentClient.name = name; updates.name = name; }
      if(clientLat && clientLng) { 
        currentClient.lat = clientLat; currentClient.lng = clientLng; 
        updates.lat = clientLat; updates.lng = clientLng; 
      }
      if(Object.keys(updates).length > 0) {
        await db.collection('clients').doc(String(currentClient.id)).update(updates);
      }
    }
  } catch(e) {
    alert("Ошибка при сохранении профиля: " + e.message);
    document.getElementById('submitBtn').disabled = false;
    document.getElementById('submitBtn').innerText = 'Подтвердить заказ';
    return;
  }

  
  let total = 0;
  const items = [];
  for(let id in cart) {
    const p = products.find(x => x.id === id);
    if(p) {
      const price = getPrice(p);
      items.push({ id: p.id, name: p.name || '', emoji: p.emoji || '', qty: cart[id], price: price, unit: p.unit || 'кг' });
      total += cart[id] * price;
    }
  }
  
  const order = {
    id: Date.now(),
    clientId: currentClient.id,
    client: currentClient.name || '',
    phone: currentClient.phone || '',
    address: address || '', 
    lat: clientLat || (currentClient && currentClient.lat) || null,
    lng: clientLng || (currentClient && currentClient.lng) || null,
    note: note || '', 
    items: items, 
    total: total || 0,
    type: 'доставка',
    payment: paymentMethod,
    status: 'new',
    date: new Date().toISOString()
  };
  

  try {
    await db.collection('orders').doc(String(order.id)).set(order);
    
    try {
      const setSnap = await db.collection('settings').doc('main').get();
      const settings = setSnap.data() || {};
      const tgToken = settings.tgToken || atob('ODc5NjU4ODA3MTpBQUZRdWVpX005ZndDX0ozb1RDcF9LS2dDS2c0WjRhWVhwWQ==');
      const tgChatId = settings.tgChatId || '483325961';
      
      if(tgToken && tgChatId) {
        const text = buildTgMsg(order);
        await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`,{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({chat_id:tgChatId, text:text, parse_mode:'HTML'})
        });
        await db.collection('orders').doc(String(order.id)).update({sent: true});
      }

      // Send confirmation to the client via Bot
      if(tgUser && tgUser.id && tgToken) {
        fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`,{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({chat_id:tgUser.id, text:'✅ Sizning buyurtmangiz qabul qilindi. Tez orada siz bilan bog\'lanamiz!'})
        }).catch(e=>console.log(e));
      }
    } catch(err) {
      console.log("TG error", err);
    }

    cart = {};
    updateCart();
    renderProducts();
    closeCheckout();

    if(tg && tg.initData && tg.showConfirm) {
      tg.showConfirm("✅ Buyurtma qabul qilindi!\n\nYana buyurtma berasizmi?", function(more) {
        if(!more) {
          tg.close();
        }
      });
    } else {
      if(confirm("✅ Buyurtma qabul qilindi!\n\nYana buyurtma berasizmi? (Ok = Ha, Cancel = Yo'q)")) {
        // just stay
      } else {
        if(tg && tg.close) tg.close();
      }
    }
  } catch(e) {
    alert("Ошибка: " + e.message);
  } finally {
    document.getElementById('submitBtn').disabled = false;
    document.getElementById('submitBtn').innerText = 'Подтвердить заказ';
  }
}

init();

function buildTgMsg(order){
  const pi={'наличные':'💵','клик':'📱','консигнация':'📝'};
  const d=new Date(order.date);
  const ds=d.toLocaleDateString('ru-RU')+' '+d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
  let l=[`🥗 <b>НОВЫЙ ЗАКАЗ ИЗ WEB APP</b>`,``,`👤 <b>${order.client}</b>`];
  if(order.phone)l.push(`📞 ${order.phone}`);
  if(order.address)l.push(`📍 ${order.address}`);
  if(order.note)l.push(`📌 <i>${order.note}</i>`);
  l.push(``,`📦 <b>Заказ:</b>`);
  order.items.forEach((i,idx)=>l.push(`${idx+1}. ${i.emoji||''} ${i.name} — ${i.qty}${i.unit||'кг'}`));
  l.push(``,`💰 <b>Итого: ${fmt(order.total)} сум</b>`,`💳 ${pi[order.payment]||''} ${order.payment}`);
  if(order.type==='доставка')l.push(`🛵 Доставка`);
  l.push(``,`⏱ ${ds}`);
  return l.join('\n');
}


// --- Order History Feature ---
window.switchClientTab = function(tab) {
  document.getElementById('tab-menu').classList.remove('active');
  document.getElementById('tab-orders').classList.remove('active');
  document.getElementById('tab-'+tab).classList.add('active');
  
  document.getElementById('client-page-menu').style.display = tab === 'menu' ? 'block' : 'none';
  document.getElementById('client-page-orders').style.display = tab === 'orders' ? 'block' : 'none';
  
  if (tab === 'orders') {
    document.getElementById('cartBar').style.display = 'none';
    fetchClientOrders();
  } else {
    updateCart();
  }
}

let orderListener = null;

function fetchClientOrders() {
  const el = document.getElementById('clientOrdersList');
  el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text3)">Загрузка...</div>';
  if(!currentClient) return;
  
  if(orderListener) orderListener(); // unsubscribe
  
  orderListener = db.collection('orders')
    .where('clientId', '==', currentClient.id)
    .onSnapshot(snap => {
      let orders = [];
      snap.forEach(doc => orders.push(doc.data()));
      orders.sort((a,b) => new Date(b.date) - new Date(a.date));
      
      if (orders.length === 0) {
        el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text3)">У вас еще нет заказов</div>';
        return;
      }
      
      el.innerHTML = orders.map(o => {
        const itemsStr = o.items.map(i => `${i.emoji} ${i.qty}${i.unit||'кг'}`).join(', ');
        const d = new Date(o.date);
        const dateStr = d.toLocaleDateString('ru-RU', {day:'numeric',month:'short'}) + ' ' + d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
        
        const safeItems = JSON.stringify(o.items).replace(/'/g, "&apos;").replace(/"/g, "&quot;");
        
        const isActive = ['new', 'preparing', 'delivering'].includes(o.status);
        let statusHtml = '';
        
        if (isActive) {
           const steps = ['new', 'preparing', 'delivering'];
           const stepIndex = steps.indexOf(o.status);
           statusHtml = `
           <div style="background:var(--bg); border-radius:12px; padding:12px; margin-bottom:12px; border:1px solid var(--border)">
             <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
                <div style="font-size:10px; font-weight:800; color:${stepIndex>=0?'var(--accent)':'var(--text3)'};">Qabul qilindi</div>
                <div style="font-size:10px; font-weight:800; color:${stepIndex>=1?'var(--orange)':'var(--text3)'};">Tayyorlanmoqda</div>
                <div style="font-size:10px; font-weight:800; color:${stepIndex>=2?'var(--blue)':'var(--text3)'};">Yo'lda</div>
             </div>
             <div style="display:flex; height:6px; background:var(--bg3); border-radius:3px; overflow:hidden;">
                <div style="width:${(stepIndex+1)*33.3}%; background:linear-gradient(90deg, var(--accent), var(--accent2)); transition:width 0.5s ease;"></div>
             </div>
           </div>
           `;
        } else {
           // Delivered or Cancelled
           let badgeColor = o.status==='done' ? 'var(--green)' : 'var(--text2)';
           let badgeText = o.status==='done' ? 'Завершен' : o.status;
           statusHtml = `<div style="text-align:right; font-size:12px; font-weight:700; color:${badgeColor}; margin-bottom:8px;">${badgeText}</div>`;
        }

        return `
          <div class="card" style="padding:15px;margin-bottom:12px; background:var(--bg2);">
            ${statusHtml}
            <div style="display:flex;justify-content:space-between;margin-bottom:8px">
              <div style="font-weight:800; font-size:15px;">Заказ #${String(o.id).slice(-4)}</div>
              <div style="font-size:12px;color:var(--text2)">${dateStr}</div>
            </div>
            <div style="font-size:13px;color:var(--text);margin-bottom:12px; line-height:1.4;">${itemsStr}</div>
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <div style="font-weight:900;color:var(--accent2);font-size:16px;">${o.total.toLocaleString('ru-RU')} сум</div>
              <button class="btn-repeat" onclick="repeatOrder('${safeItems}')" style="width:auto; margin:0; padding:6px 14px;">🔄 Повторить</button>
            </div>
          </div>
        `;
      }).join('');
    }, err => {
      console.log(err);
      el.innerHTML = '<div style="color:var(--danger);text-align:center">Ошибка загрузки заказов</div>';
    });
}

window.repeatOrder = function(itemsJson) {
  try {
    const items = JSON.parse(itemsJson);
    cart = {};
    items.forEach(i => {
      cart[i.id] = i.qty;
    });
    switchClientTab('menu');
    renderProducts();
    updateCart();
  } catch(e) {
    alert('Не удалось повторить заказ');
  }
}

// --- MAP PICKER LOGIC ---
let clientLat = null;
let clientLng = null;
let clientMapInstance = null;

window.openClientMap = function() {
  document.getElementById('clientMapOverlay').classList.add('open');
  if (!clientMapInstance && window.ymaps) {
    ymaps.ready(() => {
      clientMapInstance = new ymaps.Map("clientYandexMap", {
        center: [41.2995, 69.2401], // Tashkent default
        zoom: 15,
        controls: ['zoomControl', 'geolocationControl']
      });
      // Try to get user location
      clientMapInstance.geolocation.get({ provider: 'browser', mapStateAutoApply: true }).then(function (result) {
        clientMapInstance.setCenter(result.geoObjects.position, 16);
      });
    });
  }
}

window.closeClientMap = function() {
  document.getElementById('clientMapOverlay').classList.remove('open');
}

window.confirmClientMap = function() {
  if (clientMapInstance) {
    const center = clientMapInstance.getCenter();
    clientLat = center[0];
    clientLng = center[1];
    document.getElementById('locationStatus').style.display = 'block';
    
    // Reverse geocode to get address text (optional, but nice)
    ymaps.geocode(center).then(function (res) {
      const firstGeoObject = res.geoObjects.get(0);
      if(firstGeoObject) {
        document.getElementById('orderAddress').value = firstGeoObject.getAddressLine();
      }
    });
  }
  closeClientMap();
}

let currentCategory = 'all';
function filterCategory(cat) {
  currentCategory = cat;
  document.querySelectorAll('#categoryTabs .tab').forEach(t => {
    t.classList.remove('active');
    t.style.borderColor = 'var(--border)';
    t.style.color = 'var(--text3)';
  });
  const activeTab = event.currentTarget;
  activeTab.classList.add('active');
  activeTab.style.borderColor = 'var(--accent)';
  activeTab.style.color = 'var(--accent)';
  renderProducts();
}
