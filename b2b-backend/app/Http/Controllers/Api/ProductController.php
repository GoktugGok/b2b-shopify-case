<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;

use App\Models\Product;
use Illuminate\Http\JsonResponse;

class ProductController extends Controller
{
    /**
     * Display a listing of products for Shopify integration.
     */
    public function index(Request $request): JsonResponse
    {
        $query = Product::query()
            ->select('sku', 'name', 'price', 'stock', 'is_published', 'is_on_shopify', 'b2b_price', 'updated_at');

        // Adım 1: Incremental mantığı. 
        if ($request->boolean('incremental') || $request->query('incremental') === 'true') {
            // Eğer Remix bize en son senkronizasyon tarihini yolladıysa gerçek aralığı kontrol et
            if ($request->has('last_sync')) {
                $lastSync = $request->query('last_sync');
                $query->where('updated_at', '>', \Carbon\Carbon::parse($lastSync));
            } else {
                // Hiç log bulunamazsa (fallback) son 24 saati al
                $query->where('updated_at', '>=', now()->subHours(24));
            }
        }

        $products = $query->get()->map(function ($product) {
            $data = [
                'sku'          => $product->sku,
                'name'         => $product->name,
                'price'        => $product->price,
                'b2b_price'    => !is_null($product->b2b_price) ? number_format((float)$product->b2b_price, 2, '.', '') : null,
                'stock'        => $product->stock,
                'is_published' => $product->is_published,
                'is_on_shopify'=> $product->is_on_shopify,
            ];

            // Adım 2: Shopify Metafield Formatı
            $data['metafields'] = [
                [
                    'namespace' => 'custom',
                    'key'       => 'b2b_price',
                    'value'     => $data['b2b_price'],
                    'type'      => 'number_decimal'
                ]
            ];

            return $data;
        });

        return response()->json([
            'status' => 'success',
            'data' => $products
        ]);
    }
}
