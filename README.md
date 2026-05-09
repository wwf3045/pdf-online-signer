# PDF Online Signer

A web application to upload, view, and sign PDFs with handwritten signatures.

## Features
- Upload any PDF document.
- Draw multiple handwritten signatures using a touch/mouse canvas.
- Drag and drop signatures onto any page of the PDF.
- Resize signatures while locking the aspect ratio.
- Download the finalized signed PDF.

## Tech Stack
- **Frontend**: React, TypeScript, Vite, PDF.js, Tailwind CSS.
- **Backend**: Node.js, Express, pdf-lib, Multer.

## How to Run

### 1. Backend
```bash
cd server
npm install
npm run dev
```
The backend runs on `http://localhost:3001`.

### 2. Frontend
```bash
cd client
npm install
npm run dev
```
The frontend runs on `http://localhost:5173`.

## Usage
1. Click **Upload PDF** to select your document.
2. Click **Add Signature** to draw your signature and save it.
3. Click on a saved signature in the sidebar to add it to the current page.
4. Drag the signature to the desired location and resize it as needed.
5. Click **Download Signed** to get your signed PDF.
