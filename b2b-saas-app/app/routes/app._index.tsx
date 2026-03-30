import { useFetcher, useLoaderData } from "react-router";
import { useEffect, useState } from "react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Box,
  Banner,
  IndexTable,
  Pagination,
  Divider,
  Scrollable,
} from "@shopify/polaris";
import type { LoaderFunctionArgs, ActionFunctionArgs, HeadersFunction } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import Redis from "ioredis";
import prisma from "../db.server";

// Global Redis Bağlantısı (Upstash)
const redis = new Redis("rediss://default:gQAAAAAAASmGAAIncDI1MDIxZmMwNzFkMmU0MmZjYTZkMjhmMDdiZmNjOGVjOXAyNzYxNjY@closing-stinkbug-76166.upstash.io:6379");

const BACKEND_URL = process.env.LARAVEL_API_URL || "http://127.0.0.1:8000";

// Yardımcı Fonksiyon: Ürünün Shopify'da aktif olup olmadığını kontrol eder (Dashboard ile tutarlı)
const isActiveProduct = (p: any) => p.is_on_shopify == true || p.is_on_shopify == 1 || p.is_on_shopify == "1";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  // 1. Ürün verilerini çek (Redis öncelikli)
  const cachedData = await redis.get("b2b_products");
  let products = cachedData ? JSON.parse(cachedData) : [];

  if (products.length === 0) {
    try {
      const response = await fetch(`${BACKEND_URL}/api/products`);
      const result = await response.json();
      products = result.data || [];
      if (products.length > 0) {
        await redis.setex("b2b_products", 3600, JSON.stringify(products));
      }
    } catch (error) {
      console.error("Laravel API Hatası:", error);
    }
  }

  // 2. Senkronizasyon Loglarını çek (Son 10 kayıt)
  const logs = await prisma.syncLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return { products, logs };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const _action = formData.get("_action");

  try {
    // 1. Verileri Yenile (Cache temizle ve Laravel'den çek)
    if (_action === "refresh") {
      await redis.del("b2b_products");

      const response = await fetch(`${BACKEND_URL}/api/products`);
      const result = await response.json();
      const products = result.data || [];

      await redis.setex("b2b_products", 3600, JSON.stringify(products));

      // Snapshot: her SKU'nun fiyat/stok değerlerini Redis'e kaydet (incremental karşılaştırma için)
      const snapshotPipeline = redis.pipeline();
      for (const p of products) {
        if (p.sku) {
          snapshotPipeline.setex(
            `b2b_snapshot:${p.sku}`,
            7200,
            JSON.stringify({
              price: p.price,
              b2b_price: p.b2b_price,
              stock: p.stock,
              is_published: !!p.is_published,
              is_on_shopify: !!p.is_on_shopify
            })
          );
        }
      }
      await snapshotPipeline.exec();

      // Log Kaydı Yaz
      await prisma.syncLog.create({
        data: {
          actionType: "CACHE_REFRESH",
          status: "SUCCESS",
          details: "Ürün verileri Laravel API'sinden başarıyla çekildi ve güncellendi.",
        },
      });

      const newLogs = await prisma.syncLog.findMany({ orderBy: { createdAt: "desc" }, take: 20 });
      return { success: true, message: "Veriler başarıyla güncellendi.", products, logs: newLogs };
    }

    // 2. Shopify'a Senkronize Et (Upsert Mantığı - Optimize Edilmiş)
    if (_action === "sync") {
      let products;
      const cachedData = await redis.get("b2b_products");

      if (cachedData) {
        products = JSON.parse(cachedData);
      } else {
        const response = await fetch(`${BACKEND_URL}/api/products`);
        const result = await response.json();
        products = result.data || [];
      }

      const laravelSkus = products.map((p: any) => p.sku);

      // Snapshot güncelle (manual sync sonrası taban çizgisini tazele)
      const snapshotPipeline = redis.pipeline();
      for (const p of products) {
        if (p.sku) {
          snapshotPipeline.setex(
            `b2b_snapshot:${p.sku}`,
            7200,
            JSON.stringify({ price: p.price, b2b_price: p.b2b_price, stock: p.stock })
          );
        }
      }
      await snapshotPipeline.exec();

      const initialDataQuery = await admin.graphql(
        `#graphql
        query getInitialData {
          locations(first: 1) { edges { node { id } } }
          publications(first: 10) { edges { node { id name } } }
          products(first: 250) {
            edges {
              node {
                id
                status
                variants(first: 1) { edges { node { sku } } }
              }
            }
          }
        }`
      );
      const initialData = await initialDataQuery.json();
      const locationId = initialData.data?.locations?.edges[0]?.node?.id;
      const onlineStorePubId = initialData.data?.publications?.edges?.find((e: any) => e.node.name === "Online Store")?.node?.id;

      if (!locationId) throw new Error("Shopify lokasyon ID bulunamadı.");

      const skuToIdMap = new Map();
      initialData.data?.products?.edges?.forEach((edge: any) => {
        const titleSku = edge.node.variants?.edges[0]?.node?.sku;
        if (titleSku) skuToIdMap.set(titleSku, edge.node.id);
      });

      for (const product of products) {
        const existingProductId = skuToIdMap.get(product.sku);

        // --- ÖNEMLİ: Laravel'de Pasif (is_on_shopify: false) ise Shopify'dan SİL ---
        if (product.is_on_shopify === false || product.is_on_shopify === 0 || product.is_on_shopify === "0") {
          if (existingProductId) {
            await admin.graphql(
              `#graphql
              mutation deletePasif($input: ProductDeleteInput!) {
                productDelete(input: $input) { deletedProductId }
              }`,
              { variables: { input: { id: existingProductId } } }
            );
            console.log(`[Manual Sync] Pasif ürün Shopify'dan silindi: SKU=${product.sku}`);
          }
          continue; // Pasif ürünü güncellemeye çalışma, sıradakine geç
        }

        const input: any = {
          title: product.name,
          status: product.is_published ? "ACTIVE" : "DRAFT",
          productOptions: [{ name: "Title", values: [{ name: "Default Title" }] }],
          variants: [
            {
              sku: product.sku,
              price: (product.price || 0).toString(),
              optionValues: [{ optionName: "Title", name: "Default Title" }],
              inventoryItem: { tracked: true },
              inventoryQuantities: [
                {
                  locationId: locationId,
                  name: "available",
                  quantity: Number(product.stock || 0)
                }
              ]
            },
          ],
        };

        if (product.image_url) {
          input.files = [
            {
              alt: product.name,
              contentType: "IMAGE",
              originalSource: product.image_url
            }
          ];
        }

        if (existingProductId) input.id = existingProductId;

        const productSetRes = await admin.graphql(
          `#graphql
          mutation productSet($input: ProductSetInput!) {
            productSet(synchronous: true, input: $input) {
              product { 
                id
                variants(first: 1) { edges { node { id } } }
              }
              userErrors { field message }
            }
          }`,
          { variables: { input } }
        );

        const pSetData = await productSetRes.json();
        const createdId = pSetData.data?.productSet?.product?.id || existingProductId;
        const variantId = pSetData.data?.productSet?.product?.variants?.edges?.[0]?.node?.id;

        // B2B Fiyatı Metafield Yaz veya Sil
        if (variantId) {
          if (product.b2b_price) {
            await admin.graphql(
              `#graphql
              mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
                metafieldsSet(metafields: $metafields) {
                  metafields { id value }
                  userErrors { message }
                }
              }`,
              { variables: { metafields: [{ namespace: "custom", key: "b2b_price", type: "number_decimal", value: String(product.b2b_price), ownerId: variantId }] } }
            );
          } else {
            await admin.graphql(
              `#graphql
              mutation metafieldsDelete($metafields: [MetafieldIdentifierInput!]!) {
                metafieldsDelete(metafields: $metafields) {
                  deletedMetafields { key namespace ownerId }
                  userErrors { message }
                }
              }`,
              { variables: { metafields: [{ ownerId: variantId, namespace: "custom", key: "b2b_price" }] } }
            );
          }
        }

        // Yayınlama Garantisi (Sales Channel - Full Sync)
        if (createdId && onlineStorePubId) {
          try {
            if (product.is_published) {
              await admin.graphql(
                `#graphql
                mutation publish($id: ID!, $input: [PublicationInput!]!) {
                  publishablePublish(id: $id, input: $input) { userErrors { message } }
                }`,
                { variables: { id: createdId, input: [{ publicationId: onlineStorePubId }] } }
              );
            } else {
              await admin.graphql(
                `#graphql
                mutation unpublish($id: ID!, $input: [PublicationInput!]!) {
                  publishableUnpublish(id: $id, input: $input) { userErrors { message } }
                }`,
                { variables: { id: createdId, input: [{ publicationId: onlineStorePubId }] } }
              );
            }
          } catch (e) { }
        }
      }

      const shopifyProducts = initialData.data?.products?.edges || [];
      for (const edge of shopifyProducts) {
        const shopifyProduct = edge.node;
        const shopifySku = shopifyProduct.variants?.edges[0]?.node?.sku;

        if (shopifySku && !laravelSkus.includes(shopifySku) && shopifyProduct.status === "ACTIVE") {
          await admin.graphql(
            `#graphql
            mutation deactivateProduct($input: ProductInput!) {
              productUpdate(input: $input) {
                product { id }
              }
            }`,
            { variables: { input: { id: shopifyProduct.id, status: "DRAFT" } } }
          );
        }
      }

      // Sadece admin panelindeki "Ürün Listesi"nde görünenlerin sayısını loga bas (Daha tutarlı)
      const visibleProductsCount = products.filter(isActiveProduct).length;

      // Log Kaydı Yaz
      await prisma.syncLog.create({
        data: {
          actionType: "MANUAL_SYNC",
          status: "SUCCESS",
          productsSynced: visibleProductsCount,
          details: "Shopify senkronizasyonu ve Hayalet Veri temizliği tamamlandı.",
        },
      });

      const newLogs = await prisma.syncLog.findMany({ orderBy: { createdAt: "desc" }, take: 20 });
      return { success: true, message: "Senkronizasyon ve Temizlik başarıyla tamamlandı!", syncSuccess: true, logs: newLogs };
    }

    // 3. Artımlı Senkronizasyon (Incremental Sync - Bulk Operation GraphQL)
    if (_action === "sync-incremental") {
      // a) En son başarılı olan senkronizasyon logunu (SUCCESS) DB'den bul
      const lastSyncLog = await prisma.syncLog.findFirst({
        where: { status: { in: ["SUCCESS", "WARNING"] }, actionType: { in: ["MANUAL_SYNC", "BULK_SYNC", "WEBHOOK_SYNC"] } },
        orderBy: { createdAt: "desc" }
      });

      // Log varsa ISO formatında tarihini al, yoksa fallback olarak 24 saat öncesini kullan
      const lastSyncDate = lastSyncLog
        ? lastSyncLog.createdAt.toISOString()
        : new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      // b) Laravel API'sine last_sync parametresini ileterek gerçek Incremental filtrasyonu yaptır
      const response = await fetch(`${BACKEND_URL}/api/products?incremental=true&last_sync=${lastSyncDate}`);
      const result = await response.json();
      const incrementalProducts = result.data || [];

      // c) GHOST CLEANUP için tüm Laravel SKU'larını çek
      const fullLaravelRes = await fetch(`${BACKEND_URL}/api/products`);
      const fullLaravelResult = await fullLaravelRes.json();
      const fullLaravelProducts = fullLaravelResult.data || [];
      const laravelSkus = new Set(fullLaravelProducts.map((p: any) => p.sku));

      // d) Shopify verilerini çek
      const initialDataQuery = await admin.graphql(
        `#graphql
        query getInitialData {
          locations(first: 1) { edges { node { id } } }
          publications(first: 10) { edges { node { id name } } }
          products(first: 250) {
            edges {
              node {
                id
                variants(first: 1) { edges { node { id sku } } }
              }
            }
          }
        }`
      );
      const initialData = await initialDataQuery.json();
      const locationId = initialData.data?.locations?.edges[0]?.node?.id;
      const onlineStorePubId = initialData.data?.publications?.edges?.find((e: any) => e.node.name === "Online Store")?.node?.id;

      if (!locationId) throw new Error("Shopify lokasyon ID bulunamadı.");

      const skuToIdMap = new Map();
      const skuToVariantIdMap = new Map();
      const ghostsToDelete: string[] = [];

      initialData.data?.products?.edges?.forEach((edge: any) => {
        const variantNode = edge.node.variants?.edges[0]?.node;
        const sku = variantNode?.sku;
        if (sku) {
          skuToIdMap.set(sku, edge.node.id);
          skuToVariantIdMap.set(sku, variantNode.id);

          // Eğer bu SKU Shopify'da var ama Laravel tam listesinde YOKSA (Silinmişse) -> Ghost işaretle
          if (!laravelSkus.has(sku)) {
            ghostsToDelete.push(edge.node.id);
            console.log(`📡 [Incremental] GHOST tespit edildi: SKU=${sku}`);
          }
        }
      });

      // Erken dönüş (Hiç değişen veya silinen yoksa)
      if (incrementalProducts.length === 0 && ghostsToDelete.length === 0) {
        return { success: true, message: "Shopify zaten güncel. Temizlik veya güncellemeye gerek kalmadı." };
      }

      // c) Shopify'ın zorunlu tuttuğu JSONL (JSON Lines) formatını oluştur
      let jsonlContent = "";
      let passiveCount = 0;
      let publishCount = 0;
      let unpublishCount = 0;
      const newlyCreatedSkus = new Set<string>();
      const smartLines: string[] = []; // Taşındı

      // GHOST CLEANUP: SKU takibi ile log ekle
      for (const ghostId of ghostsToDelete) {
        // ID'den SKU bul
        const ghostSku = Array.from(skuToIdMap.entries()).find(([s, id]) => id === ghostId)?.[0] || "—";
        
        await admin.graphql(
          `#graphql
          mutation deleteGhost($input: ProductDeleteInput!) {
            productDelete(input: $input) { deletedProductId }
          }`,
          { variables: { input: { id: ghostId } } }
        );
        smartLines.push(`[Anlık Güncelleme] ${ghostSku} - Laravel'den silindiği için Shopify'dan temizlendi.`);
      }

      for (const product of incrementalProducts) {
        const existingProductId = skuToIdMap.get(product.sku);

        // --- ÖNEMLİ: Laravel'de Pasif ise Shopify'dan SİL (Artımlı) ---
        if (product.is_on_shopify === false || product.is_on_shopify === 0 || product.is_on_shopify === "0") {
          if (existingProductId) {
            await admin.graphql(
              `#graphql
              mutation deletePasifInc($input: ProductDeleteInput!) {
                productDelete(input: $input) { deletedProductId }
              }`,
              { variables: { input: { id: existingProductId } } }
            );
            passiveCount++;
            smartLines.push(`[Anlık Güncelleme] ${product.sku} - Pasife çekildiği için Shopify'dan kaldırıldı.`);
            console.log(`[Incremental Sync] Pasif ürün Shopify'dan silindi: SKU=${product.sku}`);
          }
          continue;
        }

        // Null/eksik alan koruması
        const safeSku = product.sku || "";
        const safeTitle = product.name || "İsimsiz Ürün";
        const safePrice = (product.price != null ? Number(product.price) : 0).toString();
        const safeStock = Number(product.stock ?? 0);

        if (!safeSku) {
          console.error("[Incremental] SKU boş ürün atlandı:", product);
          continue;
        }

        const variantId = skuToVariantIdMap.get(safeSku);

        const input: any = {
          title: safeTitle,
          status: product.is_published ? "ACTIVE" : "DRAFT",
          productOptions: [{ name: "Title", values: [{ name: "Default Title" }] }],
          variants: [
            {
              id: variantId || undefined,
              sku: safeSku,
              price: safePrice,
              optionValues: [{ optionName: "Title", name: "Default Title" }],
              inventoryItem: { tracked: true },
              inventoryQuantities: [
                {
                  locationId: locationId,
                  name: "available",
                  quantity: safeStock,
                }
              ],
              // B2B Fiyatını varyasyon metafield'ı olarak ekle
              metafields: product.b2b_price ? [
                {
                  namespace: "custom",
                  key: "b2b_price",
                  type: "number_decimal",
                  value: String(product.b2b_price)
                }
              ] : []
            },
          ],
        };

        // Ürün görseli varsa ekle
        if (product.image_url) {
          input.files = [
            {
              alt: safeTitle,
              contentType: "IMAGE",
              originalSource: product.image_url
            }
          ];
        }

        if (existingProductId) {
          // --- MEVCUT ÜRÜN: JSONL'e ekle, Bulk ile işlenecek ---
          input.id = existingProductId;
          jsonlContent += JSON.stringify({ input }) + "\n";
        } else {
          // --- YENİ ÜRÜN: Shopify ID yok → Bulk dışında senkron productSet ile oluştur ---
          console.log(`[Incremental] Yeni ürün senkron oluşturuluyor: SKU=${safeSku}`);
          try {
            const pSetRes = await admin.graphql(
              `#graphql
              mutation newProd($input: ProductSetInput!) {
                productSet(synchronous: true, input: $input) {
                  product { id }
                  userErrors { field message }
                }
              }`,
              { variables: { input } }
            );
            const pSetData = await pSetRes.json();
            const createdId = pSetData.data?.productSet?.product?.id;

            if (createdId) {
              newlyCreatedSkus.add(safeSku);

              // Yayınlama Garantisi (Artımlı - Yeni Ürün)
              if (onlineStorePubId) {
                if (product.is_published) {
                  await admin.graphql(
                    `#graphql
                    mutation publish($id: ID!, $input: [PublicationInput!]!) {
                      publishablePublish(id: $id, input: $input) { userErrors { message } }
                    }`,
                    { variables: { id: createdId, input: [{ publicationId: onlineStorePubId }] } }
                  );
                } else {
                  await admin.graphql(
                    `#graphql
                    mutation unpublish($id: ID!, $input: [PublicationInput!]!) {
                      publishableUnpublish(id: $id, input: $input) { userErrors { message } }
                    }`,
                    { variables: { id: createdId, input: [{ publicationId: onlineStorePubId }] } }
                  );
                }
              }
            }
          } catch (err) {
            console.error(`[Incremental] Yeni ürün oluşturma hatası:`, err);
          }
        }

        // Mevcut Ürünler için de Yayınlama Senkronu (Artımlı)
        if (existingProductId && onlineStorePubId) {
          try {
            if (product.is_published) {
              await admin.graphql(
                `#graphql
                mutation publish($id: ID!, $input: [PublicationInput!]!) {
                  publishablePublish(id: $id, input: $input) { userErrors { message } }
                }`,
                { variables: { id: existingProductId, input: [{ publicationId: onlineStorePubId }] } }
              );
            } else {
              await admin.graphql(
                `#graphql
                mutation unpublish($id: ID!, $input: [PublicationInput!]!) {
                  publishableUnpublish(id: $id, input: $input) { userErrors { message } }
                }`,
                { variables: { id: existingProductId, input: [{ publicationId: onlineStorePubId }] } }
              );
            }
          } catch (e) {
            console.error(`[Incremental] Yayın güncelleme hatası:`, e);
          }
        }
      }

      // ----- BULK OPERATION: Sadece mevcut (Shopify ID'li) ürünler varsa çalıştır -----
      const jsonlLines = jsonlContent.trim().split("\n").filter(Boolean);
      const updatedCount = jsonlLines.length;
      const newCount = newlyCreatedSkus.size;

      // g) Akıllı log mesajlarını oluştur (Redis snapshot karşılaştırması)
      const joinTr = (parts: string[]): string => {
        if (parts.length === 0) return "Alan";
        if (parts.length === 1) return parts[0];
        return parts.slice(0, -1).join(", ") + " ve " + parts[parts.length - 1];
      };

      const snapshotKeys = incrementalProducts.map((p: any) => `b2b_snapshot:${p.sku}`);
      const snapshots = snapshotKeys.length > 0 ? await redis.mget(...snapshotKeys) : [];
      const updateSnapshotPipeline = redis.pipeline();

      for (let i = 0; i < incrementalProducts.length; i++) {
        const p = incrementalProducts[i];
        const raw = snapshots[i];
        const prev = raw ? JSON.parse(raw) : null;
        const labels: string[] = [];

        const isPassiveNow = p.is_on_shopify === false || p.is_on_shopify === 0 || p.is_on_shopify === "0";

        if (isPassiveNow) {
          // Pasife çekilenleri tekil detay logunda göstermiyoruz, sadece Özet'te (passiveCount) kalsınlar.
          updateSnapshotPipeline.setex(
            `b2b_snapshot:${p.sku}`,
            7200,
            JSON.stringify({
              price: p.price,
              b2b_price: p.b2b_price,
              stock: p.stock,
              is_published: !!p.is_published,
              is_on_shopify: !!p.is_on_shopify
            })
          );
          continue;
        }

        if (prev) {
          const prevPrice = prev.price != null ? String(Number(prev.price).toFixed(2)) : null;
          const prevB2b = prev.b2b_price != null ? String(Number(prev.b2b_price).toFixed(2)) : null;
          const prevStock = prev.stock != null ? String(Number(prev.stock)) : null;
          const newPrice = p.price != null ? String(Number(p.price).toFixed(2)) : null;
          const newB2b = p.b2b_price != null ? String(Number(p.b2b_price).toFixed(2)) : null;
          const newStock = p.stock != null ? String(Number(p.stock)) : null;

          if (prevPrice !== newPrice) labels.push("Fiyat");
          if (prevB2b !== newB2b) labels.push("B2B fiyatı");
          if (prevStock !== newStock) labels.push("Stok");

          // Yayın durumu ve Aktiflik takibi (Tiplerden bağımsız sağlam kontrol)
          const currPublished = p.is_published == true || p.is_published == 1 || p.is_published == "1";
          const prevPublished = prev.is_published == true || prev.is_published == 1 || prev.is_published == "1";
          const currOnShopify = p.is_on_shopify == true || p.is_on_shopify == 1 || p.is_on_shopify == "1";
          const prevOnShopify = prev.is_on_shopify == true || prev.is_on_shopify == 1 || prev.is_on_shopify == "1";

          if (prevPublished !== currPublished) {
            labels.push("Yayın durumu");
            if (currPublished) publishCount++; else unpublishCount++;
          }
          if (prevOnShopify !== currOnShopify) {
            labels.push("Aktiflik");
          }
        }

        const isPublishedNow = p.is_published == true || p.is_published == 1 || p.is_published == "1";

        if (newlyCreatedSkus.has(p.sku)) {
          const suffix = isPublishedNow ? ", senkronize edildi ve yayınlandı." : " ve senkronize edildi.";
          smartLines.push(`[Anlık Güncelleme] ${p.sku} - Ürün mağazada bulunamadı, yeni kayıt olarak başarıyla oluşturuldu${suffix}`);
        } else if (labels.length > 0) {
          let msg = `[Anlık Güncelleme] ${p.sku} - ${joinTr(labels)} güncellendi.`;

          if (labels.includes("Yayın durumu")) {
            const pubSuffix = isPublishedNow ? "Yayına alındı." : "Yayından kaldırıldı.";
            if (labels.length === 1) {
              msg = `[Anlık Güncelleme] ${p.sku} - ${pubSuffix}`;
            } else {
              msg = `[Anlık Güncelleme] ${p.sku} - ${joinTr(labels.filter(l => l !== "Yayın durumu"))} güncellendi ve ürün ${pubSuffix.toLowerCase()}`;
            }
          }
          smartLines.push(msg);
        }
        updateSnapshotPipeline.setex(
          `b2b_snapshot:${p.sku}`,
          7200,
          JSON.stringify({
            price: p.price,
            b2b_price: p.b2b_price,
            stock: p.stock,
            is_published: !!p.is_published,
            is_on_shopify: !!p.is_on_shopify
          })
        );
      }
      await updateSnapshotPipeline.exec().catch(() => { });
      const smartDetails = smartLines.join("\n");
      const ghostCount = ghostsToDelete.length;
      const totalDeletions = ghostCount + passiveCount;
      const summaryParts = [];
      let successMessage = "";
      if (newCount > 0) summaryParts.push(`${newCount} yeni ürün eklendi`);
      if (publishCount > 0) summaryParts.push(`${publishCount} ürün yayınlandı`);
      if (unpublishCount > 0) summaryParts.push(`${unpublishCount} yayından kaldırıldı`);

      // Eğer yayınlanma dışında da güncelleme varsa (fiyat/stok) onları da say
      const otherUpdates = updatedCount - (publishCount + unpublishCount);
      if (otherUpdates > 0) summaryParts.push(`${otherUpdates} ürün güncellendi`);
      if (passiveCount > 0) summaryParts.push(`${passiveCount} pasife çekilen ürün kaldırıldı`);
      if (ghostCount > 0) summaryParts.push(`${ghostCount} silinmiş ürün temizlendi`);

      if (summaryParts.length > 0) {
        successMessage = "Tamamlandı: " + summaryParts.join(", ") + " işlemi başarıyla yapıldı.";
      } else {
        successMessage = "Artımlı kontrol tamamlandı: Shopify mağazanız zaten güncel.";
      }

      // Eğer tekil güncellemeler (smartDetails) varsa, özeti de altına ekleyelim ki hiçbir işlem (silme/pasif) gözden kaçmasın.
      const finalDetails = (smartDetails)
        ? (summaryParts.length > 0 ? `${smartDetails}\n📊 Özet: ${summaryParts.join(", ")}` : smartDetails)
        : (summaryParts.length > 0 ? `📊 Özet: ${summaryParts.join(", ")}` : "Herhangi bir değişiklik tespit edilmedi.");

      // DURUM A: Eğer hiç mevcut ürün güncellenmeyecekse (sadece yeni vardı veya temizlik yapıldı)
      if (updatedCount === 0) {
        await prisma.syncLog.create({
          data: {
            actionType: "BULK_SYNC",
            status: "SUCCESS",
            productsSynced: newCount + totalDeletions,
            details: finalDetails,
          },
        });
        const newLogs = await prisma.syncLog.findMany({ orderBy: { createdAt: "desc" }, take: 20 });
        return {
          success: true,
          message: successMessage,
          syncSuccess: true,
          logs: newLogs
        };
      }

      // d) Shopify'dan Bulk Yükleme Yetkisi Al (Staged Upload Mutation)
      const stagedUploadQuery = await admin.graphql(
        `#graphql
        mutation stagedUploadsCreate {
          stagedUploadsCreate(input: {
            resource: BULK_MUTATION_VARIABLES, 
            filename: "incremental_sync.jsonl", 
            mimeType: "text/jsonl", 
            httpMethod: POST
          }) {
            stagedTargets {
              url
              resourceUrl
              parameters { name value }
            }
            userErrors { field message }
          }
        }`
      );

      const uploadData = await stagedUploadQuery.json();
      const target = uploadData.data?.stagedUploadsCreate?.stagedTargets?.[0];

      if (!target) {
        throw new Error("Shopify Bulk Operations yükleme hedefi oluşturulamadı.");
      }

      // e) JSONL dosyamızı hedef URL'e Node.js yerleşik FormData standardıyla gönderiyoruz
      const formData = new FormData();
      target.parameters.forEach((param: any) => {
        formData.append(param.name, param.value);
      });
      formData.append("file", new Blob([jsonlContent], { type: "text/jsonl" }), "incremental_sync.jsonl");

      const uploadResponse = await fetch(target.url, { method: "POST", body: formData });
      if (!uploadResponse.ok) {
        throw new Error("Dosya Shopify Bulk hedefine yüklenemedi.");
      }

      // f) Yüklenen dosya yolunu belirtip Bulk Operation Run Mutation'ı başlatıyoruz
      const stagedUploadPathValue = target.parameters.find((p: any) => p.name === "key")?.value;
      if (!stagedUploadPathValue) {
        throw new Error("Bulk yükleme 'key' parametresi bulunamadı.");
      }

      const bulkOperationQuery = await admin.graphql(
        `#graphql
        mutation bulkOperationRunMutation($mutation: String!, $stagedUploadPath: String!) {
          bulkOperationRunMutation(
            mutation: $mutation,
            stagedUploadPath: $stagedUploadPath
          ) {
            userErrors { field message }
          }
        }`,
        {
          variables: {
            mutation: `mutation call($input: ProductSetInput!) { productSet(synchronous: true, input: $input) { product { id } } }`,
            stagedUploadPath: stagedUploadPathValue
          }
        }
      );

      // BULK DURUMU İÇİN MESAJ GÜNCELLEME (Eğer bulk çalıştıysa, summary already generated but might need refresh)
      // summaryParts already handled above, but technically this block is for the bulk success path.
      // We can just use the successMessage generated before the updatedCount check.

      // Log için "Ürün Listesi"ndeki aktif sayıyı baz al
      const incrementalActiveCount = incrementalProducts.filter(isActiveProduct).length;

      await prisma.syncLog.create({
        data: {
          actionType: "BULK_SYNC",
          status: "SUCCESS",
          productsSynced: incrementalActiveCount,
          details: finalDetails,
        },
      });

      const newLogs = await prisma.syncLog.findMany({ orderBy: { createdAt: "desc" }, take: 20 });

      return {
        success: true,
        message: successMessage,
        syncSuccess: true,
        logs: newLogs
      };
    }

    return null;
  } catch (error) {
    console.error("Action Hatası:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "İşlem sırasında bir hata oluştu."
    };
  }
};

