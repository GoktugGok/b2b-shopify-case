<?php

namespace Database\Seeders;

use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;

use App\Models\Product;
use Illuminate\Support\Str;

class ProductSeeder extends Seeder
{
    /**
     * Run the database seeds.
     */
    public function run(): void
    {
        // 15 products on Shopify
        for ($i = 1; $i <= 15; $i++) {
            Product::create([
                'sku' => 'SHP-' . Str::upper(Str::random(8)),
                'name' => 'Shopify Product ' . $i,
                'price' => rand(100, 1000) / 10,
                'stock' => rand(10, 100),
                'is_on_shopify' => true,
            ]);
        }

        // 10 products not on Shopify
        for ($i = 1; $i <= 10; $i++) {
            Product::create([
                'sku' => 'B2B-' . Str::upper(Str::random(8)),
                'name' => 'B2B Only Product ' . $i,
                'price' => rand(100, 1000) / 10,
                'stock' => rand(0, 50),
                'is_on_shopify' => false,
            ]);
        }
    }
}
