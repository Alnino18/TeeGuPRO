
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

let tgUser = tg?.initDataUnsafe?.user || { id: Date.now(), first_name: "Клиент", language_code: "ru" };

const clientLang = (tgUser.language_code === 'uz' || tgUser.language_code === 'uzb') ? 'uz' : 'ru';
const T = {
  uz: {
    menu: 'Menyu', orders: 'Buyurtmalarim', add: 'Qo\'shish', sum: 'so\'m',
    loading: 'Yuklanmoqda...', noOrders: 'Sizda hali buyurtmalar yo\'q',
    orderError: 'Buyurtmalarni yuklashda xatolik', repeat: 'Qaytarish',
    cartTotal: 'Jami to\'lov:', orderBtn: 'Buyurtma berish',
    statusNew: 'Yangi', statusPreparing: 'Tayyorlanmoqda', statusDelivering: 'Yo\'lda',
    statusDone: 'Bajarildi', statusCancelled: 'Bekor qilindi',
    ratePrompt: 'Buyurtmani baholang', orderStr: 'Buyurtma',
    addressPrompt: 'Manzilingizni kiriting', namePrompt: 'Ismingiz', phonePrompt: 'Telefon raqamingiz',
    orderSuccess: 'Buyurtma qabul qilindi!', fillAll: 'Iltimos, barcha maydonlarni to\'ldiring',
    cartEmpty: 'Savatchangiz bo\'sh'
  },
  ru: {
    menu: 'Меню', orders: 'Мои заказы', add: 'Добавить', sum: 'сум',
    loading: 'Загрузка...', noOrders: 'У вас еще нет заказов',
    orderError: 'Ошибка загрузки заказов', repeat: 'Повторить',
    cartTotal: 'Итого к оплате:', orderBtn: 'Заказать',
    statusNew: 'Принят', statusPreparing: 'Готовится', statusDelivering: 'В пути',
    statusDone: 'Завершен', statusCancelled: 'Отменен',
    ratePrompt: 'Оцените заказ', orderStr: 'Заказ',
    addressPrompt: 'Введите адрес', namePrompt: 'Ваше имя', phonePrompt: 'Ваш телефон',
    orderSuccess: 'Заказ принят!', fillAll: 'Пожалуйста, заполните все поля',
    cartEmpty: 'Ваша корзина пуста'
  }
};
const t = T[clientLang];

let currentClient = null;
let products = [];
let cart = {};
let CLIENT_RULES = [];
try {
  const _cRules = JSON.parse(localStorage.getItem('teegu_business_rules') || 'null');
  if (Array.isArray(_cRules)) CLIENT_RULES = _cRules;
} catch (e) {}
let clientOrdersCache = [];

// Update static text in HTML
document.addEventListener('DOMContentLoaded', () => {
  const m = document.getElementById('tab-menu');
  if(m) m.innerHTML = `🥗 ${t.menu}`;
  const o = document.getElementById('tab-orders');
  if(o) o.innerHTML = `📦 ${t.orders}`;
  const ct = document.getElementById('cartTotalLabel');
  if(ct) ct.innerText = t.cartTotal;
  const ob = document.getElementById('btnOrder');
  if(ob) ob.innerText = t.orderBtn;
  
  const chkT = document.getElementById('checkoutTitle');
  if(chkT) chkT.innerText = t.orderStr;
  const chkN = document.getElementById('checkoutNameLabel');
  if(chkN) chkN.innerText = t.namePrompt;
  const chkP = document.getElementById('checkoutPhoneLabel');
  if(chkP) chkP.innerText = t.phonePrompt;
  const chkA = document.getElementById('checkoutAddressLabel');
  if(chkA) chkA.innerText = t.addressPrompt;
  const chkCancel = document.getElementById('checkoutCancelBtn');
  if(chkCancel) chkCancel.innerText = t.statusCancelled; // Using cancelled text for 'Cancel'
  const chkSub = document.getElementById('checkoutSubmitBtn');
  if(chkSub) chkSub.innerText = t.orderBtn;
});

