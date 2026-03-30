import type { ActionFunctionArgs } from "react-router";
import shopify from "../shopify.server";
import prisma from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  // 1. Sadece POST isteklerini kabul et
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" }
    });
  }

  // 2. Güvenlik Kalkanı (Authorization: Bearer <SYNC_SECRET_KEY>)
  const authHeader = request.headers.get("Authorization");
  const expectedToken = process.env.SYNC_SECRET_KEY;

  if (!expectedToken) {
    console.warn("⚠️ SYNC_SECRET_KEY .env dosyasında bulunamadı!");
    return new Response(JSON.stringify({ error: "Sunucu konfigürasyon hatası." }), { status: 500 });
  }

  if (!authHeader || authHeader !== `Bearer ${expectedToken}`) {
    return new Response(JSON.stringify({ error: "Unauthorized / Yetkisiz erişim." }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }

  try {
    const body = await request.json();
    const { sku, stock, price, b2b_price, is_on_shopify: ios, is_published } = body;

    // Robust isPassive check
    const isPassive = ios === false || ios === 0 || ios === "0" || body.status === 'passive';

    console.log(`🚀 [SYNC] Gelen body: SKU=${sku}, ios=${ios}, isPassive=${isPassive}, pub=${is_published}`);

    if (!sku) {
      return new Response(JSON.stringify({ error: "SKU eksik." }), { status: 400 });
    }

    const session = await prisma.session.findFirst({ where: { isOnline: false } });
    if (!session) return new Response(JSON.stringify({ error: "Session yok." }), { status: 401 });

    const { admin } = await shopify.unauthenticated.admin(session.shop);

    const findQuery = `
      query findBySku($query: String!) {
        locations(first: 1) { edges { node { id } } }
        publications(first: 10) { edges { node { id name } } }
        productVariants(first: 1, query: $query) {
          edges {
            node {
              id
              product { id }
              inventoryItem { id }
            }
          }
        }
      }
    `;

    const findResult: any = await admin.graphql(findQuery, { variables: { query: `sku:"${sku}"` } });
    const parsedFindResult = await findResult.json();
    const locationId = parsedFindResult.data?.locations?.edges[0]?.node?.id;
    const variantNode = parsedFindResult.data?.productVariants?.edges[0]?.node;
    const onlineStorePubId = parsedFindResult.data?.publications?.edges?.find((e: any) => e.node.name === "Online Store")?.node?.id;

    // --- SENARYO A: Pasif (SİL) ---
    if (isPassive) {
      if (variantNode) {
        await admin.graphql(
          `mutation productDelete($input: ProductDeleteInput!) { productDelete(input: $input) { deletedProductId } }`,
          { variables: { input: { id: variantNode.product.id } } }
        );
        await prisma.syncLog.create({
          data: {
            actionType: "MANUAL_SYNC",
            status: "SUCCESS",
            details: `[Anlık Güncelleme] ${sku} - Ürün Shopify mağazasından başarıyla kaldırıldı ve dış kaynağa (Laravel) geri çekildi.`,
          },
        });
      }
      return new Response(JSON.stringify({ success: true, message: "Ürün silindi (veya zaten yoktu)." }));
    }

    // --- SENARYO B: Aktif (GÜNCELLE) ---
    if (!locationId || !variantNode) {
      return new Response(JSON.stringify({ error: `Shopify'da SKU (${sku}) bulunamadı.` }), { status: 404 });
    }

    const productId = variantNode.product.id;
    const variantId = variantNode.id;
    const results: any = { updated: [] };

    // Yayın durumu (ACTIVE/DRAFT)
    if (is_published !== undefined && is_published !== null) {
      await admin.graphql(
        `mutation pUpdate($input: ProductInput!) { productUpdate(input: $input) { product { id } } }`,
        { variables: { input: { id: productId, status: is_published ? "ACTIVE" : "DRAFT" } } }
      );

      console.log(`📡 [SYNC] Yayın Kanalları Kontrol Ediliyor: is_published=${is_published}, OnlineStorePubID=${onlineStorePubId}`);

      // Online Store kanalı yayınlama/yayından kaldırma garantisi
      if (onlineStorePubId) {
        if (is_published) {
          await admin.graphql(
            `mutation publish($id: ID!, $input: [PublicationInput!]!) { publishablePublish(id: $id, input: $input) { userErrors { message } } }`,
            { variables: { id: productId, input: [{ publicationId: onlineStorePubId }] } }
          );
          console.log(`✅ [SYNC] Online Mağaza'da YAYINLANDI. SKU=${sku}`);
        } else {
          await admin.graphql(
            `mutation unpublish($id: ID!, $input: [PublicationInput!]!) { publishableUnpublish(id: $id, input: $input) { userErrors { message } } }`,
            { variables: { id: productId, input: [{ publicationId: onlineStorePubId }] } }
          );
          console.log(`🚫 [SYNC] Online Mağaza'dan KALDIRILDI. SKU=${sku}`);
        }
      }
      results.updated.push("status");
    }

    // Fiyat
    if (price !== undefined && price !== null) {
      await admin.graphql(
        `mutation pv($input: ProductVariantInput!) { productVariantUpdate(input: $input) { productVariant { id } } }`,
        { variables: { input: { id: variantId, price: price.toString() } } }
      );
      results.updated.push("price");
    }

    // Stok
    if (stock !== undefined && stock !== null) {
      await admin.graphql(
        `mutation inv($input: InventorySetQuantitiesInput!) { inventorySetQuantities(input: $input) { inventoryAdjustmentGroup { reason } } }`,
        { variables: { input: { name: "available", reason: "correction", quantities: [{ inventoryItemId: variantNode.inventoryItem.id, locationId, quantity: parseInt(stock, 10) }] } } }
      );
      results.updated.push("stock");
    }

    // B2B Fiyatı
    if (b2b_price !== undefined && b2b_price !== null) {
      await admin.graphql(
        `mutation mf($metafields: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $metafields) { metafields { id } } }`,
        { variables: { metafields: [{ namespace: "custom", key: "b2b_price", type: "number_decimal", value: b2b_price.toString(), ownerId: variantId }] } }
      );
      results.updated.push("b2b_price");
    }

    // Akıllı Log Mesajı
    const joinTr = (parts: string[]): string => {
      if (parts.length === 0) return "";
      if (parts.length === 1) return parts[0];
      return parts.slice(0, -1).join(", ") + " ve " + parts[parts.length - 1];
    };

    const labelMap: any = { price: "Fiyat", stock: "Stok", b2b_price: "B2B fiyatı", status: "Yayın durumu" };
    const changedFields = results.updated.map((f: string) => labelMap[f]);

    let detail = "";
    if (changedFields.length > 0) {
      detail = `${joinTr(changedFields)} güncellendi`;
      detail += " ve aktif edildi.";
    } else {
      detail = "bilgileri güncellendi ve aktif edildi.";
    }

    await prisma.syncLog.create({
      data: {
        actionType: "MANUAL_SYNC",
        status: "SUCCESS",
        details: `[Anlık Güncelleme] ${sku} - ${detail}`,
      },
    });

    return new Response(JSON.stringify({ success: true }));

  } catch (error: any) {
    console.error("Sync Hatası:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
};
