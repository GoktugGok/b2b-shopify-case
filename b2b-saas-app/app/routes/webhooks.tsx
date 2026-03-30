import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  console.log("Incoming webhook request topic:", request.headers.get("x-shopify-topic"));
  const { shop, payload, topic, admin } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  switch (topic) {
    case "APP_UNINSTALLED":
      await prisma.session.deleteMany({ where: { shop } });
      break;

    case "INVENTORY_LEVELS_UPDATE":
      console.log("🔔 WEBHOOK PAYLOAD (FULL):", JSON.stringify(payload, null, 2));
      const { inventory_item_id, available, updated_at, reason } = payload as any;
      console.log("🔔 WEBHOOK GELDİ: INVENTORY_LEVELS_UPDATE", payload);

      if (admin) {
        try {
          const response = await admin.graphql(
            `#graphql
            query {
              inventoryItem(id: "gid://shopify/InventoryItem/${inventory_item_id}") {
                variant {
                  sku
                }
              }
            }`
          );
          const result = await response.json();
          const sku = result.data?.inventoryItem?.variant?.sku;

          if (sku) {
            console.log("✅ SKU BULUNDU:", sku, "YENİ STOK:", available);

            // Araştırmacı mod: PendingOrderSku tablosunda bu SKU var mı?
            const pendingOrder = await (prisma as any).pendingOrderSku.findFirst({
              where: {
                sku: sku,
                createdAt: { gte: new Date(Date.now() - 30000) } // Son 30 sn
              }
            });

            const laravelResponse = await fetch("http://127.0.0.1:8000/api/webhook/inventory", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Shopify-Hmac-Sha256": request.headers.get("x-shopify-hmac-sha256") || "",
                "X-Shopify-Topic": topic
              },
              body: JSON.stringify({
                sku,
                stock: available,
                reason: reason || (pendingOrder ? "order" : null),
                inventory_item_id: inventory_item_id,
                is_pending_match: !!pendingOrder
              }),
            });

            const responseText = await laravelResponse.text();
            console.log("🚀 LARAVEL YANITI:", responseText);

            let logDetails = "";
            let source = pendingOrder ? "order" : "manual";

            try {
              const resData = JSON.parse(responseText);
              if (resData.message === 'Geçerli bir değişiklik tespit edilmedi.') {
                return new Response("Echo ignored", { status: 200 });
              }
              logDetails = resData.details || `[Webhook] Stok Güncellemesi: SKU ${sku} -> ${available}`;
              source = resData.source || source;
            } catch (err) {
              logDetails = `[Webhook] Stok Güncellemesi: SKU ${sku} -> ${available}`;
            }

            if (laravelResponse.ok) {
              await (prisma.syncLog as any).create({
                data: {
                  actionType: "WEBHOOK_SYNC",
                  status: "SUCCESS",
                  productsSynced: 1,
                  source,
                  details: logDetails,
                },
              });

              // Eğer eşleştiyse o SKU'ya ait TÜM pending kayıtlarını temizle (Mükerrer webhookları öldür)
              if (pendingOrder) {
                await (prisma as any).pendingOrderSku.deleteMany({
                  where: { sku: sku }
                });
              }
            }
          }
        } catch (error) {
          console.error("❌ WEBHOOK HATASI (INVENTORY):", error);
        }
      }
      break;

    case "ORDERS_CREATE":
    case "ORDERS_FULFILLED":
    case "ORDERS_PAID":
    case "ORDERS_EDITED":
    case "ORDERS_CANCELLED":
      const orderData = payload as any;
      const orderName = orderData.name || `#${orderData.order_number}` || "Bilinmeyen Sipariş";
      const isCancellation = topic === "ORDERS_CANCELLED" || topic === "ORDERS_EDITED";
      const endpoint = isCancellation ? "orders/cancel" : "orders";

      console.log(`🔔 WEBHOOK GELDİ (ORDER): ${topic} -> ${endpoint} -> ${orderName}`);
      console.log("📦 SIPARIŞ DETAYI:", JSON.stringify(payload, null, 2));
      try {
        await fetch(`http://127.0.0.1:8000/api/webhook/${endpoint}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Hmac-Sha256": request.headers.get("x-shopify-hmac-sha256") || "",
            "X-Shopify-Topic": topic
          },
          body: JSON.stringify(payload),
        });

        const orderLineItems = (payload as any).line_items || [];
        for (const item of orderLineItems) {
          if (item.sku) {
            // İdemmopotency: Eğer son 10 sn içinde bu SKU için bir kayıt zaten atıldıysa mükerrer atma
            const existingPending = await (prisma as any).pendingOrderSku.findFirst({
              where: {
                sku: item.sku,
                createdAt: { gte: new Date(Date.now() - 10000) }
              }
            });

            if (!existingPending) {
              await (prisma as any).pendingOrderSku.create({
                data: { sku: item.sku }
              }).catch(() => { });
            }

            // Retroactive log correction: Find manual WEBHOOK_SYNC logs for these SKUs in the last 60 seconds
            const recentManualLog = await (prisma.syncLog as any).findFirst({
              where: {
                actionType: "WEBHOOK_SYNC",
                source: "manual",
                createdAt: { gte: new Date(Date.now() - 60000) },
                details: { contains: item.sku }
              }
            });

            if (recentManualLog) {
              /* GÜVENLİK KORUMASI: Sadece stok farkı, sipariş adetleriyle tam eşleşiyorsa logu siparişe çek */
              const oldM = recentManualLog.details.match(/(\d+)\s*[➔\-➔]/);
              const newM = recentManualLog.details.match(/[➔\-➔]\s*(\d+)/);
              
              if (oldM && newM) {
                const diff = parseInt(newM[1], 10) - parseInt(oldM[1], 10);
                const expectedDiff = isCancellation ? Number(item.quantity) : -Number(item.quantity);

                if (diff === expectedDiff) {
                  let newDetails = recentManualLog.details;
                  if (isCancellation) {
                    newDetails = newDetails
                      .replace("✍️ Manuel ellendi", `❌ Sipariş iptal oldu ${orderName}`)
                      .replace("📦 Sipariş oluşturuldu", `❌ Sipariş iptal oldu ${orderName}`);
                  } else {
                    newDetails = newDetails
                      .replace("✍️ Manuel ellendi", `📦 Sipariş oluşturuldu ${orderName}`);
                  }

                  await (prisma.syncLog as any).update({
                    where: { id: recentManualLog.id },
                    data: {
                      source: isCancellation ? "cancel" : "order",
                      details: newDetails
                    }
                  });
                  console.log(`✅ Log Düzeltildi: SKU ${item.sku} (#${orderName}) [Miktar Doğrulandı]`);
                } else {
                  console.log(`ℹ️ Log Korundu: SKU ${item.sku} [Miktar Farklı: Manuel=${diff}, Sipariş=${expectedDiff}]`);
                }
              }
            }
          }
        }
      } catch (error) {
        console.error("❌ WEBHOOK HATASI (ORDERS):", error);
      }
      break;


    default:
      console.log("Unhandled webhook topic:", topic);
  }

  return new Response();
};
