const express = require('express');
const path = require('path');
const OpenAI = require('openai');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const PROMPT = `You are reading a photo of library book spines.
Find the small rectangular call number labels (white stickers) near the bottom of each spine.
Extract every Library of Congress call number you can see, in left-to-right shelf order.

LC call numbers look like: "DD 256.5 .B94 2000" or "E 98 .L3 J65" or "F 869 .S35 L44"

Return ONLY a valid JSON array of strings — one call number per book, no explanation, no markdown.
If a label is unreadable, make your best guess. Skip publisher labels (PUTNAM, STANFORD, etc).
Example output: ["DD 256.5 .B94 2000", "E 98 .L3 J65 2000", "F 869 .S35 L44"]`;

/**
 * POST /extract
 * Body: { image: "data:image/jpeg;base64,..." }
 * Returns: { callNumbers: string[] }
 */
app.post('/extract', async (req, res) => {
  try {
    const { image } = req.body;
    if (!image) return res.status(400).json({ error: 'No image provided' });

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: image, detail: 'high' } },
          { type: 'text', text: PROMPT },
        ],
      }],
      max_tokens: 500,
    });

    const text = response.choices[0].message.content.trim();

    // Strip markdown code fences if model wraps the JSON
    const json = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    const callNumbers = JSON.parse(json);

    if (!Array.isArray(callNumbers)) throw new Error('Expected JSON array');

    res.json({ callNumbers });
  } catch (err) {
    console.error('Extract error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Shelf Reader running on port ${PORT}`);
});
