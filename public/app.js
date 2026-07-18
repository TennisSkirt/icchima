/* イッチマ — 買い物メモ PWA */

const DAY_MS = 24 * 60 * 60 * 1000;
const FB_VER = "10.12.2";
const configured =
  typeof FIREBASE_CONFIG !== "undefined" &&
  FIREBASE_CONFIG.apiKey &&
  !FIREBASE_CONFIG.apiKey.includes("PASTE");
const vapidConfigured =
  typeof VAPID_KEY !== "undefined" && VAPID_KEY && !VAPID_KEY.includes("PASTE");

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));

let store = null;
let fb = null; // { db, fs(firestore module), familyId }
let items = [];
let currentTab = "buy";
let swReg = null;
let editingId = null; // 編集中の項目ID（null = 新規追加）
let sheetMode = "item"; // "item"（買うもの） | "stock"（ストック）
let selectedIcon = ""; // シートで選択中のアイコン（"" = お店の名前から自動）
let filterStore = ""; // "" = すべて
let sheetQty = 1; // シートの個数
let sheetUrgent = false; // シートの「急ぎ」
let cleanedOldDone = false; // 古い完了項目の掃除は起動時に一度だけ

/* ---------- メンバーチェンジ（テーマ切り替え） ---------- */

const MEMBERS = [
  { key: "red",    no: "1号", label: "レッド",   theme: ["#14090b", "#0a0405"] },
  { key: "green",  no: "2号", label: "グリーン", theme: ["#091309", "#040a05"] },
  { key: "blue",   no: "3号", label: "ブルー",   theme: ["#070d1a", "#030710"] },
  { key: "yellow", no: "4号", label: "イエロー", theme: ["#141005", "#0d0a03"] },
  { key: "pink",   no: "5号", label: "ピンク",   theme: ["#170810", "#0d040a"] },
];

function currentMember() {
  const m = localStorage.getItem("icchima-member");
  return MEMBERS.some((x) => x.key === m) ? m : "red";
}

function applyMember(key) {
  const m = MEMBERS.find((x) => x.key === key) || MEMBERS[0];
  localStorage.setItem("icchima-member", m.key);
  document.documentElement.dataset.member = m.key;
  $("memberLogo").src = `icons/helmet-${m.key}.png`;
  $("splashImg").src = `splash-${m.key}.jpg`;
  document.querySelectorAll('meta[name="theme-color"]').forEach((el, i) => {
    el.setAttribute("content", m.theme[i] || m.theme[0]);
  });
}

function renderMemberGrid() {
  const cur = currentMember();
  $("memberGrid").innerHTML = MEMBERS.map((m) => `
    <button type="button" class="member-choice ${m.key === cur ? "sel" : ""}" data-member="${m.key}">
      <img src="icons/helmet-${m.key}.png" alt="${m.no} ${m.label}">
      <span>${m.no}</span>
    </button>`).join("");
  $("memberGrid").querySelectorAll(".member-choice").forEach((btn) => {
    btn.onclick = () => {
      const m = MEMBERS.find((x) => x.key === btn.dataset.member);
      applyMember(m.key);
      renderMemberGrid();
      $("memberDialog").close();
      toast(`イッチマン・${m.label}にチェンジ！`);
    };
  });
}

/* ---------- アイコン ---------- */

const ICON_CHOICES = [
  "🛒", "🏪", "👕", "💊", "🧺", "🔨", "🛋️", "📱", "📚", "🍞",
  "🍎", "🐟", "☕", "🧴", "🧼", "🎁", "⚽", "🐶", "👶", "💄", "📦", "📍",
];

