<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class VerifyShopifyWebhook
{
    public function handle(Request $request, Closure $next): Response
    {
        $secret = (string) config('services.shopify.webhook_secret', '');
        $expectedToken = (string) config('services.shopify.sync_secret', '');

        if ($secret === '') {
            $authHeader = $request->header('Authorization');
        
            \Illuminate\Support\Facades\Log::info('VerifyShopifyWebhook Check', [
                'expected' => $expectedToken,
                'received_auth' => $authHeader,
                'received_fallback' => $request->header('X-Sync-Secret'),
            ]);

            // Eğer Remix bize Authorization: Bearer <TOKEN> olarak atıyorsa:
            if ($authHeader === 'Bearer ' . $expectedToken) {
                return $next($request);
            }

            if (app()->environment('production')) {
                return response()->json(['error' => 'Webhook secret not configured'], 500);
            }

            return $next($request);
        }

        $hmacHeader = $request->header('X-Shopify-Hmac-Sha256');
        if ($hmacHeader === null || $hmacHeader === '') {
            return response()->json(['error' => 'Unauthorized'], 401);
        }

        $data = $request->getContent();
        $calculatedHmac = base64_encode(hash_hmac('sha256', $data, $secret, true));

        if (! hash_equals($calculatedHmac, (string) $hmacHeader)) {
            return response()->json(['error' => 'Unauthorized'], 401);
        }

        return $next($request);
    }
}