async function init() {
  try {
    const cSnap = await db.collection('clients').where('tgId', '==', tgUser.id).get();
    if(!cSnap.empty) {
      currentClient = cSnap.docs[0].data();
      try {
        const oSnap = await db.collection('orders').where('clientId', '==', currentClient.id).get();
        if (oSnap && !oSnap.empty) clientOrdersCache = oSnap.docs.map(d => d.data());
      } catch (e2) {}
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
    products = pSnap.docs.map(d => d.data()).filter(Boolean).sort((a,b)=>(a.order??999)-(b.order??999));
    
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
    
    let qtyControls = '';
    const isOutOfStock = p.stock !== undefined && p.stock !== '' && p.stock < (p.step || 0.5);
    
    if (isOutOfStock) {
      qtyControls = `<div style="padding:6px 16px; border-radius:12px; font-weight:800; background:var(--bg3); color:var(--text3); font-size:13px; text-align:center">${clientLang==='uz'?'Tugadi':'Нет в наличии'}</div>`;
    } else if (!qty) {
      qtyControls = `<button class="btn btn-outline" style="padding:6px 16px; border-radius:12px; font-weight:800; background:var(--bg3); border:none; color:var(--accent); transition:transform 0.2s" onclick="changeQty('${p.id}', ${p.step || 0.5})">➕ ${t.add}</button>`;
    } else {
      qtyControls = `
        <div style="display:flex; align-items:center; justify-content:space-between; background:var(--bg); border-radius:12px; border:1px solid var(--border); padding:2px; min-width:90px;">
          <button class="icon-btn" onclick="changeQty('${p.id}', ${-(p.step || 0.5)})" style="border:none; width:30px; height:30px; padding:0; display:flex; align-items:center; justify-content:center;">➖</button>
          <span style="font-weight:800; font-size:15px; text-align:center" id="qty-${p.id}">${qty}</span>
          <button class="icon-btn" onclick="changeQty('${p.id}', ${p.step || 0.5})" style="border:none; width:30px; height:30px; padding:0; display:flex; align-items:center; justify-content:center; color:var(--accent)">➕</button>
        </div>
      `;
    }

    return `
    <div class="product-card ${qty > 0 ? 'selected' : ''}" id="pc-${p.id}" style="padding:12px; display:flex; justify-content:space-between; align-items:center; background:var(--bg2); border-radius:16px; border:1px solid var(--border); box-shadow: 0 4px 12px rgba(0,0,0,0.02); transition:transform 0.2s; margin-bottom:10px;">
      <div style="display:flex; align-items:center; gap:12px;">
        <div style="font-size:32px; background:var(--bg3); width:50px; height:50px; display:flex; align-items:center; justify-content:center; border-radius:14px; border:1px solid var(--border);">${p.emoji || '🍔'}</div>
        <div>
          <div style="font-weight:700; font-size:15px; margin-bottom:4px; line-height:1.2;">${(clientLang === 'uz' && p.nameUz) ? p.nameUz : (p.name || '')} ${hasCustomPrice}</div>
          <div style="color:var(--accent2); font-weight:900; font-size:14px;">${fmt(price)} <span style="font-size:11px; color:var(--text3); font-weight:600;">/ ${p.unit || 'кг'}</span></div>
        </div>
      </div>
      <div>
        ${qtyControls}
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
  
  renderProducts();
  updateCart();
}

function updateCart() {
  let total = 0;
  for(let id in cart) {
    const p = products.find(x => x.id === id);
    if(p) total += cart[id] * getPrice(p);
  }
  document.getElementById('cartTotal').innerText = fmt(total) + ' ' + t.sum;
  document.getElementById('cartBar').style.display = total > 0 ? 'flex' : 'none';
}

function placeOrder() {
  if (Object.keys(cart).length === 0) {
    if (tg && tg.showAlert) tg.showAlert(t.cartEmpty);
    else alert(t.cartEmpty);
    return;
  }
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
  
  if(!name || !phone || !address) {
    if(tg && tg.showAlert) tg.showAlert(t.fillAll);
    else alert(t.fillAll);
    return;
  }
  
  const checkoutBtn = document.getElementById('checkoutSubmitBtn');
  if (checkoutBtn) {
    checkoutBtn.disabled = true;
    checkoutBtn.innerText = t.loading;
  }
  
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
    const checkoutBtnReset = document.getElementById('checkoutSubmitBtn');
    if (checkoutBtnReset) {
      checkoutBtnReset.disabled = false;
      checkoutBtnReset.innerText = t.orderBtn;
    }
    return;
  }

  
  let total = 0;
  const items = [];
  for(let id in cart) {
    const p = products.find(x => x.id === id);
    if(p) {
      const price = getPrice(p);
      items.push({ id: p.id, name: p.name || '', nameUz: p.nameUz || p.name || '', emoji: p.emoji || '', qty: cart[id], price: price, unit: p.unit || 'кг' });
      total += cart[id] * price;
    }
  }

  // Enforce active dynamic business rules before placing order
  if ((paymentMethod === 'консигнация' || paymentMethod === 'Qarz') && currentClient && (!clientOrdersCache || !clientOrdersCache.length)) {
    try {
      const oSnap = await db.collection('orders').where('clientId', '==', currentClient.id).get();
      if (oSnap && !oSnap.empty) clientOrdersCache = oSnap.docs.map(d => d.data());
    } catch (e) {}
  }
  const clientRuleRes = evaluateClientOrderRules({
    clientId: currentClient && currentClient.id,
    clientName: name,
    items,
    payment: paymentMethod,
    rules: CLIENT_RULES,
    orders: clientOrdersCache
  });
  if (clientRuleRes.blocked) {
    if (tg && tg.showAlert) tg.showAlert(clientRuleRes.errors[0]);
    else alert(clientRuleRes.errors[0]);
    const checkoutBtnReset = document.getElementById('checkoutSubmitBtn');
    if (checkoutBtnReset) {
      checkoutBtnReset.disabled = false;
      checkoutBtnReset.innerText = t.orderBtn;
    }
    return;
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
    type: 'Dostavka',
    delivered: false,
    sentSheets: false,
    courier: '',
    partialPaid: 0,
    debtPaid: paymentMethod !== 'консигнация' && paymentMethod !== 'Qarz',
    payment: paymentMethod,
    status: 'new',
    date: new Date().toISOString(),
    stockDeducted: true
  };
  

  try {
    const batch = db.batch();
    
    order.items.forEach(i => {
      const p = products.find(x => x.id === i.id);
      if(p && p.stock !== undefined && p.stock !== null && p.stock !== '' && !isNaN(Number(p.stock))) {
        const prodRef = db.collection('products').doc(String(p.id));
        const newVal = Math.round((Number(p.stock) - Number(i.qty)) * 100) / 100;
        p.stock = newVal;
        const incVal = (typeof firebase !== 'undefined' && firebase.firestore && firebase.firestore.FieldValue && firebase.firestore.FieldValue.increment)
          ? firebase.firestore.FieldValue.increment(-i.qty)
          : newVal;
        batch.update(prodRef, { stock: incVal });
      }
    });
    
    batch.set(db.collection('orders').doc(String(order.id)), order);
    await batch.commit();
    
    try {
      const setSnap = await db.collection('settings').doc('main').get();
      const settings = setSnap.data() || {};
      const tgToken = settings.tgToken || atob('ODc5NjU4ODA3MTpBQUc4Wl9SOGhQOUVTWlpfM0x4VWFrRDhQQ1hqNUM1WlA2WQ==');
      const tgChatId = settings.tgChatId || '483325961';
      
      if(tgToken && tgChatId) {
        const text = buildTgMsg(order);
        await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`,{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({chat_id:tgChatId, text:text, parse_mode:'HTML'})
        });
        
        // Also send warning if stock drops
        for (const i of order.items) {
           const p = products.find(x => x.id === i.id);
           const minSt = getClientProductMinStock(p);
           if(p && p.stock !== undefined && p.stock !== '' && !isNaN(Number(p.stock)) && Number(p.stock) <= minSt) {
               const rem = Math.round(Number(p.stock) * 100) / 100;
               const warning = `⚠️ Diqqat! ${p.name} zaxirasi tugayapti. Qoldiq: ${rem} ${p.unit||'kg'}`;
               fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:tgChatId,text:warning})}).catch(()=>{});
           }
        }
        if (clientRuleRes.largeOrderAlertKg) {
          const bigMsg = `🚨 KATTA BUYURTMA (Client App - ${clientRuleRes.largeOrderAlertKg} kg)!\n👤 Mijoz: ${name}`;
          fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:tgChatId,text:bigMsg})}).catch(()=>{});
        }
        
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
    const checkoutBtnReset = document.getElementById('checkoutSubmitBtn');
    if (checkoutBtnReset) {
      checkoutBtnReset.disabled = false;
      checkoutBtnReset.innerText = t.orderBtn;
    }
  }
}

