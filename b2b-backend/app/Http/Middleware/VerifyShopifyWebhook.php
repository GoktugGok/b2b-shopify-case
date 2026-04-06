<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class VerifyShopifyWebhook
{
    public function handle(Request $request, Closure $next): Response
    {
        $expectedToken = config('app.sync_secret_key');
        
        // ENV'den config('app.sync_secret_key') gelmiyorsa fallback olarak direkt okuyalım
        if (!$expectedToken) {
            $expectedToken = env('SYNC_SECRET_KEY');
        }

        if (empty($expectedToken)) {
            if (app()->environment('production')) {
                return response()->json(['error' => 'Webhook secret not configured'], 500);
            }
            return $next($request);
        }

        $authHeader = $request->header('Authorization');
        
        // Eğer Remix bize Authorization: Bearer <TOKEN> olarak atıyorsa:
        if ($authHeader === 'Bearer ' . $expectedToken) {
            return $next($request);
        }
        
        // Veya X-Sync-Secret olarak atıyorsa vs. (fallback)
        if ($request->header('X-Sync-Secret') === $expectedToken) {
            return $next($request);
        }

        return response()->json(['error' => 'Unauthorized sync request'], 401);
    }
}
