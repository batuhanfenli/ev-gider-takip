# Ev Giderleri – Kurulum

Uygulama bir web uygulamasıdır (PWA). İnternetten açılır, sonra her cihaza "uygulama olarak yükle" ile simge olarak kurulur. Veriler Firebase'te tutulur ve tüm cihazlarda anında güncellenir.

## 1. Firebase projesi (bir kez, ~10 dakika)

1. https://console.firebase.google.com adresinde **Proje ekle**. Google Analytics'i kapatabilirsin.
2. **Build → Authentication → Get started → Email/Password**'ü aç.
   **Users** sekmesinden iki kullanıcı ekle: senin ve eşinin e-postası ile birer şifre.
3. **Build → Firestore Database → Create database**. Konum olarak `europe-west` (ör. `eur3`) seç, **production mode** ile başlat.
   **Rules** sekmesine `firestore.rules` dosyasının içeriğini yapıştır, iki e-postayı kendi e-postalarınızla değiştir, **Publish**.
4. **Project settings (dişli) → General → Your apps → Web (</>)** ile bir web uygulaması ekle. Çıkan `firebaseConfig` değerlerini kopyala.

Ücretsiz plan (Spark) iki kişilik ev kullanımı için fazlasıyla yeterli; kredi kartı gerekmez.

## 2. Ayarları uygulamaya yazmak

`js/config.js` içinde:
- `firebaseConfig` alanlarını 4. adımda kopyaladığın değerlerle doldur (bu değerler gizli değildir, güvenliği kurallar sağlar).
- `members` listesindeki e-postaları ve isimleri kendinize göre düzelt (Authentication'da açtığın e-postalarla aynı olmalı).

`firebaseConfig.apiKey` boş kaldığı sürece uygulama **deneme modunda** çalışır: örnek verilerle açılır, veriler yalnızca o cihazda kalır.

## 3. Yayınlamak (GitHub Pages)

1. GitHub'da boş bir depo aç (ör. `ev-giderleri`) ve bu klasördeki dosyaları yükle.
2. Depoda **Settings → Pages → Build and deployment → Deploy from a branch → main / (root)**.
3. Birkaç dakika sonra adres hazır olur: `https://KULLANICI.github.io/ev-giderleri/`

## 4. Cihazlara yüklemek

- **iPhone:** Safari ile adresi aç → Paylaş → **Ana Ekrana Ekle**.
- **Android telefon / tablet:** Chrome ile aç → menü → **Uygulamayı yükle**.
- **Windows (ofis ve ev bilgisayarları):** Chrome veya Edge ile aç → adres çubuğundaki **yükle** simgesi. Başlat menüsüne ve masaüstüne normal bir uygulama gibi eklenir.

Her cihazda bir kez kendi e-postanla giriş yaparsın, sonra oturum açık kalır.

## 5. Fiş okuma (isteğe bağlı)

1. https://console.anthropic.com adresinde hesap aç, **Billing**'den az bir bakiye yükle (ör. 5 $).
2. **API Keys → Create Key** ile anahtar oluştur.
3. Uygulamada **Ayarlar → Fiş okuma** alanına yapıştır. Anahtar buluta kaydedilir, ikiniz de kullanırsınız.

Fiş başına maliyet yaklaşık 1–2 TL'dir (Claude Opus 5.5, düşük düşünme seviyesi).

## Dosyalar

| Dosya | Ne işe yarar |
|---|---|
| `index.html`, `css/styles.css` | Sayfa ve görünüm |
| `js/app.js` | Özet, Harcamalar, Ayarlar sayfaları, ekleme ve fiş ekranları |
| `js/store.js` | Firebase bağlantısı ve deneme modu |
| `js/categories.js` | Varsayılan 14 kategori ve alt kategoriler |
| `js/receipt.js` | Fiş fotoğrafını Claude'a okutma |
| `js/config.js` | Firebase ayarları ve iki kullanıcı |
| `firestore.rules` | Veritabanına yalnızca iki kişinin erişmesini sağlayan kurallar |
| `sw.js`, `manifest.webmanifest`, `icons/` | Yüklenebilir uygulama ve çevrimdışı açılış |
