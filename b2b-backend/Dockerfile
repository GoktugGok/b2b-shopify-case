FROM php:8.2-fpm-alpine

# -------------------------------------------------------
# 1. Sistem bağımlılıkları (derleme için *-dev dahil)
# -------------------------------------------------------
RUN apk add --no-cache \
    bash \
    curl \
    git \
    zip \
    unzip \
    nginx \
    supervisor \
    dos2unix \
    nodejs \
    npm \
    mysql-client \
    ca-certificates \
    # Runtime kütüphaneler
    libzip \
    libpng \
    libjpeg-turbo \
    freetype \
    oniguruma \
    icu-libs \
    # Derleme için header (dev) paketler
    zlib-dev \
    libzip-dev \
    libpng-dev \
    libjpeg-turbo-dev \
    freetype-dev \
    oniguruma-dev \
    icu-dev \
    g++ \
    make \
    autoconf

# -------------------------------------------------------
# 2. PHP extension'larını derle
# -------------------------------------------------------
RUN docker-php-ext-configure gd --with-freetype --with-jpeg \
    && docker-php-ext-install -j$(nproc) \
        pdo_mysql \
        mbstring \
        exif \
        pcntl \
        bcmath \
        gd \
        zip \
        intl \
        opcache

# Derleme araçlarını temizle (image boyutunu küçültmek için)
RUN apk del \
    zlib-dev \
    libzip-dev \
    libpng-dev \
    libjpeg-turbo-dev \
    freetype-dev \
    oniguruma-dev \
    icu-dev \
    g++ \
    make \
    autoconf \
    git

# -------------------------------------------------------
# 3. Composer
# -------------------------------------------------------
COPY --from=composer:2.7 /usr/bin/composer /usr/bin/composer

WORKDIR /var/www/html

# -------------------------------------------------------
# 4. PHP bağımlılıklarını yükle (cache layer için önce)
# -------------------------------------------------------
COPY composer.json composer.lock ./
RUN composer install --no-dev --optimize-autoloader --no-scripts --no-interaction

# -------------------------------------------------------
# 5. Uygulama dosyalarını kopyala
# -------------------------------------------------------
COPY . .

# Post-install scriptleri çalıştır
RUN composer run-script post-autoload-dump

# -------------------------------------------------------
# 6. Frontend asset'lerini derle
# -------------------------------------------------------
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts && npm run build

# -------------------------------------------------------
# 7. Konfigürasyon dosyalarını kopyala (CRLF -> LF)
# -------------------------------------------------------
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY docker/supervisord.conf /etc/supervisor/conf.d/supervisord.conf
COPY docker/php.ini /usr/local/etc/php/conf.d/custom.ini
COPY docker/entrypoint.sh /entrypoint.sh

# Windows CRLF -> Unix LF dönüşümü
RUN dos2unix /entrypoint.sh \
    && dos2unix /etc/nginx/nginx.conf \
    && dos2unix /etc/supervisor/conf.d/supervisord.conf \
    && chmod +x /entrypoint.sh

# -------------------------------------------------------
# 8. İzinler
# -------------------------------------------------------
RUN mkdir -p storage/logs storage/framework/{sessions,views,cache} bootstrap/cache \
    && chown -R www-data:www-data /var/www/html \
    && chmod -R 775 /var/www/html/storage \
    && chmod -R 775 /var/www/html/bootstrap/cache

# Render PORT = 8080
EXPOSE 8080

ENTRYPOINT ["/entrypoint.sh"]