/* お店の名前からアイコンを自動で当てる */
const STORE_ICON_RULES = [
  [/ユニクロ|uniqlo|\bgu\b|ジーユー|しまむら|洋服|衣料/i, "👕"],
  [/スーパー|イオン|イトーヨーカドー|ライフ|オーケー|業務スーパー|マルエツ/i, "🛒"],
  [/コンビニ|セブン|ファミマ|ファミリーマート|ローソン/i, "🏪"],
  [/ドラッグ|薬局|マツキヨ|ウエルシア|ココカラ|スギ薬局/i, "💊"],
  [/100均|ダイソー|セリア|キャンドゥ/i, "🧺"],
  [/ホームセンター|カインズ|コーナン|ビバホーム/i, "🔨"],
  [/ニトリ|無印|ikea|イケア|家具/i, "🛋️"],
  [/家電|ヨドバシ|ビックカメラ|ヤマダ|エディオン/i, "📱"],
  [/本屋|書店|ブックオフ|紀伊国屋/i, "📚"],
  [/パン|ベーカリー/i, "🍞"],
  [/amazon|アマゾン|楽天|ヤフー|メルカリ|ネット|通販/i, "📦"],
  [/魚|鮮魚|市場/i, "🐟"],
  [/カフェ|コーヒー|スタバ/i, "☕"],
];

function suggestIcon(storeName) {
  if (!storeName) return "";
  for (const [re, icon] of STORE_ICON_RULES) {
    if (re.test(storeName)) return icon;
  }
  return "";
}

/* お店グループの表示用アイコン（項目に設定されたもの → 自動判定 → 📍） */
function storeIconOf(storeName) {
  const it = items.find((i) => (i.store || "その他") === storeName && i.icon);
  return (it && it.icon) || suggestIcon(storeName) || "📍";
}

/* ---------- ストレージ ---------- */

class LocalStore {
  constructor() {
    this.key = "icchima-items";
    this.items = [];
    this.cb = () => {};
  }
  onChange(cb) { this.cb = cb; }
  async init() {
    try { this.items = JSON.parse(localStorage.getItem(this.key) || "[]"); }
    catch { this.items = []; }
    this.cb(this.items.slice());
  }
  _save() {
    localStorage.setItem(this.key, JSON.stringify(this.items));
    this.cb(this.items.slice());
  }
  async add(item) { this.items.push(item); this._save(); }
  async update(id, patch) {
    const it = this.items.find((i) => i.id === id);
    if (it) Object.assign(it, patch);
    this._save();
  }
  async remove(id) {
    this.items = this.items.filter((i) => i.id !== id);
    this._save();
  }
}

class CloudStore {
  constructor(db, fs, familyId) {
    this.db = db;
    this.fs = fs;
    this.familyId = familyId;
    this.cb = () => {};
  }
  onChange(cb) { this.cb = cb; }
  _col() {
    return this.fs.collection(this.db, "families", this.familyId, "items");
  }
  async init() {
    this.fs.onSnapshot(this._col(), (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      this.cb(list);
    });
  }
  async add(item) {
    const { id, ...data } = item;
    await this.fs.setDoc(this.fs.doc(this._col(), id), data);
  }
  async update(id, patch) {
    await this.fs.updateDoc(this.fs.doc(this._col(), id), patch);
  }
  async remove(id) {
    await this.fs.deleteDoc(this.fs.doc(this._col(), id));
  }
}

/* ---------- 初期化 ---------- */

async function init() {
  applyMember(currentMember());

  // 起動スプラッシュ（ヒーロー登場）を少し見せてからフェードアウト
  setTimeout(() => {
    const sp = $("splash");
    if (sp) sp.classList.add("hide");
  }, 1100);

  if ("serviceWorker" in navigator) {
    try { swReg = await navigator.serviceWorker.register("sw.js"); }
    catch (e) { console.warn("SW registration failed:", e); }
  }

  if (configured) {
    try {
      await initFirebase();
    } catch (e) {
      console.error("Firebase init failed:", e);
      showBanner("Firebaseに接続できませんでした。ローカルモードで動作します。");
      store = new LocalStore();
    }
  } else {
    store = new LocalStore();
    showBanner("ローカルモード：データはこの端末にのみ保存されます。家族共有・プッシュ通知にはFirebase設定が必要です（SETUP.md参照）。");
  }

  store.onChange((list) => {
    items = list;
    checkRepeats();
    cleanOldDone();
    render();
  });
  await store.init();
  bindUI();
}

