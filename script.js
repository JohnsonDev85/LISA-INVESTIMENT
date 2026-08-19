/* =========================================================
   NGOLE FAMILY - Mfumo wa Usimamizi
   Weka Firebase config yako hapa chini kabla ya kutumia
   ========================================================= */
const firebaseConfig = {
  apiKey: "AIzaSyCRbL-gm69xl-NbhbT_4eRRUMYschvwTLM",
  authDomain: "lisa-mgt.firebaseapp.com",
  projectId: "lisa-mgt",
  storageBucket: "lisa-mgt.firebasestorage.app",
  messagingSenderId: "319402238209",
  appId: "1:319402238209:web:3060a77ca3a31825ea3b00"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

const RATES = {
  single_room: 25000,
  chumbaself_sebule: 60000,
  chumbaself_sebule_jiko: 100000,
  frame_biashara: 50000,
  complete_house: 150000
};
const HOUSE_LABELS = {
  single_room: "Single Room",
  chumbaself_sebule: "Chumba self na Sebule",
  chumbaself_sebule_jiko: "Chumbaself sebule & jiko",
  frame_biashara: "Frame ya Biashara",
  complete_house: "Complete House"
};
const EXPENSE_SOURCE_LABELS = {
  electronics: "Electronics",
  realestate: "Real Estate",
  frame: "Frame za Biashara",
  completehouse: "Complete House",
  jumla: "Jumla (Vyote)"
};

let currentUser = null;
let currentRole = null;
let currentUserName = "";
let productsCache = [];
let currentPeriod = "quarterly";

/* ---------------- HELPERS ---------------- */
function fmtMoney(n) {
  return "Tsh " + Number(n || 0).toLocaleString("en-US");
}
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function showToast(msg, type = "") {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = "toast " + type;
  setTimeout(() => t.classList.add("hidden"), 3000);
}
function daysAgoStr(months) {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}
// Kokotoa tarehe ambayo kodi mpya inatakiwa kuanza:
// tarehe ya malipo + idadi ya miezi aliyolipia + siku 1
// mfano: 2025-01-03 + miezi 3 = 2025-04-03, + siku 1 = 2025-04-04
function computeExpectedDueDate(paymentDateStr, months) {
  const d = new Date(paymentDateStr + "T00:00:00");
  d.setMonth(d.getMonth() + months);
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

/* ---------------- AUTH (Anonymous + Username/Password lookup, kama Ustawi) ---------------- */
let currentUsername = null;
const SESSION_KEY = "ngole_session";

document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = document.getElementById("loginUsername").value.trim();
  const pass = document.getElementById("loginPassword").value.trim();
  const errEl = document.getElementById("loginError");
  errEl.textContent = "";
  try {
    if (!auth.currentUser) {
      await auth.signInAnonymously();
    }
    const snap = await db.collection("ngole_users")
      .where("username", "==", username).limit(1).get();
    if (snap.empty) {
      errEl.textContent = "Jina la mtumiaji halipo.";
      return;
    }
    const userDoc = snap.docs[0];
    const data = userDoc.data();
    if (data.password !== pass) {
      errEl.textContent = "Password si sahihi.";
      return;
    }
    const session = { username: data.username, name: data.name, role: data.role };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    applySession(session);
  } catch (err) {
    errEl.textContent = "Hitilafu: " + err.message;
  }
});

document.getElementById("logoutBtn").addEventListener("click", () => {
  localStorage.removeItem(SESSION_KEY);
  currentUsername = null;
  currentRole = null;
  auth.signOut();
  document.getElementById("appShell").classList.add("hidden");
  document.getElementById("loginScreen").classList.remove("hidden");
});

