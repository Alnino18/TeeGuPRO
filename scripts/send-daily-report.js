#!/usr/bin/env node
/**
 * TeeGuPRO - Kunlik hisobotni Telegram botga avtomatik yuborish skripti.
 * 
 * Ishga tushirish:
 *   node scripts/send-daily-report.js
 *   node scripts/send-daily-report.js --dry-run   (Telegramga yubormasdan konsolda tekshirish)
 * 
 * Avtomatlashtirish:
 *   GitHub Actions, Windows Task Scheduler yoki server cron orqali
 *   har kuni kechki soat 22:00 da (UTC+5 Toshkent vaqti) avtomatik ishga tushadi.
 */

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'dostavka-b53d8';
const BASE_FIRESTORE_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

const DEFAULT_TG_TOKEN = '8796588071:AAG8Z_R8hP9ESZZ_3LxUakD8PCXj5C5ZP6Y';
const DEFAULT_TG_CHAT_ID = '483325961';

function parseFirestoreValue(val) {
  if (!val) return null;
  if ('stringValue' in val) return val.stringValue;
  if ('integerValue' in val) return parseInt(val.integerValue, 10);
  if ('doubleValue' in val) return parseFloat(val.doubleValue);
  if ('booleanValue' in val) return val.booleanValue;
  if ('timestampValue' in val) return val.timestampValue;
  if ('nullValue' in val) return null;
  if ('arrayValue' in val) return (val.arrayValue.values || []).map(parseFirestoreValue);
  if ('mapValue' in val) {
    const res = {};
    for (const [k, v] of Object.entries(val.mapValue.fields || {})) {
      res[k] = parseFirestoreValue(v);
    }
    return res;
  }
  return null;
}

function parseFirestoreDoc(doc) {
  const obj = {};
  for (const [k, v] of Object.entries(doc.fields || {})) {
    obj[k] = parseFirestoreValue(v);
  }
  return obj;
}

function fmt(n) {
  return Math.round(n || 0).toLocaleString('ru-RU');
}

