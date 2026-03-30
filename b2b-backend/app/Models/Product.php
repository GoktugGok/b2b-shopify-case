<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

class Product extends Model
{
    protected $fillable = [
        'sku',
        'name',
        'price',
        'stock',
        'is_on_shopify',
        'is_published',
        'b2b_price',
    ];

    protected $casts = [
        'is_on_shopify' => 'boolean',
        'is_published'  => 'boolean',
    ];

    /**
     * Model boot: Yeni ürün oluşturulurken SKU otomatik üretilir.
     * Format: SHP- + 8 haneli büyük harf/rakam karışımı (Örn: SHP-XVGLTZY1)
     */
    protected static function boot()
    {
        parent::boot();

        static::creating(function ($product) {
            if (empty($product->sku)) {
                $product->sku = static::generateUniqueSku();
            }
        });
    }

    /**
     * Benzersiz bir SKU kodu üretir.
     */
    protected static function generateUniqueSku(): string
    {
        do {
            $sku = 'SHP-' . strtoupper(Str::random(8));
        } while (static::where('sku', $sku)->exists());

        return $sku;
    }
}
