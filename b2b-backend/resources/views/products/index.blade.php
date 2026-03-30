<x-app-layout>
    <x-slot name="header">
        <div class="flex flex-col lg:flex-row justify-between lg:items-center gap-4 pb-2">
            <!-- Sol: Başlık -->
            <h2 class="font-bold text-2xl text-gray-800 leading-tight tracking-tight">
                {{ __('Ürün Yönetimi') }}
            </h2>

            <!-- Sağ: Kullanıcı Menüsü ve Buton -->
            <div class="flex flex-wrap items-center gap-3">
                <!-- Dropdown -->
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
                        <!-- Authentication -->
                        <form method="POST" action="{{ route('logout') }}">
                            @csrf
                            <x-dropdown-link :href="route('logout')"
                                    onclick="event.preventDefault(); this.closest('form').submit();" class="text-red-600 font-medium hover:text-red-700">
                                {{ __('Çıkış Yap') }}
                            </x-dropdown-link>
                        </form>
                    </x-slot>
                </x-dropdown>

                <!-- Yeni Ürün Ekle Butonu -->
                <a href="{{ route('products.create') }}" class="flex-1 sm:flex-none inline-flex items-center justify-center px-5 py-2.5 bg-indigo-600 border border-transparent rounded-lg font-bold text-xs text-white uppercase tracking-widest hover:bg-indigo-700 focus:bg-indigo-700 active:bg-indigo-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition ease-in-out duration-150 shadow-sm">
                    Yeni Ürün Ekle
                </a>
            </div>
        </div>
    </x-slot>

    <div class="py-6 sm:py-12 px-4 sm:px-0">
        <div class="max-w-7xl mx-auto lg:px-8">
            <div class="bg-white overflow-hidden shadow-sm rounded-2xl border border-gray-100">
                <div class="p-4 sm:p-6 text-gray-900">
                    @if(session('success'))
                        <div class="mb-4 p-3 bg-green-50 border border-green-100 rounded-xl font-medium text-sm text-green-600">
                            {{ session('success') }}
                        </div>
                    @endif

                    <div class="mb-6 flex flex-col xl:flex-row xl:items-center justify-between gap-6">
                        <!-- Arama ve Filtreler -->
                        <div class="flex flex-col lg:flex-row items-start lg:items-center gap-4">
                            <!-- Arama Çubuğu -->
                            <form action="{{ route('products.index') }}" method="GET" class="relative group w-full lg:w-72">
                                @if(request('filter'))
                                    <input type="hidden" name="filter" value="{{ request('filter') }}">
                                @endif
                                <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                    <svg class="h-4 w-4 text-gray-400 group-focus-within:text-indigo-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
                                    </svg>
                                </div>
                                <input type="text" name="search" value="{{ request('search') }}" 
                                    placeholder="İsim veya SKU ile ara..." 
                                    class="block w-full pl-10 pr-4 py-2 text-sm border-gray-200 rounded-lg bg-gray-50 focus:bg-white focus:ring-2 focus:ring-indigo-100 focus:border-indigo-500 transition-all placeholder-gray-400"
                                >
                            </form>

                            <div class="flex flex-wrap items-center gap-2">
                                <a href="{{ route('products.index') }}" class="flex-1 sm:flex-none text-center px-4 py-2 text-sm font-medium rounded-lg border {{ !request('filter') && !request('search') ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50' }} transition-colors shadow-sm">Tümü</a>
                                <a href="{{ route('products.index', array_merge(request()->only('search'), ['filter' => 'active'])) }}" class="px-4 py-2 text-sm font-medium rounded-lg border {{ request('filter') == 'active' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50' }} transition-colors shadow-sm">Aktifler</a>
                                <a href="{{ route('products.index', array_merge(request()->only('search'), ['filter' => 'published'])) }}" class="px-4 py-2 text-sm font-medium rounded-lg border {{ request('filter') == 'published' ? 'bg-purple-50 text-purple-700 border-purple-200' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50' }} transition-colors shadow-sm">Yayındakiler</a>
                            </div>
                        </div>

                        <!-- Toplu İşlemler -->
                        <div class="relative hidden flex items-center gap-2" id="bulk-actions">
                            <form id="bulk-form" method="POST" action="{{ route('products.bulk-status') }}" class="m-0">
                                @csrf
                                <input type="hidden" name="action" id="bulk-action-input">
                                <div id="bulk-ids-container"></div>
                                
                                <div>
                                    <button type="button" onclick="toggleDropdown(event)" class="inline-flex items-center px-4 py-2 bg-indigo-600 border border-transparent rounded-lg font-medium text-sm text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-all">
                                        İşlemler (Seçili: <span id="selected-count" class="mx-1">0</span>)
                                        <svg class="ml-1 -mr-1 w-4 h-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                                            <path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" />
                                        </svg>
                                    </button>

                                    <!-- Dropdown Menü -->
                                    <div id="bulk-dropdown" class="absolute right-0 top-full mt-2 w-48 rounded-xl shadow-lg bg-white ring-1 ring-black ring-opacity-5 divide-y divide-gray-100 hidden z-50 transform opacity-100 scale-100 transition-all origin-top-right">
                                        <div class="py-1">
                                            <button type="button" onclick="submitBulk('activate')" class="group flex items-center w-full px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 hover:text-gray-900 transition-colors">
                                                <span class="w-2 h-2 rounded-full bg-green-500 mr-3"></span> Aktif Et
                                            </button>
                                            <button type="button" onclick="submitBulk('deactivate')" class="group flex items-center w-full px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 hover:text-gray-900 transition-colors">
                                                <span class="w-2 h-2 rounded-full bg-gray-400 mr-3"></span> Pasif Yap
                                            </button>
                                        </div>
                                        <div class="py-1">
                                            <button type="button" onclick="submitBulk('publish')" class="group flex items-center w-full px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 hover:text-gray-900 transition-colors">
                                                <span class="w-2 h-2 rounded-full bg-blue-500 mr-3"></span> Vitrinde Yayınla
                                            </button>
                                            <button type="button" onclick="submitBulk('unpublish')" class="group flex items-center w-full px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 hover:text-gray-900 transition-colors">
                                                <span class="w-2 h-2 rounded-full bg-red-500 mr-3"></span> Yayından Kaldır
                                            </button>
                                        </div>
                                        <div class="py-1">
                                            <button type="button" onclick="submitBulk('delete')" class="group flex items-center w-full px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 hover:text-red-700 transition-colors">
                                                <span class="w-2 h-2 rounded-full bg-red-600 mr-3"></span> Seçilenleri Sil
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </form>
                        </div>
                    </div>

                    <div class="overflow-x-auto bg-white rounded-xl shadow-md border border-gray-200">
                        <table class="w-full text-sm text-left text-gray-600">
                            <thead class="text-xs text-gray-700 uppercase bg-gray-50">
                                <tr>
                                    <th class="px-6 py-3 w-10">
                                        <input type="checkbox" id="selectAll" class="rounded border-gray-300 text-indigo-600 shadow-sm focus:ring-indigo-500 cursor-pointer">
                                    </th>
                                    <th class="px-6 py-3">SKU</th>
                                    <th class="px-6 py-3">Ürün Adı</th>
                                    <th class="px-6 py-3">Fiyat</th>
                                    <th class="px-6 py-3 text-center">B2B Fiyat</th>
                                    <th class="px-6 py-3">Stok</th>
                                    <th class="px-6 py-3 text-center">Shopify Status</th>
                                    <th class="px-6 py-3">İşlemler</th>
                                </tr>
                            </thead>
                            <tbody>
                                @foreach($products as $product)
                                    <tr class="bg-white border-b hover:bg-gray-50 transition-colors duration-150">
                                        <td class="px-6 py-4">
                                            <input type="checkbox" value="{{ $product->id }}" 
                                                data-isonshopify="{{ $product->is_on_shopify ? 'true' : 'false' }}"
                                                class="product-checkbox rounded border-gray-300 text-indigo-600 shadow-sm focus:ring-indigo-500 cursor-pointer">
                                        </td>
                                        <td class="px-6 py-4 font-medium text-gray-900 whitespace-nowrap">{{ $product->sku }}</td>
                                        <td class="px-6 py-4 truncate max-w-[200px]">{{ $product->name }}</td>
                                        <td class="px-6 py-4 font-semibold text-gray-900 border-r border-gray-100/50 whitespace-nowrap">{{ number_format($product->price, 2) }} ₺</td>
                                        <td class="px-6 py-4 text-center whitespace-nowrap">
                                            @if($product->b2b_price)
                                                <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-green-50 text-green-700 border border-green-100 shadow-sm">
                                                    {{ number_format($product->b2b_price, 2) }} ₺
                                                </span>
                                            @else
                                                <div class="text-gray-400 font-bold">—</div>
                                            @endif
                                        </td>
                                        <td class="px-6 py-4 whitespace-nowrap">{{ $product->stock }}</td>
                                        <td class="px-6 py-4">
                                            <div class="flex flex-col gap-1.5 items-center">
                                                @if($product->is_on_shopify)
                                                    <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700 border border-green-200 shadow-sm">
                                                        <svg class="w-3 h-3 mr-1.5 text-green-500" fill="currentColor" viewBox="0 0 8 8"><circle cx="4" cy="4" r="3"></circle></svg>
                                                        Aktif
                                                    </span>
                                                @else
                                                    <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-600 border border-gray-200 shadow-sm">
                                                        <svg class="w-3 h-3 mr-1.5 text-gray-400" fill="currentColor" viewBox="0 0 8 8"><circle cx="4" cy="4" r="3"></circle></svg>
                                                        Pasif
                                                    </span>
                                                @endif
                                                @if($product->is_published)
                                                    <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-100 text-indigo-700 border border-indigo-200 shadow-sm">
                                                        <svg class="w-3 h-3 mr-1.5 text-indigo-500" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"></path></svg>
                                                        Yayında
                                                    </span>
                                                @endif
                                            </div>
                                        </td>
                                        <td class="px-6 py-4">
                                            <div class="flex items-center space-x-3">
                                                <a href="{{ route('products.edit', $product) }}" class="inline-flex items-center px-3 py-1.5 bg-blue-50 border border-transparent rounded-md text-xs font-medium text-blue-700 shadow-sm hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all">
                                                    <svg class="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
                                                    Düzenle
                                                </a>
                                                <form id="delete-form-{{ $product->id }}" action="{{ route('products.destroy', $product) }}" method="POST">
                                                    @csrf
                                                    @method('DELETE')
                                                    <button type="button" onclick="confirmDelete({{ $product->id }})" class="inline-flex items-center px-3 py-1.5 bg-red-50 border border-transparent rounded-md text-xs font-medium text-red-700 shadow-sm hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 transition-all">
                                                        <svg class="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                                                        Sil
                                                    </button>
                                                </form>
                                            </div>
                                        </td>
                                    </tr>
                                @endforeach
                            </tbody>
                        </table>
                    </div>
                    <div class="mt-4">
                        {{ $products->links() }}
                    </div>
                </div>
            </div>
        </div>
    </div>
