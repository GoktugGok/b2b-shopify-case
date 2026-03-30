<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Prisma'nın kullandığı SyncLog tablosunun Vercel vs. için migration karşılığı
        if (!Schema::hasTable('SyncLog')) {
            Schema::create('SyncLog', function (Blueprint $table) {
                $table->id();
                $table->string('actionType');
                $table->string('status');
                $table->integer('productsSynced')->nullable()->default(0);
                $table->string('source')->nullable();
                $table->longText('details')->nullable();
                $table->timestamp('createdAt')->useCurrent();
            });
        }

        // Prisma'nın kullandığı PendingOrderSku tablosu
        if (!Schema::hasTable('PendingOrderSku')) {
            Schema::create('PendingOrderSku', function (Blueprint $table) {
                $table->id();
                $table->string('sku');
                $table->timestamp('createdAt')->useCurrent();
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('SyncLog');
        Schema::dropIfExists('PendingOrderSku');
    }
};
