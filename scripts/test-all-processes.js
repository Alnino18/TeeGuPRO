const fs = require('fs');
const vm = require('vm');

console.log('====================================================');
console.log('🧪 COMPREHENSIVE TEST OF ALL PROCESSES & WORKFLOWS');
console.log('====================================================\n');

let testsFailed = 0;
let testsPassed = 0;

function assert(condition, testName, errorDetails = '') {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    testsPassed++;
  } else {
    console.error(`  ❌ FAIL: ${testName} ${errorDetails}`);
    testsFailed++;
  }
}

function createMockEl(id) {
  return {
    id,
    innerHTML: '',
    textContent: '',
    innerText: '',
    value: '',
    style: {},
    classList: {
      classes: new Set(),
      add: function(c) { this.classes.add(c); },
      remove: function(c) { this.classes.delete(c); },
      contains: function(c) { return this.classes.has(c); },
      toggle: function(c, force) {
        if (force === undefined) {
          if (this.classes.has(c)) this.classes.delete(c); else this.classes.add(c);
        } else if (force) this.classes.add(c); else this.classes.delete(c);
      }
    },
    addEventListener: () => {},
    setAttribute: () => {},
    getAttribute: () => null,
    dataset: {},
    focus: () => {},
    click: () => {},
    appendChild: () => {},
    remove: () => {}
  };
}