function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function buildTgMsg(order){
  const pi={'наличные':'💵','клик':'📱','консигнация':'📝','Naqd':'💵','Karta':'💳','Qarz':'📝','карта':'💳'};
  const d=new Date(order.date);
  const ds=d.toLocaleDateString('ru-RU')+' '+d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
  let l=[`🥗 <b>НОВЫЙ ЗАКАЗ ИЗ WEB APP</b>`,``,`👤 <b>${escapeHTML(order.client)}</b>`];
  if(order.phone)l.push(`📞 ${escapeHTML(order.phone)}`);
  if(order.address)l.push(`📍 ${escapeHTML(order.address)}`);
  if(order.note)l.push(`📌 <i>${escapeHTML(order.note)}</i>`);
  l.push(``,`📦 <b>Заказ:</b>`);
  (order.items || []).forEach((i,idx)=>l.push(`${idx+1}. ${i.emoji||''} ${escapeHTML(i.name)} — ${i.qty}${escapeHTML(i.unit||'кг')}`));
  l.push(``,`💰 <b>Итого: ${fmt(order.total)} сум</b>`,`💳 ${pi[order.payment]||''} ${escapeHTML(order.payment)}`);
  if(order.type==='доставка'||order.type==='Dostavka')l.push(`🛵 Доставка`);
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
  el.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text3)">${t.loading}</div>`;
  if(!currentClient) return;
  
  if(orderListener) orderListener(); // unsubscribe
  
  orderListener = db.collection('orders')
    .where('clientId', '==', currentClient.id)
    .onSnapshot(snap => {
      let orders = [];
      snap.forEach(doc => orders.push(doc.data()));
      orders.sort((a,b) => new Date(b.date) - new Date(a.date));
      
      if (orders.length === 0) {
        el.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text3)">${t.noOrders}</div>`;
        return;
      }
      
      el.innerHTML = orders.map(o => {
        const itemsStr = (o.items || []).map(i => `${i.emoji || '🥗'} ${i.qty}${i.unit||'кг'}`).join(', ');
        const d = new Date(o.date);
        const dateStr = isNaN(d.getTime()) ? '—' : (d.toLocaleDateString('ru-RU', {day:'numeric',month:'short'}) + ' ' + d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}));
        
        const safeItems = JSON.stringify(o.items || []).replace(/'/g, "&apos;").replace(/"/g, "&quot;");
        
        const isActive = ['new', 'preparing', 'delivering'].includes(o.status);
        let statusHtml = '';
        
        if (isActive) {
           const steps = ['new', 'preparing', 'delivering'];
           const stepIndex = steps.indexOf(o.status);
           statusHtml = `
           <div style="background:var(--bg); border-radius:12px; padding:12px; margin-bottom:12px; border:1px solid var(--border)">
             <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
                <div style="font-size:10px; font-weight:800; color:${stepIndex>=0?'var(--accent)':'var(--text3)'};">${t.statusNew}</div>
                <div style="font-size:10px; font-weight:800; color:${stepIndex>=1?'var(--orange)':'var(--text3)'};">${t.statusPreparing}</div>
                <div style="font-size:10px; font-weight:800; color:${stepIndex>=2?'var(--blue)':'var(--text3)'};">${t.statusDelivering}</div>
             </div>
             <div style="display:flex; height:6px; background:var(--bg3); border-radius:3px; overflow:hidden;">
                <div style="width:${(stepIndex+1)*33.3}%; background:linear-gradient(90deg, var(--accent), var(--accent2)); transition:width 0.5s ease;"></div>
             </div>
           </div>
           `;
        } else {
           // Delivered or Cancelled
           let badgeColor = o.status==='done' ? 'var(--green)' : 'var(--text2)';
           let badgeText = o.status==='done' ? t.statusDone : t.statusCancelled;
           
           // ADDING RATING UI
           let ratingHtml = '';
           if(o.status === 'done' && !o.rating) {
             ratingHtml = `
               <div style="margin-top:10px; padding-top:10px; border-top:1px dashed var(--border); text-align:center;">
                 <div style="font-size:12px; font-weight:600; color:var(--text2); margin-bottom:6px;">${t.ratePrompt}</div>
                 <div style="display:flex; justify-content:center; gap:8px;">
                   ${[1,2,3,4,5].map(star => `<span style="font-size:24px; color:var(--text3); cursor:pointer" onclick="rateOrder(${o.id}, ${star})">⭐</span>`).join('')}
                 </div>
               </div>
             `;
           } else if(o.status === 'done' && o.rating) {
             ratingHtml = `
               <div style="margin-top:10px; padding-top:10px; border-top:1px dashed var(--border); text-align:center;">
                 <div style="display:flex; justify-content:center; gap:2px;">
                   ${Array(o.rating).fill('<span style="font-size:16px;">⭐</span>').join('')}
                 </div>
               </div>
             `;
           }
           
           statusHtml = `<div style="text-align:right; font-size:12px; font-weight:700; color:${badgeColor}; margin-bottom:8px;">${badgeText}</div>${ratingHtml}`;
        }

        return `
          <div class="card" style="padding:15px;margin-bottom:12px; background:var(--bg2);">
            ${statusHtml}
            <div style="display:flex;justify-content:space-between;margin-bottom:8px">
              <div style="font-weight:800; font-size:15px;">${t.orderStr} #${String(o.id).slice(-4)}</div>
              <div style="font-size:12px;color:var(--text2)">${dateStr}</div>
            </div>
            <div style="font-size:13px;color:var(--text);margin-bottom:12px; line-height:1.4;">${itemsStr}</div>
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <div style="font-weight:900;color:var(--accent2);font-size:16px;">${o.total.toLocaleString('ru-RU')} ${t.sum}</div>
              <button class="btn-repeat" onclick="repeatOrder('${safeItems}')" style="width:auto; margin:0; padding:6px 14px;">🔄 ${t.repeat}</button>
            </div>
          </div>
        `;
      }).join('');
    }, err => {
      console.log(err);
      el.innerHTML = `<div style="color:var(--danger);text-align:center">${t.orderError}</div>`;
    });
}