function applySession(session) {
  currentUsername = session.username;
  currentRole = session.role;
  currentUserName = session.name || session.username || "Mtumiaji";

  document.getElementById("loginScreen").classList.add("hidden");
  document.getElementById("appShell").classList.remove("hidden");
  document.getElementById("userNameDisplay").textContent = currentUserName;

  const badge = document.getElementById("roleBadge");
  document.body.classList.remove("role-manager", "role-salesperson");

  if (currentRole === "manager") {
    badge.textContent = "Manager";
    badge.classList.remove("sales");
    document.body.classList.add("role-manager");
    document.getElementById("managerDashboard").classList.remove("hidden");
    document.getElementById("salespersonDashboard").classList.add("hidden");
    initManagerDashboard();
  } else {
    badge.textContent = "Sales Person";
    badge.classList.add("sales");
    document.body.classList.add("role-salesperson");
    document.getElementById("salespersonDashboard").classList.remove("hidden");
    document.getElementById("managerDashboard").classList.add("hidden");
    initSalespersonDashboard();
  }
}

// Ikiwa mtu ameshalogin awali (localStorage), mrudishe moja kwa moja bila kujaza fomu tena
auth.onAuthStateChanged(async (user) => {
  if (!user) {
    // hakuna anonymous session bado - subiri mpaka mtu abonyeze Ingia
    return;
  }
  currentUser = user;
  const saved = localStorage.getItem(SESSION_KEY);
  if (saved) {
    try {
      applySession(JSON.parse(saved));
    } catch (e) {
      localStorage.removeItem(SESSION_KEY);
    }
  }
});

// Anzisha anonymous session mara moja app inapofunguka, ili session ya awali (kama ipo) irudi haraka
if (!auth.currentUser) {
  auth.signInAnonymously().catch(() => {});
}

/* ---------------- TABS ---------------- */
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.tab).classList.add("active");
    if (btn.dataset.tab === "summaryTab") loadSummary();
  });
});

/* =========================================================
   MANAGER DASHBOARD
   ========================================================= */
let managerInitialized = false;
function initManagerDashboard() {
  if (managerInitialized) return;
  managerInitialized = true;
  listenProducts();
  listenSales();
  listenRealEstate();
  listenExpenses();
  listenRemittances();
  loadSummary();
}

/* ---- PRODUCTS (Electronics) ---- */
function listenProducts() {
  // .limit() kuepuka kupakua data isiyo na mwisho - inasaidia speed
  db.collection("ngole_products").orderBy("createdAt", "desc").limit(200)
    .onSnapshot((snap) => {
      productsCache = [];
      const tbody = document.querySelector("#productsTable tbody");
      const stockSelect = document.getElementById("stockProductSelect");
      tbody.innerHTML = "";
      stockSelect.innerHTML = "";
      snap.forEach((doc) => {
        const p = { id: doc.id, ...doc.data() };
        productsCache.push(p);
        tbody.innerHTML += `<tr id="prod-row-${p.id}">
          <td>${p.name}</td>
          <td>${fmtMoney(p.buyingPrice)}</td><td>${fmtMoney(p.sellingPrice)}</td>
          <td>${p.stockQty}</td>
          <td><button class="link-btn" onclick="deleteProduct('${p.id}')">Delete</button></td>
        </tr>`;
        stockSelect.innerHTML += `<option value="${p.id}">${p.name} (Stock: ${p.stockQty})</option>`;
      });
    }, (err) => {
      showToast("Hitilafu ya kuappload bidhaa: " + err.message, "error");
    });
}