function makeMockBrowser() {
  const dom = {};
  const mockDoc = {
    getElementById: id => {
      if (!dom[id]) dom[id] = createMockEl(id);
      return dom[id];
    },
    querySelector: sel => {
      const id = sel.replace(/^[#.]/, '');
      if (!dom[id]) dom[id] = createMockEl(id);
      return dom[id];
    },
    querySelectorAll: sel => [createMockEl('mock1'), createMockEl('mock2')],
    addEventListener: () => {},
    createElement: tag => createMockEl('dynamic_' + tag),
    body: createMockEl('body'),
    head: createMockEl('head')
  };

  const mockFirestore = {
    collection: coll => ({
      onSnapshot: () => {},
      doc: docId => ({
        onSnapshot: () => {},
        get: () => Promise.resolve({ exists: true, data: () => ({}) }),
        set: data => Promise.resolve(data),
        update: data => Promise.resolve(data),
        delete: () => Promise.resolve()
      }),
      add: data => Promise.resolve({ id: 'new_' + Date.now() }),
      where: () => ({
        ...mockFirestore.collection(coll),
        get: () => Promise.resolve({ empty: false, docs: [{ id: '101', data: () => ({ id: '101', name: 'Alfraganus Cafe' }) }] })
      }),
      orderBy: () => mockFirestore.collection(coll),
      limit: () => mockFirestore.collection(coll)
    }),
    batch: () => ({
      set: () => {},
      update: () => {},
      delete: () => {},
      commit: () => Promise.resolve()
    }),
    enablePersistence: () => Promise.resolve()
  };

  const env = {
    atob: str => Buffer.from(str, 'base64').toString('binary'),
    btoa: str => Buffer.from(str, 'binary').toString('base64'),
    window: {},
    setInterval: (fn, ms) => 1,
    setTimeout: (fn, ms) => { fn(); return 1; },
    clearInterval: () => {},
    clearTimeout: () => {},
    console,
    Math,
    Date,
    Array,
    Object,
    String,
    Number,
    Boolean,
    RegExp,
    Set,
    Map,
    Promise,
    JSON,
    localStorage: {
      store: {},
      getItem: function(k) { return this.store[k] || null; },
      setItem: function(k, v) { this.store[k] = String(v); },
      removeItem: function(k) { delete this.store[k]; }
    },
    navigator: {
      serviceWorker: { register: () => Promise.resolve() },
      geolocation: {
        getCurrentPosition: (success, error) => {
          success({ coords: { latitude: 41.2995, longitude: 69.2401 } });
        }
      }
    },
    addEventListener: () => {},
    document: mockDoc,
    alert: msg => {},
    confirm: msg => true,
    prompt: (msg, def) => def || 'test',
    fetch: () => Promise.resolve({ json: () => Promise.resolve({ ok: true }) }),
    URL: { createObjectURL: () => 'blob:mock' },
    Blob: class Blob {},
    Chart: class { constructor() {} destroy() {} update() {} },
    firebase: {
      apps: [{}],
      initializeApp: () => ({}),
      firestore: () => mockFirestore
    },
    dom
  };
  env.window = env;
  return env;
}

// =========================================================================
// 1. TEST ADMIN APP
// =========================================================================
console.log('--- 1. Testing Admin App (`admin/app.js`) ---');
const adminEnv = makeMockBrowser();
const adminContext = vm.createContext(adminEnv);
const runAdmin = code => vm.runInContext(code, adminContext);

try {
  const adminCode = fs.readFileSync('admin/app.js', 'utf8');
  vm.runInContext(adminCode, adminContext);
  assert(true, 'admin/app.js loaded without syntax errors');
} catch (e) {
  assert(false, 'admin/app.js evaluation failed', e.stack);
}

// Populate sample data
runAdmin(`
state.clients = [
  { id: '101', name: 'Alfraganus Cafe', type: 'кафе', phone: '+998901234567', customPrices: { funchoza: 22000 } },
  { id: '102', name: 'Burger Boss', type: 'фаст-фуд', phone: '+998939876543' },
  { id: '103', name: 'Oshxona O\\'zbegim', type: 'ресторан', phone: '+998941112233' }
];

state.orders = [
  {
    id: 'ord_1',
    clientId: '101',
    client: 'Alfraganus Cafe',
    phone: '+998901234567',
    date: new Date().toISOString(),
    items: [{ id: 'funchoza', name: 'Фунчоза', nameUz: 'Funchoza', price: 22000, qty: 3, unit: 'kg' }],
    total: 66000,
    payment: 'наличные',
    status: 'new',
    type: 'Dostavka',
    delivered: false
  },
  {
    id: 'ord_2',
    clientId: '102',
    client: 'Burger Boss',
    phone: '+998939876543',
    date: new Date(Date.now() - 86400000 * 2).toISOString(),
    items: [{ id: 'sologurc', name: 'Сол огурцы', nameUz: 'Tuzlangan bodring', price: 20000, qty: 2, unit: 'kg' }],
    total: 40000,
    payment: 'Qarz',
    debtPaid: false,
    status: 'delivering',
    type: 'Dostavka',
    delivered: false
  },
  {
    id: 'ord_3',
    clientId: '103',
    client: 'Oshxona O\\'zbegim',
    phone: '+998941112233',
    date: new Date(Date.now() - 86400000 * 15).toISOString(),
    items: [{ id: 'morkovcha', name: 'Морковча', nameUz: 'Sabzi', price: 25000, qty: 4, unit: 'kg' }],
    total: 100000,
    payment: 'консигнация',
    debtPaid: false,
    status: 'done',
    type: 'Dostavka',
    delivered: true
  }
];
`);

// 1.1 Test startApp
try {
  runAdmin('startApp()');
  assert(true, 'startApp() runs without errors');
} catch (e) {
  assert(false, 'startApp() failed', e.stack);
}

// 1.2 Test navigation showPage
const pages = ['dashboard', 'orders', 'clients', 'stats', 'debts', 'delivery', 'new-order', 'map', 'ai'];
pages.forEach(p => {
  try {
    runAdmin(`showPage('${p}')`);
    assert(true, `showPage('${p}') executed successfully`);
  } catch (e) {
    assert(false, `showPage('${p}') failed`, e.stack);
  }
});

// 1.3 Test calculateItemProfit and calculateOrderProfit
try {
  const p1 = runAdmin(`calculateItemProfit({ id: 'funchoza', price: 20000, qty: 2 })`);
  assert(p1 === 6000, 'Profit Funchoza @ 20k -> 3000/kg (qty 2 = 6000)');
  const p2 = runAdmin(`calculateItemProfit({ id: 'funchoza', price: 22000, qty: 2 })`);
  assert(p2 === 8000, 'Profit Funchoza @ 22k -> 4000/kg (qty 2 = 8000)');
  const p3 = runAdmin(`calculateItemProfit({ id: 'funchoza', price: 25000, qty: 2 })`);
  assert(p3 === 10000, 'Profit Funchoza @ 25k -> 5000/kg (qty 2 = 10000)');

  const pBodring1 = runAdmin(`calculateItemProfit({ id: 'sologurc', price: 15000, qty: 3 })`);
  assert(pBodring1 === 9000, 'Profit Sol ogurtsy @ 15k -> 3000/kg (qty 3 = 9000)');
  const pBodring2 = runAdmin(`calculateItemProfit({ id: 'sologurc', price: 20000, qty: 3 })`);
  assert(pBodring2 === 15000, 'Profit Sol ogurtsy @ 20k -> 5000/kg (qty 3 = 15000)');

  const ordProfit = runAdmin(`calculateOrderProfit(state.orders[0])`);
  assert(ordProfit === 12000, `Order profit calculated correctly (expected 12000, got ${ordProfit})`);
} catch (e) {
  assert(false, 'Profit calculation test failed', e.stack);
}

// 1.4 Test Client List & Search
try {
  runAdmin('renderClientsList()');
  assert(adminEnv.dom['clientsList'].innerHTML.includes('Alfraganus Cafe'), 'renderClientsList contains Alfraganus Cafe');
  assert(adminEnv.dom['clientsList'].innerHTML.includes('Oshxona O\'zbegim'), 'renderClientsList handles apostrophes in names');

  runAdmin('renderClientsList("Burger")');
  assert(adminEnv.dom['clientsList'].innerHTML.includes('Burger Boss'), 'filterClients("Burger") shows Burger Boss');
  assert(!adminEnv.dom['clientsList'].innerHTML.includes('Alfraganus'), 'filterClients("Burger") filters out others');
  runAdmin('renderClientsList("")'); // reset
} catch (e) {
  assert(false, 'Client list & search test failed', e.stack);
}

// 1.5 Test Churn Radar
try {
  runAdmin('renderChurnRadar()');
  assert(runAdmin('typeof toggleChurnRadar === "function"'), 'toggleChurnRadar function exists');
  runAdmin('toggleChurnRadar()');
  runAdmin('toggleChurnRadar()');
  assert(true, 'toggleChurnRadar runs smoothly');
} catch (e) {
  assert(false, 'Churn radar test failed', e.stack);
}

// 1.6 Test Orders List, Date Filters, Search
try {
  runAdmin('renderOrdersList("", "all")');
  assert(adminEnv.dom['ordersList'].innerHTML.includes('Alfraganus Cafe'), 'renderOrdersList("all") shows orders');

  runAdmin('renderOrdersList("", "today")');
  assert(adminEnv.dom['ordersList'].innerHTML.includes('Alfraganus Cafe'), 'renderOrdersList("today") shows today order');

  runAdmin('renderOrdersList("Burger", "all")');
  assert(adminEnv.dom['ordersList'].innerHTML.includes('Burger Boss'), 'filterOrders("Burger") shows matching order');
  runAdmin('renderOrdersList("", "all")');
} catch (e) {
  assert(false, 'Orders list test failed', e.stack);
}

// 1.7 Test Debts
try {
  runAdmin('renderDebts()');
  assert(adminEnv.dom['debtsList'].innerHTML.includes('Burger Boss'), 'Debts list includes "Qarz" from Burger Boss');
  assert(adminEnv.dom['debtsList'].innerHTML.includes('Oshxona O\'zbegim'), 'Debts list includes "консигнация" from Oshxona');
} catch (e) {
  assert(false, 'Debts test failed', e.stack);
}

// 1.8 Test Delivery
try {
  runAdmin('renderDelivery()');
  assert(adminEnv.dom['deliveryList'].innerHTML.includes('Alfraganus Cafe'), 'Delivery list renders today active delivery');
} catch (e) {
  assert(false, 'Delivery test failed', e.stack);
}

// 1.9 Test Stats & Dashboard
try {
  runAdmin('renderStats()');
  runAdmin('renderDashboard()');
  assert(true, 'renderStats and renderDashboard run without errors');
} catch (e) {
  assert(false, 'Stats / Dashboard test failed', e.stack);
}

// 1.10 Test New Order Submission in Admin
try {
  runAdmin(`
    state.quantities = { funchoza: 2 };
    state.selectedPayment = 'наличные';
    document.getElementById('clientSelect').value = '101';
    submitOrder();
  `);
  assert(true, 'submitOrder in Admin executed without crash');
} catch (e) {
  assert(false, 'submitOrder in Admin failed', e.stack);
}

// 1.11 Test Broadcast Modal & Preview
try {
  runAdmin('loadBroadcastTemplate("pricelist")');
  assert(adminEnv.dom['broadcastTitle'].value.length > 0, 'loadBroadcastTemplate populated title');
  runAdmin('updateBroadcastPreview()');
  assert(adminEnv.dom['broadcastPreviewBox'].innerHTML.length > 0, 'updateBroadcastPreview generated preview HTML');
} catch (e) {
  assert(false, 'Broadcast test failed', e.stack);
}

// 1.12 Test AI Agent context builder
try {
  const ctx = runAdmin('buildBusinessContext()');
  assert(ctx.bugungiSavdo !== undefined && ctx.mahsulotlarNarxlari !== undefined, 'buildBusinessContext generated structured context');
} catch (e) {
  assert(false, 'AI context builder test failed', e.stack);
}

// 1.13 Test Thermal Label Generator
try {
  runAdmin('openLabelModal("ord_1")');
  assert(adminEnv.dom['labelPreviewArea'].innerHTML.includes('svg'), 'openLabelModal generated barcode SVG');
} catch (e) {
  assert(false, 'Label modal generator test failed', e.stack);
}

// 1.14 Test Partial Debt Payment (Uzbek Qarz & Russian консигнация)
try {
  runAdmin(`
    partialClientId = '102';
    document.getElementById('partialAmount').value = '15000';
    updatePartialRemaining();
    applyPartialPayment();
  `);
  assert(adminEnv.dom['partialRemaining'].textContent.includes('Qoladi') || adminEnv.dom['partialRemaining'].textContent.includes('Останется'), 'Partial payment update & apply executed');
} catch (e) {
  assert(false, 'Partial debt payment test failed', e.stack);
}

// 1.15 Test Client History & Order Detail modals
try {
  runAdmin('showClientHistory("101")');
  assert(adminEnv.dom['historyContent'].innerHTML.includes('Alfraganus Cafe') || adminEnv.dom['historyTitle'].textContent.includes('Alfraganus'), 'showClientHistory loaded history');
  runAdmin('showOrderDetail("ord_1")');
  assert(adminEnv.dom['detailContent'].innerHTML.includes('Фунчоза') || adminEnv.dom['detailContent'].innerHTML.includes('Funchoza'), 'showOrderDetail displayed order contents');
} catch (e) {
  assert(false, 'History & detail modal test failed', e.stack);
}

// 1.16 Test Excel Export
try {
  runAdmin('exportToExcel()');
  assert(true, 'exportToExcel executed cleanly without errors');
} catch (e) {
  assert(false, 'Excel export test failed', e.stack);
}

// =========================================================================
// 2. TEST AGENT APP
// =========================================================================
console.log('\n--- 2. Testing Agent App (`agent/agent.js`) ---');
const agentEnv = makeMockBrowser();
const agentContext = vm.createContext(agentEnv);
const runAgent = code => vm.runInContext(code, agentContext);

try {
  const agentCode = fs.readFileSync('agent/agent.js', 'utf8');
  runAgent(agentCode);
  assert(true, 'agent/agent.js loaded without syntax errors');

  runAgent(`
    loggedAgentName = 'Узим';
    CLIENTS = [
      { id: '101', name: 'Alfraganus Cafe', type: 'кафе', phone: '+998901234567', customPrices: { funchoza: 22000 } }
    ];
    PRODUCTS = [
      { id: 'funchoza', name: 'Фунчоза', nameUz: 'Funchoza', price: 25000, emoji: '🍜', unit: 'kg' },
      { id: 'sologurc', name: 'Сол огурцы', nameUz: 'Tuzlangan bodring', price: 20000, emoji: '🥒', unit: 'kg' }
    ];
    document.getElementById('orderClient').value = 'Alfraganus Cafe — +998901234567';
  `);

  // Test custom price for client 101
  const customP = runAgent('getProductPrice(PRODUCTS[0])');
  assert(customP === 22000, `Agent getProductPrice returned client custom price 22000 (got ${customP})`);

  // Test cart qty update & total
  runAgent(`
    cart = {};
    updateQty('funchoza', 1);
  `);
  const cQty1 = runAgent("cart['funchoza']");
  assert(cQty1 === 0.5, 'updateQty added 0.5 kg for funchoza');

  runAgent(`
    updateQty('funchoza', 1);
    calcTotal();
  `);
  const cQty2 = runAgent("cart['funchoza']");
  assert(cQty2 === 1.0, 'updateQty increased to 1.0 kg');
  assert(agentEnv.dom['orderTotalSum'].innerText.includes('22'), 'calcTotal calculated with custom price');

  // Test submitOrder in agent
  runAgent(`
    document.getElementById('orderPayment').value = 'Qarz';
    document.getElementById('orderAddress').value = 'Tashkent, Chilonzor';
    document.getElementById('orderNote').value = 'Iltimos tezroq';
    submitOrder();
  `);
  assert(true, 'Agent submitOrder executed successfully');
} catch (e) {
  assert(false, 'Agent app test failed', e.stack);
}

// =========================================================================
// 3. TEST COURIER APP
// =========================================================================
console.log('\n--- 3. Testing Courier App (`courier/courier.js`) ---');
const courierEnv = makeMockBrowser();
const courierContext = vm.createContext(courierEnv);
const runCourier = code => vm.runInContext(code, courierContext);

try {
  const courierCode = fs.readFileSync('courier/courier.js', 'utf8');
  runCourier(courierCode);
  assert(true, 'courier/courier.js loaded without syntax errors');

  runCourier(`
    loggedCourierName = 'Akbar';
    allClientsMap = {
      '101': { id: '101', name: 'Alfraganus Cafe', lat: 41.2995, lng: 69.2401, phone: '+998901234567' },
      '102': { id: '102', name: 'Burger Boss', lat: 41.3110, lng: 69.2790, phone: '+998939876543' }
    };
    myOrders = [
      {
        id: 'ord_c1',
        clientId: '101',
        client: 'Alfraganus Cafe',
        total: 66000,
        payment: 'Naqd',
        items: [{ id: 'funchoza', name: 'Фунчоза', nameUz: 'Funchoza', qty: 2, unit: 'kg' }],
        delivered: false,
        date: new Date().toISOString()
      },
      {
        id: 'ord_c2',
        clientId: '102',
        client: 'Burger Boss',
        total: 40000,
        payment: 'Qarz',
        items: [{ id: 'sologurc', name: 'Сол огурцы', nameUz: 'Tuzlangan bodring', qty: 1, unit: 'kg' }],
        delivered: false,
        date: new Date().toISOString()
      }
    ];

    renderOrders();
  `);
  assert(courierEnv.dom['ordersList'].innerHTML.includes('Alfraganus Cafe'), 'Courier renderOrders displays assigned orders');

  // Test optimizeCourierRoute
  runCourier('optimizeCourierRoute()');
  const routeCount = runCourier('routeSummary ? routeSummary.count : 0');
  const yandexUrl = runCourier('routeSummary ? routeSummary.yandexUrl : ""');
  assert(routeCount === 2, 'Route contains 2 destinations');
  assert(yandexUrl.includes('yandex.ru/maps'), 'Generated multi-point Yandex Maps URL');

  // Test markDelivered
  runCourier('markDelivered("ord_c1")');
  assert(true, 'Courier markDelivered executed without crash');
} catch (e) {
  assert(false, 'Courier app test failed', e.stack);
}

// =========================================================================
// 4. TEST CLIENT APP
// =========================================================================
console.log('\n--- 4. Testing Client App (`client.js`) ---');
const clientEnv = makeMockBrowser();
const clientContext = vm.createContext(clientEnv);
const runClient = code => vm.runInContext(code, clientContext);

try {
  const clientCode = fs.readFileSync('client.js', 'utf8');
  runClient(clientCode);
  assert(true, 'client.js loaded without syntax errors');

  runClient(`
    currentClient = {
      id: 'cl_101',
      name: 'Sherdorbek Cafe',
      phone: '+998901234567',
      address: 'Chilonzor 5',
      customPrices: { 'funchoza': 23000 }
    };
    products = [
      { id: 'funchoza', name: 'Фунчоза', nameUz: 'Funchoza', price: 25000, emoji: '🍜', unit: 'кг', step: 0.5 },
      { id: 'sologurc', name: 'Сол огурцы', nameUz: 'Tuzlangan bodring', price: 20000, emoji: '🥒', unit: 'кг', step: 0.5 }
    ];
  `);

  // Test custom price detection
  const clientPrice = runClient('getPrice(products[0])');
  assert(clientPrice === 23000, `Client getPrice respected custom price 23000 (got ${clientPrice})`);

  // Test cart operations
  runClient(`
    cart = {};
    changeQty('funchoza', 1.0);
    changeQty('sologurc', 0.5);
  `);
  const cTot = runClient('cart["funchoza"]');
  assert(cTot === 1.0, 'Client cart funchoza quantity is 1.0');

  // Test buildTgMsg
  const sampleOrder = {
    id: 1799999999999,
    date: new Date().toISOString(),
    client: 'Sherdorbek Cafe',
    phone: '+998901234567',
    address: 'Chilonzor 5',
    items: [{ id: 'funchoza', name: 'Фунчоза', nameUz: 'Funchoza', qty: 1, unit: 'кг' }],
    total: 23000,
    payment: 'Qarz',
    type: 'Dostavka'
  };
  clientEnv.orderToTest = sampleOrder;
  const tgMsg = runClient('buildTgMsg(orderToTest)');
  assert(tgMsg.includes('Sherdorbek Cafe') && tgMsg.includes('Qarz'), 'buildTgMsg generated proper Telegram text');

  // Test submitOrder
  runClient(`
    document.getElementById('orderName').value = 'Sherdorbek Cafe';
    document.getElementById('orderPhone').value = '+998901234567';
    document.getElementById('orderAddress').value = 'Chilonzor 5';
    document.getElementById('orderNote').value = 'Iltimos, tezroq yetkazing';
    submitOrder();
  `);
  assert(true, 'Client submitOrder completed successfully');
} catch (e) {
  assert(false, 'client.js evaluation failed', e.stack);
}

console.log('\n====================================================');
console.log(`📊 FINAL RESULT: ${testsPassed} PASSED, ${testsFailed} FAILED`);
console.log('====================================================');

if (testsFailed > 0) {
  process.exit(1);
}
