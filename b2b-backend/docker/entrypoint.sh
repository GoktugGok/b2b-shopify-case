#!/bin/bash
set -e

echo "🚀 Starting B2B Backend..."

# Storage dizinlerini oluştur
mkdir -p /var/www/html/storage/logs
mkdir -p /var/www/html/storage/framework/{sessions,views,cache}
mkdir -p /var/www/html/bootstrap/cache

# İzinleri ayarla
chown -R www-data:www-data /var/www/html/storage /var/www/html/bootstrap/cache
chmod -R 775 /var/www/html/storage /var/www/html/bootstrap/cache

# ÖNEMLİ: .env KOPYALAMA - Render ortam değişkenlerini kullanır
# config:cache yerine config:clear kullanıyoruz ki sistem env vars okunabilsin
echo "📦 Config cache temizleniyor..."
php artisan config:clear
php artisan cache:clear
php artisan route:clear
php artisan view:clear

echo "🗄️  Migrationlar çalıştırılıyor..."
php artisan migrate --force

# Supervisor dizinini oluştur
mkdir -p /var/log/supervisor
mkdir -p /var/run

echo "✅ Hazır! Supervisor başlatılıyor..."
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
