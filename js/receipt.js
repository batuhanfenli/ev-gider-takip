// Fiş fotoğrafını küçültür ve Claude'a okutup kalemleri kategorilere ayırır.
// Anthropic SDK (0.130.0) tarayıcı için tek dosyada paketlendi: js/vendor/anthropic-sdk.js
const SDK_URL = "./vendor/anthropic-sdk.js";
const MODEL = "claude-opus-5-5";

// Fotoğrafı en uzun kenarı maxSide olacak şekilde JPEG'e çevirir.
export async function resizeImage(file, maxSide, quality) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvas.toDataURL("image/jpeg", quality);
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["store", "date", "total", "items"],
  properties: {
    store: { type: "string", description: "Mağaza adı, okunamıyorsa boş" },
    date: { type: "string", description: "Fiş tarihi YYYY-MM-DD, okunamıyorsa boş" },
    total: { type: "number", description: "Fişin ödenen genel toplamı (TL)" },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "amount", "categoryId", "sub"],
        properties: {
          name: { type: "string" },
          amount: { type: "number", description: "Kalemin indirimler düşülmüş son tutarı (TL)" },
          categoryId: { type: "string" },
          sub: { type: "string" },
        },
      },
    },
  },
};

export async function readReceipt({ apiKey, imageDataUrl, categories }) {
  const { default: Anthropic } = await import(SDK_URL);
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const catalog = categories
    .map((c) => `- ${c.id} (${c.name}): ${c.subs.join(" | ")}`)
    .join("\n");

  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: imageDataUrl.split(",")[1] } },
        { type: "text", text:
`Bu bir Türkiye'de alınmış alışveriş fişi. Her satın alınan kalemi oku ve aşağıdaki kategorilerden birine ata.
categoryId alanına listedeki kimliği, sub alanına o kategorinin alt kategorilerinden birini birebir aynı yazımla yaz.
İndirimleri ilgili kalemin tutarından düş; kalem tutarlarının toplamı fişin ödenen toplamına eşit olsun.
KDV, ara toplam, ödeme ve para üstü satırlarını kalem olarak ekleme. Kalem adlarını anlaşılır Türkçe ile yaz.

Kategoriler:
${catalog}` },
      ],
    }],
  });

  if (response.stop_reason === "refusal") throw new Error("Fiş okunamadı, lütfen tekrar deneyin.");
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const data = JSON.parse(text);

  // Modelin listede olmayan bir kategori yazması durumuna karşı en yakın geçerli değere çek.
  const fallback = categories.find((c) => c.id === "diger") || categories[categories.length - 1];
  data.items = data.items.map((it) => {
    const cat = categories.find((c) => c.id === it.categoryId) || fallback;
    const sub = cat.subs.includes(it.sub) ? it.sub : cat.subs[0];
    return { ...it, categoryId: cat.id, sub, amount: Math.round(it.amount * 100) / 100 };
  });
  return data;
}