async function initFirebase() {
  const base = `https://www.gstatic.com/firebasejs/${FB_VER}`;
  const [{ initializeApp }, authMod, fs] = await Promise.all([
    import(`${base}/firebase-app.js`),
    import(`${base}/firebase-auth.js`),
    import(`${base}/firebase-firestore.js`),
  ]);
  const app = initializeApp(FIREBASE_CONFIG);
  const auth = authMod.getAuth(app);
  await authMod.signInAnonymously(auth);
  const db = fs.getFirestore(app);

  let familyId = localStorage.getItem("icchima-family");
  if (!familyId) {
    familyId = await askFamily(db, fs);
    localStorage.setItem("icchima-family", familyId);
  }
  fb = { app, db, fs, familyId };
  store = new CloudStore(db, fs, familyId);
  await migrateLocalItems();
  setupForegroundPush().catch(() => {});
}

/* ローカルモードで貯めた項目を家族グループへ移行（初回のみ確認） */
async function migrateLocalItems() {
  if (localStorage.getItem("icchima-migrate-done")) return;
  let localItems = [];
  try { localItems = JSON.parse(localStorage.getItem("icchima-items") || "[]"); }
  catch { localItems = []; }
  if (localItems.length &&
      confirm(`この端末に保存された${localItems.length}件のメモを家族グループに移しますか？`)) {
    for (const it of localItems) {
      await store.add(it).catch(() => {});
    }
    localStorage.removeItem("icchima-items");
    toast(`${localItems.length}件をグループに移しました`);
  }
  localStorage.setItem("icchima-migrate-done", "1");
}

/* 家族グループの作成・参加ダイアログ */
function askFamily(db, fs) {
  return new Promise((resolve) => {
    const dlg = $("familyDialog");
    const err = $("familyError");
    dlg.showModal();
    dlg.addEventListener("cancel", (e) => e.preventDefault());

    $("createFamilyBtn").onclick = async () => {
      const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      const code = Array.from(crypto.getRandomValues(new Uint8Array(6)))
        .map((n) => chars[n % chars.length]).join("");
      try {
        await fs.setDoc(fs.doc(db, "families", code), { createdAt: Date.now() });
        dlg.close();
        resolve(code);
        toast(`グループを作成しました（コード：${code}）`);
      } catch (e) {
        err.textContent = "作成に失敗しました。通信環境を確認してください。";
        err.classList.remove("hidden");
      }
    };

    $("joinForm").onsubmit = async (e) => {
      e.preventDefault();
      const code = $("joinCodeInput").value.trim().toUpperCase();
      if (code.length !== 6) {
        err.textContent = "コードは6文字です。";
        err.classList.remove("hidden");
        return;
      }
      try {
        const snap = await fs.getDoc(fs.doc(db, "families", code));
        if (!snap.exists()) {
          err.textContent = "このコードのグループが見つかりません。";
          err.classList.remove("hidden");
          return;
        }
        dlg.close();
        resolve(code);
        toast("グループに参加しました");
      } catch (e2) {
        err.textContent = "参加に失敗しました。通信環境を確認してください。";
        err.classList.remove("hidden");
      }
    };
  });
}

/* ---------- 通知 ---------- */

async function enableNotifications() {
  if (!("Notification" in window)) {
    toast("この端末は通知に対応していません");
    return;
  }
  const perm = await Notification.requestPermission();
  if (perm !== "granted") {
    toast("通知が許可されませんでした");
    renderNotifStatus();
    return;
  }
  if (fb && vapidConfigured && swReg) {
    try {
      const base = `https://www.gstatic.com/firebasejs/${FB_VER}`;
      const msgMod = await import(`${base}/firebase-messaging.js`);
      const messaging = msgMod.getMessaging(fb.app);
      const token = await msgMod.getToken(messaging, {
        vapidKey: VAPID_KEY,
        serviceWorkerRegistration: swReg,
      });
      if (token) {
        await fb.fs.setDoc(
          fb.fs.doc(fb.db, "families", fb.familyId, "tokens", token),
          { createdAt: Date.now(), ua: navigator.userAgent.slice(0, 120) }
        );
        localStorage.setItem("icchima-push", "1");
        toast("プッシュ通知を有効にしました");
      }
    } catch (e) {
      console.error("FCM token error:", e);
      toast("プッシュ通知の登録に失敗しました");
    }
  } else if (!fb) {
    toast("通知を許可しました（プッシュ配信にはFirebase設定が必要です）");
  } else if (!vapidConfigured) {
    toast("VAPIDキーが未設定です（firebase-config.js参照）");
  }
  renderNotifStatus();
}

