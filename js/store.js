// Veri katmanı. Firebase ayarları girilmişse Firestore (gerçek zamanlı, çevrimdışı
// destekli) kullanılır; girilmemişse tarayıcıda çalışan bir deneme deposu kullanılır.
// İki uygulama da aynı arayüzü sunar, böylece arayüz kodu hangisinin çalıştığını bilmez.
import { firebaseConfig, members } from "./config.js";

const FIREBASE_VERSION = "12.19.0";
const fb = (name) => `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-${name}.js`;

export function memberName(email) {
  const m = members.find((x) => x.email.toLowerCase() === (email || "").toLowerCase());
  return m ? m.name : (email || "").split("@")[0];
}

export async function createStore() {
  return firebaseConfig.apiKey ? createCloudStore() : createDemoStore();
}

async function createCloudStore() {
  const [{ initializeApp }, auth, fs] = await Promise.all([
    import(fb("app")), import(fb("auth")), import(fb("firestore")),
  ]);
  const app = initializeApp(firebaseConfig);
  const a = auth.getAuth(app);
  await auth.setPersistence(a, auth.browserLocalPersistence);
  const db = fs.initializeFirestore(app, {
    localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
  });
  const expensesCol = fs.collection(db, "expenses");
  const settingsDoc = fs.doc(db, "meta", "settings");
  const categoriesDoc = fs.doc(db, "meta", "categories");

  return {
    mode: "cloud",
    onAuth(cb) {
      return auth.onAuthStateChanged(a, (u) =>
        cb(u ? { email: u.email, name: memberName(u.email) } : null));
    },
    signIn: (email, password) => auth.signInWithEmailAndPassword(a, email, password),
    signUp: (email, password) => auth.createUserWithEmailAndPassword(a, email, password),
    resetPassword: (email) => auth.sendPasswordResetEmail(a, email),
    signOut: () => auth.signOut(a),
    watchExpenses(cb, onError) {
      return fs.onSnapshot(expensesCol, (snap) => {
        cb(snap.docs.map((d) => ({ id: d.id, ...d.data(), pending: d.metadata.hasPendingWrites })));
      }, onError);
    },
    watchCategories(cb) {
      return fs.onSnapshot(categoriesDoc, (d) => cb(d.exists() ? d.data().list : null));
    },
    watchSettings(cb) {
      return fs.onSnapshot(settingsDoc, (d) => cb(d.exists() ? d.data() : {}));
    },
    async addExpenses(list) {
      const batch = fs.writeBatch(db);
      for (const e of list) {
        batch.set(fs.doc(expensesCol), { ...e, createdAt: fs.serverTimestamp(), updatedAt: fs.serverTimestamp() });
      }
      await batch.commit();
    },
    updateExpense: (id, patch) =>
      fs.updateDoc(fs.doc(expensesCol, id), { ...patch, updatedAt: fs.serverTimestamp() }),
    deleteExpense: (id) => fs.deleteDoc(fs.doc(expensesCol, id)),
    saveCategories: (list) => fs.setDoc(categoriesDoc, { list }),
    saveSettings: (patch) => fs.setDoc(settingsDoc, patch, { merge: true }),
    async saveReceipt(dataUrl) {
      const ref = fs.doc(fs.collection(db, "receipts"));
      await fs.setDoc(ref, { data: dataUrl, createdAt: fs.serverTimestamp() });
      return ref.id;
    },
    async getReceipt(id) {
      const d = await fs.getDoc(fs.doc(db, "receipts", id));
      return d.exists() ? d.data().data : null;
    },
  };
}

