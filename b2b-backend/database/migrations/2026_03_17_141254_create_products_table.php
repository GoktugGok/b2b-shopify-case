<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
{
    Schema::create('products', function (Blueprint $table) {
        $table->id();
        $table->string('sku')->unique();
        $table->string('name');
        $table->decimal('price', 15, 2);
        $table->integer('stock');
        $table->boolean('is_published')->default(false);
        $table->boolean('is_on_shopify')->default(false);
        
        // HATA ALDIĞIN EKSİK SATIR TAM OLARAK BU:
        $table->decimal('b2b_price', 15, 2)->nullable(); 
        
        $table->timestamps();
    });
}

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('products');
    }
};
