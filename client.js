
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
  tg.ready();
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
      loadMenu();
    } else {
      document.getElementById('loading').style.display = 'none';
      document.getElementById('loginScreen').style.display = 'block';
    }
  } catch(e) {
    alert("Ошибка загрузки. Проверьте интернет.");
  }
}

async function loginWithPhone() {
  let phone = document.getElementById('loginPhone').value.trim();
  let name = document.getElementById('loginName').value.trim();
  
  if(!name) return alert('Пожалуйста, введите ваше имя');
  if(!phone) return alert('Пожалуйста, введите номер телефона');
  
  document.getElementById('loading').style.display = 'flex';
  document.getElementById('loginScreen').style.display = 'none';
  
  try {
    const cSnap = await db.collection('clients').where('phone', '==', phone).get();
    if(!cSnap.empty) {
      // Существующий клиент найден по номеру
      currentClient = cSnap.docs[0].data();
      currentClient.tgId = tgUser.id;
      // Обновляем имя, если оно было пустым или клиент захотел его уточнить
      currentClient.name = name;
      await db.collection('clients').doc(String(currentClient.id)).update({ tgId: tgUser.id, name: name });
    } else {
      // Создаем нового клиента
      const newClient = {
        id: Date.now(),
        name: name,
        tgId: tgUser.id,
        phone: phone,
        customPrices: {}
      };
      await db.collection('clients').doc(String(newClient.id)).set(newClient);
      currentClient = newClient;
    }
    loadMenu();
  } catch(e) {
    alert("Ошибка связи с базой.");
    document.getElementById('loading').style.display = 'none';
    document.getElementById('loginScreen').style.display = 'block';
  }
}

async function loadMenu() {
  document.getElementById('loading').style.display = 'flex';
  const pSnap = await db.collection('products').get();
  products = pSnap.docs.map(d => d.data()).sort((a,b)=>a.order-b.order);
  
  document.getElementById('loading').style.display = 'none';
  document.getElementById('menuScreen').style.display = 'block';
  renderProducts();
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
  document.getElementById('checkoutModal').classList.add('active');
  document.getElementById('cartBar').style.display = 'none';
  if(currentClient.phone) document.getElementById('orderPhone').value = currentClient.phone;
  if(currentClient.address) document.getElementById('orderAddress').value = currentClient.address;
}

function closeCheckout() {
  document.getElementById('checkoutModal').classList.remove('active');
  updateCart();
}

async function submitOrder() {
  const phone = document.getElementById('orderPhone').value.trim();
  const address = document.getElementById('orderAddress').value.trim();
  const note = document.getElementById('orderNote').value.trim();
  
  document.getElementById('submitBtn').disabled = true;
  document.getElementById('submitBtn').innerText = 'Отправка...';
  
  // Update client info if address changed
  if(address !== currentClient.address) {
    currentClient.address = address;
    await db.collection('clients').doc(String(currentClient.id)).update({ address });
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
    note: note || '', 
    items: items, 
    total: total || 0,
    type: 'доставка',
    payment: 'наличные',
    status: 'new',
    date: new Date().toISOString()
  };
  

  try {
    await db.collection('orders').doc(String(order.id)).set(order);
    
    try {
      const setSnap = await db.collection('settings').doc('main').get();
      const settings = setSnap.data() || {};
      if(settings.tgToken && settings.tgChatId) {
        const text = buildTgMsg(order);
        await fetch(`https://api.telegram.org/bot${settings.tgToken}/sendMessage`,{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({chat_id:settings.tgChatId, text:text, parse_mode:'HTML'})
        });
        await db.collection('orders').doc(String(order.id)).update({sent: true});
      }
    } catch(err) {
      console.log("TG error", err);
    }

    if(tg && tg.initData) tg.close();

    else {
      alert('Заказ успешно отправлен!');
      cart = {};
      updateCart();
      renderProducts();
      closeCheckout();
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