async function setupForegroundPush() {
  if (!fb || !vapidConfigured) return;
  if (Notification.permission !== "granted") return;
  const base = `https://www.gstatic.com/firebasejs/${FB_VER}`;
  const msgMod = await import(`${base}/firebase-messaging.js`);
  const messaging = msgMod.getMessaging(fb.app);
  msgMod.onMessage(messaging, (payload) => {
    const n = payload.notification || {};
    toast(`${n.title || "イッチマ"}：${n.body || ""}`);
  });
}

/* ---------- 繰り返し（反復購入） ---------- */

function checkRepeats() {
  const now = Date.now();
  for (const it of items) {
    if (it.done && it.repeatDays > 0 && it.completedAt &&
        it.completedAt + it.repeatDays * DAY_MS <= now) {
      store.update(it.id, { done: false, completedAt: null });
      toast(`「${it.name}」を買うものリストに戻しました`);
    }
  }
}

/* 完了から30日たった項目を自動削除（繰り返し設定のものは残す） */
function cleanOldDone() {
  if (cleanedOldDone || !items.length) return;
  cleanedOldDone = true;
  const cutoff = Date.now() - 30 * DAY_MS;
  items
    .filter((i) => i.done && i.completedAt && i.completedAt < cutoff && !(i.repeatDays > 0))
    .forEach((i) => store.remove(i.id));
}

/* ---------- 描画 ---------- */

