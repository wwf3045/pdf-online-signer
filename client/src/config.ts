/**
 * 环境感知逻辑 - 域名配置加载器
 */
import { DOMAINS } from './domains';

/**
 * 获取标准 API 请求的基础 URL
 */
export function getApiBase(): string {
  // 本地开发环境：后端通常在 3001
  if (window.location.hostname === 'localhost') {
    return 'http://localhost:3001';
  }

  // 生产环境：使用专用的 API 加速域名
  return `https://${DOMAINS.API}`;
}

/**
 * 获取 WebSocket 连接的基础 URL
 */
export function getSocketBase(): string {
  // 本地开发环境
  if (window.location.hostname === 'localhost') {
    return 'http://localhost:3001';
  }

  // 生产环境：使用专用的 WebSocket 直连域名（绕过 ESA）
  return `https://${DOMAINS.WEBSOCKET}`;
}

/**
 * 生成手机端扫码签名的 URL
 */
export function getMobileSignUrl(sessionId: string, serverIp: string | null): string {
  // 生产环境：二维码指向 ESA 加速的前端域名
  if (window.location.hostname !== 'localhost') {
    return `https://${DOMAINS.FRONTEND}${window.location.pathname}?session=${sessionId}`;
  }
  
  // 本地开发环境
  const host = serverIp || window.location.hostname;
  const protocol = window.location.protocol;
  const port = window.location.port || '5173'; 
  return `${protocol}//${host}:${port}${window.location.pathname}?session=${sessionId}`;
}