window.rateOrder = function(orderId, rating) {
  if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('medium');
  db.collection('orders').doc(String(orderId)).update({ rating: rating });
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
    const locStatus = document.getElementById('locationStatus');
    if (locStatus) locStatus.style.display = 'block';
    
    // Reverse geocode to get address text (optional, but nice)
    if (window.ymaps && ymaps.geocode) {
      ymaps.geocode(center).then(function (res) {
        const firstGeoObject = res && res.geoObjects && res.geoObjects.get(0);
        if(firstGeoObject) {
          const addr = document.getElementById('orderAddress');
          if (addr) addr.value = firstGeoObject.getAddressLine();
        }
      }).catch(function() {});
    }
  }
  closeClientMap();
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
  if (cachedUi) applySharedUiConfig(cachedUi, 'client');
  db.collection('settings').doc('main').onSnapshot(snap => {
    if (snap && snap.exists) {
      const d = snap.data() || {};
      if (Array.isArray(d.businessRules)) {
        CLIENT_RULES = d.businessRules;
        try { localStorage.setItem('teegu_business_rules', JSON.stringify(CLIENT_RULES)); } catch (e) {}
      }
      if (d.uiConfig) applySharedUiConfig(d.uiConfig, 'client');
    }
  });
} catch (e) {}

