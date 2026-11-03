# Oracle Gateway CLI

Kurumsal standartlara uygun, modern ve modüler bir Node.js tabanlı CLI (Komut Satırı Arayüzü) uygulaması.

---

## 📌 Özellikler

- **Modern Mimari**: Node.js ES Modules (ESM) altyapısı (`"type": "module"`).
- **Gelişmiş CLI Çerçevesi**: [Commander.js](https://github.com/tj/commander.js) ile komut, opsiyon ve otomatik `--help` yönetimi.
- **Güvenli Konfigürasyon**: `.env` ve `.env.example` ile ortam değişkenleri yönetimi ve hassas veri maskeleme.
- **Renkli & Yapılandırılmış Loglama**: [Chalk](https://github.com/chalk/chalk) ile terminal loglama desteği.
- **Sıfır Ek Bağımlılıklı Test**: Node.js yerleşik test çalıştırıcısı (`node --test`).
- **Kod Standartları**: [Prettier](https://prettier.io/) ve `.editorconfig` ile endüstri standartlarında kod biçimlendirme.

---

## 🚀 Gereksinimler

- **Node.js**: `v18.0.0` veya üzeri (Önerilen: v20+)
- **npm**: `v9.0.0` veya üzeri

---

## 📦 Kurulum

1. Depoyu klonlayın (veya proje dizinine geçin):

   ```bash
   cd c:\dev\oracle-gateway
   ```

2. Bağımlılıkları yükleyin:

   ```bash
   npm install
   ```

3. Çevre değişkenlerini yapılandırın:

   ```bash
   cp .env.example .env
   # Windows PowerShell için:
   # Copy-Item .env.example .env
   ```

4. CLI komutunu global olarak test etmek için yerel link oluşturun (opsiyonel):
   ```bash
   npm link
   ```

---

## 🛠️ Kullanım

CLI'yı çalıştırmak için `npm start`, doğrudan `node ./bin/oracle-gateway.js` veya linklendikten sonra `oracle-gateway` komutu kullanılabilir:

```bash
# Yardım menüsünü görüntüleme
node ./bin/oracle-gateway.js --help

# Sürüm bilgisi alma
node ./bin/oracle-gateway.js -v

# Sistem ve ağ geçidi durumunu sorgulama
node ./bin/oracle-gateway.js status

# Aktif konfigürasyonu listeleme (maskelenmiş)
node ./bin/oracle-gateway.js config
```

`npm link` yapıldıysa doğrudan terminalden:

```bash
oracle-gateway --help
oracle-gateway status
```

---

## ⚙️ Ortam Değişkenleri (.env)

| Değişken                | Açıklama                                             | Varsayılan Değer        |
| ----------------------- | ---------------------------------------------------- | ----------------------- |
| `NODE_ENV`              | Çalışma ortamı (`development`, `production`, `test`) | `development`           |
| `LOG_LEVEL`             | Log seviyesi (`info`, `debug`, `warn`, `error`)      | `info`                  |
| `GATEWAY_HOST`          | Gateway hedef ana makine adresi                      | `localhost`             |
| `GATEWAY_PORT`          | Gateway hedef bağlantı noktası                       | `8080`                  |
| `GATEWAY_TIMEOUT_MS`    | İstek zaman aşımı süresi (ms)                        | `5000`                  |
| `API_KEY`               | Ağ geçidi yetkilendirme anahtarı                     | -                       |
| `ORACLE_CONNECT_STRING` | Oracle servis/veritabanı bağlantı dizesi             | `localhost:1521/XEPDB1` |
| `ORACLE_USER`           | Oracle kullanıcı adı                                 | `admin`                 |
| `ORACLE_PASSWORD`       | Oracle kullanıcı parolası                            | -                       |

---

## 🧪 Geliştirme Scriptleri

| Komut            | Açıklama                                                              |
| ---------------- | --------------------------------------------------------------------- |
| `npm start`      | CLI uygulamasını çalıştırır                                           |
| `npm run dev`    | `--watch` bayrağı ile dosyaları izleyerek CLI uygulamasını çalıştırır |
| `npm test`       | Node.js yerleşik test paketini çalıştırır (`node --test`)             |
| `npm run lint`   | Prettier ile kod formatlama kontrolü yapar                            |
| `npm run format` | Kod tabanını Prettier ile otomatik biçimlendirir                      |

---

## 📂 Proje Dizin Yapısı

```text
oracle-gateway/
├── bin/
│   └── oracle-gateway.js    # CLI çalıştırılabilir giriş noktası (#/usr/bin/env node)
├── src/
│   ├── cli.js               # Commander CLI tanımı ve komut işleyicileri
│   ├── config.js            # Ortam değişkenleri ve konfigürasyon yöneticisi
│   ├── index.js             # Kütüphane ana dışa aktarım (export) noktası
│   └── utils/
│       └── logger.js        # Konsol loglama aracı
├── test/
│   └── cli.test.js          # CLI birim ve entegrasyon testleri
├── .editorconfig            # Kod editör standartları
├── .env.example             # Örnek çevre değişkenleri şablonu
├── .gitignore               # Git göz ardı listesi
├── .prettierrc              # Prettier biçimlendirme kuralları
├── package.json             # Bağımlılıklar, scriptler ve metadata
└── README.md                # Proje dokümantasyonu
```

---

## 📄 Lisans

Bu proje **UNLICENSED** (Özel / Gizli mülkiyet) olarak ayarlanmıştır. İzinsiz kopyalanamaz veya dağıtılamaz.
