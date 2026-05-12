# PDF 在线签名系统 - 完整使用说明文档

本项目是一个功能完备、安全高效的 PDF 在线手写签字系统。支持 PC/移动端自适应、跨端扫码联动签名、以及飞书多维表格（Lark Base）的自动化集成。

---

## 1. 核心特性
*   **跨端联动**: PC 端扫码，手机端手写，实时同步，解决电脑鼠标签字不美观的问题。
*   **安全隐私**: 
    *   **阅后即焚**: 临时文件在下载完成或提交飞书后**立即从服务器自动删除**。
    *   **内存运行**: 飞书凭证仅存在于会话中，不存入数据库，保证数据安全。
*   **智能排版**: 签名支持任意拖拽、等比例缩放，采用百分比坐标系，适配不同尺寸的 PDF 页面。
*   **飞书集成**: 无缝对接飞书多维表格，实现从“拉取-签字-回传”的全流程闭环。

---

## 2. 基础功能使用手册

### 2.1 本地签字流程
1.  **访问地址**: 打开浏览器访问 `https://sign.wwfeng3045.top`。
2.  **上传文件**: 点击右上角 **“上传 PDF”**，选择您需要签字的文档。
3.  **创建签名**: 
    *   点击 **“新增签名”** 按钮。
    *   在弹出窗口中，您可以直接使用鼠标/触摸板在 **“本地签名”** 区域书写。
    *   完成后点击 **“确认保存”**，签名将进入左侧侧边栏的“我的签名”库。
4.  **放置签名**: 
    *   在侧边栏点击所需的签名，它会出现在 PDF 第一页中心。
    *   **移动**: 鼠标按住签名拖动到目标位置。
    *   **缩放**: 拖动签名方框右下角的控制点进行等比例缩放。
    *   **删除**: 点击签名右上角的红色叉号可移除该位置的签名。
5.  **导出文档**: 点击右上角 **“下载文件”**，系统将合成签名并弹出下载窗口。
    *   *注意：一旦下载开始，该文档及其所有临时记录将从服务器彻底删除。*

### 2.2 跨端扫码签字 (强烈推荐)
*为了获得最真实的手写感，建议使用此功能：*
1.  在 PC 端打开 **“新增签名”** 弹窗。
2.  选择 **“扫码签名”** 选项卡。
3.  使用手机（微信、飞书或系统相机）扫描显示的二维码。
4.  **手机操作**: 在手机打开的签字页中横屏或竖屏书写，完成后点击 **“确认并同步到电脑”**。
5.  **同步**: 电脑端会立刻收到签名并弹出提醒，您可以像处理本地签名一样使用它。

---

## 3. 飞书多维表格集成指南

本系统可作为飞书工作流中的一个插件环节。

### 3.1 准备工作
1.  **飞书应用**: 在飞书开放平台创建一个自建应用，并启用“多维表格”权限。
2.  **表格准备**: 
    *   一个多维表格，包含一个 **“附件”** 类型的列（用于存放原始 PDF）。
    *   另一个 **“附件”** 类型的列（用于接收签字后的 PDF）。

### 3.2 流程接入 (开发者/管理员)
1.  **初始化会话**: 第三方系统（或集成工具）向接口 `/api/lark/init` 发送 **POST** 请求。

**请求体 JSON 示例 (机器人模式)**:
```json
{
  "appId": "cli_xxxxxxxx",           // [与 personalBaseToken 二选一] 飞书自建应用 ID
  "appSecret": "xxxxxxxxxxxxxxxx",    // [与 personalBaseToken 二选一] 飞书自建应用 Secret
  "baseToken": "bascnxxxxxxxx",      // [必填] 多维表格 Token
  "tableId": "tblxxxxxx",            // [必填] 数据表 ID
  "recordId": "recxxxxxx",           // [必填] 记录 ID
  "sourceFieldName": "待签文件",      // [必填] 原始 PDF 列名
  "outputFieldName": "签字结果"       // [必填] 结果 PDF 列名
}
```

**请求体 JSON 示例 (个人访问令牌模式 - 推荐)**:
```json
{
  "personalBaseToken": "pat_xxxxxxx", // [与 appId/appSecret 二选一] 飞书个人访问令牌 (Personal Access Token)
  "baseToken": "bascnxxxxxxxx",
  "tableId": "tblxxxxxx",
  "recordId": "recxxxxxx",
  "sourceFieldName": "待签文件",
  "outputFieldName": "签字结果"
}
```

2.  **获取链接**: 接口将返回一个 JSON：`{"sessionId": "abcdef123"}`。
    *   拼接访问链接：`https://sign.wwfeng3045.top/?larkSession=abcdef123`
3.  **用户操作**: 用户通过该链接访问，系统会自动完成以下动作：
    *   使用提供的凭证从飞书记录中下载 `sourceFieldName` 里的 PDF。
    *   在本地服务器临时挂载，并展示在前端页面。
4.  **一键提交**: 用户在页面完成签字放置后，点击顶部的橙色 **“提交至飞书”** 按钮。
    *   系统合成 PDF -> 上传至飞书文件空间 -> 更新飞书记录的 `outputFieldName` 列。
    *   **清理**: 任务完成后，服务器上的 PDF 和会话信息将立即被物理删除。

---

## 4. 安装与部署指南