// ── Sayfalanmış Ürün Tablosu ──────────────────────────────────────────────────
const PAGE_SIZE = 15;

function ProductTable({ products }: { products: any[] }) {
  const [page, setPage] = useState(0);
  const totalPages = Math.ceil(products.length / PAGE_SIZE);

  // Veri azaldığında (silme sonrası) sayfa sınır dışı kalırsa başa dön veya sınırı koru
  useEffect(() => {
    if (page >= totalPages && totalPages > 0) {
      setPage(totalPages - 1);
    } else if (totalPages === 0) {
      setPage(0);
    }
  }, [products.length, totalPages, page]);
  const pageProducts = products.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const resourceName = { singular: "ürün", plural: "ürün" };

  const rowMarkup = pageProducts.map((p: any, index: number) => (
    <IndexTable.Row
      id={String(p.sku)}
      key={p.sku}
      position={index}
    >
      <IndexTable.Cell>
        <Text as="span" variant="bodyMd" fontWeight="semibold">{p.sku}</Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodyMd">{p.name}</Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodyMd">{p.price} ₺</Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        {p.b2b_price
          ? <Badge tone="success">{`${String(p.b2b_price)} ₺`}</Badge>
          : <Text as="span" variant="bodySm" tone="subdued">—</Text>}
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Badge tone={Number(p.stock) > 0 ? "success" : "critical"}>{String(p.stock)}</Badge>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <BlockStack gap="300">
      <Card padding="0">
        <IndexTable
          resourceName={resourceName}
          itemCount={products.length}
          selectable={false}
          headings={[
            { title: "SKU" },
            { title: "Ürün Adı" },
            { title: "Fiyat" },
            { title: "B2B Fiyat" },
            { title: "Stok" },
          ]}
        >
          {rowMarkup}
        </IndexTable>
      </Card>

      {totalPages > 1 && (
        <Box paddingBlockStart="200">
          <InlineStack align="center">
            <BlockStack gap="200" inlineAlign="center">
              <Text as="span" variant="bodySm" tone="subdued">
                {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, products.length)} / {products.length} ürün
              </Text>
              <Pagination
                hasPrevious={page > 0}
                onPrevious={() => setPage((p) => Math.max(0, p - 1))}
                hasNext={page < totalPages - 1}
                onNext={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              />
            </BlockStack>
          </InlineStack>
        </Box>
      )}
    </BlockStack>
  );
}

// ── Log Mesajı Üretici ────────────────────────────────────────────────────────
function buildLogMessage(log: any): string {
  const detail: string = log.details || "";
  const synced: number = log.productsSynced ?? 0;

  // BULK_SYNC: details alanı zaten akıllı, satır satır mesaj içeriyor
  if (log.actionType === "BULK_SYNC") {
    if (detail.includes("[Anlık Güncelleme]")) return detail;

    if (detail.includes("📊 Özet:")) {
      const summary = detail.split("📊 Özet:")[1].trim();
      // Önemli işlemler (silme/temizleme) varsa detayı göster, yoksa (sadece ekleme/güncelleme) genel mesaj ver
      if (summary.includes("kaldırıldı") || summary.includes("temizlendi")) {
        return "[Artımlı Senkronizasyon] " + summary + " başarıyla tamamlandı.";
      }
    }
    return `[Artımlı Senkronizasyon] ${synced} ürün Shopify ile senkronize edildi.`;
  }

  if (log.actionType === "MANUAL_SYNC") {
    return `[Manuel Senkronizasyon] Veri analizi tamamlandı. ${synced} ürün Shopify mağazasına başarıyla aktarıldı.`;
  }

  if (log.actionType === "CACHE_REFRESH") {
    return `[Veri Yenileme] Ürün verileri Laravel API'sinden başarıyla güncellendi.`;
  }

  if (log.actionType === "WEBHOOK_SYNC") {
    // Yeni emoji formatlı veya profesyonel logları direkt döndür
    if (
      detail.includes("SKU:") || 
      detail.includes("Shopify") || 
      detail.includes("📦") || 
      detail.includes("❌") || 
      detail.includes("✍️")
    ) {
      return detail;
    }

    // Fallback/Yedek mantığı (Regex ile veriyi ayıkla)
    const skuM = detail.match(/SKU[:\s]+([\w\-]+)/i);
    // '->' veya '➔' sonrasındaki son sayıyı bul (Yeni Stok)
    const stockM = detail.match(/[➔\-➔]\s*(\d+)/) || detail.match(/stok[:\s]*(\d+)/i);
    const oldStockM = detail.match(/(\d+)\s*[➔\-➔]/);

    const sku = skuM?.[1] ?? "—";
    const stock = stockM?.[1] ?? "?";
    const oldStock = oldStockM?.[1] ?? "...";

    return `SKU: ${sku} Shopify üzerinden güncelleme alındı | Stok: ${oldStock} ➔ ${stock}`;
  }

  if (log.status === "ERROR" || log.status === "FAILED") {
    const skuM = detail.match(/SKU[:\s]+([\w\-]+)/i);
    const sku = skuM?.[1] ?? "—";
    return `[Senkronizasyon Hatası] ${sku !== "—" ? `${sku} güncellenemedi.` : ""} Hata: Ürün SKU eşleşmesi bulunamadı veya API isteği zaman aşımına uğradı.`;
  }

  return detail || log.actionType;
}

// ── Ana Sayfa Bileşeni ────────────────────────────────────────────────────────
export default function Index() {
  const { products, logs } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const actionData = fetcher.data;

  const isSyncing = fetcher.state !== "idle" && fetcher.formData?.get("_action") === "sync";
  const isSyncingIncremental = fetcher.state !== "idle" && fetcher.formData?.get("_action") === "sync-incremental";
  const isRefreshing = fetcher.state !== "idle" && fetcher.formData?.get("_action") === "refresh";

  const currentProducts = (actionData?.products || products || []);
  const visibleProducts = currentProducts.filter(isActiveProduct);
  const currentLogs = actionData?.logs || logs || [];

  return (
    <Page
      fullWidth={true}
      title="Ürün Senkronizasyon Merkezi"
      primaryAction={{
        content: "Shopify'a Senkronize Et",
        onAction: () => fetcher.submit({ _action: "sync" }, { method: "POST" }),
        loading: isSyncing,
      }}
      secondaryActions={[
        {
          content: "Artırılmış Senkronize Et (Incremental)",
          onAction: () => fetcher.submit({ _action: "sync-incremental" }, { method: "POST" }),
          loading: isSyncingIncremental,
        },
        {
          content: "Verileri Yenile",
          onAction: () => fetcher.submit({ _action: "refresh" }, { method: "POST" }),
          loading: isRefreshing,
        },
      ]}
    >
      <BlockStack gap="400">
        {/* Bildirimler */}
        {actionData?.success && (
          <Banner title="İşlem Başarılı" tone="success">
            <p>{actionData.message}</p>
          </Banner>
        )}
        {actionData?.error && (
          <Banner title="Hata" tone="critical">
            <p>{actionData.error}</p>
          </Banner>
        )}

        {/* Hero stat bar */}
        <div style={{
          background: "linear-gradient(135deg, #1a1f36 0%, #0d3068 50%, #1a1f36 100%)",
          borderRadius: "12px",
          padding: "20px 24px",
          display: "flex",
          gap: "16px",
          flexWrap: "wrap",
          boxShadow: "0 4px 24px rgba(0,0,0,0.18)",
        }}>
          {/* Stat: Toplam Ürün */}
          <div style={{
            flex: "1 1 160px",
            background: "rgba(255,255,255,0.07)",
            borderRadius: "10px",
            padding: "14px 18px",
            borderLeft: "4px solid #5c6ac4",
          }}>
            <div style={{ color: "#a5b4fc", fontSize: "11px", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "6px" }}>Toplam Ürün</div>
            <div style={{ color: "#fff", fontSize: "28px", fontWeight: 700, lineHeight: 1 }}>{visibleProducts.length || 0}</div>
          </div>

          {/* Stat: Son İşlem */}
          <div style={{
            flex: "1 1 160px",
            background: "rgba(255,255,255,0.07)",
            borderRadius: "10px",
            padding: "14px 18px",
            borderLeft: "4px solid #9b59b6",
          }}>
            <div style={{ color: "#d8b4fe", fontSize: "11px", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "6px" }}>Son İşlem</div>
            <div style={{ color: "#fff", fontSize: "15px", fontWeight: 600, lineHeight: 1.3 }}>
              {currentLogs[0] ? new Date(currentLogs[0].createdAt).toLocaleTimeString("tr-TR") : "—"}
            </div>
          </div>

          {/* Stat: Log Sayısı */}
          <div style={{
            flex: "1 1 160px",
            background: "rgba(255,255,255,0.07)",
            borderRadius: "10px",
            padding: "14px 18px",
            borderLeft: "4px solid #10b981",
          }}>
            <div style={{ color: "#6ee7b7", fontSize: "11px", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "6px" }}>İşlem Logu</div>
            <div style={{ color: "#fff", fontSize: "28px", fontWeight: 700, lineHeight: 1 }}>{currentLogs.length}</div>
          </div>

          {/* Stat: Webhook */}
          <div style={{
            flex: "1 1 160px",
            background: "rgba(255,255,255,0.07)",
            borderRadius: "10px",
            padding: "14px 18px",
            borderLeft: "4px solid #f59e0b",
          }}>
            <div style={{ color: "#fcd34d", fontSize: "11px", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "6px" }}>Webhook</div>
            <div style={{ color: "#fff", fontSize: "15px", fontWeight: 600, lineHeight: 1.3 }}>Aktif 🟢</div>
          </div>
        </div>

        {/* İçerik Alanı - Tam Genişlik */}
        <BlockStack gap="500">
          {/* Üst Kısım: Ürün Listesi */}
          <BlockStack gap="300">
            <div style={{
              background: "linear-gradient(90deg, #0d3068 0%, #1a1f36 100%)",
              borderRadius: "10px",
              padding: "12px 18px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}>
              <span style={{ color: "#fff", fontWeight: 700, fontSize: "15px", letterSpacing: "0.02em" }}>
                📦 Ürün Listesi
              </span>
              <span style={{
                background: "#5c6ac4",
                color: "#fff",
                borderRadius: "20px",
                padding: "2px 12px",
                fontSize: "12px",
                fontWeight: 600,
              }}>
                {visibleProducts.length} ürün
              </span>
            </div>
            <ProductTable products={visibleProducts} />
          </BlockStack>

          {/* Alt Kısım: Loglar (Tam Genişlik) */}
          <div style={{
            background: "#fff",
            borderRadius: "12px",
            boxShadow: "0 2px 12px rgba(0,0,0,0.08)",
            overflow: "hidden",
            marginBottom: "40px",
          }}>
            {/* Kart Başlığı */}
            <div style={{
              background: "linear-gradient(90deg, #1a1f36 0%, #0d3068 100%)",
              padding: "14px 18px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}>
              <span style={{ color: "#fff", fontWeight: 700, fontSize: "14px" }}>
                🕐 Son İşlem Logları
              </span>
              <span style={{
                background: "rgba(255,255,255,0.15)",
                color: "#fff",
                borderRadius: "20px",
                padding: "2px 10px",
                fontSize: "12px",
                fontWeight: 600,
              }}>
                {currentLogs.length}
              </span>
            </div>

            {/* Scroll Alanı (Scrollable ve MaxHeight 700px) */}
            <Scrollable style={{ maxHeight: "700px" }} focusable>
              <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
                {currentLogs.length === 0 ? (
                  <div style={{ padding: "24px", textAlign: "center", color: "#8c9196" }}>
                    Henüz işlem logu yok.
                  </div>
                ) : (
                  currentLogs.map((log: any) => {
                    const isSuccess = log.status === "SUCCESS";
                    const isWarning = log.status === "WARNING";
                    return (
                      <div key={log.id} style={{
                        borderRadius: "8px",
                        padding: "12px 16px",
                        borderLeft: `4px solid ${isSuccess ? "#10b981" : isWarning ? "#f59e0b" : "#ef4444"}`,
                        background: isSuccess ? "#f0fdf4" : isWarning ? "#fffbeb" : "#fef2f2",
                        display: "flex",
                        flexDirection: "column",
                        gap: "6px",
                      }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontWeight: 700, fontSize: "12px", color: isSuccess ? "#1a1f36" : "#b91c1c" }}>
                            {log.actionType === "CACHE_REFRESH"
                              ? "🔄 Veri Yenileme"
                              : log.actionType === "BULK_SYNC"
                                ? "⚡ Artımlı Sync"
                                : log.actionType === "WEBHOOK_SYNC"
                                  ? "🔔 Webhook Sync"
                                  : "🔗 Shopify Sync"}
                          </span>
                          <span style={{
                            fontSize: "10px",
                            fontWeight: 700,
                            padding: "2px 8px",
                            borderRadius: "20px",
                            background: log.status === "SUCCESS" ? "#10b981" : log.status === "WARNING" ? "#f59e0b" : "#ef4444",
                            color: "#fff",
                          }}>
                            {log.status === "SUCCESS" ? "BAŞARILI" : log.status === "WARNING" ? "DİKKAT" : log.status === "FAILED" || log.status === "ERROR" ? "HATA" : log.status}
                          </span>
                        </div>
                        {log.productsSynced != null && (
                          <div style={{ fontSize: "11px", color: "#6b7280", marginBottom: "4px" }}>
                            <b>{log.productsSynced} Ürün İşlendi</b>
                            <hr style={{ border: "0", borderTop: "1px solid #e5e7eb", margin: "4px 0" }} />
                          </div>
                        )}
                        {/* Karakter sınırı kaldırıldı, alta sarması için pre-wrap eklendi */}
                        <span style={{
                          fontSize: "12px",
                          color: isSuccess ? "#4b5563" : "#991b1b",
                          lineHeight: 1.5,
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                          display: "block"
                        }}>
                          <InlineStack gap="200" align="start">
                            {log.source === "order" && <Badge tone="success">Sipariş Oluşturuldu</Badge>}
                            {log.source === "cancel" && <Badge tone="critical">Sipariş İptal Edildi</Badge>}
                            {log.source === "manual" && <Badge tone="info">Manuel Güncelleme</Badge>}
                            <Text as="span" variant="bodyMd">
                              {buildLogMessage(log)
                                .replace(/^(🛒|🔧|⚡|🔄|📊|📦|✍️|❌)\s*/, "") // Remove lead emojis including cancel
                              }
                            </Text>
                          </InlineStack>
                        </span>
                        <span style={{ fontSize: "10px", color: "#9ca3af", marginTop: "4px" }}>
                          {new Date(log.createdAt).toLocaleString("tr-TR")}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </Scrollable>
          </div>
        </BlockStack>
      </BlockStack>
    </Page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
