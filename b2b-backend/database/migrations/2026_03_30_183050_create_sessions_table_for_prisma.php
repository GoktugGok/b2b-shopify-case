<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Prisma bu tabloyu tam olarak 'Session' (büyük S ile) adında bekliyor
        Schema::create('session', function (Blueprint $table) {
            $table->string('id', 191)->primary(); // MySQL 1170 hatasını önlemek için uzunluk 191
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
        Schema::dropIfExists('Session');
    }
};