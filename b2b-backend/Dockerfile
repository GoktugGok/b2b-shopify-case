# ---- Build Stage ----
FROM php:8.2-fpm-alpine AS builder

# System dependencies
RUN apk add --no-cache \
    bash \
    curl \
    git \
    zip \
    unzip \
    libzip-dev \
    libpng-dev \
    libjpeg-turbo-dev \
    freetype-dev \
    oniguruma-dev \
    icu-dev \
    mysql-client \
    nodejs \
    npm

# PHP extensions
RUN docker-php-ext-configure gd --with-freetype --with-jpeg \
    && docker-php-ext-install \
        pdo_mysql \
        mbstring \
        exif \
        pcntl \
        bcmath \
        gd \
        zip \
        intl \
        opcache

# Install Composer
COPY --from=composer:2.7 /usr/bin/composer /usr/bin/composer

WORKDIR /var/www/html

# Copy composer files first for better layer caching
COPY composer.json composer.lock ./

# Install PHP dependencies (no dev)
RUN composer install --no-dev --optimize-autoloader --no-scripts --no-interaction

# Copy the rest of the application
COPY . .

# Run post-install scripts
RUN composer run-script post-autoload-dump

# Install npm dependencies and build assets
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts && npm run build

# ---- Production Stage ----
FROM php:8.2-fpm-alpine AS production

# Install runtime dependencies only
RUN apk add --no-cache \
    bash \
    curl \
    nginx \
    supervisor \
    libzip \
    libpng \
    libjpeg-turbo \
    freetype \
    oniguruma \
    icu-libs \
    mysql-client \
    dos2unix

# PHP extensions
RUN docker-php-ext-configure gd --with-freetype --with-jpeg \
    && docker-php-ext-install \
        pdo_mysql \
        mbstring \
        exif \
        pcntl \
        bcmath \
        gd \
        zip \
        intl \
        opcache

WORKDIR /var/www/html

# Copy built app from builder
COPY --from=builder /var/www/html /var/www/html

# Copy configuration files
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY docker/supervisord.conf /etc/supervisor/conf.d/supervisord.conf
COPY docker/php.ini /usr/local/etc/php/conf.d/custom.ini
COPY docker/entrypoint.sh /entrypoint.sh

# CRLF -> LF dönüşümü (Windows'ta oluşturulan dosyalar için)
RUN dos2unix /entrypoint.sh \
    && dos2unix /etc/nginx/nginx.conf \
    && dos2unix /etc/supervisor/conf.d/supervisord.conf \
    && chmod +x /entrypoint.sh

# Set proper permissions
RUN chown -R www-data:www-data /var/www/html \
    && chmod -R 755 /var/www/html/storage \
    && chmod -R 755 /var/www/html/bootstrap/cache

# Render uses PORT env variable
EXPOSE 8080

ENTRYPOINT ["/entrypoint.sh"]
