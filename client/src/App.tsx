import React, { useState, useRef, useEffect } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import SignatureCanvas from 'react-signature-canvas';
import { Rnd } from 'react-rnd';
import { Upload, Plus, Download, X, Eraser, Check, Menu, Smartphone, Monitor, RotateCw, FileText, PartyPopper } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { io, Socket } from 'socket.io-client';
import { QRCodeSVG } from 'qrcode.react';
import { getApiBase, getSocketBase, getMobileSignUrl } from './config';

// Setup PDF.js worker and CMap for Chinese characters
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
const CMAP_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/cmaps/`;
const CMAP_PACKED = true;
const STANDARD_FONT_DATA_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/standard_fonts/`;

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface Signature {
  id: string;
  dataUrl: string;
}

interface PlacedSignature {
  id: string;
  signatureId: string;
  pageIndex: number;
  xPercent: number; // Store as percentage (0-100)
  yPercent: number;
  widthPercent: number;
  heightPercent: number;
}

export default function App() {
  // Detect if we are in mobile signing mode
  const queryParams = new URLSearchParams(window.location.search);
  const mobileSessionId = queryParams.get('session');
  const isMobileSigningMode = !!mobileSessionId;

  const [file, setFile] = useState<File | null>(null);
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [signatures, setSignatures] = useState<Signature[]>([]);
  const [placedSignatures, setPlacedSignatures] = useState<PlacedSignature[]>([]);
  const [isSigning, setIsSigning] = useState(false);
  const sigCanvas = useRef<SignatureCanvas>(null);
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const [globalRotation, setGlobalRotation] = useState(0);

  const rotateAllPages = () => {
    setGlobalRotation(prev => (prev + 90) % 360);
  };
  const [signatureStrokes, setSignatureStrokes] = useState<any[]>([]);
  const [orientationKey, setOrientationKey] = useState(0);
  const [signTab, setSignTab] = useState<'draw' | 'qr'>('draw');

  // Define page dimensions in points (from PDF)
  const [pageDimensions, setPageDimensions] = useState<{ [key: number]: { width: number, height: number } }>({});

  const [serverIp, setServerIp] = useState<string | null>(null);
  
  // Desktop Session ID - Move this UP
  const [desktopSessionId] = useState(() => Math.random().toString(36).substring(2, 10));
  const socketRef = useRef<Socket | null>(null);

  // Fetch server config on load
  useEffect(() => {
    const configUrl = `${getApiBase()}/api/config?t=${Date.now()}`;
    console.log('[App] Fetching initial config from:', configUrl);
      
    fetch(configUrl)
      .then(async res => {
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`HTTP ${res.status}: ${text.substring(0, 100)}`);
        }
        return res.json();
      })
      .then(data => setServerIp(data.localIp))
      .catch(async (err) => {
        console.error('[App] Config fetch failed:', err);
        // 如果是因为返回了 HTML 而解析失败，尝试打印出 HTML 片段
        if (err instanceof SyntaxError) {
          try {
            const res = await fetch(configUrl);
            const text = await res.text();
            console.error('[App] Server returned HTML instead of JSON. Snippet:', text.substring(0, 200));
          } catch (e) {}
        }
        setServerIp(window.location.hostname);
      });
  }, []);

  const API_BASE = getApiBase();
  const mobileSignUrl = getMobileSignUrl(desktopSessionId, serverIp);

  // Initialize Socket.io
  useEffect(() => {
    // 根据当前页面协议自动切换 ws 或 wss
    const socketOptions = window.location.protocol === 'https:' 
      ? { secure: true, reconnection: true, rejectUnauthorized: false }
      : {};
      
    socketRef.current = io(getSocketBase(), socketOptions);
    
    if (isMobileSigningMode) {
      socketRef.current.emit('join-session', mobileSessionId);
    } else {
      socketRef.current.emit('join-session', desktopSessionId);
      socketRef.current.on('receive-signature', (dataUrl: string) => {
        setSignatures(prev => [...prev, { id: Date.now().toString(), dataUrl }]);
        setIsSigning(false);
        alert('收到来自手机的签名！');
      });
    }

    return () => {
      socketRef.current?.disconnect();
    };
  }, [desktopSessionId, isMobileSigningMode, mobileSessionId]);

  // 监听旋转，强制重新初始化签名板以修复偏移
  useEffect(() => {
    const handleResize = () => {
      setOrientationKey(prev => prev + 1);
    };
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, []);

  // 当签名板重新初始化后，恢复笔迹
  useEffect(() => {
    if ((isSigning || isMobileSigningMode) && sigCanvas.current) {
      const timer = setTimeout(() => {
        if (!sigCanvas.current) return;
        const canvas = sigCanvas.current.getCanvas();
        const ratio = Math.max(window.devicePixelRatio || 1, 1);
        canvas.width = canvas.offsetWidth * ratio;
        canvas.height = canvas.offsetHeight * ratio;
        canvas.getContext('2d')?.scale(ratio, ratio);
        if (signatureStrokes.length > 0) {
          sigCanvas.current.fromData(signatureStrokes);
        }
      }, 350);
      return () => clearTimeout(timer);
    }
  }, [isSigning, isMobileSigningMode, orientationKey, signatureStrokes]);

  const resetUpload = (clearQueue = true) => {
    setFile(null);
    setPdfDoc(null);
    setNumPages(0);
    setUploadId(null);
    setPlacedSignatures([]);
    setLoading(false);
    setPageDimensions({});
    if (clearQueue) {
      setSigningQueue([]);
      setSelectedTokens([]);
      setIsAllCompleted(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile && selectedFile.type === 'application/pdf') {
      setLoading(true);
      const formData = new FormData();
      formData.append('pdf', selectedFile);
      try {
        const response = await fetch(`${API_BASE}/api/upload`, {
          method: 'POST',
          body: formData,
        });
        if (!response.ok) throw new Error('服务器响应错误');
        const data = await response.json();
        setUploadId(data.id);
        const arrayBuffer = await selectedFile.arrayBuffer();
        const loadingTask = pdfjsLib.getDocument({ 
          data: arrayBuffer,
          cMapUrl: CMAP_URL,
          cMapPacked: CMAP_PACKED,
          standardFontDataUrl: STANDARD_FONT_DATA_URL,
        });
        const pdf = await loadingTask.promise;
        const dimensions: { [key: number]: { width: number, height: number } } = {};
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: 1 });
          dimensions[i - 1] = { width: viewport.width, height: viewport.height };
        }
        setPageDimensions(dimensions);
        setFile(selectedFile);
        setPdfDoc(pdf);
        setNumPages(pdf.numPages);
      } catch (error) {
        console.error('上传 PDF 出错:', error);
        alert('上传 PDF 失败');
        resetUpload();
      } finally {
        setLoading(false);
      }
    }
  };

  const saveSignature = () => {
    console.log('开始保存签名...');
    const sigPad = sigCanvas.current;
    
    if (!sigPad) {
      console.error('sigCanvas ref 为空');
      alert('签名板未准备就绪，请重试');
      return;
    }

    if (sigPad.isEmpty()) {
      alert('请先绘制签名');
      return;
    }

    try {
      let dataUrl = '';
      // Simplified: Just use the raw canvas to avoid library-specific errors
      dataUrl = sigPad.getCanvas().toDataURL('image/png');

      if (!dataUrl || dataUrl === 'data:,') {
        throw new Error('签名数据无效');
      }

      if (isMobileSigningMode) {
        socketRef.current?.emit('send-signature', { sessionId: mobileSessionId, dataUrl });
        alert('签名已发送！');
      } else {
        setSignatures(prev => [...prev, { id: Date.now().toString(), dataUrl }]);
        setIsSigning(false);
        setSignatureStrokes([]);
      }
    } catch (error) {
      console.error('保存签名出错:', error);
      alert('保存失败，请重写签名后再次尝试');
    }
  };

  const handleAddSignatureBtn = () => {
    setSignatureStrokes([]);
    setIsSigning(true);
    setSignTab('draw');
  };

  const [lastClickedPageIndex, setLastClickedPageIndex] = useState(0);

  const addSignatureToPage = (signatureId: string) => {
    const signature = signatures.find(s => s.id === signatureId);
    if (!signature) return;
    const newPlaced: PlacedSignature = {
      id: Date.now().toString(),
      signatureId,
      pageIndex: lastClickedPageIndex,
      xPercent: 10,
      yPercent: 10,
      widthPercent: 20,
      heightPercent: 10,
    };
    setPlacedSignatures(prev => [...prev, newPlaced]);
    setShowSidebar(false);
  };

  const [larkParams, setLarkParams] = useState<{
    appId?: string;
    appSecret?: string;
    personalBaseToken?: string;
    baseToken: string;
    tableId: string;
    recordId: string;
    sourceFieldName: string;
    outputFieldName: string;
  } | null>(null);

  const [larkAttachments, setLarkAttachments] = useState<{ name: string, token: string }[]>([]);
  const [selectedTokens, setSelectedTokens] = useState<string[]>([]);
  const [signingQueue, setSigningQueue] = useState<string[]>([]);
  const [isAllCompleted, setIsAllCompleted] = useState(false);

  const toggleToken = (token: string) => {
    setSelectedTokens(prev => 
      prev.includes(token) ? prev.filter(t => t !== token) : [...prev, token]
    );
  };

  const startSigningSelected = () => {
    if (selectedTokens.length === 0 || !larkParams) return;
    setSigningQueue(selectedTokens);
    handleLarkFetch(larkParams, selectedTokens[0]);
  };

  const fetchStarted = useRef(false);

  // Auto-fetch from Lark if session ID exist
  useEffect(() => {
    const lSessionId = queryParams.get('larkSession');

    if (lSessionId && !fetchStarted.current) {
      fetchStarted.current = true;
      // 1. Fetch parameters from session
      setLoading(true);
      fetch(`${API_BASE}/api/lark/session/${lSessionId}?t=${Date.now()}`)
        .then(async res => {
          if (!res.ok) {
            const text = await res.text();
            throw new Error(`HTTP ${res.status}: ${text.substring(0, 100)}`);
          }
          return res.json();
        })
        .then(params => {
          setLarkParams(params);
          handleLarkFetch(params);
        })
        .catch(async err => {
          console.error('Session 获取失败:', err);
          if (err instanceof SyntaxError) {
             const res = await fetch(`${API_BASE}/api/lark/session/${lSessionId}`);
             const text = await res.text();
             console.error('[App] Session response was HTML:', text.substring(0, 200));
          }
          alert(`进入飞书签字模式失败: ${err.message}`);
          setLoading(false);
        });
    }
  }, []);

  // Recalculate dimensions when PDF or rotation changes
  useEffect(() => {
    const updateDimensions = async () => {
      if (!pdfDoc) return;
      const dimensions: { [key: number]: { width: number, height: number } } = {};
      for (let i = 1; i <= pdfDoc.numPages; i++) {
        const page = await pdfDoc.getPage(i);
        // Important: viewport dimensions should match the visual rotation
        const viewport = page.getViewport({ scale: 1, rotation: (page.rotate + globalRotation) % 360 });
        dimensions[i - 1] = { width: viewport.width, height: viewport.height };
      }
      setPageDimensions(dimensions);
    };
    updateDimensions();
  }, [pdfDoc, globalRotation]);

  const handleLarkFetch = async (params: any, fileToken?: string) => {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/lark/fetch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...params, fileToken }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || '从飞书获取文件失败');
      }
      const data = await response.json();

      if (data.multiple) {
        setLarkAttachments(data.attachments);
        setLoading(false);
        return;
      }

      setLarkAttachments([]); // Clear list if we are loading a file
      setUploadId(data.id);

      // Load PDF locally using URL for better performance (streaming)
      const pdfUrl = `${API_BASE}/api/uploads/${data.id}`;
      const loadingTask = pdfjsLib.getDocument({ 
        url: pdfUrl,
        cMapUrl: CMAP_URL,
        cMapPacked: CMAP_PACKED,
        standardFontDataUrl: STANDARD_FONT_DATA_URL,
      });
      const pdf = await loadingTask.promise;
      
      const dimensions: { [key: number]: { width: number, height: number } } = {};
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 1 });
        dimensions[i - 1] = { width: viewport.width, height: viewport.height };
      }
      setPageDimensions(dimensions);
      
      setPdfDoc(pdf);
      setNumPages(pdf.numPages);
      setFile({ name: data.fileName } as File);
    } catch (error: any) {
      console.error('飞书集成错误:', error);
      alert(`无法从飞书加载 PDF: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitToLark = async () => {
    if (!uploadId || placedSignatures.length === 0 || !larkParams) return;
    setLoading(true);
    try {
      // 1. 先合成 PDF
      const signRes = await fetch(`${API_BASE}/api/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: uploadId,
          signatures: placedSignatures.map(ps => {
            const dims = pageDimensions[ps.pageIndex];
            return {
              pageIndex: ps.pageIndex,
              x: (ps.xPercent / 100) * dims.width,
              y: (ps.yPercent / 100) * dims.height,
              width: (ps.widthPercent / 100) * dims.width,
              height: (ps.heightPercent / 100) * dims.height,
              rotation: globalRotation,
              imageBase64: signatures.find(s => s.id === ps.signatureId)?.dataUrl
            };
          })
        }),
      });

      if (!signRes.ok) throw new Error('合成签名 PDF 失败');
      const { id: signedId } = await signRes.json();
      
      // 2. 自动回传至飞书
      const uploadRes = await fetch(`${API_BASE}/api/lark/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: signedId,
          // Only invalidate session if it's the last file in queue (or if no queue)
          sessionId: (signingQueue.length <= 1) ? queryParams.get('larkSession') : null,
          ...larkParams
        }),
      });

      if (uploadRes.ok) {
        if (signingQueue.length > 1) {
          const nextQueue = signingQueue.slice(1);
          resetUpload(false);
          setSigningQueue(nextQueue);
          // Show a brief success message before loading next
          setLoading(true); 
          setTimeout(() => {
            handleLarkFetch(larkParams, nextQueue[0]);
          }, 500);
        } else {
          setSigningQueue([]);
          setIsAllCompleted(true);
          resetUpload(false); // Clear file but keep queue info for completion view if needed, or just reset
        }
      } else {
        const error = await uploadRes.json();
        throw new Error(error.error || '回传飞书失败');
      }
    } catch (error: any) {
      console.error('提交飞书错误:', error);
      alert(`提交失败: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async () => {
    if (!uploadId || placedSignatures.length === 0) return;
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: uploadId,
          signatures: placedSignatures.map(ps => {
            const dims = pageDimensions[ps.pageIndex];
            return {
              pageIndex: ps.pageIndex,
              x: (ps.xPercent / 100) * dims.width,
              y: (ps.yPercent / 100) * dims.height,
              width: (ps.widthPercent / 100) * dims.width,
              height: (ps.heightPercent / 100) * dims.height,
              rotation: globalRotation,
              imageBase64: signatures.find(s => s.id === ps.signatureId)?.dataUrl
            };
          })
        }),
      });

      if (response.ok) {
        const { id: signedId } = await response.json();
        
        // Trigger local download using the new cleanup endpoint
        const downloadUrl = `${API_BASE}/api/download/${signedId}`;
        const a = document.createElement('a');
        a.href = downloadUrl;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        // Files are deleted on server after download, reset local state
        setTimeout(() => {
          resetUpload();
        }, 1000); // Small delay to ensure download starts
      } else {
        alert('签名 PDF 失败');
      }
    } catch (error) {
      console.error('签名 PDF 出错:', error);
      alert('签名 PDF 出错');
    } finally {
      setLoading(false);
    }
  };

  // --- Mobile Signing Mode UI ---
  if (isMobileSigningMode) {
    return (
      <div className="min-h-screen bg-gray-100 flex flex-col items-center p-4">
        <header className="w-full max-w-lg mb-6 text-center">
          <h1 className="text-2xl font-bold text-gray-900">手机端手写确认</h1>
          <p className="text-gray-500 mt-2">在下方签名，确认后将同步到电脑</p>
        </header>
        <div className="w-full max-w-lg bg-white rounded-2xl shadow-lg overflow-hidden flex flex-col">
          <div className="p-4 bg-white border-b flex justify-between items-center">
            <span className="font-semibold text-gray-700">签名区域</span>
            <button 
              onClick={() => sigCanvas.current?.clear()}
              className="text-blue-600 font-medium text-sm flex items-center gap-1"
            >
              <Eraser size={16} /> 重填
            </button>
          </div>
          <div className="bg-gray-50 p-4">
            <div className="bg-white border-2 border-dashed border-gray-200 rounded-xl overflow-hidden touch-none h-80">
              <SignatureCanvas 
                key={orientationKey}
                ref={sigCanvas}
                penColor="black"
                velocityFilterWeight={0}
                onEnd={() => sigCanvas.current && setSignatureStrokes(sigCanvas.current.toData())}
                canvasProps={{ className: "w-full h-auto min-h-full" }}
              />
            </div>
          </div>
          <div className="p-4 bg-white border-t">
            <button 
              onClick={saveSignature}
              className="w-full bg-blue-600 text-white py-4 rounded-xl font-bold text-lg shadow-lg active:scale-95 transition"
            >
              确认并同步到电脑
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- Main Desktop/Tablet UI ---

  const getFileIcon = (fileName: string) => {
    const ext = fileName.split('.').pop()?.toLowerCase();
    if (ext === 'pdf') return <FileText size={24} className="text-red-500" />;
    if (['doc', 'docx'].includes(ext || '')) return <FileText size={24} className="text-blue-600" />;
    if (['xls', 'xlsx', 'csv'].includes(ext || '')) return <FileText size={24} className="text-green-600" />;
    if (['jpg', 'jpeg', 'png', 'webp', 'bmp'].includes(ext || '')) return <FileText size={24} className="text-purple-500" />;
    return <FileText size={24} className="text-gray-500" />;
  };

  const getFileBadge = (fileName: string) => {
    const ext = fileName.split('.').pop()?.toLowerCase();
    if (ext === 'pdf') return <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-bold uppercase">PDF</span>;
    if (['doc', 'docx'].includes(ext || '')) return <span className="text-[10px] bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded font-bold uppercase">Word</span>;
    if (['xls', 'xlsx', 'csv'].includes(ext || '')) return <span className="text-[10px] bg-green-100 text-green-600 px-1.5 py-0.5 rounded font-bold uppercase">Excel</span>;
    if (['jpg', 'jpeg', 'png', 'webp', 'bmp'].includes(ext || '')) return <span className="text-[10px] bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded font-bold uppercase">Image</span>;
    return <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded font-bold uppercase">{ext}</span>;
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center">
      <header className="w-full bg-white border-b sticky top-0 z-30 px-4 py-3 md:px-8 flex justify-between items-center shadow-sm">
        <div className="flex items-center gap-2">
          {file && (
            <button 
              onClick={() => setShowSidebar(!showSidebar)}
              className="md:hidden p-2 hover:bg-gray-100 rounded-lg text-gray-600"
            >
              <Menu size={24} />
            </button>
          )}
          <img src="/favicon.png" alt="Logo" className="w-8 h-8 md:w-9 md:h-9 object-contain" />
          <h1 className="text-xl md:text-2xl font-bold text-gray-900">PDF 在线签名</h1>
        </div>
        <div className="flex gap-2 md:gap-4">
          {!file && (
            <label className="flex items-center gap-2 bg-blue-600 text-white px-3 py-1.5 md:px-4 md:py-2 rounded-lg cursor-pointer hover:bg-blue-700 transition text-sm md:text-base">
              <Upload size={18} />
              <span>上传 PDF</span>
              <input type="file" accept=".pdf" className="hidden" onChange={handleFileChange} />
            </label>
          )}
          {file && (
            <>
              <button 
                onClick={() => resetUpload()}
                className="hidden md:flex items-center gap-2 bg-gray-200 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-300 transition text-sm"
              >
                <X size={18} />
                <span>重新上传</span>
              </button>
              <button 
                onClick={handleAddSignatureBtn}
                className="flex items-center gap-2 bg-green-600 text-white px-3 py-1.5 md:px-4 md:py-2 rounded-lg hover:bg-green-700 transition text-sm md:text-base"
              >
                <Plus size={18} />
                <span>新增签名</span>
              </button>
              <button 
                onClick={rotateAllPages}
                className="flex items-center gap-2 bg-gray-600 text-white px-3 py-1.5 md:px-4 md:py-2 rounded-lg hover:bg-gray-700 transition text-sm md:text-base"
              >
                <RotateCw size={18} />
                <span>旋转</span>
              </button>
              {larkParams && (
                <button 
                  onClick={handleSubmitToLark}
                  disabled={placedSignatures.length === 0 || loading}
                  className="flex items-center gap-2 bg-orange-600 text-white px-3 py-1.5 md:px-4 md:py-2 rounded-lg hover:bg-orange-700 transition disabled:opacity-50 text-sm md:text-base font-bold shadow-md shadow-orange-200"
                >
                  <Check size={18} />
                  <span>提交至飞书</span>
                </button>
              )}
              <button 
                onClick={handleDownload}
                disabled={placedSignatures.length === 0 || loading}
                className="flex items-center gap-2 bg-blue-600 text-white px-3 py-1.5 md:px-4 md:py-2 rounded-lg hover:bg-blue-700 transition disabled:opacity-50 text-sm md:text-base"
              >
                <Download size={18} />
                <span>下载文件</span>
              </button>
            </>
          )}
        </div>
      </header>

      <main className="w-full max-w-7xl flex flex-col md:flex-row gap-4 md:gap-8 p-4 md:p-8">
        {file && (
          <aside className={cn(
            "fixed inset-y-0 left-0 z-40 w-64 bg-white p-4 shadow-xl transition-transform transform md:sticky md:top-24 md:translate-x-0 md:shadow-none md:rounded-xl md:h-fit",
            showSidebar ? "translate-x-0" : "-translate-x-full"
          )}>
            <div className="flex justify-between items-center mb-4 md:hidden">
              <h2 className="font-semibold text-lg">我的签名</h2>
              <button onClick={() => setShowSidebar(false)} className="text-gray-400"><X size={24}/></button>
            </div>
            <h2 className="hidden md:block font-semibold mb-4">我的签名</h2>
            <div className="flex flex-col gap-4 overflow-y-auto max-h-[calc(100vh-200px)]">
              {signatures.length === 0 && (
                <p className="text-gray-500 text-sm italic text-center py-8 border-2 border-dashed rounded-lg">
                  暂无签名。请点击“新增签名”创建。
                </p>
              )}
              {signatures.map(sig => (
                <div 
                  key={sig.id} 
                  className="group relative border rounded-lg p-2 cursor-pointer hover:border-blue-400 transition bg-gray-50"
                  onClick={() => addSignatureToPage(sig.id)}
                >
                  <img src={sig.dataUrl} alt="签名" className="max-w-full" />
                </div>
              ))}
            </div>
          </aside>
        )}

        <section className="flex-1 flex flex-col items-center gap-4">
          {isAllCompleted ? (
            <div className="w-full max-w-2xl bg-white border border-gray-200 rounded-2xl shadow-xl p-12 text-center animate-in zoom-in duration-500">
              <div className="w-24 h-24 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
                <PartyPopper size={48} />
              </div>
              <h2 className="text-3xl font-bold text-gray-900 mb-4">全部签署完成！</h2>
              <p className="text-gray-500 text-lg mb-8">
                所有选定的文件均已成功合成签名，并已同步回传至飞书多维表格。
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <button 
                  onClick={() => resetUpload(true)}
                  className="bg-gray-900 text-white px-8 py-3 rounded-xl font-bold hover:bg-black transition active:scale-95"
                >
                  返回首页
                </button>
                <button 
                  onClick={() => window.close()}
                  className="bg-white text-gray-700 border border-gray-200 px-8 py-3 rounded-xl font-bold hover:bg-gray-50 transition active:scale-95"
                >
                  关闭窗口
                </button>
              </div>
            </div>
          ) : (
            <>
              {!file && !loading && larkAttachments.length > 0 && (
                <div className="w-full max-w-2xl bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-300">
                  <div className="bg-gray-50 border-b px-6 py-4 flex justify-between items-center">
                    <h3 className="text-lg font-bold text-gray-800">选择待签署文件 ({larkAttachments.length})</h3>
                    <div className="text-sm text-gray-500 font-medium">发现多个附件，请选择</div>
                  </div>
                  <div className="p-4 max-h-[400px] overflow-y-auto">
                    <div className="grid gap-3">
                      {larkAttachments.map((att) => (
                        <div 
                          key={att.token}
                          onClick={() => toggleToken(att.token)}
                          className={cn(
                            "flex items-center gap-4 p-4 rounded-xl border-2 transition cursor-pointer active:scale-[0.98]",
                            selectedTokens.includes(att.token) 
                              ? "border-blue-500 bg-blue-50/50" 
                              : "border-gray-100 hover:border-blue-200 bg-white"
                          )}
                        >
                          <div className={cn(
                            "w-6 h-6 rounded flex items-center justify-center border-2 transition",
                            selectedTokens.includes(att.token)
                              ? "bg-blue-600 border-blue-600 text-white"
                              : "border-gray-300 text-transparent"
                          )}>
                            <Check size={14} strokeWidth={4} />
                          </div>
                          {getFileIcon(att.name)}
                          <div className="flex-1 min-w-0">
                            <div className="font-bold text-gray-800 truncate">{att.name}</div>
                            <div className="flex items-center gap-2 mt-1">
                              {getFileBadge(att.name)}
                              <span className="text-[10px] text-gray-400">点击选择</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="p-6 bg-gray-50 border-t flex flex-col gap-3">
                    <button 
                      onClick={startSigningSelected}
                      disabled={selectedTokens.length === 0}
                      className="w-full bg-blue-600 text-white py-4 rounded-xl font-bold text-lg shadow-lg active:scale-95 transition disabled:opacity-50 disabled:scale-100"
                    >
                      {selectedTokens.length > 1 ? `确认签署这 ${selectedTokens.length} 个文件` : '确认签署'}
                    </button>
                    <div className="text-center text-sm text-gray-400">签署完成后，文件将自动回传至飞书</div>
                  </div>
                </div>
              )}
              {!file && !loading && larkAttachments.length === 0 && (
                <div className="w-full aspect-[3/4] max-w-2xl bg-white border-2 border-dashed border-gray-300 rounded-2xl flex flex-col items-center justify-center text-gray-400 p-8 text-center">
                  <Upload size={64} className="mb-4 opacity-10" />
                  <h3 className="text-xl font-medium text-gray-600 mb-2">开始签署文档</h3>
                  <p>请上传 PDF 文件，然后即可在页面上添加您的手写签名。</p>
                </div>
              )}
              {loading && (
                <div className="flex flex-col items-center gap-4 py-32">
                  <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                  <span className="text-blue-600 font-medium text-lg">
                    {signingQueue.length > 0 ? `正在准备下一个文件... (剩余 ${signingQueue.length} 个)` : "正在处理中..."}
                  </span>
                </div>
              )}
              {pdfDoc && (
                <div className="relative flex flex-col gap-6 w-full items-center">
                  {Array.from({ length: numPages }).map((_, i) => (
                    <PDFPage 
                      key={i} 
                      pdfDoc={pdfDoc} 
                      pageIndex={i} 
                      rotation={globalRotation}
                      placedSignatures={placedSignatures.filter(ps => ps.pageIndex === i)}
                      setPlacedSignatures={setPlacedSignatures}
                      allPlacedSignatures={placedSignatures}
                      signatures={signatures}
                      addSignatureToPage={addSignatureToPage}
                      setShowSidebar={setShowSidebar}
                      setLastClickedPageIndex={setLastClickedPageIndex}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      </main>

      {/* 签名弹窗 */}
      {isSigning && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="flex border-b bg-gray-50">
              <button 
                onClick={() => setSignTab('draw')}
                className={cn(
                  "flex-1 py-4 flex items-center justify-center gap-2 font-bold transition",
                  signTab === 'draw' ? "bg-white text-blue-600 border-b-2 border-blue-600" : "text-gray-500 hover:bg-gray-100"
                )}
              >
                <Monitor size={18} /> 本地签名
              </button>
              <button 
                onClick={() => setSignTab('qr')}
                className={cn(
                  "flex-1 py-4 flex items-center justify-center gap-2 font-bold transition",
                  signTab === 'qr' ? "bg-white text-blue-600 border-b-2 border-blue-600" : "text-gray-500 hover:bg-gray-100"
                )}
              >
                <Smartphone size={18} /> 扫码签名
              </button>
              <button onClick={() => setIsSigning(false)} className="px-4 text-gray-400 hover:text-gray-600"><X size={24} /></button>
            </div>

            <div className="p-4 md:p-6 min-h-[350px] flex flex-col justify-center">
              {signTab === 'draw' ? (
                <>
                  <div className="bg-white border-2 border-gray-200 rounded-xl overflow-hidden touch-none h-64 md:h-80">
                    <SignatureCanvas 
                      key={orientationKey}
                      ref={sigCanvas}
                      penColor="black"
                      velocityFilterWeight={0}
                      onEnd={() => sigCanvas.current && setSignatureStrokes(sigCanvas.current.toData())}
                      canvasProps={{ className: "signature-canvas w-full h-full cursor-crosshair" }}
                    />
                  </div>
                  <div className="mt-4 flex justify-end gap-3">
                    <button onClick={() => sigCanvas.current?.clear()} className="flex items-center gap-2 px-4 py-2 text-gray-600 hover:bg-gray-200 rounded-lg transition font-medium">
                      <Eraser size={18} /> 重填
                    </button>
                    <button onClick={saveSignature} className="flex items-center gap-2 px-8 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-bold shadow-md shadow-blue-200">
                      <Check size={20} /> 确认保存
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center text-center">
                  <div className="p-4 bg-white border-2 border-gray-100 rounded-2xl shadow-sm mb-4">
                    <QRCodeSVG value={mobileSignUrl} size={200} />
                  </div>
                  <h4 className="text-lg font-bold text-gray-800">手机扫码，手写签字</h4>
                  <p className="text-gray-500 text-sm mt-2 max-w-xs">使用手机扫描上方二维码，在手机上完成签字后，签名将自动同步到此处。</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {showSidebar && <div className="fixed inset-0 bg-black/50 z-30 md:hidden" onClick={() => setShowSidebar(false)} />}
    </div>
  );
}

function PDFPage({ pdfDoc, pageIndex, rotation, placedSignatures, setPlacedSignatures, allPlacedSignatures, signatures, setShowSidebar, setLastClickedPageIndex }: any) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [renderDimensions, setRenderDimensions] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0) {
          setRenderDimensions({ width: entry.contentRect.width, height: entry.contentRect.height });
        }
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let renderTask: any = null;
    let isCanceled = false;

    const renderPage = async () => {
      try {
        const page = await pdfDoc.getPage(pageIndex + 1);
        if (isCanceled) return;

        const pixelRatio = window.devicePixelRatio || 1;
        const baseScale = 2.0; 
        const viewport = page.getViewport({ 
          scale: baseScale * pixelRatio, 
          rotation: (page.rotate + rotation) % 360 
        });
        
        const canvas = canvasRef.current;
        if (!canvas || isCanceled) return;
        const context = canvas.getContext('2d');
        if (!context) return;
        
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        canvas.style.width = '100%';
        canvas.style.height = 'auto';

        renderTask = page.render({ 
          canvasContext: context, 
          viewport: viewport,
          intent: 'print'
        });

        await renderTask.promise;
      } catch (err: any) {
        if (err.name !== 'RenderingCancelledException') {
          console.error('PDF Render Error:', err);
        }
      }
    };

    renderPage();

    return () => {
      isCanceled = true;
      if (renderTask) {
        renderTask.cancel();
      }
    };
  }, [pdfDoc, pageIndex, rotation]);

  const updatePlacedSignature = (id: string, updates: any) => {
    setPlacedSignatures(allPlacedSignatures.map((ps: any) => ps.id === id ? { ...ps, ...updates } : ps));
  };

  const removePlacedSignature = (id: string) => {
    setPlacedSignatures(allPlacedSignatures.filter((ps: any) => ps.id !== id));
  };

  return (
    <div className="flex flex-col items-center gap-2 w-full max-w-fit mx-auto group/page">
      <div className="flex items-center justify-between w-full px-2 text-sm text-gray-500 font-medium">
        <span>第 {pageIndex + 1} 页</span>
        <button 
          onClick={() => {
            setLastClickedPageIndex(pageIndex);
            setShowSidebar(true);
          }}
          className="flex items-center gap-1 text-blue-600 hover:text-blue-700 transition"
        >
          <Plus size={16} /> 在此页添加签名
        </button>
      </div>
      <div ref={containerRef} className="relative shadow-2xl bg-white rounded-sm border border-gray-300 w-full overflow-hidden">
        <canvas key={`${pageIndex}-${rotation}`} ref={canvasRef} className="max-w-full h-auto block" />
        {renderDimensions.width > 0 && placedSignatures.map((ps: any) => {
          const sig = signatures.find((s: any) => s.id === ps.signatureId);
          if (!sig) return null;
          const x = (ps.xPercent / 100) * renderDimensions.width;
          const y = (ps.yPercent / 100) * renderDimensions.height;
          const width = (ps.widthPercent / 100) * renderDimensions.width;
          const height = (ps.heightPercent / 100) * renderDimensions.height;
          return (
            <Rnd
              key={ps.id}
              size={{ width, height }}
              position={{ x, y }}
              onDragStop={(_, d) => updatePlacedSignature(ps.id, { xPercent: (d.x / renderDimensions.width) * 100, yPercent: (d.y / renderDimensions.height) * 100 })}
              onResizeStop={(_e, _dir, ref, _delta, pos) => updatePlacedSignature(ps.id, { widthPercent: (parseInt(ref.style.width) / renderDimensions.width) * 100, heightPercent: (parseInt(ref.style.height) / renderDimensions.height) * 100, xPercent: (pos.x / renderDimensions.width) * 100, yPercent: (pos.y / renderDimensions.height) * 100 })}
              bounds="parent"
              lockAspectRatio={true}
              className="z-10"
            >
              <div className="relative w-full h-full border-2 border-dashed border-blue-400 hover:border-blue-600 bg-blue-400/5 transition-colors group/sig">
                <img src={sig.dataUrl} className="w-full h-full object-contain pointer-events-none" />
                <button onClick={(e) => { e.stopPropagation(); removePlacedSignature(ps.id); }} className="absolute -top-3 -right-3 bg-red-500 text-white rounded-full p-1.5 shadow-lg opacity-0 group-hover/sig:opacity-100 transition hover:bg-red-600 scale-110"><X size={14} /></button>
              </div>
            </Rnd>
          );
        })}
      </div>
    </div>
  );
}
