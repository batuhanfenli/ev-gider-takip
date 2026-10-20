// Firebase konsolundaki "Web uygulaması" ayarlarından kopyalanan değerler.
// apiKey boş bırakılırsa uygulama "deneme modunda" çalışır: veriler yalnızca
// o cihazın tarayıcısında tutulur, senkronizasyon olmaz.
export const firebaseConfig = {
  apiKey: "AIzaSyAtXRzX7YYFrkGiQM992W34NlusN7f0t3Y",
  authDomain: "ev-gider-takip.firebaseapp.com",
  projectId: "ev-gider-takip",
  storageBucket: "ev-gider-takip.firebasestorage.app",
  messagingSenderId: "136622237258",
  appId: "1:136622237258:web:ecd319693af870a218e8b3",
};

// Uygulamayı kullanabilecek iki kişi. E-postalar Firebase Authentication'da
// açılan hesaplarla ve firestore.rules dosyasındaki listeyle aynı olmalı.
export const members = [
  { email: "batuhanfenli@gmail.com", name: "Batuhan" },
  { email: "yondendirim@gmail.com", name: "Dirim" },
];
