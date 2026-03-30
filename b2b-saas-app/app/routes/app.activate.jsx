import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  
  // LİSTEDEN GELEN GERÇEK VE ÇALIŞAN ID ✅
  const functionId = "019d0b5b-e174-7d3c-816e-5de098645fe2"; 

  const response = await admin.graphql(
    `#graphql
    mutation discountAutomaticAppCreate($automaticAppDiscount: DiscountAutomaticAppInput!) {
      discountAutomaticAppCreate(automaticAppDiscount: $automaticAppDiscount) {
        automaticAppDiscount {
          title
          status
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        automaticAppDiscount: {
          title: "B2B Özel Fiyatlandırma",
          functionId: functionId,
          startsAt: new Date().toISOString()
        }
      }
    }
  );

  const responseJson = await response.json();
  const result = responseJson.data?.discountAutomaticAppCreate || {};
  
  // HTML Olarak Dön (Kullanıcı Sonucu Görsün)
  return new Response(
    `<html>
      <body style="font-family: sans-serif; padding: 2rem; line-height: 1.6; color: #333;">
        <h1 style="color: #0f766e;">🚀 B2B İndirim Motoru Durumu</h1>
        <hr />
        <p><strong>Sonuç:</strong> ${result.userErrors?.length > 0 ? "❌ Hata Oluştu" : "✅ Başarıyla Aktif Edildi!"}</p>
        <pre style="background: #f4f4f4; padding: 1rem; border-radius: 8px; border: 1px solid #ddd;">
${JSON.stringify(responseJson, null, 2)}
        </pre>
        <p>Eğer yukarıda "userErrors: []" (boş liste) görüyorsan, artık sepete gidip indirimleri test edebilirsin knk.</p>
        <a href="../" style="display: inline-block; margin-top: 1rem; padding: 0.5rem 1rem; background: #0f766e; color: #fff; text-decoration: none; border-radius: 4px;">Panele Dön</a>
      </body>
    </html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
};

export default function Activate() {
  return null;
}
