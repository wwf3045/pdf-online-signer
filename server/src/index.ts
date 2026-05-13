import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { PDFDocument, degrees } from 'pdf-lib';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { Server } from 'socket.io';
import os from 'os';
import * as Lark from '@larksuiteoapi/node-sdk';
import axios from 'axios';
import FormData from 'form-data';

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
  const { appId, appSecret, personalBaseToken, baseToken, tableId, recordId, sourceFieldName, outputFieldName } = req.body;
  if ((!appId || !appSecret) && !personalBaseToken) {
    return res.status(400).json({ error: 'Missing required credentials (appId/appSecret or personalBaseToken)' });
  }
  if (!baseToken || !tableId || !recordId || !sourceFieldName || !outputFieldName) {
    return res.status(400).json({ error: 'Missing required parameters (baseToken, tableId, recordId, sourceFieldName, outputFieldName)' });
  }

  // Check if a session already exists for this record
  let sessionId: string | undefined;
  for (const [id, session] of larkSessions.entries()) {
    if (
      session.params.baseToken === baseToken &&
      session.params.tableId === tableId &&
      session.params.recordId === recordId
    ) {
      sessionId = id;
      // Update params in case they changed (e.g. source/output fields)
      session.params = { appId, appSecret, personalBaseToken, baseToken, tableId, recordId, sourceFieldName, outputFieldName };
      session.createdAt = Date.now(); // Refresh timestamp
      break;
    }
  }

  if (!sessionId) {
    sessionId = Math.random().toString(36).substring(2, 15);
    larkSessions.set(sessionId, {
      params: { appId, appSecret, personalBaseToken, baseToken, tableId, recordId, sourceFieldName, outputFieldName },
      createdAt: Date.now()
    });
  }

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
    const { appId, appSecret, personalBaseToken, baseToken, tableId, recordId, sourceFieldName, fileToken } = req.body;
    
    if (((!appId || !appSecret) && !personalBaseToken) || !baseToken || !tableId || !recordId || !sourceFieldName) {
      return res.status(400).json({ error: 'Missing required Lark parameters or credentials' });
    }

    let attachmentField: any;

    if (personalBaseToken) {
      // Direct API call for Personal Access Token to avoid SDK auth issues on base-api domain
      const response = await axios.get(`https://base-api.feishu.cn/open-apis/bitable/v1/apps/${baseToken}/tables/${tableId}/records/${recordId}`, {
        headers: { Authorization: `Bearer ${personalBaseToken}` }
      });
      attachmentField = response.data?.data?.record?.fields?.[sourceFieldName];
    } else {
      const larkClient = new Lark.Client({ appId: appId!, appSecret: appSecret! });
      // 1. Get record data to find file token
      const record = await larkClient.bitable.appTableRecord.get({
        path: {
          app_token: baseToken,
          table_id: tableId,
          record_id: recordId,
        },
      });
      attachmentField = (record.data?.record?.fields as any)?.[sourceFieldName];
    }

    if (!attachmentField || !Array.isArray(attachmentField) || attachmentField.length === 0) {
      return res.status(404).json({ error: `Source field "${sourceFieldName}" is empty or not an attachment field` });
    }

    // If there are multiple files and no specific token requested, return the list for selection
    if (!fileToken && attachmentField.length > 1) {
      return res.json({ 
        multiple: true, 
        attachments: attachmentField.map((f: any) => ({ 
          name: f.name, 
          token: f.file_token,
          size: f.size,
          type: f.type
        })) 
      });
    }

    // Use requested token or first one
    const targetFile = fileToken 
      ? attachmentField.find((f: any) => f.file_token === fileToken) 
      : attachmentField[0];

    if (!targetFile) {
      return res.status(404).json({ error: 'Requested file token not found in attachment field' });
    }

    const targetToken = targetFile.file_token;
    const fileName = targetFile.name;

    // 2. Download file from Lark
    let fileBuffer: Buffer;
    if (personalBaseToken) {
      const downloadRes = await axios.get(`https://base-api.feishu.cn/open-apis/drive/v1/medias/${targetToken}/download?extra=%7B%22bitablePerm%22%3A%7B%22tableId%22%3A%22${tableId}%22%7D%7D`, {
        headers: { Authorization: `Bearer ${personalBaseToken}` },
        responseType: 'arraybuffer'
      });
      fileBuffer = Buffer.from(downloadRes.data);
    } else {
      const larkClient = new Lark.Client({ appId: appId!, appSecret: appSecret! });
      const response = await (larkClient.bitable as any).appAttachment.download({
        path: {
          app_token: baseToken,
          attachment_token: targetToken,
        },
      });
      fileBuffer = response as unknown as Buffer;
    }

    // 3. Save to local uploads
    const localFileName = `${Date.now()}-lark-${fileName}`;
    const localPath = path.join(uploadsDir, localFileName);
    
    fs.writeFileSync(localPath, fileBuffer);

    res.json({ id: localFileName, fileName });
  } catch (error: any) {
    console.error('Lark Fetch Error:', error.response?.data || error.message);
    res.status(500).json({ error: error.response?.data?.msg || error.message || 'Failed to fetch PDF from Lark' });
  }
});

