/**
 * B2B Global Script v5
 *
 * Düzeltmeler:
 *   - .b2b-processed guard: aynı karta asla iki kez müdahale edilmez
 *   - findProductCards() artık WeakSet ile DOM element seviyesinde duplicate'i önler
 *   - Selector listesi sadeleştirildi, en güvenilir olanlar kaldı
 */
(function () {
    'use strict';

    var STORAGE_KEY = 'b2b_customer_id';
    var REFRESHED_KEY = 'b2b_cart_refreshed';

    /* ── Yardımcılar ── */
    function fmt(num) {
        var n = parseFloat(String(num).replace(/[^0-9.\-]/g, ''));
        return isNaN(n) ? '0.00' : n.toFixed(2);
    }

    function extractHandle(href) {
        if (!href) return null;
        var m = href.match(/\/products\/([^?#\/]+)/);
        return m ? m[1] : null;
    }

    /* ================================================================
       SEPET YENİLEME
       ================================================================ */
    function refreshCart(cb) {
        fetch(window.Shopify.routes.root + 'cart/update.js', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ updates: {} })
        })
            .then(function () { cb && cb(); })
            .catch(function (e) { console.warn('[B2B] refreshCart:', e); });
    }

    /* ================================================================
       AUTH STATE
       ================================================================ */
    function handleAuthState() {
        var cfg = window.B2BConfig || {};
        var currentId = cfg.customerId ? String(cfg.customerId) : null;
        var prevId = localStorage.getItem(STORAGE_KEY);
        var refreshed = sessionStorage.getItem(REFRESHED_KEY);

        if (currentId) {
            if (prevId !== currentId) {
                localStorage.setItem(STORAGE_KEY, currentId);
                if (!refreshed) {
                    sessionStorage.setItem(REFRESHED_KEY, '1');
                    console.info('[B2B] Yeni giriş → sepet yenileniyor…');
                    refreshCart(function () { window.location.reload(); });
                }
            }
        } else {
            if (prevId) {
                localStorage.removeItem(STORAGE_KEY);
                sessionStorage.removeItem(REFRESHED_KEY);
                console.info('[B2B] Çıkış → sepet sıfırlanıyor…');
                refreshCart(function () { window.location.reload(); });
            }
        }
    }

    /* ================================================================
       KART TESPITI — DOM element seviyesinde deduplicate
       ================================================================ */
    function findProductCards() {
        var SELECTORS = [
            /* Dawn — card-wrapper ama product-recommendations container'ı DEĞİL */
            '.card-wrapper:not(product-recommendations)',
            /* Debut / classic */
            '.grid-product',
            /* Impulse / Broadcast */
            '.product-item:not(product-recommendations)',
            '.product-grid-item',
            /* Generic */
            '.product-card',
            '.product-block',
            '.collection-grid__item',
            '.products-grid > li',
        ];

        /* WeakSet ile aynı DOM elementinin iki kez eklenmesini önle */
        var seen = typeof WeakSet !== 'undefined' ? new WeakSet() : null;
        var results = [];

        SELECTORS.forEach(function (sel) {
            try {
                document.querySelectorAll(sel).forEach(function (el) {
                    /* product-recommendations custom element'ini ASLA kart olarak işleme */
                    if (el.tagName && el.tagName.toLowerCase() === 'product-recommendations') return;
                    if (seen) {
                        if (seen.has(el)) return;
                        seen.add(el);
                    }
                    results.push(el);
                });
            } catch (_) { }
        });

        /* ── OUTERMOST FILTER ─────────────────────────────────────────────
           Aynı ürün için li (dış) ve card-wrapper (iç) ikisi de bulunursa
           card-wrapper'ı at, sadece li bırak → tek inject garantisi.
        ───────────────────────────────────────────────────────────────── */
        return results.filter(function (el) {
            return !results.some(function (other) {
                return other !== el && other.contains(el);
            });
        });
    }

    /* ================================================================
       HANDLE ÇIKAR
       ================================================================ */
    function getHandle(card) {
        var h = card.getAttribute('data-product-handle') ||
            extractHandle(card.getAttribute('data-url'));
        if (h) return h;
        var link = card.querySelector('a[href*="/products/"]');
        return link ? extractHandle(link.getAttribute('href')) : null;
    }

    /* ================================================================
       ORJİNAL FİYATI ÜST ÇIZGILI YAP
       ================================================================ */
    var PRICE_SELECTORS = [
        '.price__regular .price-item--regular',
        '.price__regular',
        '.price-item--regular',
        '.product-item__price',
        '.grid-product__price',
        '.card__price .price',
        '.price .money',
        '.price',
    ];

    function strikePrice(card) {
        var el = null;
        for (var i = 0; i < PRICE_SELECTORS.length; i++) {
            var found = card.querySelector(PRICE_SELECTORS[i]);
            if (found &&
                found.className.indexOf('b2b') === -1 &&
                !found.closest('.b2b-price-block')) {
                el = found;
                break;
            }
        }
        if (!el) {
            /* Fallback: class'ında "price" geçen ama "b2b" geçmeyen küçük element */
            var all = card.querySelectorAll('*');
            for (var j = 0; j < all.length; j++) {
                var cn = all[j].className;
                if (typeof cn === 'string' &&
                    cn.toLowerCase().indexOf('price') !== -1 &&
                    cn.indexOf('b2b') === -1 &&
                    all[j].children.length <= 2) {
                    el = all[j];
                    break;
                }
            }
        }
        if (el) {
            el.style.setProperty('text-decoration', 'line-through', 'important');
            el.style.setProperty('opacity', '0.45', 'important');
            el.style.setProperty('font-size', '0.88em', 'important');
        }
        return el;
    }

    /* ================================================================
       B2B BLOK ENJEKTE ET
       ================================================================ */
    function inject(card, data) {
        /* ── DUPLIKASYON KONTROLU ─────────────────────────────────────────
           Dawn kartı:
             <li.grid__item>               ← selector 1
               <div.card-wrapper>          ← selector 2 (içinde hover alanı, fiyat yok)
               <div.card-information>      ← fiyat BURADA, card-wrapper DIŞINDA
    
           Sorun: li işlenince block card-information'a inject edilir.
                  Sonra card-wrapper işlenince card-wrapper.querySelector('.b2b-price-block')
                  card-information'a bakamaz (dışında) → ikinci inject yapar.
    
           Çözüm: Geçerli kartın li/article atasını da kontrol et.
        ────────────────────────────────────────────────────────────────── */
        var outerCard = (card.closest && card.closest('li, article')) || card;

        /* Kural 1: Geçerli kart VEYA li atası içinde zaten blok var mı? */
        if (card.querySelector('.b2b-price-block')) return;
        if (outerCard !== card && outerCard.querySelector('.b2b-price-block')) return;

        /* Kural 2: Aynı JS çağrısında zaten işlendi mi? */
        if (card.classList.contains('b2b-processed')) return;
        if (outerCard !== card && outerCard.classList.contains('b2b-processed')) return;

        /* Her ikisini de işaretле — sonraki kart denemeleri bloklanır */
        card.classList.add('b2b-processed');
        if (outerCard !== card) outerCard.classList.add('b2b-processed');

        var origEl = strikePrice(card);

        var block = document.createElement('div');
        block.className = 'b2b-price-block';

        /* Orijinal fiyat elementi zaten üstü çizili yapıldı →
           b2b-was span'ı EKLEME (çifte strikethrough önleme).
           Orijinal bulunamadıysa kendin göster. */
        if (!origEl) {
            var wasEl = document.createElement('span');
            wasEl.className = 'b2b-was';
            wasEl.textContent = data.sym + fmt(data.orig);
            block.appendChild(wasEl);
        }

        var nowEl = document.createElement('span');
        nowEl.className = 'b2b-now';
        nowEl.textContent = data.sym + fmt(data.b2b);
        block.appendChild(nowEl);

        /* origEl'in hemen arkasına ekle; yoksa fiyat wrapper'ına, o da yoksa karta */
        if (origEl && origEl.parentNode) {
            origEl.parentNode.insertBefore(block, origEl.nextSibling);
        } else {
            var wrap = card.querySelector(
                '.card-information__price, .price__container, .grid-product__price-wrap, .price'
            );
            (wrap || card).appendChild(block);
        }
    }

    /* ================================================================
       ANA FONKSİYON
       ================================================================ */
    function applyB2BPrices() {
        var prices = window.B2BPrices || {};
        var cfg = window.B2BConfig || {};

        if (!cfg.isB2B) return;

        var keys = Object.keys(prices);
        if (!keys.length) {
            console.info('[B2B] B2BPrices map boş — bu sayfa için Liquid verisi yok.');
            return;
        }

        var cards = findProductCards();
        var injected = 0;
        var skipped = 0;

        cards.forEach(function (card) {
            if (card.classList.contains('b2b-processed')) { skipped++; return; }
            var handle = getHandle(card);
            if (!handle) return;
            var data = prices[handle];
            if (!data || !data.b2b) return;
            inject(card, data);
            injected++;
        });

        console.info(
            '[B2B] Enjeksiyon: ' + injected + ' kart işlendi, ' +
            skipped + ' kart atlandı (zaten işlenmişti). Toplam kart: ' + cards.length
        );

        /* Hala çifte blok varsa (farklı DOM bölgelerine inject olduysa) temizle */
        cleanupDuplicates();
    }

    /* ================================================================
       SEPET (CART) SAYFASI — Fiyat Enjektörü
       ================================================================ */
    function applyCartPrices() {
        var prices = window.B2BPrices || {};
        var cfg = window.B2BConfig || {};

        if (!cfg.isB2B) return;

        /* Dawn ve çoğu tema için sepet satırı selectorları */
        var CART_ITEM_SELECTORS = [
            '.cart-item',
            '.cart-row',
            '.cart__item',
            '[data-cart-item-id]'
        ];

        CART_ITEM_SELECTORS.forEach(function (sel) {
            document.querySelectorAll(sel).forEach(function (item) {
                if (item.classList.contains('b2b-processed')) return;

                var handle = getHandle(item);
                if (!handle) return;

                var data = prices[handle];
                if (!data || !data.b2b) return;

                /* Sepetteki ana fiyat elementini bul (item.querySelector ile) */
                var priceEl = item.querySelector('.cart-item__price-wrapper, .cart-item__line-price, .price, [class*="price"]');
                if (priceEl && !priceEl.querySelector('.b2b-price-block')) {
                    /* Mevcut fiyatı gizle */
                    var nestedPrice = priceEl.querySelector('.price-item, .money, [class*="price"]');
                    if (nestedPrice) {
                        nestedPrice.style.setProperty('text-decoration', 'line-through', 'important');
                        nestedPrice.style.setProperty('opacity', '0.45', 'important');
                    }

                    /* B2B Bloku oluştur ve ekle */
                    var block = document.createElement('div');
                    block.className = 'b2b-price-block';

                    var nowEl = document.createElement('span');
                    nowEl.className = 'b2b-now';
                    nowEl.style.fontSize = '1.1em';
                    nowEl.textContent = data.sym + fmt(data.b2b);

                    block.appendChild(nowEl);
                    priceEl.appendChild(block);
                    item.classList.add('b2b-processed');
                }
            });
        });
    }

    /* ================================================================
       DUPLICATE CLEANUP — Başlıktan ÖNCE gelen blokları kaldır
       Dawn: .card-wrapper (hover) + .card-information (görünür) ayrı bölgeler.
       İkiye inject olursa başlık (h3) öncesindeki = hover alanındaki → SİL
       ================================================================ */
    function cleanupDuplicates() {
        /* Tüm sayfadaki B2B bloklarını tara */
        var allBlocks = document.querySelectorAll('.b2b-price-block');

        allBlocks.forEach(function (block) {
            /* Bu bloğun kart container'ını bul */
            var container = block.closest('li, article, .card-wrapper');
            if (!container) return;

            /* Container içindeki ürün başlığını bul */
            var heading = container.querySelector('h1, h2, h3, h4');
            if (!heading) return;

            /* Başlık bloktan SONRA mı geliyor? (blok başlıktan önce = hover alanı = sil) */
            /* compareDocumentPosition: DOCUMENT_POSITION_FOLLOWING = 4 */
            var pos = block.compareDocumentPosition(heading);
            var headingIsAfterBlock = !!(pos & 4); /* 4 = Node.DOCUMENT_POSITION_FOLLOWING */

            if (headingIsAfterBlock) {
                /* Bu blok başlıktan ÖNCE → görünmeyen hover alanında → SİL */
                var prevSibling = block.previousElementSibling;
                if (prevSibling && prevSibling.style) {
                    prevSibling.style.removeProperty('text-decoration');
                    prevSibling.style.removeProperty('opacity');
                    prevSibling.style.removeProperty('font-size');
                }
                block.parentNode.removeChild(block);
            }
        });
    }

    /* ================================================================
       ÜRÜN DETAY SAYFASI — Yedek Injector
       b2b_price_display.liquid block'u template'e eklenmemişse
       veya yanlış konumdaysa bu fonksiyon JS tarafından inject eder.
       ================================================================ */
    function injectDetailPagePrice() {
        var cfg = window.B2BConfig || {};
        var prices = window.B2BPrices || {};

        if (!cfg.isB2B || !cfg.productHandle) return;

        var data = prices[cfg.productHandle];
        if (!data || !data.b2b) return;

        /* 1. Ürün detay sayfasındaki ANA fiyat elementini bul */
        var DETAIL_PRICE_SELECTORS = [
            '[id^="price-"]',                         /* Dawn: Dinamik fiyat ID'si (en garantisi) */
            '.product__info-container .price',        /* Dawn: Ana fiyat containerı */
            '.product__info-wrapper .price',          /* Dawn alternatif */
            '.product-single__info-wrapper .price',   /* Diğer temalar */
            '.product-form__price',                   /* Standart */
            '.product__price',                        /* Standart */
            '.price--large'                           /* Dawn spesifik */
        ];

        var priceEl = null;
        for (var i = 0; i < DETAIL_PRICE_SELECTORS.length; i++) {
            var els = document.querySelectorAll(DETAIL_PRICE_SELECTORS[i]);
            for (var j = 0; j < els.length; j++) {
                /* Bulduğumuz element bizim B2B bloklarımızın içinde OLMAMALI */
                if (els[j] && !els[j].closest('.b2b-detail-price') && !els[j].closest('.b2b-price-block')) {
                    priceEl = els[j];
                    break;
                }
            }
            if (priceEl) break;
        }

        /* 2. Orijinal Shopify fiyatını GİZLE (display: none) */
        if (priceEl) {
            priceEl.style.setProperty('display', 'none', 'important');
        }

        /* 3. Liquid block (.b2b-detail-price) zaten var mı? 
           Tema editöründen manuel olarak eklenmiş olabilir. */
        var liquidBlockExists = document.querySelector('.b2b-detail-price');
        if (liquidBlockExists) {
            console.info('[B2B] Liquid block mevcut, JS inject atlandı — orijinal fiyat gizlendi.');
            return;
        }

        /* 4. Zaten JS ile inject edildiyse tekrar etme */
        if (document.querySelector('.b2b-detail-injected')) return;

        /* 5. Liquid block yoksa, JS rozetini inject et */
        var badge = document.createElement('div');
        badge.className = 'b2b-detail-injected b2b-detail-price';

        var wasEl = document.createElement('span');
        wasEl.className = 'b2b-was-detail';
        wasEl.textContent = data.sym + fmt(data.orig);

        /* Yeni satır: Fiyat ve Pill yanyana */
        var row = document.createElement('div');
        row.className = 'b2b-price-row';

        var nowEl = document.createElement('span');
        nowEl.className = 'b2b-now-detail';
        nowEl.textContent = data.sym + fmt(data.b2b);

        var pill = document.createElement('span');
        pill.className = 'b2b-tag-pill';
        pill.textContent = 'B2B';

        row.appendChild(nowEl);
        row.appendChild(pill);

        badge.appendChild(wasEl);
        badge.appendChild(row);

        if (priceEl && priceEl.parentNode) {
            priceEl.parentNode.insertBefore(badge, priceEl.nextSibling);
        } else {
            /* Fallback: sepete ekle butonu üstüne inject et */
            var form = document.querySelector('form[action*="/cart/add"]');
            if (form) form.parentNode.insertBefore(badge, form);
        }

        console.info('[B2B] Detay fiyat inject edildi: ' + cfg.productHandle + ' → ' + data.sym + fmt(data.b2b));

        /* Blok eklendikten sonra standart fiyat bloğunu kesin olarak temizle */
        hideStandardPriceBlock();
    }

    /* ================================================================
       NUCLEAR HIDE — Standart Fiyat Bloğunu Kardeşlik Mantığıyla Gizle
       ================================================================ */
    function hideStandardPriceBlock() {
        var b2b = document.querySelector('.b2b-detail-price');
        if (!b2b) return;

        /* 1. Direk önceki elemente bak (Kardeş elementi) */
        var prev = b2b.previousElementSibling;
        if (prev && (prev.textContent.indexOf('$') !== -1 || prev.innerHTML.indexOf('price') !== -1)) {
            prev.style.setProperty('display', 'none', 'important');
        }

        /* 2. Eğer bloklar sarmalayıcı (wrapper) içindeyse bir üst seviyeye bak */
        var b2bParent = b2b.parentElement;
        if (b2bParent && (b2bParent.children.length <= 2 || b2bParent.className.indexOf('block') !== -1)) {
            var wrapPrev = b2bParent.previousElementSibling;
            if (wrapPrev && (wrapPrev.textContent.indexOf('$') !== -1 || wrapPrev.innerHTML.indexOf('price') !== -1)) {
                wrapPrev.style.setProperty('display', 'none', 'important');
            }
        }
    }

    /* ================================================================
       GELIŞTIRILMIŞ REFRESH — Shopify Motorunu Re-run Etmeye Zorlar
       ================================================================ */
    function refreshCart(cb) {
        /* Standard update.js bazen cache'e takılabilir. 
           En garantisi bir line item'ı 'change' yöntemiyle "touch" etmek. */
        fetch(window.Shopify.routes.root + 'cart.js?v=' + Date.now())
            .then(function (res) { return res.json(); })
            .then(function (cart) {
                if (cart.items && cart.items.length > 0) {
                    var first = cart.items[0];
                    return fetch(window.Shopify.routes.root + 'cart/change.js', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id: String(first.key), quantity: first.quantity })
                    });
                }
                return fetch(window.Shopify.routes.root + 'cart/update.js', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ updates: {} })
                });
            })
            .then(function () { if (cb) cb(); })
            .catch(function () { if (cb) cb(); });
    }

    /* ================================================================
       CART SYNC — Backend (Map) ile Sepet Tutarlılığını Sağla
       ================================================================ */
    function syncCartWithB2BMap() {
        var cfg = window.B2BConfig || {};
        if (!cfg.isB2B) return;

        /* Anti-loop: 10 saniyede en fazla 1 kez sepet senkronizasyonuna izin ver (Hız dengesi) */
        var SYNC_DONE_KEY = 'b2b_last_sync_ts';
        var lastSync = parseInt(sessionStorage.getItem(SYNC_DONE_KEY) || '0');
        if (Date.now() - lastSync < 10000) return;

        /* Cache buster ile Shopify'ın en taze sepet verisini çek (v=Date.now) */
        fetch(window.Shopify.routes.root + 'cart.js?v=' + Date.now())
            .then(function (res) { return res.json(); })
            .then(function (cart) {
                if (!cart.items || cart.items.length === 0) return;

                var needsRefresh = false;

                cart.items.forEach(function (item) {
                    /* Liquid tarafında sayfa yüklenirken derlediğimiz gerçek veriyi alıyoruz */
                    var freshB2BPrice = (cfg.freshCartMap && cfg.freshCartMap[String(item.variant_id)]) || null;

                    /* Şuan sepette B2B-X benzeri bir indirim uygulanmış mı? */
                    var currentB2BDiscount = null;
                    if (item.line_level_discount_allocations) {
                        currentB2BDiscount = item.line_level_discount_allocations.find(function (d) {
                            var app = d.discount_application || {};
                            var str = (app.title || '') + (app.key || '') + (app.description || '');
                            return /B2B/i.test(str);
                        });
                    }

                    /* 
                       DURUM 1: İndirim var ama backend (metafield) artık VERİSİZ -> TEMİZLE/YENİLE
                    */
                    if (currentB2BDiscount && (freshB2BPrice === null)) {
                        console.info('[B2B] Fiyat silindiği için eski indirim kalkıyor: ' + (item.handle || item.variant_id));
                        needsRefresh = true;
                    }
                    /* 
                       DURUM 2: Haritada bu varyanta B2B fiyatı var ama sepete yansımamışsa -> SENKRONİZE ET
                    */
                    else if (!currentB2BDiscount && (freshB2BPrice !== null)) {
                        console.info('[B2B] İndirim eksik olduğu için sepet senkronize ediliyor: ' + (item.handle || item.variant_id));
                        needsRefresh = true;
                    }
                    /*
                       DURUM 3: Hem indirim var hem backend verisi var ama FİYAT TUTMUYOR (Change Scenario)
                    */
                    else if (currentB2BDiscount && freshB2BPrice !== null) {
                        var targetCents = Math.round(parseFloat(freshB2BPrice) * 100);
                        if (Math.abs(item.final_price - targetCents) > 1) {
                            console.info('[B2B] Fiyat değişmiş, sepet güncelleniyor: ' + (item.handle || item.variant_id));
                            needsRefresh = true;
                        }
                    }
                });

                if (needsRefresh) {
                    sessionStorage.setItem(SYNC_DONE_KEY, Date.now().toString());
                    console.info('[B2B] Sepet tutarsızlığı algılandı, Shopify motoru tetikleniyor...');
                    refreshCart(function () {
                        console.info('[B2B] Sepet senkronize edildi, sayfa yenileniyor...');
                        window.location.reload();
                    });
                }
            })
            .catch(function (e) { console.error('[B2B] Sync Error:', e); });
    }

    /* ================================================================
       BAŞLATMA + MutationObserver (AJAX yüklemeler için)
       ================================================================ */
    function init() {
        handleAuthState();

        if (!(window.B2BConfig || {}).isB2B) return;

        syncCartWithB2BMap();
        applyB2BPrices();
        applyCartPrices();
        injectDetailPagePrice();
        hideStandardPriceBlock();

        /* Dawn'ın product-recommendations elementi yüklenince tekrar çalıştır */
        document.addEventListener('recommendations:loaded', function () {
            var recoSection = document.querySelector('product-recommendations');
            if (recoSection) {
                recoSection.querySelectorAll('.b2b-processed').forEach(function (el) {
                    el.classList.remove('b2b-processed');
                });
            }
            setTimeout(function () {
                applyB2BPrices();
                injectDetailPagePrice();
            }, 150);
        });

        /* AJAX/SPA: yeni kartlar DOM'a eklendiğinde tekrar çalıştır */
        if (window.MutationObserver) {
            var timer = null;
            var observer = new MutationObserver(function (mutations) {
                /* Recommendations section'a ekleme oldu mu? */
                var recoChanged = false;
                mutations.forEach(function (m) {
                    if (!recoChanged && m.target &&
                        m.target.closest && m.target.closest('product-recommendations')) {
                        recoChanged = true;
                    }
                });

                clearTimeout(timer);
                /* 
                   KRITIK FIX: Herhangi bir DOM değişikliğinde injectDetailPagePrice'ı da çağır.
                   Dawn teması varyant değiştikçe fiyat elementini SİLİP YENİDEN OLUŞTURUR.
                   Bu yüzden sürekli takip edip gizlememiz gerekiyor.
                */
                timer = setTimeout(function () {
                    applyB2BPrices();
                    applyCartPrices();
                    injectDetailPagePrice();
                    hideStandardPriceBlock();
                }, recoChanged ? 600 : 400);
            });
            observer.observe(document.body, { childList: true, subtree: true });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
