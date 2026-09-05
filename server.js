const express = require('express');
const cors = require('cors');
const catalog = require('./catalog.json');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' })); // الصور base64 بتكون كبيرة نسبياً

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// ---------- تطبيع النص العربي عشان المطابقة تبقى أدق ----------
function normalize(s) {
  return (s || '').toString()
    .replace(/[إأآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[\u064B-\u0652]/g, '')
    .trim()
    .toLowerCase();
}

// ---------- مطابقة اسم مستخرج من الصورة مع الكتالوج ----------
function matchItem(name) {
  const norm = normalize(name);
  for (const item of catalog) {
    for (const kw of item.keywords) {
      const nkw = normalize(kw);
      if (norm.includes(nkw) || nkw.includes(norm)) return item;
    }
  }
  return null;
}

// ---------- Endpoint 1: يستقبل صورة، يرجع الأصناف المستخرجة ----------
app.post('/analyze', async (req, res) => {
  try {
    const { imageBase64, mediaType } = req.body;
    if (!imageBase64) return res.status(400).json({ error: 'imageBase64 required' });
    if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured on server' });

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: imageBase64 } },
            {
              type: 'text',
              text: 'استخرج من هذه الصورة كل الأصناف المكتوبة في قائمة الأدوات المدرسية. أرجع فقط JSON صافي بدون أي نص إضافي أو علامات markdown، بالشكل التالي بالضبط: [{"item":"اسم الصنف بالعربي","quantity":عدد}]. لو الكمية غير مذكورة اعتبرها 1.'
            }
          ]
        }]
      })
    });

    const data = await response.json();
    const textBlock = (data.content || []).find(b => b.type === 'text');
    if (!textBlock) return res.status(502).json({ error: 'no text returned from model', raw: data });

    const clean = textBlock.text.replace(/```json|```/g, '').trim();
    let extracted;
    try {
      extracted = JSON.parse(clean);
    } catch (e) {
      return res.status(422).json({ error: 'could not parse items from image, try a clearer photo', raw: textBlock.text });
    }

    res.json({ extracted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Endpoint 2: يستقبل الأصناف + المستوى، يرجع الأسعار والإجمالي ----------
app.post('/price', (req, res) => {
  const { items, tier } = req.body; // items: [{item, quantity}], tier: 'economic' | 'premium'
  if (!items || !tier) return res.status(400).json({ error: 'items and tier are required' });

  let grandTotal = 0;
  const priced = items.map(entry => {
    const qty = Number(entry.quantity) || 1;
    const match = matchItem(entry.item);
    if (!match) {
      return { name: entry.item, quantity: qty, matched: false };
    }
    const price = match[tier];
    const lineTotal = price * qty;
    grandTotal += lineTotal;
    return { name: match.name, quantity: qty, price, lineTotal, matched: true };
  });

  res.json({ items: priced, grandTotal, tier });
});

app.get('/', (req, res) => res.send('School Supplies API is running ✅'));

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log('Server running on port ' + PORT));
}

module.exports = app; // مطلوب عشان Vercel تقدر تستضيف السيرفر من غير app.listen