document.getElementById("productForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("prodName").value.trim();
  const buyingPrice = Number(document.getElementById("prodBuyPrice").value);
  const sellingPrice = Number(document.getElementById("prodSellPrice").value);
  const stockQty = Number(document.getElementById("prodStock").value);
  try {
    await db.collection("ngole_products").add({
      name, buyingPrice, sellingPrice, stockQty,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    e.target.reset();
    showToast("Product registered.", "success");
  } catch (err) {
    showToast("Hitilafu: " + err.message, "error");
  }
});

async function deleteProduct(id) {
  if (!confirm("Una uhakika unataka kufuta bidhaa hii?")) return;
  // Optimistic UI - toa mara moja kwenye screen kabla Firestore haijajibu, kwa speed
  const row = document.getElementById("prod-row-" + id);
  if (row) row.remove();
  productsCache = productsCache.filter((p) => p.id !== id);
  showToast("Bidhaa imefutwa.", "success");
  try {
    await db.collection("ngole_products").doc(id).delete();
  } catch (err) {
    showToast("Hitilafu: " + err.message, "error");
  }
}

/* ---- STOCK IN/OUT ---- */
document.getElementById("stockForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const productId = document.getElementById("stockProductSelect").value;
  const type = document.getElementById("stockType").value;
  const qty = Number(document.getElementById("stockQty").value);
  const reason = document.getElementById("stockReason").value.trim();
  const product = productsCache.find((p) => p.id === productId);
  if (!product) return showToast("Chagua bidhaa.", "error");

  const newStock = type === "in" ? product.stockQty + qty : product.stockQty - qty;
  if (newStock < 0) return showToast("Stock haiwezi kuwa negative.", "error");

  try {
    const batch = db.batch();
    batch.update(db.collection("ngole_products").doc(productId), { stockQty: newStock });
    batch.set(db.collection("ngole_stockLogs").doc(), {
      productId, productName: product.name, type, qty, reason,
      doneBy: currentUsername, date: todayStr(),
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    await batch.commit();
    e.target.reset();
    showToast("Stock edited.", "success");
  } catch (err) {
    showToast("Hitilafu: " + err.message, "error");
  }
});

/* ---- SALES LISTENER (Manager view - ripoti + muhtasari wa siku) ---- */
function listenSales() {
  db.collection("ngole_sales").orderBy("createdAt", "desc").limit(100)
    .onSnapshot((snap) => {
      const tbody = document.querySelector("#salesTable tbody");
      tbody.innerHTML = "";
      const byDate = {};
      snap.forEach((doc) => {
        const s = doc.data();
        tbody.innerHTML += `<tr>
          <td>${s.productName}</td><td>${s.qty}</td>
          <td>${fmtMoney(s.sellingPrice)}</td><td>${fmtMoney(s.total)}</td>
          <td>${fmtMoney(s.profit)}</td><td>${s.date}</td>
        </tr>`;
        if (!byDate[s.date]) byDate[s.date] = { count: 0, total: 0, profit: 0 };
        byDate[s.date].count += 1;
        byDate[s.date].total += Number(s.total || 0);
        byDate[s.date].profit += Number(s.profit || 0);
      });

      const summaryTbody = document.querySelector("#dailySalesSummaryTable tbody");
      summaryTbody.innerHTML = "";
      Object.keys(byDate).sort((a, b) => b.localeCompare(a)).forEach((date) => {
        const d = byDate[date];
        summaryTbody.innerHTML += `<tr>
          <td>${date}</td><td>${d.count}</td><td>${fmtMoney(d.total)}</td><td>${fmtMoney(d.profit)}</td>
        </tr>`;
      });
    }, (err) => {
      showToast("Hitilafu ya kuappload mauzo: " + err.message, "error");
    });
}

/* ---- REAL ESTATE ---- */
function computeTotalDisplay() {
  const sel = document.getElementById("houseType");
  const rate = Number(sel.selectedOptions[0].dataset.rate);
  const months = Number(document.getElementById("numMonths").value);
  document.getElementById("totalPaidDisplay").value = fmtMoney(rate * months);
}
document.getElementById("houseType").addEventListener("change", computeTotalDisplay);
document.getElementById("numMonths").addEventListener("change", computeTotalDisplay);
document.getElementById("paymentDate").value = todayStr();
computeTotalDisplay();

let realEstateCache = [];
function listenRealEstate() {
  db.collection("ngole_realEstatePayments").orderBy("createdAt", "desc").limit(200)
    .onSnapshot((snap) => {
      realEstateCache = [];
      const tbody = document.querySelector("#realEstateTable tbody");
      tbody.innerHTML = "";
      snap.forEach((doc) => {
        const r = { id: doc.id, ...doc.data() };
        realEstateCache.push(r);
        const fullLocation = (r.location || "") + (r.specificLocation ? (" - " + r.specificLocation) : "");
        tbody.innerHTML += `<tr id="re-row-${r.id}">
          <td>${r.tenantName}</td><td>${fullLocation}</td><td>${HOUSE_LABELS[r.houseType]}</td>
          <td>${fmtMoney(r.monthlyRate)}</td><td>${r.months}</td>
          <td>${fmtMoney(r.totalPaid)}</td><td>${r.paymentDate}</td>
          <td>${r.expectedDueDate || ""}</td>
          <td><button class="link-btn" onclick="deleteRealEstate('${r.id}')">Delete</button></td>
        </tr>`;
      });
    }, (err) => {
      showToast("Hitilafu ya kuappload real estate: " + err.message, "error");
    });
}

document.getElementById("realEstateForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const tenantName = document.getElementById("tenantName").value.trim();
  const location = document.getElementById("tenantLocation").value;
  const specificLocation = document.getElementById("specificLocation").value.trim();
  const houseType = document.getElementById("houseType").value;
  const monthlyRate = RATES[houseType];
  const months = Number(document.getElementById("numMonths").value);
  const paymentDate = document.getElementById("paymentDate").value;
  const totalPaid = monthlyRate * months;
  const expectedDueDate = computeExpectedDueDate(paymentDate, months);

  try {
    await db.collection("ngole_realEstatePayments").add({
      tenantName, location, specificLocation,
      houseType, monthlyRate, months, totalPaid, paymentDate, expectedDueDate,
      recordedBy: currentUsername,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    e.target.reset();
    document.getElementById("paymentDate").value = todayStr();
    computeTotalDisplay();
    showToast("Sales Registered.", "success");
  } catch (err) {
    showToast("Hitilafu: " + err.message, "error");
  }
});

async function deleteRealEstate(id) {
  if (!confirm("Una uhakika unataka kufuta rekodi hii?")) return;
  const row = document.getElementById("re-row-" + id);
  if (row) row.remove();
  realEstateCache = realEstateCache.filter((r) => r.id !== id);
  showToast("Rekodi imefutwa.", "success");
  try {
    await db.collection("ngole_realEstatePayments").doc(id).delete();
  } catch (err) {
    showToast("Delete Error: " + err.message, "error");
  }
}

/* =========================================================
   SUMMARY (Quarterly / Semi-Annual / Annually)
   Tunatumia one-time get() badala ya real-time listener -
   hii inapunguza reads na inafanya summary kuwa ya haraka.
   ========================================================= */
document.querySelectorAll(".period-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".period-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentPeriod = btn.dataset.period;
    loadSummary();
  });
});

