const express = require('express');
const path = require('path');
const sharp = require('sharp');

const app = express();
const PORT = process.env.PORT || 3000;

// Accept up to 10MB JSON bodies (captured images are ~1-3MB as base64)
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

/**
 * POST /preprocess
 * Body: { image: "data:image/jpeg;base64,..." }
 * Returns: { image: "data:image/png;base64,..." }
 *
 * Pipeline: grayscale → normalize → sharpen → threshold
 * This gives Tesseract high-contrast black-on-white text.
 */
app.post('/preprocess', async (req, res) => {
  try {
    const { image } = req.body;
    if (!image) return res.status(400).json({ error: 'No image provided' });

    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
    const inputBuffer = Buffer.from(base64Data, 'base64');

    const outputBuffer = await sharp(inputBuffer)
      .greyscale()
      .normalize()          // stretch histogram to full 0-255 range
      .sharpen({ sigma: 1.5 })
      .threshold(140)       // binarize: text → black, background → white
      .png()
      .toBuffer();

    const outputBase64 = 'data:image/png;base64,' + outputBuffer.toString('base64');
    res.json({ image: outputBase64 });
  } catch (err) {
    console.error('Preprocess error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Shelf Reader running on port ${PORT}`);
});