</x-app-layout>

<script>
    document.addEventListener("DOMContentLoaded", function() {
        const selectAll = document.getElementById('selectAll');
        const checkboxes = document.querySelectorAll('.product-checkbox');
        const bulkActions = document.getElementById('bulk-actions');
        const bulkIdsContainer = document.getElementById('bulk-ids-container');
        const bulkForm = document.getElementById('bulk-form');
        const bulkActionInput = document.getElementById('bulk-action-input');

        // Checkbox değişimlerini dinle
        selectAll.addEventListener('change', function() {
            checkboxes.forEach(cb => cb.checked = selectAll.checked);
            toggleBulkActions();
        });

        checkboxes.forEach(cb => {
            cb.addEventListener('change', toggleBulkActions);
        });

        // Toplu İşlem butonlarının görünürlüğünü aç/kapa
        function toggleBulkActions() {
            const checkedCount = Array.from(checkboxes).filter(cb => cb.checked).length;
            const allChecked = Array.from(checkboxes).every(cb => cb.checked);
            
            selectAll.checked = allChecked && checkboxes.length > 0;

            if (checkedCount > 0) {
                document.getElementById('selected-count').innerText = checkedCount;
                bulkActions.classList.remove('hidden');
            } else {
                bulkActions.classList.add('hidden');
                document.getElementById('bulk-dropdown').classList.add('hidden');
            }
        }

        // Dropdown Menüyü Aç/Kapat
        window.toggleDropdown = function(e) {
            e.stopPropagation();
            document.getElementById('bulk-dropdown').classList.toggle('hidden');
        };

        // Ekranda menü dışına tıklanınca Dropdown kapansın
        document.addEventListener('click', function(event) {
            const dropdown = document.getElementById('bulk-dropdown');
            const bulkForm = document.getElementById('bulk-form');
            if (bulkForm && !bulkForm.contains(event.target) && dropdown) {
                dropdown.classList.add('hidden');
            }
        });

        // İlgili aksiyona formları pushla
        window.submitBulk = function(action) {
            const selectedCheckboxes = Array.from(checkboxes).filter(cb => cb.checked);
            
            // --- KISITLAMA VE ONAY: Aktif olmayan ürünler yayına alınırken onay al ---
            if (action === 'publish') {
                const hasPassive = selectedCheckboxes.some(cb => cb.getAttribute('data-isonshopify') === 'false');
                if (hasPassive) {
                    Swal.fire({
                        title: 'Pasif Ürünler Var',
                        text: 'Seçtiğiniz ürünler arasında "Pasif" olanlar var. Bu ürünler otomatik olarak "Aktif" yapılıp yayına alınacak. Devam etmek istiyor musunuz?',
                        icon: 'info',
                        showCancelButton: true,
                        confirmButtonColor: '#4f46e5',
                        cancelButtonColor: '#ef4444',
                        confirmButtonText: 'Evet, Aktif Et ve Yayınla',
                        cancelButtonText: 'Vazgeç'
                    }).then((result) => {
                        if (result.isConfirmed) {
                            executeBulkAction(action, selectedCheckboxes);
                        }
                    });
                    return;
                }
            }

            // --- TOPLU SİLME ONAYI ---
            if (action === 'delete') {
                Swal.fire({
                    title: 'Toplu Silme Onayı',
                    text: "Seçtiğiniz " + selectedCheckboxes.length + " ürünü silmek istediğinize emin misiniz? Bu işlem geri alınamaz!",
                    icon: 'warning',
                    showCancelButton: true,
                    confirmButtonColor: '#ef4444',
                    cancelButtonColor: '#6b7280',
                    confirmButtonText: 'Evet, Hepsini Sil',
                    cancelButtonText: 'Vazgeç'
                }).then((result) => {
                    if (result.isConfirmed) {
                        executeBulkAction(action, selectedCheckboxes);
                    }
                });
                return;
            }

            Swal.fire({
                title: 'Emin misiniz?',
                text: "Seçili " + selectedCheckboxes.length + " ürün toplu olarak güncellenecek.",
                icon: 'question',
                showCancelButton: true,
                confirmButtonColor: '#4f46e5',
                cancelButtonColor: '#ef4444',
                confirmButtonText: 'Evet, Güncelle',
                cancelButtonText: 'İptal'
            }).then((result) => {
                if (result.isConfirmed) {
                    executeBulkAction(action, selectedCheckboxes);
                }
            });
        };

        // Formu gönderen yardımcı fonksiyon
        function executeBulkAction(action, selectedCheckboxes) {
            bulkIdsContainer.innerHTML = '';
            bulkActionInput.value = action;
            
            selectedCheckboxes.forEach(cb => {
                const input = document.createElement('input');
                input.type = 'hidden';
                input.name = 'product_ids[]';
                input.value = cb.value;
                bulkIdsContainer.appendChild(input);
            });
            
            bulkForm.submit();
        }

        // Tekli Silme Onayı
        window.confirmDelete = function(id) {
            Swal.fire({
                title: 'Ürünü Sil?',
                text: "Bu ürünü silmek istediğinize emin misiniz? Bu işlem geri alınamaz.",
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#ef4444',
                cancelButtonColor: '#6b7280',
                confirmButtonText: 'Evet, Sil',
                cancelButtonText: 'Vazgeç'
            }).then((result) => {
                if (result.isConfirmed) {
                    document.getElementById('delete-form-' + id).submit();
                }
            });
        };
    });
</script>