const PERIOD_MONTHS = { quarterly: 3, semiannual: 6, annual: 12 };
const PERIOD_LABELS_SW = { quarterly: "Miezi 3 iliyopita", semiannual: "Miezi 6 iliyopita", annual: "Miezi 12 iliyopita" };

let lastSummaryData = null;

async function loadSummary() {
  const months = PERIOD_MONTHS[currentPeriod];
  const startDate = daysAgoStr(months);
  document.getElementById("periodLabel").textContent = PERIOD_LABELS_SW[currentPeriod] + " (kuanzia " + startDate + ")";

  const [salesSnap, reSnap, expSnap, remSnap] = await Promise.all([
    db.collection("ngole_sales").where("date", ">=", startDate).get(),
    db.collection("ngole_realEstatePayments").where("paymentDate", ">=", startDate).get(),
    db.collection("ngole_expenses").where("date", ">=", startDate).get(),
    db.collection("ngole_remittances").where("date", ">=", startDate).get()
  ]);

  let electronicsProfit = 0;
  salesSnap.forEach((doc) => { electronicsProfit += Number(doc.data().profit || 0); });

  let rentalIncome = 0;
  let frameIncome = 0;
  let completeHouseIncome = 0;
  reSnap.forEach((doc) => {
    const r = doc.data();
    if (r.houseType === "frame_biashara") frameIncome += Number(r.totalPaid || 0);
    else if (r.houseType === "complete_house") completeHouseIncome += Number(r.totalPaid || 0);
    else rentalIncome += Number(r.totalPaid || 0);
  });

  // Expenses zinakatwa kutoka kwenye source husika. Source "jumla" inakatwa
  // moja kwa moja kwenye JUMLA KUU tu, si kwenye kila category (kuepuka kukata mara nyingi).
  let expElectronics = 0, expRealestate = 0, expFrame = 0, expCompleteHouse = 0, expJumla = 0;
  expSnap.forEach((doc) => {
    const ex = doc.data();
    const amt = Number(ex.amount || 0);
    if (ex.source === "electronics") expElectronics += amt;
    else if (ex.source === "realestate") expRealestate += amt;
    else if (ex.source === "frame") expFrame += amt;
    else if (ex.source === "completehouse") expCompleteHouse += amt;
    else if (ex.source === "jumla") expJumla += amt;
  });

  electronicsProfit -= expElectronics;
  rentalIncome -= expRealestate;
  frameIncome -= expFrame;
  completeHouseIncome -= expCompleteHouse;

  // Makabidhi (remittances) - INAHESABIWA tu kama status="approved"
  let remittanceIncome = 0;
  remSnap.forEach((doc) => {
    const r = doc.data();
    if (r.status === "approved") remittanceIncome += Number(r.amount || 0);
  });

  const totalExpenses = expElectronics + expRealestate + expFrame + expCompleteHouse + expJumla;
  const grandTotal = electronicsProfit + rentalIncome + frameIncome + completeHouseIncome + remittanceIncome - expJumla;

  document.getElementById("statElectronicsProfit").textContent = fmtMoney(electronicsProfit);
  document.getElementById("statRentalIncome").textContent = fmtMoney(rentalIncome);
  document.getElementById("statFrameIncome").textContent = fmtMoney(frameIncome);
  document.getElementById("statCompleteHouseIncome").textContent = fmtMoney(completeHouseIncome);
  document.getElementById("statRemittanceIncome").textContent = fmtMoney(remittanceIncome);
  document.getElementById("statTotalExpenses").textContent = fmtMoney(totalExpenses);
  document.getElementById("statGrandTotal").textContent = fmtMoney(grandTotal);

  lastSummaryData = {
    electronicsProfit, rentalIncome, frameIncome, completeHouseIncome, remittanceIncome,
    totalExpenses, grandTotal, startDate, period: currentPeriod
  };
}

