<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Prisma loglarında küçük 'session' aradığı için burayı küçük harf yapıyoruz
        Schema::create('session', function (Blueprint $table) {
            $table->string('id', 191)->primary(); 
            $table->string('shop');
            $table->string('state');
            $table->boolean('isOnline')->default(false);
            $table->string('scope')->nullable();
            $table->dateTime('expires')->nullable();
            $table->string('accessToken');
            $table->bigInteger('userId')->nullable();
            $table->string('firstName')->nullable();
            $table->string('lastName')->nullable();
            $table->string('email')->nullable();
            $table->boolean('accountOwner')->default(false);
            $table->string('locale')->nullable();
            $table->boolean('collaborator')->default(false);
            $table->boolean('emailVerified')->default(false);
            $table->string('refreshToken')->nullable();
            $table->dateTime('refreshTokenExpires')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        // Burayı da up() ile aynı yapmalısın: 'session'
        Schema::dropIfExists('session');
    }
};