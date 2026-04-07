# 智者圆桌 · 部署指南

## 项目结构

```
wise-council/
├── index.html          # 前端页面
├── api/
│   └── ask.js          # Vercel Serverless Function（API代理）
├── vercel.json         # Vercel路由配置
├── .env.example        # 环境变量模板
├── .gitignore
└── README.md
```

---

## 一、准备工作（5分钟）

### 1. 获取 API Key

**Anthropic Claude（必选之一）**
1. 访问 https://console.anthropic.com
2. 注册 / 登录（支持国际信用卡）
3. 左侧菜单 → API Keys → Create Key
4. 复制保存（只显示一次）

**DeepSeek（可选，便宜10倍以上）**
1. 访问 https://platform.deepseek.com
2. 注册 → 充值（最低约10元）
3. API Keys → 创建 API Key
4. 复制保存

---

## 二、部署到 Vercel（10分钟）

### 步骤1：推送到 GitHub

```bash
# 在项目文件夹里执行
cd wise-council
git init
git add .
git commit -m "init: 智者圆桌"

# 在 GitHub.com 新建仓库（可以是 Private）
# 然后执行：
git remote add origin https://github.com/你的用户名/wise-council.git
git push -u origin main
```

### 步骤2：连接 Vercel

1. 访问 https://vercel.com，用 GitHub 账号登录
2. 点击 **Add New → Project**
3. 选择你刚推送的 `wise-council` 仓库
4. Framework Preset 选 **Other**
5. 先**不要点 Deploy**，先去配置环境变量

### 步骤3：配置环境变量

在 Vercel 的 **Environment Variables** 区域，逐一添加：

| 变量名 | 值 | 说明 |
|--------|-----|------|
| `ANTHROPIC_API_KEY` | `sk-ant-xxxxx` | Claude的Key，至少填这个 |
| `DEEPSEEK_API_KEY` | `sk-xxxxx` | DeepSeek的Key，可选 |
| `ACCESS_PASSWORD` | `你设的密码` | 留空则无需密码 |
| `MAX_REQUESTS_PER_IP` | `30` | 每IP每天最多请求次数 |

> ⚠️ 注意：`MAX_REQUESTS_PER_IP=30` 意味着每次「召集圆桌」调用9次，
> 30次约等于3轮完整体验。可按需调整。

### 步骤4：部署

点击 **Deploy** 按钮，等待约1分钟，Vercel会给你一个公开链接，如：
```
https://wise-council-xxx.vercel.app
```

---

## 三、自定义域名（可选）

1. Vercel → 你的项目 → Settings → Domains
2. 添加你自己的域名（如 `council.yourdomain.com`）
3. 按提示在域名商那里加一条 CNAME 记录
4. 等待几分钟生效

---

## 四、更新部署

每次修改文件后：
```bash
git add .
git commit -m "update: 描述改动"
git push
```
Vercel 会自动重新部署，通常1分钟内生效。

---

## 五、费用估算

### Claude Sonnet 4（claude-sonnet-4-20250514）
- 输入：~$3 / 100万 token
- 输出：~$15 / 100万 token
- 每次完整圆桌（9人×约200字）≈ **$0.02~0.04**

### DeepSeek V3
- 输入：约¥1 / 100万 token
- 输出：约¥2 / 100万 token  
- 每次完整圆桌 ≈ **¥0.002~0.005**（约贵10倍的Claude的1/10）

### Vercel 免费额度
- 个人 Hobby 计划免费，足够个人使用
- Serverless Function：每月100GB流量，每月10万次调用

---

## 六、安全说明

### ✅ API Key 安全
- Key 只存在 Vercel 环境变量里
- 前端代码里**没有任何 Key**
- 即使用户「查看源码」也无法看到 Key

### ✅ 防滥用机制
- IP 限流：每IP每天最多N次（可配置）
- 访问密码：可设置密码，只分享给朋友
- 双重保障：IP限流 + 密码，叠加保护

### ⚠️ 注意事项
- 当前 IP 限流用内存存储，Vercel 冷启动后重置
- 如需更严格的持久化限流，可接入 Upstash Redis（有免费额度）
- 建议定期在 Anthropic/DeepSeek 控制台查看用量

---

## 七、本地开发

```bash
# 安装 Vercel CLI
npm i -g vercel

# 登录
vercel login

# 复制环境变量文件
cp .env.example .env.local
# 编辑 .env.local 填入真实的 Key

# 本地启动（会模拟 Vercel 环境）
vercel dev

# 访问 http://localhost:3000
```

---

## 八、常见问题

**Q: 点「召集圆桌」没有反应？**
A: 检查浏览器控制台（F12），看是否有报错。常见原因：API Key 无效、余额不足。

**Q: 某位智者一直显示「出错」？**
A: 通常是 API 调用频率过高（rate limit），稍等几秒重试，或把每人的延迟从280ms改大。

**Q: 想修改某位智者的性格？**
A: 修改 `index.html` 里 `T` 数组中对应的 `prompt` 字段，推送即生效。

**Q: 想增加第十位智者？**
A: 在 `T` 数组里加一个对象，`grid-template-columns` 改为 `repeat(3,1fr)` 依然适用（第10个会自动换行）。