/* ---- PDF: Real Estate Records ---- */
document.getElementById("downloadRealEstatePdf").addEventListener("click", () => {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFontSize(16);
  doc.text("NGOLE FAMILY - Ripoti ya Real Estate", 14, 16);
  doc.setFontSize(10);
  doc.text("Tarehe ya ripoti: " + todayStr(), 14, 23);

  const rows = realEstateCache.map((r) => {
    const fullLocation = (r.location || "") + (r.specificLocation ? (" - " + r.specificLocation) : "");
    return [
      r.tenantName, fullLocation, HOUSE_LABELS[r.houseType], fmtMoney(r.monthlyRate),
      r.months, fmtMoney(r.totalPaid), r.paymentDate, r.expectedDueDate || ""
    ];
  });
  doc.autoTable({
    startY: 30,
    head: [["Mpangaji", "Mahali", "Aina", "Rate/Mwezi", "Miezi", "Jumla", "Tarehe", "Kodi Mpya Kuanzia"]],
    body: rows,
    styles: { fontSize: 8 }
  });
  doc.save("NgoleFamily-RealEstate-" + todayStr() + ".pdf");
});

/* ---- PDF: Summary Report ---- */
document.getElementById("downloadSummaryPdf").addEventListener("click", () => {
  if (!lastSummaryData) return;
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFontSize(16);
  doc.text("NGOLE FAMILY - Summary ya Mapato", 14, 16);
  doc.setFontSize(10);
  doc.text("Kipindi: " + PERIOD_LABELS_SW[lastSummaryData.period], 14, 24);
  doc.text("Tarehe ya ripoti: " + todayStr(), 14, 30);

  doc.autoTable({
    startY: 38,
    head: [["Kipengele", "Kiasi"]],
    body: [
      ["Faida - Electronics", fmtMoney(lastSummaryData.electronicsProfit)],
      ["Mapato - Nyumba za Kupangisha", fmtMoney(lastSummaryData.rentalIncome)],
      ["Mapato - Frame za Biashara", fmtMoney(lastSummaryData.frameIncome)],
      ["Mapato - Complete House", fmtMoney(lastSummaryData.completeHouseIncome)],
      ["Mapato - Makabidhi (Remittances)", fmtMoney(lastSummaryData.remittanceIncome)],
      ["Jumla ya Matumizi (Expenses)", fmtMoney(lastSummaryData.totalExpenses)],
      ["JUMLA KUU", fmtMoney(lastSummaryData.grandTotal)]
    ],
    styles: { fontSize: 10 }
  });
  doc.save("NgoleFamily-Muhtasari-" + todayStr() + ".pdf");
});

