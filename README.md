# Casus Kim 🕵️

Gerçek zamanlı, çok oyunculu "Casus Kim" (Spyfall tarzı) parti oyunu. Node.js + Express + Socket.io ile yazıldı, telefon tarayıcısından oynanır, ek bir uygulama kurulumu gerekmez.

## Nasıl çalışır?

1. Bir kişi "Yeni Oyun Kur" der, 5 haneli bir **lobi kodu** oluşur.
2. Diğerleri "Kodla Katıl" diyerek bu kodu girer, aynı lobiye katılır.
3. Host (lobiyi kuran kişi) kategorileri seçer: **Oyun, Film, Dizi, Ünlüler, Meslekler, Klasik Mekanlar**.
4. "Oyunu Başlat" denince:
   - Sistem gizlice bir **casus** seçer.
   - Casus olmayan herkese seçilen kategoriden rastgele bir **evren** (örn. "Harry Potter") gösterilir.
   - Casusa ise gerçek evrenin de içinde bulunduğu, aynı kategoriden **10 olası evren** listesi gösterilir.
5. **5 dakikalık** bir geri sayım başlar. Oyuncular gerçek hayatta birbirine sorular sorarak casusu bulmaya çalışır.
6. Bu süre içinde:
   - **Casus** her an "Evreni Tahmin Ettim" diyip 10 seçenekten birini işaretleyebilir. Doğruysa **anında casus kazanır**, yanlışsa **anında kaybeder**.
   - **Herhangi bir oyuncu** "Casusu Oyla" butonuna basarak oylamayı başlatabilir (süre bitmeden de olur). Süre dolarsa oylama otomatik başlar.
7. Oylamada herkes şüphelendiği kişiyi seçer. En çok oy alan kişi casus ise **siviller kazanır**, değilse (ya da oylar dağılıp berabere kalırsa) **casus kazanır**.
8. Host "Yeni Tur" ile aynı lobide tekrar oynatabilir.

## Kurulum ve çalıştırma

```bash
npm install
npm start
```

Sunucu varsayılan olarak `http://localhost:3000` adresinde çalışır.

### Telefonlardan test etmek için

Aynı wifi ağındaki telefonlardan erişmek için bilgisayarınızın yerel IP adresini kullanın, örn: `http://192.168.1.23:3000`.

Farklı ağlardaki (evler, mobil veri) arkadaşlarınızla oynamak için ücretsiz bir tünel servisi kullanabilirsiniz, örn:

```bash
npx localtunnel --port 3000
```

veya [ngrok](https://ngrok.com/) ile:

```bash
ngrok http 3000
```

### Gerçek sunucuya (internete) yayınlama

Bu proje herhangi bir Node.js barındırma servisinde (Render, Railway, Fly.io, bir VPS, vb.) doğrudan çalışır:

- **Render.com**: Yeni "Web Service" oluştur, bu klasörü bağla, build command `npm install`, start command `npm start`.
- **Railway.app**: Yeni proje, GitHub reposunu bağla, otomatik algılar.
- **VPS**: `npm install && npm start`, öndeki bir Nginx ile ters proxy + PM2 ile ayakta tutabilirsiniz. Socket.io websocket kullandığı için Nginx `proxy_set_header Upgrade`/`Connection` ayarlarının doğru olduğundan emin olun.

## Proje yapısı

```
casus-kim/
├── server.js           # Express + Socket.io sunucusu, tüm oyun mantığı
├── data/
│   └── categories.js   # Kategoriler ve evren (universe) listeleri
├── public/
│   ├── index.html       # Tüm ekranlar (giriş, lobi, oyun, oylama, sonuç)
│   ├── style.css         # Mobil öncelikli, koyu tema
│   └── client.js         # Ekran akışı ve socket olayları
└── package.json
```

## Kategori listesini genişletmek

`data/categories.js` dosyasındaki `universes` dizilerine yeni maddeler eklemeniz yeterli — sunucu otomatik olarak yeniden başlatıldığında yeni listeyi kullanır. Yeni bir kategori eklemek için aynı dosyaya yeni bir `key: { label, emoji, universes }` girişi eklemeniz yeterli, arayüz otomatik olarak listeler.

## Notlar / olası geliştirmeler

- Oyun durumu şu an bellekte (in-memory) tutuluyor; sunucu yeniden başlarsa aktif lobiler silinir. Küçük arkadaş grupları için sorun değil.
- İsteğe bağlı geliştirmeler: skor/puan tablosu, oda başına özel evren listesi ekleme arayüzü, sesli/haptik geri sayım uyarısı, yeniden bağlanma (reconnect) desteği için oyuncu token'ı.