### 4.1 环境要求
*   **操作系统**: Linux (推荐 Ubuntu 20.04+ 或 Debian)
*   **运行时**: Node.js (v18.x 或更高版本)
*   **包管理器**: npm 或 yarn
*   **反向代理**: Nginx (必须，用于处理 HTTPS 和 WebSocket)

### 4.2 依赖清单
#### 后端 (server) 核心依赖:
- `express`: Web 框架
- `socket.io`: 实现手机与电脑实时同步
- `pdf-lib`: 用于在服务器端合成签名至 PDF
- `@larksuiteoapi/node-sdk`: 飞书官方 SDK
- `multer`: 处理 PDF 文件上传

#### 前端 (client) 核心依赖:
- `react` & `vite`: 前端框架与构建工具
- `pdfjs-dist`: 在浏览器中渲染 PDF
- `react-signature-canvas`: 手写板组件
- `react-rnd`: 实现签名的拖拽与缩放
- `lucide-react`: 图标库

### 4.3 部署步骤

#### 第一步：克隆代码并安装依赖
```bash
# 进入项目根目录
cd /mnt/raid/pdfsign

# 安装后端依赖
cd server
npm install

# 安装前端依赖
cd ../client
npm install
```

#### 第二步：环境配置
在 `server` 目录下创建 `.env` 文件（可选，目前主要通过 API 动态传参，但建议保留）：
```env
PORT=3001
```

#### 第三步：构建与启动
**推荐方式：使用 PM2 进行生产环境管理**
```bash
# 安装 PM2
npm install -g pm2

# 启动后端服务
cd /mnt/raid/pdfsign/server
pm2 start src/index.ts --interpreter ./node_modules/.bin/ts-node --name pdf-backend

# 启动前端服务 (开发模式供反代)
cd /mnt/raid/pdfsign/client
pm2 start "npm run dev" --name pdf-frontend
```

#### 第四步：Nginx 配置
参考以下生产环境模板，配置文件通常位于 `/etc/nginx/sites-available/pdfsign`：

```nginx
server {
    listen 80;
    server_name your-domain.com; # 替换为你的域名
    return 301 https://$host$request_uri; # 强制跳转 HTTPS
}

server {
    listen 443 ssl;
    server_name your-domain.com;

    # SSL 证书路径
    ssl_certificate     /etc/nginx/cert/fullchain.cer;
    ssl_certificate_key /etc/nginx/cert/key.pem;

    # 安全配置
    ssl_session_timeout 5m;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # 关键：支持大文件上传
    client_max_body_size 50M;

    # 1. 前端页面 (Vite 服务)
    location / {
        proxy_pass http://127.0.0.1:5173;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # 2. 后端 API 接口
    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # 3. Socket.io (实现手机联动必须)
    location /socket.io/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
    }
}
```

### 4.4 Systemd 开机自启服务示例
如果你不使用 PM2，可以使用 Systemd。创建以下两个服务文件。

#### 1. 后端服务: `/etc/systemd/system/pdf-backend.service`
```ini
[Unit]
Description=PDF Sign Backend Server
After=network.target

[Service]
Type=simple
User=wwf
WorkingDirectory=/mnt/raid/pdfsign/server
# 生产环境建议先 npm run build 然后运行 node dist/index.js
# 当前开发模式运行方式:
ExecStart=/usr/bin/npm run dev
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

#### 2. 前端服务: `/etc/systemd/system/pdf-frontend.service`
```ini
[Unit]
Description=PDF Sign Frontend (Vite)
After=network.target

[Service]
Type=simple
User=wwf
WorkingDirectory=/mnt/raid/pdfsign/client
ExecStart=/usr/bin/npm run dev
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

**启用命令**:
```bash
sudo systemctl daemon-reload
sudo systemctl enable pdf-backend pdf-frontend
sudo systemctl start pdf-backend pdf-frontend
```

---

## 5. 文件自动清理机制说明

本系统遵循**最小化存储原则**：
1.  **上传后的源文件**: 仅在签字过程中存在。
2.  **合成后的结果文件**: 
    *   如果是**本地下载**：文件在下载响应完成后瞬间删除。
    *   如果是**飞书回传**：文件在 API 调用成功（飞书确认接收）后瞬间删除。
3.  **异常清理**: 即使流程未走完，服务器也会定期清理超过 24 小时的无主临时文件（取决于后端配置）。

---

## 5. 常见问题排查

| 现象 | 原因 | 解决方案 |
| :--- | :--- | :--- |
| **PDF 加载缓慢** | 网络波动或文件过大 | 建议 PDF 限制在 20MB 以内，系统支持最大 50MB。 |
| **手机扫码后是空白页** | 局域网防火墙或域名解析问题 | 确保手机能正常访问 `sign.wwfeng3045.top` 的 443 端口。 |
| **签名位置发生偏移** | PDF 页面含有复杂的旋转旋转元数据 | 尽量使用标准化工具生成的 PDF。 |
| **飞书提交报错 403** | 飞书应用权限不足 | 确保应用拥有 `bitable:app` 范围内的读写权限。 |
| **下载后的文件名是乱码** | 部分旧版浏览器兼容性 | 建议使用 Chrome、Edge 或 Safari 浏览器。 |

---
*文档版本: 1.1.0*
*更新日期: 2026-05-09*
*维护者: Gemini CLI*