function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function getTashkentReportDate(d = new Date()) {
  const dateObj = new Date(d);
  const tashkentHourStr = dateObj.toLocaleTimeString('en-US', { timeZone: 'Asia/Tashkent', hour12: false, hour: '2-digit' });
  const tashkentHour = parseInt(tashkentHourStr, 10);
  const tDate = new Date(dateObj.toLocaleString('en-US', { timeZone: 'Asia/Tashkent' }));
  if (tashkentHour < 6) {
    tDate.setDate(tDate.getDate() - 1);
  }
  const y = tDate.getFullYear();
  const m = String(tDate.getMonth() + 1).padStart(2, '0');
  const day = String(tDate.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function getTashkentReportDisplayDate(d = new Date()) {
  const dateStr = getTashkentReportDate(d);
  const parts = dateStr.split('-');
  return parts[2] + '.' + parts[1] + '.' + parts[0];
}

function getTashkentDateString(d = new Date()) {
  if (!d) return '';
  const dateObj = new Date(d);
  if (isNaN(dateObj.getTime())) return String(d).slice(0, 10);
  return dateObj.toLocaleDateString('en-CA', { timeZone: 'Asia/Tashkent' });
}

function isConsignmentPayment(p) {
  if (!p) return false;
  const s = String(p).toLowerCase().trim();
  return s === 'консигнация' || s === 'qarz' || s === 'nasiya' || s === 'долг';
}

function getItemProfit(item, prodFallback) {
  const id = (item.id || '').toLowerCase();
  const name = (item.name || '').toLowerCase();
  const price = Math.round(item.price || 0);
  const qty = parseFloat(item.qty || 0) || 0;
  if (qty <= 0) return 0;
  if (id === 'funchoza' || id === 'morkovcha' || name.includes('фунчоз') || name.includes('морков') || name.includes('sabzi')) {
    if (price <= 20000) return 3000 * qty;
    if (price <= 22000) return 4000 * qty;
    return 5000 * qty;
  }
  if (id === 'sologurc' || name.includes('сол') || name.includes('огурц') || name.includes('tuzlangan')) {
    if (price <= 15000) return 3000 * qty;
    return 5000 * qty;
  }
  const cost = item.cost > 0 ? item.cost : (prodFallback?.cost > 0 ? prodFallback.cost : 0);
  if (cost > 0 && price > cost) return (price - cost) * qty;
  return 0;
}

function getDebtRepaymentsOnDate(orders = [], targetDateStr) {
  let collected = 0;
  (orders || []).forEach(o => {
    if (!o || o.status === 'cancelled') return;
    if (!isConsignmentPayment(o.payment)) return;

    let hasHistoryOnDate = false;
    if (Array.isArray(o.paymentHistory) && o.paymentHistory.length > 0) {
      o.paymentHistory.forEach(entry => {
        if (entry && entry.date && getTashkentDateString(entry.date) === targetDateStr) {
          collected += (Number(entry.amount) || 0);
          hasHistoryOnDate = true;
        }
      });
    }

    if (!hasHistoryOnDate && o.debtPaid && o.debtPaidAt && getTashkentDateString(o.debtPaidAt) === targetDateStr) {
      const alreadyPaid = Array.isArray(o.paymentHistory)
        ? o.paymentHistory.reduce((s, h) => s + (Number(h.amount) || 0), 0)
        : (Number(o.partialPaid) || 0);
      const remaining = Math.max(0, (Number(o.total) || 0) - alreadyPaid);
      collected += (remaining > 0 ? remaining : (Number(o.total) || 0));
    }
  });
  return collected;
}

function calculateDailyReportMetrics(orders = [], products = [], todayStr = getTashkentReportDate()) {
  const todayOrders = (orders || []).filter(o => o && o.status !== 'cancelled' && getTashkentDateString(o.date) === todayStr);

  // Cash / Click immediate revenue today (excluding consignment)
  const todayCashOrders = todayOrders.filter(o => !isConsignmentPayment(o.payment));
  const todayCashRev = todayCashOrders.reduce((sum, o) => sum + (Number(o.total) || 0), 0);

  // Consignment orders given today (alohida hisob)
  const consignmentOrdersToday = todayOrders.filter(o => isConsignmentPayment(o.payment));
  const consignmentGivenToday = consignmentOrdersToday.reduce((sum, o) => sum + (Number(o.total) || 0), 0);

  // Debt repayments collected on todayStr from consignment orders
  const debtsCollectedToday = getDebtRepaymentsOnDate(orders, todayStr);

  // Total realized cash revenue collected today
  const totalRealizedRev = todayCashRev + debtsCollectedToday;

  // Profit calculation
  let todayProfit = 0;
  todayOrders.forEach(o => {
    (o.items || []).forEach(i => {
      const p = (products || []).find(x => x.id === i.id);
      todayProfit += getItemProfit(i, p);
    });
  });
  const todayMarginPct = totalRealizedRev > 0 ? Math.round((todayProfit / totalRealizedRev) * 100) : 0;

  // Overall outstanding debt
  const debts = (orders || []).filter(o => {
    if (!o || o.status === 'cancelled') return false;
    return isConsignmentPayment(o.payment) && !o.debtPaid;
  });
  const totalDebt = debts.reduce((sum, o) => sum + (Number(o.total) || 0) - (Number(o.partialPaid) || 0), 0);

  return {
    todayOrders,
    todayCashRev,
    consignmentGivenToday,
    debtsCollectedToday,
    totalRealizedRev,
    todayProfit,
    todayMarginPct,
    debts,
    totalDebt
  };
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP error ${res.status} from ${url}`);
  }
  return await res.json();
}

async function main() {
  const isDryRun = process.argv.includes('--dry-run');
  console.log(`[${new Date().toISOString()}] Kunlik hisobot yuborish boshlandi (DryRun: ${isDryRun})...`);

  // 1. Sozlamalarni olish
  let tgToken = process.env.TG_BOT_TOKEN || DEFAULT_TG_TOKEN;
  let tgChatId = process.env.TG_CHAT_ID || DEFAULT_TG_CHAT_ID;
  let settings = {};

  try {
    const settingsDoc = await fetchJson(`${BASE_FIRESTORE_URL}/settings/main`);
    settings = parseFirestoreDoc(settingsDoc);
    if (settings.tgToken && !process.env.TG_BOT_TOKEN) tgToken = settings.tgToken;
    if (settings.tgChatId && !process.env.TG_CHAT_ID) tgChatId = String(settings.tgChatId);
  } catch (err) {
    console.warn('Sozlamalar standart qiymatlar bilan ishlatiladi:', err.message);
  }

  // 2. Mahsulotlarni olish
  let products = [];
  try {
    const pData = await fetchJson(`${BASE_FIRESTORE_URL}/products`);
    products = (pData.documents || []).map(parseFirestoreDoc);
  } catch (err) {
    console.warn('Mahsulotlarni olishda xatolik:', err.message);
  }

  // 3. Buyurtmalarni olish (paginatsiya bilan)
  const orders = [];
  let pageToken = '';
  do {
    const url = `${BASE_FIRESTORE_URL}/orders?pageSize=300${pageToken ? '&pageToken=' + pageToken : ''}`;
    const oData = await fetchJson(url);
    const docs = oData.documents || [];
    orders.push(...docs.map(parseFirestoreDoc));
    pageToken = oData.nextPageToken;
  } while (pageToken);

  console.log(`Jami buyurtmalar: ${orders.length}, mahsulotlar: ${products.length}`);

  // 4. Bugungi hisobotni hisoblash (Toshkent vaqti bo'yicha)
  const todayStr = getTashkentReportDate();
  const isForce = process.argv.includes('--force');
  if (!isDryRun && !isForce && settings.lastAutoSummaryDate === todayStr) {
    console.log("ℹ️ [" + todayStr + "] sanasi uchun kunlik hisobot allaqachon yuborilgan. Takroriy yuborish bekor qilindi.");
    return;
  }
  const metrics = calculateDailyReportMetrics(orders, products, todayStr);
  const {
    todayOrders,
    todayCashRev,
    consignmentGivenToday,
    debtsCollectedToday,
    totalRealizedRev,
    todayProfit,
    todayMarginPct,
    debts,
    totalDebt
  } = metrics;

  const prodTotals = {};
  products.forEach(p => { prodTotals[p.id] = 0; });
  todayOrders.forEach(o => {
    (o.items || []).forEach(i => {
      if (prodTotals[i.id] !== undefined) {
        prodTotals[i.id] += (i.qty || 0);
      }
    });
  });

  const prodLines = products.map(p => {
    if (prodTotals[p.id] > 0) {
      return `  ${p.emoji || ''} ${escapeHTML(p.name)}: <b>${prodTotals[p.id]}${escapeHTML(p.unit || 'кг')}</b>`;
    }
    return '';
  }).filter(Boolean);

  const deliveredOrders = todayOrders.filter(o => o.status === 'done' || o.delivered);
  const deliveredClients = deliveredOrders.length > 0
    ? deliveredOrders.map(o => `  👤 ${escapeHTML(o.client)}`).join('\n')
    : '  Нет доставленных';

  const displayDate = getTashkentReportDisplayDate();
  const lines = [
    `📊 <b>СВОДКА ЗА ДЕНЬ — ${displayDate}</b>`,
    ``,
    `📦 <b>Заказов:</b> ${todayOrders.length}`,
    `💵 <b>Naqd / Klik tushum:</b> ${fmt(todayCashRev)} so'm`,
    `🤝 <b>Undirilgan qarzlar (to'langan konsignatsiya):</b> ${fmt(debtsCollectedToday)} so'm`,
    `💰 <b>JAMI KELIB TUSHGAN TUSHUM:</b> ${fmt(totalRealizedRev)} so'm`,
    `⏳ <b>Bugun konsignatsiyaga berildi (nasiya):</b> ${fmt(consignmentGivenToday)} so'm (alohida hisob)`,
    `📈 <b>Чистая прибыль (Фойда):</b> ${fmt(todayProfit)} so'm (${todayMarginPct}%)`,
    ``,
    `📦 <b>Продано:</b>`,
    ...prodLines,
    ``,
    `💸 <b>Общий долг (консигнация):</b> ${fmt(totalDebt)} so'm`,
    `👥 <b>Должников:</b> ${new Set(debts.map(o => o.clientId)).size}`,
    ``,
    `✅ <b>Доставленные клиенты:</b>`,
    deliveredClients
  ];

  const trackedStockProducts = products.filter(p => p && p.stock !== undefined && p.stock !== null && p.stock !== '' && !isNaN(Number(p.stock)));
  if (trackedStockProducts.length) {
    lines.push('', `🏭 <b>Склад (Остаток):</b>`);
    trackedStockProducts.forEach(p => {
      const rem = Math.round(Number(p.stock) * 100) / 100;
      const minSt = (p.minStock !== undefined && p.minStock !== null && p.minStock !== '' && !isNaN(Number(p.minStock))) ? Number(p.minStock) : 5;
      const icon = rem <= 0 ? '🔴' : (rem <= minSt ? '⚠️' : '✅');
      lines.push(`  ${icon} ${p.emoji || ''} ${escapeHTML(p.name)}: <b>${rem}${escapeHTML(p.unit || 'кг')}</b>`);
    });
  }

  // 4.1 AI xulosa olish (Google Gemini AI)
  const geminiKey = process.env.GEMINI_API_KEY || Buffer.from('QVEuQWI4Uk42SjNYaGJzdHRxYnVzd0lRMXdZNE9idm9UTlpicU1ONDdRcTE5QTZITXh2bFE=', 'base64').toString('utf8');
  if (geminiKey) {
    try {
      console.log('AI xulosasi olinmoqda...');
      const soldSummary = prodLines.map(l => l.replace(/<[^>]*>/g, '').trim()).join(', ');
      const aiPrompt = `Siz TeeGu.PRO salat biznesi AI maslahatchisisiz. Bugungi natijalar: Jami buyurtmalar: ${todayOrders.length} ta, Kelib tushgan tushum: ${fmt(totalRealizedRev)} so'm (Naqd/Klik: ${fmt(todayCashRev)} so'm, Undirilgan qarzlar: ${fmt(debtsCollectedToday)} so'm), Bugun konsignatsiyaga berildi: ${fmt(consignmentGivenToday)} so'm, Sotilgan: ${soldSummary || 'mahsulot sotilmadi'}, Umumiy qarzlar: ${fmt(totalDebt)} so'm. Shu ma'lumotlar asosida biznes egasi uchun 2-3 jumlada qisqa, professional xulosa va ertangi kun uchun amaliy maslahat yozing (o'zbek tilida).`;
      
      const aiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${geminiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: aiPrompt }] }] })
      });
      const aiData = await aiRes.json();
      const aiText = aiData?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (aiText) {
        lines.push('', '✨ <b>AI Tahlil va Maslahat:</b>', escapeHTML(aiText));
      }
    } catch (aiErr) {
      console.warn('AI xulosa olishda xatolik (asosiy hisobot jo\'natiladi):', aiErr.message);
    }
  }

  const messageText = lines.join('\n');

  if (isDryRun) {
    console.log('\n--- XABAR MATNI (DRY RUN) ---');
    console.log(messageText);
    console.log('-----------------------------\n');
    return;
  }

  // 5. Telegramga yuborish
  console.log(`Telegram botga yuborilmoqda (Chat ID: ${tgChatId})...`);
  const tgUrl = `https://api.telegram.org/bot${tgToken}/sendMessage`;
  const tgRes = await fetch(tgUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: tgChatId,
      text: messageText,
      parse_mode: 'HTML'
    })
  });

  const tgResult = await tgRes.json();
  if (tgResult.ok) {
    console.log('✅ Kunlik hisobot Telegramga muvaffaqiyatli yuborildi!');
    try {
      await fetch(BASE_FIRESTORE_URL + "/settings/main?updateMask.fieldPaths=lastAutoSummaryDate", {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: {
            lastAutoSummaryDate: { stringValue: todayStr }
          }
        })
      });
      console.log("📌 Firestore sozlamalariga yozildi: lastAutoSummaryDate = " + todayStr);
    } catch(saveErr) {
      console.warn('lastAutoSummaryDate ni saqlashda xatolik:', saveErr.message);
    }
  } else {
    console.error('❌ Telegram xatosi:', tgResult);
    process.exit(1);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    isConsignmentPayment,
    getItemProfit,
    getDebtRepaymentsOnDate,
    calculateDailyReportMetrics,
    getTashkentReportDate,
    getTashkentReportDisplayDate,
    getTashkentDateString,
    parseFirestoreDoc,
    parseFirestoreValue,
    main
  };
}

if (require.main === module) {
  main().catch(err => {
    console.error('❌ Xatolik yuz berdi:', err);
    process.exit(1);
  });
}

