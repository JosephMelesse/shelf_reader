const express = require('express');
const path = require('path');
const sharp = require('sharp');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

/**
 * POST /preprocess
 * Body: { image: "data:image/jpeg;base64,..." }
 * Returns: { image: "data:image/png;base64,..." }
 *
 * Call number labels are small stickers sitting at ~68-78% of image height
 * on a typical phone photo of a shelf. The spine titles above and the shelf
 * below are discarded entirely.
 *
 * Pipeline:
 *   1. Crop to 68-78% of image height — isolates the label row
 *   2. Scale up 3x — gives Tesseract enough resolution for small label text
 *   3. Greyscale → normalize → sharpen → threshold(190) — clean B&W output
 */
app.post('/preprocess', async (req, res) => {
  try {
    const { image } = req.body;
    if (!image) return res.status(400).json({ error: 'No image provided' });

    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
    const inputBuffer = Buffer.from(base64Data, 'base64');

    const { width, height } = await sharp(inputBuffer).metadata();

    const cropTop = Math.round(height * 0.68);
    const cropHeight = Math.round(height * 0.10);

    const outputBuffer = await sharp(inputBuffer)
      .extract({ left: 0, top: cropTop, width, height: cropHeight })
      .resize({ width: width * 3 })
      .greyscale()
      .normalize()
      .sharpen({ sigma: 1.5 })
      .threshold(190)
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
