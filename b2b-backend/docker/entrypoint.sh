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

# .env dosyası yoksa .env.example'dan kopyala
if [ ! -f /var/www/html/.env ]; then
    echo "⚠️  .env dosyası bulunamadı, .env.example kopyalanıyor..."
    cp /var/www/html/.env.example /var/www/html/.env
fi

# APP_KEY yoksa oluştur
if [ -z "$APP_KEY" ]; then
    echo "🔑 APP_KEY üretiliyor..."
    php artisan key:generate --force
fi

echo "📦 Config cache temizleniyor..."
php artisan config:clear

echo "⚡ Cache derleniyor..."
php artisan config:cache
php artisan route:cache
php artisan view:cache

echo "🗄️  Migrationlar çalıştırılıyor..."
php artisan migrate --force

# Supervisor dizinini oluştur
mkdir -p /var/log/supervisor
mkdir -p /var/run

echo "✅ Hazır! Supervisor başlatılıyor..."
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