function fmtDate(ms) {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/* 追加・編集シートを開く（item=null なら新規追加） */
function openSheet(item) {
  editingId = item ? item.id : null;
  sheetMode = item ? (item.kind === "stock" ? "stock" : "item")
                   : (currentTab === "stock" ? "stock" : "item");
  const isStock = sheetMode === "stock";
  $("sheetTitle").textContent = isStock
    ? (item ? "ストックを編集" : "ストックを追加")
    : (item ? "編集" : "買うものを追加");
  $("sheetSubmitBtn").textContent = item ? "保存する" : "追加する";
  $("nameInput").placeholder = isStock ? "持っている物（例：ガスボンベ）" : "買うもの（例：牛乳）";
  // ストックには「繰り返し」「急ぎ」は不要
  $("repeatSelect").classList.toggle("hidden", isStock);
  $("urgentBtn").classList.toggle("hidden", isStock);
  $("nameInput").value = item ? item.name : "";
  $("storeInput").value = item ? (item.store || "") : $("storeInput").value;
  $("memoInput").value = item ? (item.memo || "") : "";
  selectedIcon = item ? (item.icon || "") : "";
  sheetQty = item ? (isStock ? (item.count ?? 1) : (item.qty || 1)) : 1;
  sheetUrgent = item ? !!item.urgent : false;
  renderQtyUrgent();
  renderIconRow();
  const sel = $("repeatSelect");
  const days = item ? item.repeatDays || 0 : 0;
  if (days > 0 && ![...sel.options].some((o) => o.value === String(days))) {
    const opt = document.createElement("option");
    opt.value = String(days);
    opt.textContent = `${days}日ごと`;
    sel.insertBefore(opt, sel.querySelector('option[value="custom"]'));
  }
  sel.value = String(days);
  $("addSheet").showModal();
  if (!item) setTimeout(() => $("nameInput").focus(), 50);
}

function renderQtyUrgent() {
  $("qtyVal").innerHTML = `${sheetQty}<small>個</small>`;
  $("urgentBtn").classList.toggle("on", sheetUrgent);
}

/* アイコン選択列（"" = 自動。お店の名前から提案されたものに印を付ける） */
function renderIconRow() {
  const auto = suggestIcon($("storeInput").value.trim());
  const row = $("iconRow");
  row.innerHTML = ICON_CHOICES.map((ic) => {
    const isSel = selectedIcon ? selectedIcon === ic : auto === ic;
    return `<button type="button" class="icon-choice ${isSel ? "sel" : ""}" data-icon="${ic}">${ic}</button>`;
  }).join("");
  row.querySelectorAll(".icon-choice").forEach((btn) => {
    btn.onclick = () => {
      selectedIcon = selectedIcon === btn.dataset.icon ? "" : btn.dataset.icon;
      renderIconRow();
    };
  });
}

function itemRow(it) {
  const meta = [];
  if (it.store) meta.push(`<span class="chip">${it.icon || suggestIcon(it.store) || "📍"} ${esc(it.store)}</span>`);
  if (it.repeatDays > 0) {
    meta.push(`<span class="chip repeat">🔁 ${it.repeatDays}日ごと</span>`);
    if (it.done && it.completedAt) {
      meta.push(`<span class="chip">↩ ${fmtDate(it.completedAt + it.repeatDays * DAY_MS)}にリストに戻る</span>`);
    }
  }
  if (it.done && it.completedAt) meta.push(`<span class="chip">✓ ${fmtDate(it.completedAt)} 完了</span>`);
  return `
    <div class="item ${it.done ? "done" : ""} ${it.urgent && !it.done ? "urgent" : ""}">
      <input type="checkbox" data-id="${it.id}" ${it.done ? "checked" : ""} aria-label="${esc(it.name)}">
      <div class="item-body" data-edit="${it.id}">
        <span class="item-name">${it.urgent && !it.done ? "⭐ " : ""}${esc(it.name)}${it.qty > 1 ? ` <span class="qty">×${it.qty}</span>` : ""}</span>
        ${meta.length ? `<div class="item-meta">${meta.join("")}</div>` : ""}
        ${it.memo ? `<div class="item-memo">📝 ${esc(it.memo)}</div>` : ""}
      </div>
      <button class="del-btn" data-del="${it.id}" aria-label="削除">✕</button>
    </div>`;
}

/* ---------- フィルター（場所のドロップダウン） ---------- */

function applyFilters(list) {
  return list.filter((i) => !filterStore || (i.store || "その他") === filterStore);
}

function renderFilters() {
  const stores = [...new Set(items.filter((i) => i.kind !== "stock").map((i) => i.store || "その他"))]
    .sort((a, b) => (a === "その他" ? 1 : b === "その他" ? -1 : a.localeCompare(b, "ja")));

  if (filterStore && !stores.includes(filterStore)) filterStore = "";
  $("filterBar").classList.toggle("hidden", currentTab !== "buy" || stores.length < 2);

  const sel = $("storeFilterSelect");
  sel.innerHTML = [
    `<option value="">🔍 すべての場所</option>`,
    ...stores.map((s) => `<option value="${esc(s)}">${storeIconOf(s)} ${esc(s)}</option>`),
  ].join("");
  sel.value = filterStore;
  sel.onchange = () => { filterStore = sel.value; render(); };
}

/* ---------- ストック（在庫の管理帳） ---------- */

function stockRow(it) {
  const count = it.count ?? 0;
  const meta = [];
  if (it.store) meta.push(`<span class="chip">${it.icon || suggestIcon(it.store) || "📍"} ${esc(it.store)}</span>`);
  return `
    <div class="item stock-item ${count <= 1 ? "stock-low" : ""}">
      <div class="item-body" data-edit="${it.id}">
        <span class="item-name">${it.icon ? it.icon + " " : ""}${esc(it.name)}</span>
        ${meta.length ? `<div class="item-meta">${meta.join("")}</div>` : ""}
        ${it.memo ? `<div class="item-memo">📝 ${esc(it.memo)}</div>` : ""}
      </div>
      <div class="stock-ctrl">
        <button class="stock-btn" data-minus="${it.id}" aria-label="1つ使った">−</button>
        <span class="stock-count ${count === 0 ? "zero" : ""}">${count}</span>
        <button class="stock-btn" data-plus="${it.id}" aria-label="1つ増やす">＋</button>
      </div>
      <button class="del-btn" data-del="${it.id}" aria-label="削除">✕</button>
    </div>`;
}

function renderStock() {
  const stock = items.filter((i) => i.kind === "stock")
    .sort((a, b) => (a.count ?? 0) - (b.count ?? 0) || String(a.name).localeCompare(String(b.name), "ja"));
  $("stockCount").textContent = stock.length;
  $("stockList").innerHTML = stock.length
    ? `<div class="list-card">${stock.map(stockRow).join("")}</div>` : "";

  $("stockList").querySelectorAll("[data-minus]").forEach((btn) => {
    btn.onclick = () => {
      const it = items.find((i) => i.id === btn.dataset.minus);
      if (!it) return;
      const next = Math.max(0, (it.count ?? 0) - 1);
      store.update(it.id, { count: next });
      if (next === 0 &&
          confirm(`「${it.name}」のストックがなくなりました。\n買うものリストに追加しますか？`)) {
        store.add({
          id: crypto.randomUUID(),
          name: it.name,
          store: it.store || "",
          icon: it.icon || "",
          memo: it.memo || "",
          qty: 1,
          urgent: false,
          done: false,
          repeatDays: 0,
          createdAt: Date.now(),
          completedAt: null,
        });
        toast(`「${it.name}」を買うものリストに追加しました`);
      }
    };
  });
  $("stockList").querySelectorAll("[data-plus]").forEach((btn) => {
    btn.onclick = () => {
      const it = items.find((i) => i.id === btn.dataset.plus);
      if (it) store.update(it.id, { count: Math.min(999, (it.count ?? 0) + 1) });
    };
  });
  return stock;
}

function render() {
  const buyAll = items.filter((i) => !i.done && i.kind !== "stock");
  const doneAll = items.filter((i) => i.done && i.kind !== "stock");

  $("buyCount").textContent = buyAll.length;
  $("doneCount").textContent = doneAll.length;
  const stockAll = renderStock();

  renderFilters();
  const buy = applyFilters(buyAll)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const done = applyFilters(doneAll)
    .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));

  // 急ぎの項目は一番上に固定表示
  const urgentItems = buy.filter((i) => i.urgent);
  const normalItems = buy.filter((i) => !i.urgent);

  // 買うもの：場所ごとにグループ化
  const groups = new Map();
  for (const it of normalItems) {
    const key = it.store || "その他";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }
  const keys = [...groups.keys()].sort((a, b) =>
    a === "その他" ? 1 : b === "その他" ? -1 : a.localeCompare(b, "ja"));

  const urgentBlock = urgentItems.length ? `
    <div class="store-group">
      <div class="store-head urgent-head">⭐ 急ぎ<span class="count">${urgentItems.length}</span></div>
      <div class="list-card">${urgentItems.map(itemRow).join("")}</div>
    </div>` : "";

  $("buyList").innerHTML = urgentBlock + keys.map((k) => `
    <div class="store-group">
      <div class="store-head">${storeIconOf(k)} ${esc(k)}<span class="count">${groups.get(k).length}</span></div>
      <div class="list-card">${groups.get(k).map(itemRow).join("")}</div>
    </div>`).join("");

  $("doneList").innerHTML = done.length
    ? `<div class="list-card">${done.map(itemRow).join("")}</div>` : "";

  // 空メッセージ
  const emptyMsg = $("emptyMsg");
  const filtering = !!filterStore;
  const activeEmpty =
    currentTab === "buy" ? buy.length === 0 :
    currentTab === "stock" ? stockAll.length === 0 :
    done.length === 0;
  if (activeEmpty) {
    emptyMsg.textContent =
      currentTab === "stock"
        ? "ストックはまだありません。\n右下の＋ボタンで、家にある物と個数を登録できます。\n1つ使ったら − を押すだけ！"
        : filtering
          ? "この条件に合うものはありません。"
          : currentTab === "buy"
            ? "買うものはありません 🎉\n右下の＋ボタンから追加できます。"
            : "完了した買い物はまだありません。";
    emptyMsg.classList.remove("hidden");
  } else {
    emptyMsg.classList.add("hidden");
  }

  // 店名の候補
  const stores = [...new Set(items.map((i) => i.store).filter(Boolean))];
  $("storeList").innerHTML = stores.map((s) => `<option value="${esc(s)}">`).join("");

  // チェック・削除ハンドラ
  document.querySelectorAll('.item input[type="checkbox"]').forEach((cb) => {
    cb.onchange = () => {
      store.update(cb.dataset.id, {
        done: cb.checked,
        completedAt: cb.checked ? Date.now() : null,
      });
    };
  });
  document.querySelectorAll(".del-btn").forEach((btn) => {
    btn.onclick = () => {
      const it = items.find((i) => i.id === btn.dataset.del);
      if (it && confirm(`「${it.name}」を削除しますか？`)) store.remove(it.id);
    };
  });
  document.querySelectorAll(".item-body").forEach((el) => {
    el.onclick = () => {
      const it = items.find((i) => i.id === el.dataset.edit);
      if (it) openSheet(it);
    };
  });

  // インストール済みPWAのアイコンに未購入件数バッジを表示（対応端末のみ）
  if ("setAppBadge" in navigator) {
    (buyAll.length ? navigator.setAppBadge(buyAll.length) : navigator.clearAppBadge())
      .catch(() => {});
  }
}

