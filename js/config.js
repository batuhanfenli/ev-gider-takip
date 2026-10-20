// Firebase konsolundaki "Web uygulaması" ayarlarından kopyalanan değerler.
// apiKey boş bırakılırsa uygulama "deneme modunda" çalışır: veriler yalnızca
// o cihazın tarayıcısında tutulur, senkronizasyon olmaz.
export const firebaseConfig = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: "",
};

// Uygulamayı kullanabilecek iki kişi. E-postalar Firebase Authentication'da
// açılan hesaplarla ve firestore.rules dosyasındaki listeyle aynı olmalı.
export const members = [
  { email: "batuhan@ornek.com", name: "Batuhan" },
  { email: "esim@ornek.com", name: "Eşim" },
];
