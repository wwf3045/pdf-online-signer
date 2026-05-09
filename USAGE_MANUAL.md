# PDF 在线签名系统 - 完整说明文档

本项目是一个功能完备的 PDF 在线手写签字系统，支持 PC/移动端自适应、跨端扫码签名以及飞书多维表格（Lark Base）深度集成。

---

## 1. 系统架构
*   **前端**: React + TypeScript + Vite + Tailwind CSS (运行于 5173 端口)
*   **后端**: Node.js + Express + Socket.io + pdf-lib (运行于 3001 端口)
*   **反向代理**: Nginx (支持 HTTPS & WebSocket 转发)

---

## 2. 快速安装与部署

### 2.1 环境要求
*   Node.js (v18+)
*   Nginx
*   有效域名及 SSL 证书

### 2.2 安装步骤
1.  **克隆/进入项目目录**:
    ```bash
    cd /mnt/raid/pdfsign
    ```
2.  **安装后端依赖**:
    ```bash
    cd server
    npm install
    ```
3.  **安装前端依赖**:
    ```bash
    cd ../client
    npm install
    ```

### 2.3 启动服务
建议使用后台进程管理工具（如 `pm2`）或直接运行：
*   **启动后端**: `cd server && npm run dev`
*   **启动前端**: `cd client && npm run dev`

---

## 3. Nginx 配置 (HTTPS & 反代)

配置文件路径：`/etc/nginx/sites-enabled/sign.wwfeng3045.top.conf`

```nginx
server {
    listen 80;
    server_name sign.wwfeng3045.top;
    return 301 https://$host$request_uri; # 强制跳转 HTTPS
}

server {
    listen 443 ssl;
    server_name sign.wwfeng3045.top;

    ssl_certificate     /etc/nginx/cert/fullchain.cer;
    ssl_certificate_key /etc/nginx/cert/key.pem;

    # 关键：支持大文件上传
    client_max_body_size 50M;

    # 前端转发
    location / {
        proxy_pass http://127.0.0.1:5173;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
    }

    # 后端 API 转发
    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket (跨端签名关键)
    location /socket.io/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

---

## 4. 核心功能使用说明

### 4.1 基础签字流程
1.  访问 `https://sign.wwfeng3045.top`。
2.  点击 **“上传 PDF”** 按钮。
3.  点击 **“新增签名”**，在弹窗中手写，完成后点击 **“确认保存”**。
4.  在左侧“我的签名”列表中点击刚才保存的签名，签名将出现在 PDF 上。
5.  自由拖动签名位置，拉动右下角可**等比例缩放**。
6.  完成后点击 **“下载文件”**。

### 4.2 手机扫码签名 (跨端联动)
1.  在 PC 端打开“新增签名”弹窗。
2.  切换至 **“扫码签名”** 选项卡。
3.  使用手机扫描二维码，手机将进入专用签字页。
4.  在手机上写完后点击 **“确认并同步到电脑”**。
5.  PC 端会自动接收该签名并显示在列表中。

---

## 5. 飞书多维表格 (Lark Base) 集成手册

本系统支持从飞书自动拉取 PDF 并回传结果，所有凭证均通过 POST 传递，不保留在服务器。

### 5.1 初始化集成 (API 方式)
第三方系统需发送 POST 请求至：`https://sign.wwfeng3045.top/api/lark/init`

**JSON 请求体内容**:
```json
{
  "appId": "cli_xxxxxxxx",           // 飞书自建应用 ID
  "appSecret": "xxxxxxxxxxxxxxxx",    // 飞书自建应用 Secret
  "baseToken": "bascnxxxxxxxx",      // 多维表格的 Token
  "tableId": "tblxxxxxx",            // 数据表 ID
  "recordId": "recxxxxxx",           // 具体的记录 ID
  "sourceFieldName": "源文件列名",    // 存放原始 PDF 的附件列
  "outputFieldName": "签字结果列名"   // 签名后回传的目标列
}
```

### 5.2 访问集成页面
上述接口将返回一个 `sessionId`。
访问地址：`https://sign.wwfeng3045.top/?larkSession=您的sessionId`

### 5.3 提交回传
在飞书集成模式下，顶部会出现橙色的 **“提交至飞书”** 按钮。点击后，系统会自动：
1.  在服务器合成签名 PDF。
2.  将新文件上传至飞书临时空间。
3.  自动更新飞书多维表格对应记录的 `outputFieldName` 列。

---

## 6. 常见问题排查 (FAQ)

*   **Q: 签名位置在旋转手机后乱了？**
    *   A: 系统已采用百分比坐标系。如果出现乱位，通常是由于页面未加载完即旋转。请稍等 PDF 渲染完成后再进行操作。
*   **Q: 扫码后手机打不开页面？**
    *   A: 请确保 Nginx 允许了来自公网或局域网的访问。检查 Nginx 的 `server_name` 是否配置正确。
*   **Q: 飞书提交失败？**
    *   A: 请检查飞书应用是否拥有“编辑多维表格”权限，且 `sourceFieldName` 和 `outputFieldName` 必须是**附件**类型的列名，且名称完全一致。
*   **Q: 签字时手跟笔迹不重合？**
    *   A: 系统已集成自动 DPR 适配。如果仍有偏移，请尝试刷新页面并保持手机在垂直或水平状态下重新打开窗口。

---
*文档版本: 1.0.0*
*开发者: Gemini CLI*