function getClientProductMinStock(p) {
  if (Array.isArray(CLIENT_RULES)) {
    const sp = CLIENT_RULES.find(r => r && r.enabled && r.type === 'warehouse_low_alert_kg' && p && String(r.productId) === String(p.id));
    if (sp && !isNaN(Number(sp.thresholdKg))) return Math.max(0, Number(sp.thresholdKg));
    const gl = CLIENT_RULES.find(r => r && r.enabled && r.type === 'warehouse_low_alert_kg' && (!r.productId || r.productId === 'all'));
    if (gl && !isNaN(Number(gl.thresholdKg))) return Math.max(0, Number(gl.thresholdKg));
  }
  return (p && p.minStock !== undefined && p.minStock !== '' && !isNaN(Number(p.minStock))) ? Number(p.minStock) : 5;
}

function evaluateClientOrderRules(opts = {}) {
  const { clientId, clientName, items = [], payment = '', rules = CLIENT_RULES, orders = clientOrdersCache } = opts;
  const activeRules = (Array.isArray(rules) ? rules : []).filter(r => r && r.enabled);
  const errors = [];
  let largeOrderAlertKg = null;
  const isCredit = payment === 'консигнация' || payment === 'Qarz';
  const totalQty = items.reduce((s, i) => s + (Number(i.qty) || 0), 0);
  const totalKg = items.filter(i => !i.unit || !['шт', 'sht', 'dona', 'ta'].includes(String(i.unit).toLowerCase()))
    .reduce((s, i) => s + (Number(i.qty) || 0), 0) || totalQty;

  let unpaidTotal = 0;
  let oldestUnpaidDays = 0;
  const now = Date.now();
  (orders || []).forEach(o => {
    if (!o || o.status === 'cancelled' || o.debtPaid) return;
    if (clientId && String(o.clientId) !== String(clientId)) return;
    if (o.payment !== 'консигнация' && o.payment !== 'Qarz') return;
    const rem = Math.max(0, (Number(o.total) || 0) - (Number(o.partialPaid) || 0));
    if (rem > 0) {
      unpaidTotal += rem;
      const dAge = Math.floor((now - new Date(o.date).getTime()) / 86400000);
      if (dAge > oldestUnpaidDays) oldestUnpaidDays = dAge;
    }
  });

  activeRules.forEach(rule => {
    if (rule.type === 'block_debt_above' && isCredit && Number(rule.limit) > 0 && unpaidTotal > Number(rule.limit)) {
      errors.push(clientLang === 'uz'
        ? `Sizda to'lanmagan qarz (${fmt(unpaidTotal)} so'm) ${fmt(rule.limit)} so'm limitidan oshgan — qarzga buyurtma yopilgan.`
        : `Ваш текущий долг (${fmt(unpaidTotal)} сум) превышает лимит ${fmt(rule.limit)} сум — заказ в долг недоступен.`);
    } else if (rule.type === 'max_order_debt_days' && isCredit && Number(rule.maxDays) > 0 && unpaidTotal > 0 && oldestUnpaidDays >= Number(rule.maxDays)) {
      errors.push(clientLang === 'uz'
        ? `${oldestUnpaidDays} kunlik to'lanmagan qarz mavjud (limit ${rule.maxDays} kun).`
        : `Имеется просроченный долг (${oldestUnpaidDays} дн., лимит ${rule.maxDays} дн.).`);
    } else if (rule.type === 'min_order_kg' && Number(rule.minKg) > 0 && totalKg > 0 && totalKg < Number(rule.minKg)) {
      errors.push(clientLang === 'uz'
        ? `Eng kam buyurtma hajmi ${rule.minKg} kg (hozir ${Math.round(totalKg * 10) / 10} kg).`
        : `Минимальный заказ ${rule.minKg} кг (сейчас ${Math.round(totalKg * 10) / 10} кг).`);
    } else if (rule.type === 'large_order_alert_kg' && Number(rule.thresholdKg) > 0 && totalKg >= Number(rule.thresholdKg)) {
      largeOrderAlertKg = Math.round(totalKg * 10) / 10;
    }
  });

  return { blocked: errors.length > 0, errors, largeOrderAlertKg };
}

init();


