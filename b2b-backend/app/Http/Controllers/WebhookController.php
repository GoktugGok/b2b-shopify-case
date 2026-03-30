<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use App\Models\Product;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Cache;

class WebhookController extends Controller
{
    /**
     * Handle inventory updates from the Shopify app via webhook.
     */
    public function updateStock(Request $request)
    {
        Log::info("🔔 Webhook Payload:", $request->all());

        $sku = $request->input('sku');
        $product = Product::where('sku', $sku)->first();

        if ($product) {
            $changedFields = [];

            if ($request->has('stock')) {
                $oldStock = $product->stock;
                $newStock = (int)$request->input('stock');
                if ($oldStock != $newStock) {
                    $product->stock = $newStock;
                    $changedFields[] = "Stok";
                }
            }

            if (count($changedFields) > 0) {
                $product->saveQuietly();

                $reason = strtolower((string) $request->input('reason', ''));
                $isWaitingOrder = Cache::pull("is_waiting_order:{$sku}");
                $isPendingMatch = $request->input('is_pending_match', false);

                $isOrder = (
                    str_contains($reason, 'sale')
                    || str_contains($reason, 'order')
                    || str_contains($reason, 'fulfillment')
                    || str_contains($reason, 'sold')
                    || $isPendingMatch
                );

                if ($isOrder || $isWaitingOrder) {
                    $isCancellation = ($product->stock > $oldStock); // Stok arttıysa iptaldir
                    $source = $isCancellation ? 'cancel' : 'order';
                    
                    if ($isCancellation) {
                        $details = "❌ Sipariş iptal oldu {$sku} | {$oldStock} ➔ {$product->stock}";
                    } else {
                        $details = "📦 Sipariş oluşturuldu {$sku} | {$oldStock} ➔ {$product->stock}";
                    }
                    
                    Cache::put("just_handled_order:{$sku}", true, 30);
                } else {
                    $source = 'manual';
                    $details = "✍️ Manuel ellendi {$sku} | {$oldStock} ➔ {$product->stock}";
                }

                Log::info($details." (Reason: {$reason}, Match: ".($isPendingMatch ? 'YES' : 'NO').", Cache Flag: ".($isWaitingOrder ? 'YES' : 'NO').')');

                return response()->json([
                    'status' => 'success',
                    'message' => 'Veriler güncellendi',
                    'details' => $details,
                    'source' => $source,
                    'old_stock' => (int) $oldStock,
                    'new_stock' => (int) $product->stock,
                ], 200, [], JSON_UNESCAPED_UNICODE);
            } else {
                return response()->json(['status' => 'success', 'message' => 'Geçerli bir değişiklik tespit edilmedi.'], 200);
            }
        }

        return response()->json(['status' => 'error', 'message' => 'Ürün bulunamadı'], 404);
    }

    /**
     * Handle order payment/creation from Shopify.
     */
    public function handleOrderPaid(Request $request)
    {
        Log::info("🔔 ORDER WEBHOOK REACHED LARAVEL: " . $request->header('X-Shopify-Topic'));

        $lineItems = $request->input('line_items', []);

        foreach ($lineItems as $item) {
            $sku = $item['sku'] ?? null;
            if (! $sku) {
                continue;
            }

            // Eğer az önce bir stok güncellemesi bunu sipariş olarak işlediyse, 
            // aynı siparişin diğer webhook sinyallerinin bu bayrağı tekrar dikmesine izin verme.
            if (!Cache::has("just_handled_order:{$sku}")) {
                Cache::put("is_waiting_order:{$sku}", true, 300);
                Log::info("[Sync] Beklenen Sipariş Sinyali: SKU {$sku}. 300 sn geçerli.");
            }
        }
        return response()->json(['status' => 'success', 'message' => 'Sipariş bayrağı eklendi.'], 200);
    }

    /**
     * Handle order creation from Shopify.
     */
    public function handleOrderCreate(Request $request)
    {
        return $this->handleOrderPaid($request);
    }

    public function handleOrderCancel(Request $request)
    {
        $lineItems = $request->input('line_items', []);
        foreach ($lineItems as $item) {
            $sku = $item['sku'] ?? null;
            if (! $sku) {
                continue;
            }
            if (!Cache::has("just_handled_order:{$sku}")) {
                Cache::put("is_waiting_order:{$sku}", true, 300);
                Log::info("[Sync] İptal Sinyali Geldi: SKU {$sku}. 300 sn geçerli.");
            }
        }
        return response()->json(['status' => 'success', 'message' => 'İptal sinyali alındı.'], 200);
    }
}