function createDemoStore() {
  const KEY = "ev-giderleri-demo-v2";
  const listeners = { expenses: new Set(), categories: new Set(), settings: new Set(), auth: new Set() };
  let state = load();

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s && s.expenses) return s;
    } catch {}
    return { expenses: sampleExpenses(), categories: null, receipts: {}, settings: {}, user: null };
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
    emit();
  }
  function emit() {
    listeners.expenses.forEach((cb) => cb(state.expenses.slice()));
    listeners.categories.forEach((cb) => cb(state.categories));
    listeners.settings.forEach((cb) => cb({ ...state.settings }));
  }
  // Aynı tarayıcıda açık diğer sekmeler de güncellensin.
  window.addEventListener("storage", (ev) => {
    if (ev.key === KEY) { state = load(); emit(); }
  });
  const uid = () => Math.random().toString(36).slice(2, 12);
  const watch = (set, cb, initial) => { set.add(cb); cb(initial()); return () => set.delete(cb); };

  return {
    mode: "demo",
    onAuth(cb) {
      listeners.auth.add(cb);
      cb(state.user);
      return () => listeners.auth.delete(cb);
    },
    async signIn(email) {
      const m = members.find((x) => x.email === email) || members[0];
      state.user = { email: m.email, name: m.name };
      save();
      listeners.auth.forEach((cb) => cb(state.user));
    },
    async signOut() {
      state.user = null;
      save();
      listeners.auth.forEach((cb) => cb(null));
    },
    watchExpenses: (cb) => watch(listeners.expenses, cb, () => state.expenses.slice()),
    watchCategories: (cb) => watch(listeners.categories, cb, () => state.categories),
    watchSettings: (cb) => watch(listeners.settings, cb, () => ({ ...state.settings })),
    async addExpenses(list) {
      const now = Date.now();
      list.forEach((e) => state.expenses.push({ ...e, id: uid(), createdAt: now }));
      save();
    },
    async updateExpense(id, patch) {
      state.expenses = state.expenses.map((e) => (e.id === id ? { ...e, ...patch } : e));
      save();
    },
    async deleteExpense(id) {
      state.expenses = state.expenses.filter((e) => e.id !== id);
      save();
    },
    async saveCategories(list) { state.categories = list; save(); },
    async saveSettings(patch) { state.settings = { ...state.settings, ...patch }; save(); },
    async saveReceipt(dataUrl) {
      const id = uid();
      state.receipts[id] = dataUrl;
      save();
      return id;
    },
    async getReceipt(id) { return state.receipts[id] || null; },
    async clearAll() {
      state.expenses = [];
      state.receipts = {};
      save();
    },
  };
}

// Deneme modunda uygulamanın boş görünmemesi için örnek kayıtlar.
function sampleExpenses() {
  const [a, b] = members.map((m) => m.name);
  const today = new Date();
  const d = (daysAgo) => {
    const x = new Date(today);
    x.setDate(x.getDate() - daysAgo);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  };
  const rows = [
    [0, "market", "Market alışverişi", 842.5, "Haftalık market", a],
    [1, "yemek", "İnternet yemek siparişi", 465, "Pizza", b],
    [2, "faturalar", "Elektrik", 1280.4, "Ekim faturası", a],
    [3, "temizlik", "Temizlik malzemeleri", 310, "Deterjan, yumuşatıcı", b],
    [5, "giyim", "Kıyafet", 1899.9, "Mont", b],
    [6, "faturalar", "İnternet", 549, "", a],
    [8, "market", "Pazar / manav", 375, "Sebze meyve", b],
    [9, "faturalar", "Doğalgaz", 960.75, "", a],
    [12, "teknoloji", "Aksesuar", 749, "Kulaklık", a],
    [14, "konut", "Kira", 22000, "Kira", a],
    [20, "esya", "Küçük ev aletleri", 3450, "Kahve makinesi", b],
    [24, "faturalar", "Su", 412.3, "", b],
    [33, "market", "Market alışverişi", 1240.8, "", a],
    [38, "tamir", "Usta / işçilik", 1500, "Musluk tamiri", a],
    [44, "konut", "Kira", 22000, "Kira", a],
    [50, "eglence", "Sinema / etkinlik", 600, "Sinema", b],
  ];
  return rows.map(([ago, categoryId, sub, amount, note, who], i) => ({
    id: "ornek" + i, date: d(ago), categoryId, sub, amount, note, who,
    whoEmail: members.find((m) => m.name === who).email, createdAt: Date.now() - ago * 864e5,
  }));
}