function renderNotifStatus() {
  const el = $("notifStatus");
  const btn = $("notifBtn");
  if (!("Notification" in window)) {
    el.textContent = "この端末は通知に対応していません。";
    btn.disabled = true;
    return;
  }
  if (Notification.permission === "granted") {
    if (fb && localStorage.getItem("icchima-push")) {
      el.textContent = "プッシュ通知：有効 ✅";
      btn.textContent = "通知を再登録する";
    } else if (fb) {
      el.textContent = "通知は許可済みです。プッシュ登録を完了してください。";
      btn.textContent = "プッシュ通知を登録する";
    } else {
      el.textContent = "通知は許可済みです（プッシュ配信にはFirebase設定が必要）。";
    }
  } else if (Notification.permission === "denied") {
    el.textContent = "通知がブロックされています。ブラウザの設定から許可してください。";
  } else {
    el.textContent = "通知はまだ有効になっていません。";
  }
}

function renderFamilySection() {
  const el = $("familySection");
  if (fb) {
    el.innerHTML = `
      <p class="dialog-note">このコードを家族に伝えると、同じリストを一緒に使えます。</p>
      <div class="family-code">
        <span class="code">${esc(fb.familyId)}</span>
        <button id="copyCodeBtn" class="icon-btn" aria-label="コピー">📋</button>
      </div>
      <button id="leaveFamilyBtn" class="link-btn">このグループを抜ける（データは残ります）</button>`;
    $("copyCodeBtn").onclick = async () => {
      try {
        await navigator.clipboard.writeText(fb.familyId);
        toast("コードをコピーしました");
      } catch { toast(`コード：${fb.familyId}`); }
    };
    $("leaveFamilyBtn").onclick = () => {
      if (confirm("グループを抜けますか？（再参加にはコードが必要です）")) {
        localStorage.removeItem("icchima-family");
        localStorage.removeItem("icchima-push");
        location.reload();
      }
    };
  } else {
    el.innerHTML = `<p class="dialog-note">家族共有を使うにはFirebaseの設定が必要です。プロジェクトの <b>SETUP.md</b> の手順に従って設定してください。</p>`;
  }
}

