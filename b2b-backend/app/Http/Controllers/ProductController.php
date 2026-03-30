<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use App\Models\Product;

class ProductController extends Controller
{
    /**
     * Display a listing of the resource.
     */
    public function index(Request $request)
    {
        $query = Product::query();

        if ($request->has('filter')) {
            $filter = $request->filter;
            if ($filter === 'active') {
                $query->where('is_on_shopify', true);
            } elseif ($filter === 'inactive') {
                $query->where('is_on_shopify', false);
            } elseif ($filter === 'published') {
                $query->where('is_published', true);
            }
        }

        if ($request->filled('search')) {
            $search = $request->search;
            $query->where(function($q) use ($search) {
                $q->where('name', 'LIKE', "%{$search}%")
                  ->orWhere('sku', 'LIKE', "%{$search}%");
            });
        }

        $products = $query->latest()->paginate(10)->appends($request->query());
        return view('products.index', compact('products'));
    }

    public function bulkUpdateStatus(Request $request)
    {
        $request->validate([
            'product_ids' => 'required|array',
            'product_ids.*' => 'exists:products,id',
            'action' => 'required|in:activate,deactivate,publish,unpublish,delete'
        ]);

        $action = $request->action;

        // --- TOPLU SİLME MANTIĞI ---
        if ($action === 'delete') {
            $ids = $request->product_ids;
            $deletedCount = count($ids);
            
            $syncedProducts = Product::whereIn('id', $ids)->get();
            foreach ($syncedProducts as $p) {
                // Shopify'a "bu ürün siliniyor/pasif" sinyali gönder
                $payload = [
                    'sku'           => $p->sku,
                    'price'         => $p->price,
                    'stock'         => $p->stock,
                    'is_on_shopify' => false,
                    'is_published'  => false,
                    'status'        => 'passive'
                ];
                if (!empty($p->b2b_price)) {
                    $payload['b2b_price'] = number_format((float)$p->b2b_price, 2, '.', '');
                }

                try {
                    \Illuminate\Support\Facades\Http::withToken(env('SYNC_SECRET_KEY'))
                        ->post(env('REMIX_APP_URL') . '/api/shopify-sync', $payload);
                } catch (\Exception $e) {
                    \Illuminate\Support\Facades\Log::error('Bulk Delete Sync Hatası: ' . $e->getMessage());
                }
                
                // Yerelden sil
                $p->delete();
            }

            return back()->with('success', 'Seçili ' . $deletedCount . ' ürün başarıyla temizlendi ve Shopify senkronizasyonu tamamlandı.');
        }

        if ($action === 'activate') {
            Product::whereIn('id', $request->product_ids)->update(['is_on_shopify' => true]);
        } elseif ($action === 'deactivate') {
            Product::whereIn('id', $request->product_ids)->update(['is_on_shopify' => false, 'is_published' => false]);
        } elseif ($action === 'publish') {
            Product::whereIn('id', $request->product_ids)->update(['is_published' => true, 'is_on_shopify' => true]);
        } elseif ($action === 'unpublish') {
            Product::whereIn('id', $request->product_ids)->update(['is_published' => false]);
        }

        // --- SENKRONİZASYON: Her bir ürünü Remix'e bildir ---
        $syncedProducts = Product::whereIn('id', $request->product_ids)->get();
        foreach ($syncedProducts as $p) {
            $payload = [
                'sku'           => $p->sku,
                'price'         => $p->price,
                'stock'         => $p->stock,
                'is_on_shopify' => $p->is_on_shopify,
                'is_published'  => $p->is_published,
                'status'        => $p->is_on_shopify ? 'active' : 'passive'
            ];
            if (!empty($p->b2b_price)) {
                $payload['b2b_price'] = number_format((float)$p->b2b_price, 2, '.', '');
            }

            try {
                \Illuminate\Support\Facades\Http::withToken(env('SYNC_SECRET_KEY'))
                    ->post(env('REMIX_APP_URL') . '/api/shopify-sync', $payload);
            } catch (\Exception $e) {
                \Illuminate\Support\Facades\Log::error('Bulk Sync Hatası: ' . $e->getMessage());
            }
        }

        return back()->with('success', 'Seçili ' . count($request->product_ids) . ' ürün başarıyla güncellendi ve Shopify senkronizasyonu tetiklendi.');
    }

    /**
     * Show the form for creating a new resource.
     */
    public function create()
    {
        return view('products.create');
    }

