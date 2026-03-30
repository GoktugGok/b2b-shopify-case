# B2B SaaS Price & Inventory Orchestrator

## Özellikler
- **Shopify Functions (Discount API)**
- **Laravel Sync Engine**
- **Tag Based Pricing**
- **Real-time Inventory Logging**

## Teknik Stack
- **Frontend:** Remix
- **Backend:** Laravel
- **Veri / API:** GraphQL, Metafields

## Kurulum ve Çalıştırma

Projeyi yerel ortamınızda geliştirmek ve çalıştırmak için aşağıdaki adımları takip ediniz.

### 📦 Bağımlılıkların Kurulması

**Backend (Laravel)**
```bash
cd b2b-backend
composer install
npm install
```

**Frontend (Remix - Shopify App)**
```bash
cd b2b-saas-app
npm install
```

### 🚀 Uygulamayı Başlatma

Geliştirme ortamında çalışırken aşağıdaki komutları **3 farklı terminal penceresinde** aynı anda çalışır durumda bırakmalısınız:

**1. Terminal: Laravel Backend (API)**
```bash
cd b2b-backend
php artisan serve
```

**2. Terminal: Laravel Assets (Vite)**
```bash
cd b2b-backend
npm run dev
```

**3. Terminal: Shopify Remix Uygulaması**
```bash
cd b2b-saas-app
npm run dev
```
