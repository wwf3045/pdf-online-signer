import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { PDFDocument } from 'pdf-lib';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { Server } from 'socket.io';
import os from 'os';
import * as Lark from '@larksuiteoapi/node-sdk';

dotenv.config();

const app = express();
const httpServer = createServer(app);

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Get local IP address
function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]!) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const localIp = getLocalIp();
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use('/api/uploads', express.static(uploadsDir));

app.get('/api/config', (req, res) => {
  res.json({ localIp, port });
});

// --- Lark Session Management ---
// Persistent store for Lark parameters in a JSON file
const SESSIONS_FILE = path.join(__dirname, '../../sessions.json');

function loadSessions(): Map<string, { params: any, createdAt: number }> {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const data = fs.readFileSync(SESSIONS_FILE, 'utf8');
      return new Map(Object.entries(JSON.parse(data)));
    }
  } catch (err) {
    console.error('Failed to load sessions:', err);
  }
  return new Map();
}

function saveSessions(sessions: Map<string, any>) {
  try {
    const data = JSON.stringify(Object.fromEntries(sessions));
    fs.writeFileSync(SESSIONS_FILE, data, 'utf8');
  } catch (err) {
    console.error('Failed to save sessions:', err);
  }
}

const larkSessions = loadSessions();

app.post('/api/lark/init', (req, res) => {
  const { appId, appSecret, baseToken, tableId, recordId, sourceFieldName, outputFieldName } = req.body;
  if (!appId || !appSecret || !baseToken || !tableId || !recordId || !sourceFieldName || !outputFieldName) {
    return res.status(400).json({ error: 'Missing required parameters (sourceFieldName and outputFieldName are both required)' });
  }

  const sessionId = Math.random().toString(36).substring(2, 15);
  larkSessions.set(sessionId, {
    params: { appId, appSecret, baseToken, tableId, recordId, sourceFieldName, outputFieldName },
    createdAt: Date.now()
  });
  saveSessions(larkSessions);

  res.json({ sessionId });
});

app.get('/api/lark/session/:id', (req, res) => {
  const session = larkSessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  
  res.json(session.params);
});

// --- Lark Base Integration API ---

/**
 * Fetch PDF from Lark Base attachment field
 */
app.post('/api/lark/fetch', async (req, res) => {
  try {
    const { appId, appSecret, baseToken, tableId, recordId, sourceFieldName } = req.body;
    
    if (!appId || !appSecret || !baseToken || !tableId || !recordId || !sourceFieldName) {
      return res.status(400).json({ error: 'Missing required Lark parameters or credentials' });
    }

    const larkClient = new Lark.Client({ appId, appSecret });

    // 1. Get record data to find file token
    const record = await larkClient.bitable.appTableRecord.get({
      path: {
        app_token: baseToken,
        table_id: tableId,
        record_id: recordId,
      },
    });

    const attachmentField = (record.data?.record?.fields as any)?.[sourceFieldName];
    if (!attachmentField || !Array.isArray(attachmentField) || attachmentField.length === 0) {
      return res.status(404).json({ error: `Source field "${sourceFieldName}" is empty or not an attachment field` });
    }

    const fileToken = attachmentField[0].file_token;
    const fileName = attachmentField[0].name;

    // 2. Download file from Lark
    const response = await (larkClient.bitable as any).appAttachment.download({
      path: {
        app_token: baseToken,
        attachment_token: fileToken,
      },
    });

    // 3. Save to local uploads
    const localFileName = `${Date.now()}-lark-${fileName}`;
    const localPath = path.join(uploadsDir, localFileName);
    
    fs.writeFileSync(localPath, response as unknown as Buffer);

    res.json({ id: localFileName, fileName });
  } catch (error: any) {
    console.error('Lark Fetch Error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch PDF from Lark' });
  }
});

/**
 * Helper to delete a file and its original counterpart if it's a signed file
 */
function cleanupFiles(fileId: string) {
  try {
    const filePath = path.join(uploadsDir, fileId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`Deleted file: ${fileId}`);
    }

    // If it's a signed file, also try to delete the original
    if (fileId.startsWith('signed-')) {
      // The format is signed-{timestamp}-{originalId}
      // We need to extract {originalId}
      const match = fileId.match(/^signed-\d+-(.+)$/);
      if (match && match[1]) {
        const originalId = match[1];
        const originalPath = path.join(uploadsDir, originalId);
        if (fs.existsSync(originalPath)) {
          fs.unlinkSync(originalPath);
          console.log(`Deleted original file: ${originalId}`);
        }
      }
    }
  } catch (err) {
    console.error(`Error cleaning up files for ${fileId}:`, err);
  }
}