    /**
     * Store a newly created resource in storage.
     */
    public function store(Request $request)
    {
        $validated = $request->validate([
            'name'      => 'required|string|max:255',
            'price'     => 'required|numeric|min:0',
            'b2b_price' => 'nullable|numeric|min:0|lte:price',
            'stock'     => 'required|integer|min:0',
        ], [
            'b2b_price.lte' => 'B2B fiyatı normal fiyattan yüksek olamaz.',
        ]);

        $validated['is_on_shopify'] = $request->has('is_on_shopify');
        $validated['is_published'] = $request->has('is_published');

        if (empty($validated['b2b_price']) || $validated['b2b_price'] == 0) {
            $validated['b2b_price'] = null;
        }

        $product = Product::create($validated);

        $payload = [
            'sku'           => $product->sku,
            'price'         => $product->price,
            'stock'         => $product->stock,
            'is_on_shopify' => $product->is_on_shopify,
            'is_published'  => $product->is_published,
        ];
        if (!empty($product->b2b_price)) {
            $payload['b2b_price'] = number_format((float)$product->b2b_price, 2, '.', '');
        }

        try {
            \Illuminate\Support\Facades\Http::withToken(env('SYNC_SECRET_KEY'))
                ->post(env('REMIX_APP_URL') . '/api/shopify-sync', $payload);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::error('Shopify Sync Hatası: ' . $e->getMessage());
        }

        return redirect()->route('products.index')->with('success', 'Ürün başarıyla oluşturuldu.');
    }

    /**
     * Show the form for editing the specified resource.
     */
    public function edit(Product $product)
    {
        return view('products.edit', compact('product'));
    }

    /**
     * Update the specified resource in storage.
     */
    public function update(Request $request, Product $product)
    {
        $validated = $request->validate([
            'name'      => 'required|string|max:255',
            'price'     => 'required|numeric|min:0',
            'b2b_price' => 'nullable|numeric|min:0|lte:price',
            'stock'     => 'required|integer|min:0',
        ], [
            'b2b_price.lte' => 'B2B fiyatı normal fiyattan yüksek olamaz.',
        ]);

        unset($validated['sku']);

        $validated['is_on_shopify'] = $request->has('is_on_shopify');
        $validated['is_published'] = $request->has('is_published');

        if (!$validated['is_on_shopify']) {
            $validated['is_published'] = false;
        }

        if (empty($validated['b2b_price']) || $validated['b2b_price'] == 0) {
            $validated['b2b_price'] = null;
        }

        $product->update($validated);

        $payload = [
            'sku'           => $product->sku,
            'price'         => $product->price,
            'stock'         => $product->stock,
            'is_on_shopify' => $product->is_on_shopify,
            'is_published'  => $product->is_published,
        ];
        if (!empty($product->b2b_price)) {
            $payload['b2b_price'] = number_format((float)$product->b2b_price, 2, '.', '');
        }

        try {
            \Illuminate\Support\Facades\Http::withToken(env('SYNC_SECRET_KEY'))
                ->post(env('REMIX_APP_URL') . '/api/shopify-sync', $payload);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::error('Shopify Sync Hatası: ' . $e->getMessage());
        }

        return redirect()->route('products.index')->with('success', 'Ürün başarıyla güncellendi.');
    }

    /**
     * Remove the specified resource from storage.
     */
    public function destroy(Product $product)
    {
        \Illuminate\Support\Facades\Log::info("Ürün silme süreci başladı: SKU=" . $product->sku);

        // 1. Ürünü önce pasife çek (Sync mantığının aynısı)
        $product->is_on_shopify = false;
        $product->is_published = false;
        $product->save();

        // 2. Pasif sinyalini Remix'e gönder
        $payload = [
            'sku'           => $product->sku,
            'price'         => $product->price,
            'stock'         => $product->stock,
            'is_on_shopify' => false,
            'is_published'  => false,
            'status'        => 'passive'
        ];

        if (!empty($product->b2b_price)) {
            $payload['b2b_price'] = number_format((float)$product->b2b_price, 2, '.', '');
        }

        try {
            $url = env('REMIX_APP_URL') . '/api/shopify-sync';
            \Illuminate\Support\Facades\Log::info("Remix Sync çağrılıyor: " . $url);
            
            $response = \Illuminate\Support\Facades\Http::withToken(env('SYNC_SECRET_KEY'))
                ->post($url, $payload);

            if ($response->successful()) {
                \Illuminate\Support\Facades\Log::info("Shopify senkronizasyonu başarılı: " . $product->sku);
            } else {
                \Illuminate\Support\Facades\Log::error("Shopify senkronizasyon hatası: " . $response->body());
            }
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::error('Shopify Silme Hatası (Destroy): ' . $e->getMessage());
        }

        // 3. Senkronizasyon sinyalinden sonra yerel veritabanından sil
        $product->delete();

        return redirect()->route('products.index')->with('success', 'Ürün yerel sistemden ve Shopify mağazasından başarıyla kaldırıldı.');
    }
}
