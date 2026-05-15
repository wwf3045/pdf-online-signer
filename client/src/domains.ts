/**
 * 域名中心 - 所有的外部域名在此统一配置
 */
export const DOMAINS = {
  // 1. 前端域名 (通过 ESA 加速，回源 NAS:5173)
  FRONTEND: 'sign.pdf.wwfeng3045.top',
  
  // 2. 后端 API 域名 (通过 ESA 加速，回源 NAS:3001)
  API: 'api.pdf.wwfeng3045.top',

  // 3. WebSocket 专用域名 (绕过 ESA，直连 ECS 反代 NAS:3001)
  WEBSOCKET: 'websocket.ecs.wwfeng3045.top'
};