/**
 * Helper to delete a file and its original counterpart if it's a signed file.
 * Now recursive to handle multi-level signed files.
 */
function cleanupFiles(fileId: string) {
  try {
    const filePath = path.join(uploadsDir, fileId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`Successfully deleted file: ${fileId}`);
    }

    // If it's a signed file, also try to delete the original
    if (fileId.startsWith('signed-')) {
      // The format is signed-{timestamp}-{originalId}
      const match = fileId.match(/^signed-\d+-(.+)$/);
      if (match && match[1]) {
        const originalId = match[1];
        // Recursive call to delete original and any further ancestors
        cleanupFiles(originalId);
      }
    }
  } catch (err) {
    console.error(`Error cleaning up files for ${fileId}:`, err);
  }
}

/**
 * Periodically clean up files older than 1 hour to remove orphans
 */
function cleanupOldFiles() {
  try {
    const files = fs.readdirSync(uploadsDir);
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;

    for (const file of files) {
      const filePath = path.join(uploadsDir, file);
      const stats = fs.statSync(filePath);
      if (now - stats.mtimeMs > oneHour) {
        fs.unlinkSync(filePath);
        console.log(`Cleaned up orphaned file: ${file}`);
      }
    }
  } catch (err) {
    console.error('Error in cleanupOldFiles:', err);
  }
}

// Run cleanup every 30 minutes
setInterval(cleanupOldFiles, 30 * 60 * 1000);
// Run once on startup
setTimeout(cleanupOldFiles, 5000);

/**
 * Upload signed PDF back to Lark Base attachment field (outputFieldName)
 */
