
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
if(tg) {
  tg.ready();
  tg.expand();
}

let tgUser = tg?.initDataUnsafe?.user || { id: 12345, first_name: "Тест Клиент" };

let currentClient = null;
let products = [];
let cart = {};

async function init() {
  // Загружаем продукты
  const pSnap = await db.collection('products').get();
  products = pSnap.docs.map(d => d.data()).sort((a,b)=>a.order-b.order);
  
  // Ищем клиента
  const cSnap = await db.collection('clients').where('tgId', '==', tgUser.id).get();
  if(!cSnap.empty) {
    currentClient = cSnap.docs[0].data();
  } else {
    // Создаем нового клиента
    const newClient = {
      id: Date.now(),
      name: tgUser.first_name + (tgUser.last_name ? ' ' + tgUser.last_name : ''),
      tgId: tgUser.id,
      phone: '',
      customPrices: {}
    };
    await db.collection('clients').doc(String(newClient.id)).set(newClient);
    currentClient = newClient;
  }
  
  document.getElementById('loading').style.display = 'none';
  renderProducts();
}

function fmt(n) { return Number(n).toLocaleString('ru-RU'); }

function getPrice(p) {
  if (currentClient && currentClient.customPrices && currentClient.customPrices[p.id]) {
    return currentClient.customPrices[p.id];
  }
  return p.price;
}

function renderProducts() {
  const html = products.map(p => {
    const price = getPrice(p);
    const qty = cart[p.id] || 0;
    return `
    <div class="product-card ${qty > 0 ? 'selected' : ''}" id="pc-${p.id}" style="padding:15px">
      <div class="product-name">${p.emoji} ${p.name}</div>
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
  
  if(!phone) { alert('Введите телефон'); return; }
  
  document.getElementById('submitBtn').disabled = true;
  document.getElementById('submitBtn').innerText = 'Отправка...';
  
  // Update client info if it changed
  if(phone !== currentClient.phone || address !== currentClient.address) {
    currentClient.phone = phone;
    currentClient.address = address;
    await db.collection('clients').doc(String(currentClient.id)).update({ phone, address });
  }
  
  let total = 0;
  const items = [];
  for(let id in cart) {
    const p = products.find(x => x.id === id);
    if(p) {
      const price = getPrice(p);
      items.push({ id: p.id, name: p.name, emoji: p.emoji, qty: cart[id], price: price, unit: p.unit });
      total += cart[id] * price;
    }
  }
  
  const order = {
    id: Date.now(),
    clientId: currentClient.id,
    client: currentClient.name,
    phone, address, note, items, total,
    type: 'доставка',
    payment: 'наличные',
    status: 'new',
    date: new Date().toISOString()
  };
  
  await db.collection('orders').doc(String(order.id)).set(order);
  
  if(tg) tg.close();
  else {
    alert('Заказ успешно отправлен!');
    cart = {};
    updateCart();
    renderProducts();
    closeCheckout();
    document.getElementById('submitBtn').disabled = false;
    document.getElementById('submitBtn').innerText = 'Подтвердить';
  }
}

init();
