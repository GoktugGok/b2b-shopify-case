<x-app-layout>
    <x-slot name="header">
        <div class="flex flex-col sm:flex-row justify-between items-center pb-2">
            <!-- Sol: Başlık -->
            <div class="flex items-center gap-3 mb-4 sm:mb-0">
                <a href="{{ route('products.index') }}" class="inline-flex items-center p-2 rounded-full text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
                </a>
                <h2 class="font-bold text-2xl text-gray-800 leading-tight tracking-tight">
                    {{ __('Ürün Düzenle: ') }} <span class="text-indigo-600">{{ $product->name }}</span>
                </h2>
            </div>

            <!-- Sağ: Kullanıcı Menüsü -->
            <div class="flex items-center gap-4">
                <x-dropdown align="right" width="48">
                    <x-slot name="trigger">
                        <button class="inline-flex items-center px-4 py-2 border border-gray-200 text-sm leading-4 font-semibold rounded-lg text-gray-700 bg-white hover:bg-gray-50 hover:text-gray-900 focus:outline-none transition ease-in-out duration-150 shadow-sm">
                            <div>{{ Auth::user()->name ?? 'Admin User' }}</div>
                            <div class="ms-1">
                                <svg class="fill-current h-4 w-4 text-gray-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                                    <path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" />
                                </svg>
                            </div>
                        </button>
                    </x-slot>

                    <x-slot name="content">
                        <x-dropdown-link :href="route('profile.edit')" class="font-medium">
                            {{ __('Profil Ayarları') }}
                        </x-dropdown-link>
                        <form method="POST" action="{{ route('logout') }}">
                            @csrf
                            <x-dropdown-link :href="route('logout')"
                                    onclick="event.preventDefault(); this.closest('form').submit();" class="text-red-600 font-medium hover:text-red-700">
                                {{ __('Çıkış Yap') }}
                            </x-dropdown-link>
                        </form>
                    </x-slot>
                </x-dropdown>
            </div>
        </div>
    </x-slot>

    <div class="py-12 bg-gray-50/50 min-h-screen">
        <div class="max-w-6xl mx-auto sm:px-6 lg:px-8">
            <form method="POST" action="{{ route('products.update', $product) }}" enctype="multipart/form-data">
                @csrf
                @method('PATCH')
                
                <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
                    
                    <!-- Sol Kolon: Temel Bilgiler -->
                    <div class="md:col-span-2 space-y-6">
                        <div class="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                            <div class="p-6 space-y-6">
                                <h3 class="text-lg font-semibold text-gray-900 border-b border-gray-100 pb-3">Temel Bilgiler</h3>

                                <div>
                                    <div class="flex items-center justify-between mb-1">
                                        <x-input-label for="sku" value="Stok Kodu (SKU)" class="text-gray-700 font-medium" />
                                        <span class="inline-flex items-center gap-1 text-xs font-medium text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                                            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
                                            </svg>
                                            Değiştirilemez
                                        </span>
                                    </div>
                                    <input type="text" id="sku" name="sku" readonly disabled
                                        value="{{ $product->sku }}"
                                        class="mt-1 block w-full border-gray-200 bg-gray-50 text-gray-500 rounded-lg shadow-sm cursor-not-allowed font-mono tracking-wider select-none"
                                    />
                                </div>

                                <div>
                                    <x-input-label for="name" value="Ürün Adı" class="text-gray-700 font-medium" />
                                    <x-text-input id="name" name="name" type="text" class="mt-1 block w-full border-gray-300 focus:border-indigo-500 focus:ring-indigo-500 rounded-lg shadow-sm" :value="old('name', $product->name)" required placeholder="Müşterilerin göreceği ürün başlığı" />
                                    <x-input-error class="mt-2" :messages="$errors->get('name')" />
                                </div>

                                <div class="grid grid-cols-1 sm:grid-cols-3 gap-6">
                                    <div>
                                        <x-input-label for="price" value="Fiyat" class="text-gray-700 font-medium" />
                                        <div class="relative mt-1 rounded-lg shadow-sm">
                                            <div class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                                                <span class="text-gray-500 font-medium">₺</span>
                                            </div>
                                            <input type="number" step="0.01" name="price" id="price" required class="block w-full rounded-lg border-gray-300 pl-8 focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm" placeholder="0.00" value="{{ old('price', $product->price) }}">
                                        </div>
                                        <x-input-error class="mt-2" :messages="$errors->get('price')" />
                                    </div>

                                    <div>
                                        <x-input-label for="b2b_price" value="B2B Fiyat" class="text-gray-700 font-medium" />
                                        <div class="relative mt-1 rounded-lg shadow-sm">
                                            <div class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                                                <span class="text-gray-500 font-medium">₺</span>
                                            </div>
                                            <input type="number" step="0.01" name="b2b_price" id="b2b_price" class="block w-full rounded-lg border-gray-300 pl-8 focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm" placeholder="0.00" value="{{ old('b2b_price', $product->b2b_price) }}">
                                        </div>
                                        <x-input-error class="mt-2" :messages="$errors->get('b2b_price')" />
                                    </div>

                                    <div>
                                        <x-input-label for="stock" value="Stok Miktarı" class="text-gray-700 font-medium" />
                                        <x-text-input id="stock" name="stock" type="number" class="mt-1 block w-full border-gray-300 focus:border-indigo-500 focus:ring-indigo-500 rounded-lg shadow-sm" :value="old('stock', $product->stock)" required placeholder="0" />
                                        <x-input-error class="mt-2" :messages="$errors->get('stock')" />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Sağ Kolon: Görünürlük & Aksiyonlar -->
                    <div class="md:col-span-1 space-y-6">
                        <div class="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                            <div class="p-6 space-y-6">
                                <h3 class="text-lg font-semibold text-gray-900 border-b border-gray-100 pb-3">Görünürlük</h3>

                                <div class="flex flex-col gap-5">
                                    <!-- Toggle: Shopify'da Yayınla -->
                                    <label class="relative inline-flex items-center cursor-pointer group">
                                        <input type="checkbox" id="is_on_shopify" name="is_on_shopify" value="1" class="sr-only peer" {{ old('is_on_shopify', $product->is_on_shopify) ? 'checked' : '' }}>
                                        <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-green-100 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500 group-hover:bg-gray-300 peer-checked:group-hover:bg-green-600"></div>
                                        <span class="ml-3 text-sm font-medium text-gray-700">Shopify'a Gönder (Aktif)</span>
                                    </label>

                                    <!-- Toggle: Vitrinde Yayınla -->
                                    <label class="relative inline-flex items-center cursor-pointer group">
                                        <input type="checkbox" id="is_published" name="is_published" value="1" class="sr-only peer" {{ old('is_published', $product->is_published) ? 'checked' : '' }}>
                                        <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-100 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600 group-hover:bg-gray-300 peer-checked:group-hover:bg-blue-700"></div>
                                        <span class="ml-3 text-sm font-medium text-gray-700">Vitrinde Yayınla</span>
                                    </label>
                                </div>
                            </div>
                        </div>

                        <!-- İşlem Butonları -->
                        <div class="flex flex-col gap-3">
                            <button type="submit" class="w-full px-5 py-3 text-sm font-bold text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 focus:ring-4 focus:ring-indigo-100 transition-all shadow-sm">
                                Bilgileri Güncelle
                            </button>
                            <div class="flex items-center gap-3">
                                <a href="{{ route('products.index') }}" class="flex-1 px-5 py-2.5 text-center text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-xl hover:bg-gray-50 hover:text-gray-900 transition-all shadow-sm">
                                    İptal
                                </a>
                                <button type="submit" form="delete-product-form" class="flex-1 px-5 py-2.5 text-sm font-medium text-red-600 bg-red-50 border border-red-200 rounded-xl hover:bg-red-100 hover:text-red-700 transition-all shadow-sm">
                                    Sil
                                </button>
                            </div>
                        </div>
                    </div>

                </div>
            </form>

            <form id="delete-product-form" action="{{ route('products.destroy', $product) }}" method="POST" onsubmit="return confirm('Bu ürünü silmek istediğinize emin misiniz?')">
                @csrf
                @method('DELETE')
            </form>
        </div>
    </div>
</x-app-layout>

<script>
    document.addEventListener("DOMContentLoaded", function() {
        const toggleActive = document.getElementById('is_on_shopify');
        const togglePublish = document.getElementById('is_published');

        function updatePublishState() {
            if (!toggleActive.checked) {
                togglePublish.checked = false;
                togglePublish.disabled = true;
                // Görsel feedback için opaklık ekle
                if (togglePublish.parentElement) {
                    togglePublish.parentElement.classList.add('opacity-50');
                    togglePublish.parentElement.style.pointerEvents = 'none';
                }
            } else {
                togglePublish.disabled = false;
                if (togglePublish.parentElement) {
                    togglePublish.parentElement.classList.remove('opacity-50');
                    togglePublish.parentElement.style.pointerEvents = 'auto';
                }
            }
        }

        // İlk yüklemede ve değişimde çalıştır
        updatePublishState();
        toggleActive.addEventListener('change', updatePublishState);
    });
</script>