/* ---- EXPENSES ---- */
document.getElementById("expenseDate").value = todayStr();

document.getElementById("expenseForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const date = document.getElementById("expenseDate").value;
  const description = document.getElementById("expenseDesc").value.trim();
  const source = document.getElementById("expenseSource").value;
  const amount = Number(document.getElementById("expenseAmount").value);
  try {
    await db.collection("ngole_expenses").add({
      date, description, source, amount,
      recordedBy: currentUsername,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    e.target.reset();
    document.getElementById("expenseDate").value = todayStr();
    showToast("Expense imesajiliwa.", "success");
    loadSummary();
  } catch (err) {
    showToast("Hitilafu: " + err.message, "error");
  }
});

function listenExpenses() {
  db.collection("ngole_expenses").orderBy("createdAt", "desc").limit(200)
    .onSnapshot((snap) => {
      const tbody = document.querySelector("#expensesTable tbody");
      tbody.innerHTML = "";
      snap.forEach((doc) => {
        const ex = doc.data();
        tbody.innerHTML += `<tr id="exp-row-${doc.id}">
          <td>${ex.date}</td><td>${ex.description}</td>
          <td>${EXPENSE_SOURCE_LABELS[ex.source] || ex.source}</td>
          <td>${fmtMoney(ex.amount)}</td>
          <td><button class="link-btn" onclick="deleteExpense('${doc.id}')">Delete</button></td>
        </tr>`;
      });
    }, (err) => {
      showToast("Hitilafu: " + err.message, "error");
    });
}
async function deleteExpense(id) {
  if (!confirm("Una uhakika unataka kufuta expense hii?")) return;
  const row = document.getElementById("exp-row-" + id);
  if (row) row.remove();
  showToast("Expense imefutwa.", "success");
  try {
    await db.collection("ngole_expenses").doc(id).delete();
    loadSummary();
  } catch (err) {
    showToast("Hitilafu: " + err.message, "error");
  }
}

/* ---- REMITTANCES (Sales Person -> Manager cash handover) ---- */
function listenRemittances() {
  db.collection("ngole_remittances").orderBy("createdAt", "desc").limit(100)
    .onSnapshot((snap) => {
      const tbody = document.querySelector("#remittancesTable tbody");
      tbody.innerHTML = "";
      snap.forEach((doc) => {
        const r = doc.data();
        const badge = r.status === "approved"
          ? '<span class="status-badge status-approved">Approved</span>'
          : `<button class="link-btn" onclick="approveRemittance('${doc.id}')">Approve</button>`;
        tbody.innerHTML += `<tr id="rem-row-${doc.id}">
          <td>${r.date}</td><td>${r.submittedByName || r.submittedBy}</td>
          <td>${fmtMoney(r.amount)}</td><td>${badge}</td>
        </tr>`;
      });
    }, (err) => {
      showToast("Hitilafu: " + err.message, "error");
    });
}

async function approveRemittance(id) {
  if (!confirm("Umepokea pesa hii kutoka kwa sales person?")) return;
  try {
    await db.collection("ngole_remittances").doc(id).update({
      status: "approved",
      approvedBy: currentUsername,
      approvedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    showToast("Umeidhinisha kupokea.", "success");
    loadSummary();
  } catch (err) {
    showToast("Hitilafu: " + err.message, "error");
  }
}

/* =========================================================
   SALESPERSON DASHBOARD
   ========================================================= */
let spInitialized = false;
function updateSellPriceDisplay() {
  const select = document.getElementById("sellProductSelect");
  const priceDisplay = document.getElementById("sellPriceDisplay");
  const product = productsCache.find((p) => p.id === select.value);
  priceDisplay.value = product ? fmtMoney(product.sellingPrice) : "";
}
document.getElementById("sellProductSelect").addEventListener("change", updateSellPriceDisplay);

document.getElementById("remittanceDate").value = todayStr();
document.getElementById("remittanceForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const date = document.getElementById("remittanceDate").value;
  const amount = Number(document.getElementById("remittanceAmount").value);
  try {
    await db.collection("ngole_remittances").add({
      date, amount,
      submittedBy: currentUsername, submittedByName: currentUserName,
      status: "pending",
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    e.target.reset();
    document.getElementById("remittanceDate").value = todayStr();
    showToast("Umekabidhi, inasubiri idhini ya Manager.", "success");
  } catch (err) {
    showToast("Hitilafu: " + err.message, "error");
  }
});

function renderMySales(rows) {
  const tbody = document.querySelector("#mySalesTable tbody");
  tbody.innerHTML = "";
  const byDate = {};
  const dateOrder = [];
  rows.forEach((s) => {
    if (!byDate[s.date]) { byDate[s.date] = []; dateOrder.push(s.date); }
    byDate[s.date].push(s);
  });
  dateOrder.sort((a, b) => (b || "").localeCompare(a || ""));
  dateOrder.forEach((date) => {
    tbody.innerHTML += `<tr class="date-group-row"><td colspan="5">${date}</td></tr>`;
    let dayTotal = 0;
    byDate[date].forEach((s) => {
      dayTotal += Number(s.total || 0);
      tbody.innerHTML += `<tr id="sale-row-${s.id}">
        <td>${s.productName}</td><td>${s.qty}</td><td>${fmtMoney(s.total)}</td><td>${s.date}</td>
        <td><button class="link-btn" onclick="deleteSale('${s.id}')">Delete</button></td>
      </tr>`;
    });
    tbody.innerHTML += `<tr class="date-total-row"><td colspan="2">Jumla ya Siku</td><td colspan="3">${fmtMoney(dayTotal)}</td></tr>`;
  });
}

function initSalespersonDashboard() {
  if (spInitialized) return;
  spInitialized = true;

  // Bado tunahitaji productsCache kwa ajili ya dropdown ya kuuza na
  // kuangalia stock, hata kama hatuoneshi tena jedwali la "Stock Iliyopo".
  db.collection("ngole_products").orderBy("createdAt", "desc").limit(200)
    .onSnapshot((snap) => {
      const select = document.getElementById("sellProductSelect");
      const prevSelected = select.value;
      select.innerHTML = "";
      productsCache = [];
      snap.forEach((doc) => {
        const p = { id: doc.id, ...doc.data() };
        productsCache.push(p);
        select.innerHTML += `<option value="${p.id}">${p.name} (Stock: ${p.stockQty})</option>`;
      });
      if (prevSelected) select.value = prevSelected;
      updateSellPriceDisplay();
    }, (err) => {
      showToast("Hitilafu: " + err.message, "error");
    });

  // .limit(20) - anaona mauzo yake ya karibuni tu. Hakuna orderBy hapa kuepuka
  // hitaji la composite index - tunapanga (sort) upande wa JS badala yake.
  db.collection("ngole_sales").where("soldBy", "==", currentUsername).limit(20)
    .onSnapshot((snap) => {
      const rows = [];
      snap.forEach((doc) => rows.push({ id: doc.id, ...doc.data() }));
      renderMySales(rows);
    }, (err) => {
      showToast("Hitilafu: " + err.message, "error");
    });

  // Historia ya makabidhi ya huyu sales person - hakuna orderBy pamoja na where
  // kuepuka composite index, tunapanga upande wa JS.
  db.collection("ngole_remittances").where("submittedBy", "==", currentUsername).limit(20)
    .onSnapshot((snap) => {
      const rows = [];
      snap.forEach((doc) => rows.push({ id: doc.id, ...doc.data() }));
      rows.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
      const tbody = document.querySelector("#remittanceHistoryTable tbody");
      tbody.innerHTML = "";
      rows.forEach((r) => {
        const badge = r.status === "approved"
          ? '<span class="status-badge status-approved">Approved</span>'
          : '<span class="status-badge status-pending">Pending</span>';
        tbody.innerHTML += `<tr><td>${r.date}</td><td>${fmtMoney(r.amount)}</td><td>${badge}</td></tr>`;
      });
    }, (err) => {
      showToast("Hitilafu: " + err.message, "error");
    });
}

document.getElementById("sellForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const productId = document.getElementById("sellProductSelect").value;
  const qty = Number(document.getElementById("sellQty").value);
  const product = productsCache.find((p) => p.id === productId);
  if (!product) return showToast("Chagua bidhaa.", "error");
  if (qty > product.stockQty) return showToast("Stock haitoshi.", "error");

  const total = product.sellingPrice * qty;
  const profit = (product.sellingPrice - product.buyingPrice) * qty;

  try {
    const batch = db.batch();
    batch.update(db.collection("ngole_products").doc(productId), {
      stockQty: product.stockQty - qty
    });
    batch.set(db.collection("ngole_sales").doc(), {
      productId, productName: product.name, qty,
      buyingPrice: product.buyingPrice, sellingPrice: product.sellingPrice,
      total, profit,
      soldBy: currentUsername, soldByName: currentUserName,
      date: todayStr(),
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    await batch.commit();
    e.target.reset();
    showToast("Mauzo yamekamilika.", "success");
  } catch (err) {
    showToast("Error: " + err.message, "error");
  }
});

// Sales Person akikosea kuuza, anaweza kufuta mauzo hayo - stock inarudi kiotomatiki
async function deleteSale(id) {
  if (!confirm("Una uhakika unataka kufuta mauzo haya? Stock ya bidhaa itarudishwa.")) return;
  const row = document.getElementById("sale-row-" + id);
  if (row) row.remove();
  showToast("Mauzo yamefutwa, stock imerudishwa.", "success");
  try {
    const saleDoc = await db.collection("ngole_sales").doc(id).get();
    if (!saleDoc.exists) return;
    const s = saleDoc.data();
    const batch = db.batch();
    batch.delete(db.collection("ngole_sales").doc(id));
    batch.update(db.collection("ngole_products").doc(s.productId), {
      stockQty: firebase.firestore.FieldValue.increment(s.qty)
    });
    await batch.commit();
  } catch (err) {
    showToast("Hitilafu kufuta: " + err.message, "error");
  }
}