/* ---------- UI ---------- */

function bindUI() {
  $("tabBuy").onclick = () => switchTab("buy");
  $("tabStock").onclick = () => switchTab("stock");
  $("tabDone").onclick = () => switchTab("done");

  $("fab").onclick = () => openSheet(null);
  $("closeAddBtn").onclick = () => $("addSheet").close();
  $("addSheet").addEventListener("close", () => { editingId = null; });
  // お店の名前を入力するとアイコンの自動提案を更新
  $("storeInput").addEventListener("input", () => {
    if (!selectedIcon) renderIconRow();
  });

  $("memberBtn").onclick = () => {
    renderMemberGrid();
    $("memberDialog").showModal();
  };
  $("closeMemberBtn").onclick = () => $("memberDialog").close();

  $("qtyMinus").onclick = () => {
    sheetQty = Math.max(sheetMode === "stock" ? 0 : 1, sheetQty - 1);
    renderQtyUrgent();
  };
  $("qtyPlus").onclick = () => { sheetQty = Math.min(99, sheetQty + 1); renderQtyUrgent(); };
  $("urgentBtn").onclick = () => { sheetUrgent = !sheetUrgent; renderQtyUrgent(); };
  $("shareBtn").onclick = shareList;
  $("bannerClose").onclick = () => $("banner").classList.add("hidden");

  $("addForm").onsubmit = (e) => {
    e.preventDefault();
    const name = $("nameInput").value.trim();
    if (!name) return;
    let repeatDays = $("repeatSelect").value;
    if (repeatDays === "custom") {
      const v = prompt("何日ごとに繰り返しますか？（日数）", "10");
      repeatDays = Math.max(1, parseInt(v, 10) || 0);
      if (!repeatDays) return;
    } else {
      repeatDays = parseInt(repeatDays, 10) || 0;
    }
    const storeName = $("storeInput").value.trim();
    const icon = selectedIcon || suggestIcon(storeName);
    const memo = $("memoInput").value.trim();

    // ストックの追加・編集
    if (sheetMode === "stock") {
      if (editingId) {
        store.update(editingId, {
          name, store: storeName, icon, memo, count: sheetQty,
        });
        toast("更新しました");
        $("addSheet").close();
        return;
      }
      store.add({
        id: crypto.randomUUID(),
        kind: "stock",
        name,
        store: storeName,
        icon,
        memo,
        count: sheetQty,
        createdAt: Date.now(),
      });
      toast(`「${name}」をストックに追加しました`);
      $("nameInput").value = "";
      $("memoInput").value = "";
      sheetQty = 1;
      renderQtyUrgent();
      $("nameInput").focus();
      return;
    }

    if (editingId) {
      store.update(editingId, {
        name, store: storeName, repeatDays, icon, memo,
        qty: sheetQty, urgent: sheetUrgent,
      });
      toast("更新しました");
      $("addSheet").close();
      return;
    }
    store.add({
      id: crypto.randomUUID(),
      name,
      store: storeName,
      icon,
      memo,
      qty: sheetQty,
      urgent: sheetUrgent,
      done: false,
      repeatDays,
      createdAt: Date.now(),
      completedAt: null,
    });
    toast(`「${name}」を追加しました`);
    $("nameInput").value = "";
    $("memoInput").value = "";
    $("repeatSelect").value = "0";
    sheetQty = 1;
    sheetUrgent = false;
    renderQtyUrgent();
    $("nameInput").focus();
  };

  $("settingsBtn").onclick = () => {
    renderNotifStatus();
    renderFamilySection();
    $("settingsDialog").showModal();
  };
  $("closeSettingsBtn").onclick = () => $("settingsDialog").close();
  $("notifBtn").onclick = enableNotifications;

  // アプリに戻ってきたとき、繰り返し品の期限をチェック
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) { checkRepeats(); }
  });
}

