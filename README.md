# Shelf Reader

A mobile-first PWA that helps librarians verify Library of Congress call numbers are in correct shelf order. Point your phone camera at a shelf of books, tap Scan, and the app flags any books that are out of sequence.

## Features

- **Camera capture** — uses the rear-facing camera via `getUserMedia`
- **OCR** — Tesseract.js (v5) extracts text from spine label images
- **LC call number parsing** — handles class letters, class numbers (integer + decimal), two cutter numbers (sorted as decimals per LC rules), and year
- **Shelf order checking** — highlights out-of-order books in red and tells you where they should go
- **Manual editing** — correct OCR mistakes inline, or add call numbers the scanner missed
- **PWA** — installable on mobile, service worker for offline static asset caching

## LC Sort Order

Call numbers are compared in this priority:

1. Class letters — alphabetically (`A < AC < B < BF < U < UA`)
2. Class number — as integer (`5 < 35 < 100 < 1000`)
3. Class decimal — as decimal (`.5 < .7 < .75`)
4. First cutter digits — as decimal (`.C65 < .C946`, i.e. `.65 < .946`)
5. Second cutter digits — same decimal rules
6. Year — chronologically

## Tech Stack

- **Frontend:** Vanilla HTML/CSS/JS, no framework
- **OCR:** [Tesseract.js v5](https://github.com/naptha/tesseract.js) via CDN
- **Server:** Express.js (serves static files; required for Railway)

## Project Structure

```
├── server.js          Express server, reads PORT from env
├── public/
│   ├── index.html     Single-page app (camera / processing / results screens)
│   ├── style.css      Dark mobile-first styles
│   ├── app.js         Camera, OCR, LC parsing, sorting, UI logic
│   ├── manifest.json  PWA manifest
│   └── sw.js          Service worker
└── package.json       "start": "node server.js"
```

## Running Locally

```bash
npm install
npm start
# Open http://localhost:3000
```

Camera access requires HTTPS in most browsers — use a tunneling tool like `ngrok` for local mobile testing, or deploy and test from the live URL.

## Deploy (Railway)

Push to GitHub and connect the repo in Railway, or:

```bash
railway login
railway init
railway up
railway domain
```

The app reads `process.env.PORT` automatically.

## Known Limitations / Areas to Improve

- **OCR accuracy** — Tesseract.js struggles with book spine labels due to varied fonts, lighting, and narrow label widths. Preprocessing the captured image (grayscale conversion, contrast enhancement, adaptive thresholding) before passing it to Tesseract significantly improves results.
- **Label segmentation** — the app uses blank-line gaps in the OCR output to separate individual labels; dense or noisy OCR output may merge multiple labels together.
- **Partial call numbers** — some labels omit cutters or years; the parser handles these but flags them as uncertain.