/**
 * Upload signed PDF back to Lark Base attachment field (outputFieldName)
 */
app.post('/api/lark/upload', async (req, res) => {
  const { sessionId } = req.body; // Expect sessionId to invalidate it
  const { id } = req.body;
  try {
    const { appId, appSecret, baseToken, tableId, recordId, outputFieldName } = req.body;
    const filePath = path.join(uploadsDir, id);

    if (!appId || !appSecret) {
      return res.status(400).json({ error: 'Missing Lark credentials' });
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Signed PDF not found locally' });
    }

    const larkClient = new Lark.Client({ appId, appSecret });

    // 1. Upload file to Lark Bitable Attachment space
    const fileStat = fs.statSync(filePath);
    const fileContent = fs.readFileSync(filePath);

    const uploadRes = await (larkClient.bitable as any).appAttachment.upload({
      path: {
        app_token: baseToken,
      },
      data: {
        file_name: id,
        parent_type: 'bitable_record',
        parent_node: tableId,
        size: fileStat.size,
        file: fileContent,
      },
    });

    const newFileToken = uploadRes.data?.file_token;
    if (!newFileToken) throw new Error('Failed to get file token after upload');

    // 2. Update record field with new attachment
    await larkClient.bitable.appTableRecord.update({
      path: {
        app_token: baseToken,
        table_id: tableId,
        record_id: recordId,
      },
      data: {
        fields: {
          [outputFieldName]: [{ file_token: newFileToken }]
        },
      },
    });

    // 3. Invalidate session upon successful upload
    if (sessionId) {
      larkSessions.delete(sessionId);
      saveSessions(larkSessions);
    }

    // 4. Cleanup local files
    cleanupFiles(id);

    res.json({ success: true, fileToken: newFileToken });
  } catch (error: any) {
    console.error('Lark Upload Error:', error);
    res.status(500).json({ error: error.message || 'Failed to upload PDF back to Lark' });
  }
});

/**
 * Download a file and delete it afterwards
 */
app.get('/api/download/:id', (req, res) => {
  const fileId = req.params.id;
  const filePath = path.join(uploadsDir, fileId);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  // Extract original filename if possible (it's after the timestamp in the ID)
  // Format: signed-{timestamp}-{original-timestamp}-{filename}
  let downloadName = fileId;
  const nameMatch = fileId.match(/^signed-\d+-\d+-(.+)$/);
  if (nameMatch && nameMatch[1]) {
    downloadName = `已签名-${nameMatch[1]}`;
  } else if (fileId.startsWith('signed-')) {
    downloadName = `已签名-${fileId.substring(7)}`;
  }

  res.download(filePath, downloadName, (err) => {
    if (err) {
      if (!res.headersSent) {
        res.status(500).json({ error: 'Error downloading file' });
      }
    } else {
      cleanupFiles(fileId);
    }
  });
});

// Socket.io logic
io.on('connection', (socket) => {
  socket.on('join-session', (sessionId) => {
    socket.join(sessionId);
  });
  socket.on('send-signature', ({ sessionId, dataUrl }) => {
    socket.to(sessionId).emit('receive-signature', dataUrl);
  });
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});

const upload = multer({ storage });

app.post('/api/upload', upload.single('pdf'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({ id: req.file.filename });
});

app.post('/api/sign', async (req, res) => {
  try {
    const { id, signatures } = req.body;
    const pdfPath = path.join(uploadsDir, id);
    if (!fs.existsSync(pdfPath)) return res.status(404).json({ error: 'PDF not found' });

    const existingPdfBytes = fs.readFileSync(pdfPath);
    const pdfDoc = await PDFDocument.load(existingPdfBytes);

    for (const sig of signatures) {
      const { pageIndex, x, y, width, height, imageBase64 } = sig;
      const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
      const imageBytes = Buffer.from(base64Data, 'base64');
      const signatureImage = await pdfDoc.embedPng(imageBytes);
      const pages = pdfDoc.getPages();
      const page = pages[pageIndex];
      const { height: pageHeight } = page.getSize();
      page.drawImage(signatureImage, { x, y: pageHeight - y - height, width, height });
    }

    const pdfBytes = await pdfDoc.save();

    // Save the signed file locally
    const signedFileName = `signed-${Date.now()}-${id}`;
    const signedFilePath = path.join(uploadsDir, signedFileName);
    fs.writeFileSync(signedFilePath, Buffer.from(pdfBytes));

    // Return the signed file ID
    res.json({ id: signedFileName });
  } catch (error) {
    console.error('Error signing PDF:', error);
    res.status(500).json({ error: 'Failed to sign PDF' });
  }
});

httpServer.listen(Number(port), '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${port}`);
});