function switchTab(tab) {
  currentTab = tab;
  for (const [id, t] of [["tabBuy", "buy"], ["tabStock", "stock"], ["tabDone", "done"]]) {
    $(id).classList.toggle("active", tab === t);
    $(id).setAttribute("aria-selected", tab === t);
  }
  $("buyList").classList.toggle("hidden", tab !== "buy");
  $("stockList").classList.toggle("hidden", tab !== "stock");
  $("doneList").classList.toggle("hidden", tab !== "done");
  $("fab").classList.toggle("hidden", tab === "done");
  render();
}

/* 買うものリストをテキストにして共有（LINE・メールなどに貼れる形） */
function shareList() {
  const buy = items.filter((i) => !i.done);
  if (!buy.length) {
    toast("共有する買うものがありません");
    return;
  }
  const itemLine = (i) =>
    `・${i.name}${i.qty > 1 ? ` ×${i.qty}` : ""}${i.memo ? `（${i.memo}）` : ""}`;

  const lines = [`🛍 買い物リスト（${fmtDate(Date.now())}）`];
  const urgent = buy.filter((i) => i.urgent);
  if (urgent.length) {
    lines.push("", "⭐ 急ぎ");
    urgent.forEach((i) => lines.push(itemLine(i)));
  }
  const groups = new Map();
  for (const it of buy.filter((i) => !i.urgent)) {
    const key = it.store || "その他";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }
  for (const [k, list] of groups) {
    lines.push("", `【${storeIconOf(k)} ${k}】`);
    list.forEach((i) => lines.push(itemLine(i)));
  }
  const text = lines.join("\n");

  if (navigator.share) {
    navigator.share({ text }).catch(() => {});
  } else {
    navigator.clipboard.writeText(text)
      .then(() => toast("リストをコピーしました（LINEなどに貼り付けできます）"))
      .catch(() => toast("コピーに失敗しました"));
  }
}

function showBanner(msg) {
  $("bannerText").textContent = msg;
  $("banner").classList.remove("hidden");
}

let toastTimer = null;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 2600);
}

init();