app.post('/api/lark/upload', async (req, res) => {
  const { sessionId } = req.body; // Expect sessionId to invalidate it
  const { id } = req.body;
  try {
    const { appId, appSecret, personalBaseToken, baseToken, tableId, recordId, outputFieldName } = req.body;
    const filePath = path.join(uploadsDir, id);

    if (((!appId || !appSecret) && !personalBaseToken)) {
      return res.status(400).json({ error: 'Missing Lark credentials' });
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Signed PDF not found locally' });
    }

    const fileStat = fs.statSync(filePath);
    const fileContent = fs.readFileSync(filePath);
    let newFileToken: string;

    if (personalBaseToken) {
      // 1. Upload file to Lark via axios
      const formData = new FormData();
      formData.append('file_name', id);
      formData.append('parent_type', 'bitable_file');
      formData.append('parent_node', baseToken);
      formData.append('size', String(fileStat.size));
      formData.append('extra', JSON.stringify({ drive_route_token: baseToken }));
      formData.append('file', fileContent, { filename: id });

      console.log(`Uploading to Lark PAT (bitable_file) via base-api - Base: ${baseToken}`);

      try {
        const uploadRes = await axios.post(`https://base-api.feishu.cn/open-apis/drive/v1/medias/upload_all`, formData, {
          headers: { 
            Authorization: `Bearer ${personalBaseToken}`,
            ...formData.getHeaders()
          }
        });

        console.log('Upload Response Success:', JSON.stringify(uploadRes.data));
        newFileToken = uploadRes.data?.data?.file_token;

        if (!newFileToken) {
          throw new Error(`Upload Failed - No Token: ${JSON.stringify(uploadRes.data)}`);
        }

        // 2. Get existing attachments and append new one
        const recordUrl = `https://base-api.feishu.cn/open-apis/bitable/v1/apps/${baseToken}/tables/${tableId}/records/${recordId}`;
        const recordRes = await axios.get(recordUrl, {
          headers: { Authorization: `Bearer ${personalBaseToken}` }
        });
        
        const existingAttachments = recordRes.data?.data?.record?.fields?.[outputFieldName] || [];
        const updatedAttachments = Array.isArray(existingAttachments) 
          ? [...existingAttachments, { file_token: newFileToken }]
          : [{ file_token: newFileToken }];

        console.log(`Updating record via PUT to base-api: ${recordUrl}`);
        
        const putRes = await axios.put(recordUrl, {
          fields: {
            [outputFieldName]: updatedAttachments
          },
        }, {
          headers: { Authorization: `Bearer ${personalBaseToken}` }
        });
        console.log('Record Updated successfully (PUT):', JSON.stringify(putRes.data));
      } catch (err: any) {
        const detail = err.response?.data || err.message;
        console.error('Lark PAT Error Details:', JSON.stringify(detail));
        const larkMsg = err.response?.data?.msg || err.response?.data?.error || err.message;
        throw new Error(larkMsg || 'Lark PAT Operation Failed');
      }

    } else {
      const larkClient = new Lark.Client({ appId: appId!, appSecret: appSecret! });

      // 1. Upload file to Lark Bitable Attachment space
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

      newFileToken = uploadRes.data?.file_token;
      if (!newFileToken) throw new Error('Failed to get file token after upload');

      // 2. Get existing attachments and append new one
      const record = await larkClient.bitable.appTableRecord.get({
        path: {
          app_token: baseToken,
          table_id: tableId,
          record_id: recordId,
        },
      });
      
      const existingAttachments = (record.data?.record?.fields as any)?.[outputFieldName] || [];
      const updatedAttachments = Array.isArray(existingAttachments) 
        ? [...existingAttachments, { file_token: newFileToken }]
        : [{ file_token: newFileToken }];

      // 3. Update record field with merged attachments
      await larkClient.bitable.appTableRecord.update({
        path: {
          app_token: baseToken,
          table_id: tableId,
          record_id: recordId,
        },
        data: {
          fields: {
            [outputFieldName]: updatedAttachments
          },
        },
      });
    }

    // 3. Invalidate session upon successful upload
    if (sessionId) {
      larkSessions.delete(sessionId);
      saveSessions(larkSessions);
    }

    // 4. Cleanup local files
    cleanupFiles(id);

    res.json({ success: true, fileToken: newFileToken });
  } catch (error: any) {
    console.error('Lark Upload Error:', error.response?.data || error.message);
    res.status(500).json({ error: error.response?.data?.msg || error.message || 'Failed to upload PDF back to Lark' });
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
      const { pageIndex, x, y, width, height, rotation: manualRotation, imageBase64 } = sig;
      const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
      const imageBytes = Buffer.from(base64Data, 'base64');
      const signatureImage = await pdfDoc.embedPng(imageBytes);
      const pages = pdfDoc.getPages();
      const page = pages[pageIndex];
      
      const { width: pWidth, height: pHeight } = page.getSize();
      const intrinsicRotation = page.getRotation().angle;
      const totalRotation = (intrinsicRotation + (manualRotation || 0)) % 360;

      // Adjust coordinates and rotation based on total visual rotation
      let drawX, drawY;
      if (totalRotation === 0) {
        drawX = x;
        drawY = pHeight - y - height;
      } else if (totalRotation === 90) {
        drawX = y + height;
        drawY = x;
      } else if (totalRotation === 180) {
        drawX = pWidth - x;
        drawY = pHeight - y;
      } else if (totalRotation === 270) {
        drawX = pWidth - y - height;
        drawY = pHeight - x;
      } else {
        drawX = x;
        drawY = pHeight - y - height;
      }

      page.drawImage(signatureImage, {
        x: drawX,
        y: drawY,
        width,
        height,
        rotate: degrees(totalRotation)
      });
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
