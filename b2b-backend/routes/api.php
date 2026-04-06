<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

use App\Http\Controllers\Api\ProductController;
use App\Http\Controllers\WebhookController;

// Health check endpoint (Render.com için)
Route::get('/health', function () {
    return response()->json([
        'status' => 'ok',
        'timestamp' => now()->toIso8601String(),
    ]);
});

Route::get('/user', function (Request $request) {
    return $request->user();
})->middleware('auth:sanctum');

// Shopify integration endpoint
Route::get('/products', [ProductController::class, 'index']);

Route::middleware('verify.shopify.webhook')->group(function () {
    Route::post('/webhook/inventory', [WebhookController::class, 'updateStock']);
    Route::post('/webhook/orders', [WebhookController::class, 'handleOrderPaid']);
    Route::post('/webhook/orders/cancel', [WebhookController::class, 'handleOrderCancel']);
});
