# Boss 直聘智能爬虫

> 首次启动会使用独立的 Chrome CDP Profile (`~/boss-chrome-profile`)。
> 第一次使用时需要在这个独立浏览器里手动登录 Boss 直聘，后续会自动复用登录态。

## 快速开始

```bash
# 进入仓库目录
cd /path/to/boss-scripts/boss

# 抓取职位列表（自动启动独立 Chrome）
node boss.js list --query "前端开发" --city "深圳"

# 或使用 bun
bun boss.js list --query "前端开发" --city "深圳"

# 补抓职位详情
node boss.js detail --input ./output/boss_前端开发.json
```

## 使用方式

### 1. 首次使用

第一次运行时,脚本会尝试启动独立的 Chrome CDP 实例。你需要在这个浏览器里完成一次 Boss 直聘登录:

```bash
# 可手动启动独立 Chrome
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 --user-data-dir=$HOME/boss-chrome-profile

# 然后访问 https://www.zhipin.com 完成登录
```

完成后,后续命令会复用 `~/boss-chrome-profile` 中的 Cookie 和登录态。

### 2. 基本使用(自动启动 Chrome)

脚本会自动检查 Chrome 是否在运行,如果没有则自动启动:

```bash
# 抓取职位列表
node boss.js list --query "前端开发" --city "深圳"

# 补抓职位详情
node boss.js detail --input ./output/boss_前端开发.json
```

### 3. 禁用自动启动

如果需要手动控制 Chrome,可以禁用自动启动:

```bash
# 需要先手动启动 Chrome
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 --user-data-dir=$HOME/boss-chrome-profile

# 然后运行脚本(禁用自动启动)
node boss.js list --query "前端开发" --city "深圳" --no-auto-start
```

## 功能特性

### ✅ 自动 CDP 连接检查
- 启动前自动检查 Chrome CDP 连接
- 如果未连接且启用自动启动,则自动启动 Chrome
- 如果禁用自动启动,则提示手动启动命令

### ✅ 登录状态验证
- 自动检查 Boss 直聘登录状态
- 未登录时给出清晰的提示和登录指引
- 可通过 `--skip-login-check` 参数跳过检查(不推荐)

### ✅ 自动打开目标 URL
- 如果没有找到 Boss 直聘的 Tab,自动打开搜索页面
- 避免手动打开和导航到目标页面的麻烦

### ✅ 专用 Chrome Profile
- 使用独立的 Chrome Profile (`~/boss-chrome-profile`)
- 保留登录状态和 Cookie
- 不影响主浏览器的使用

## 命令说明

### list 命令 - 抓取职位列表

```bash
boss-scripts list [选项]
```

仓库内直接运行时,可替换为 `node boss.js list ...` 或 `bun boss.js list ...`

**必填参数:**
- `--query <关键词>` - 搜索关键词

**可选参数:**
- `--city <城市>` - 城市名或代码,默认全国
- `--page <N>` - 抓取页数,默认 5
- `--count <N>` - 目标抓取条数,按每次约15条自动估算
- `--delay <ms>` - 滚动间隔毫秒,默认 5000
- `--slow` - 慢速模式(delay=8000ms)
- `--output <路径>` - 输出文件路径
- `--cdp-port <端口>` - Chrome 调试端口,默认 9222
- `--verbose` - 打印详细日志
- `--no-auto-start` - 禁用自动启动 Chrome
- `--skip-login-check` - 跳过登录状态检查(不推荐)

**示例:**
```bash
# 抓取深圳的 AI 相关职位,抓 5 页
boss-scripts list --query "AI应用" --city "深圳" --page 5

# 抓取 100 条前端开发职位,慢速模式
boss-scripts list --query "前端开发" --count 100 --slow

# 跳过登录检查(不推荐)
boss-scripts list --query "测试" --skip-login-check

# 指定输出文件
boss-scripts list --query "React" --output ./jobs/react.json
```

### detail 命令 - 补抓职位详情

```bash
boss-scripts detail [选项]
```

仓库内直接运行时,可替换为 `node boss.js detail ...` 或 `bun boss.js detail ...`

**必填参数:**
- `--input <路径>` - list 输出的 JSON 文件

**可选参数:**
- `--output <路径>` - 输出文件,默认覆盖 input
- `--delay <ms>` - 每条请求间隔毫秒,默认 3000
- `--cdp-port <端口>` - Chrome 调试端口,默认 9222
- `--verbose` - 打印详细日志
- `--no-auto-start` - 禁用自动启动 Chrome
- `--skip-login-check` - 跳过登录状态检查(不推荐)

**示例:**
```bash
# 补抓职位详情
boss-scripts detail --input ./output/boss_前端开发.json

# 使用更慢的请求间隔
boss-scripts detail --input ./jobs/react.json --delay 5000
```

### search 命令 - 自动打开搜索页

```bash
boss-scripts search [选项]
```

仓库内直接运行时,可替换为 `node boss.js search ...` 或 `bun boss.js search ...`

参数与 `list` 命令相同,区别在于:
- `list`: 需要已打开 Boss 直聘页面
- `search`: 自动打开搜索页面后抓取

## 工作流程

### cmdList 流程
1. 检查 `--query` 参数
2. 解析城市代码
3. 构建 Boss 搜索 URL
4. **确保 Chrome 准备就绪**(检查 CDP 连接,未连接则自动启动)
5. 查找或创建 Tab(自动打开目标 URL)
6. 连接 CDP 客户端
7. **验证登录状态**(新增,除非跳过检查)
8. 开始抓取职位列表

### cmdDetail 流程
1. 检查 `--input` 参数
2. 读取已有的职位数据
3. **确保 Chrome 准备就绪**(检查 CDP 连接,未连接则自动启动)
4. 查找 zhipin.com Tab
5. 连接 CDP 客户端
6. **验证登录状态**(新增,除非跳过检查)
7. 开始补抓职位详情

## 常见问题

### Q: Chrome 启动超时怎么办?

A: 可以手动启动 Chrome:
```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 --user-data-dir=$HOME/boss-chrome-profile
```

### Q: 如何确认 Chrome 是否在运行?

A: 手动检查:
```bash
lsof -i :9222
curl http://127.0.0.1:9222/json/version
```

### Q: 能否使用不同的 CDP 端口?

A: 可以,使用 `--cdp-port` 参数:
```bash
boss-scripts list --query "测试" --cdp-port 9223
```

### Q: 自动启动的 Chrome 会关闭吗?

A: 不会。Chrome 会在后台继续运行,任务完成后需要手动关闭。

### Q: 如何清理 Chrome Profile?

A: Profile 位于 `~/boss-chrome-profile`,可以直接删除:
```bash
rm -rf ~/boss-chrome-profile
```

### Q: 如何登录 Boss 直聘?

A: 首次使用需要在 Chrome 中登录 Boss 直聘:
```bash
# 1. 启动专用 Chrome(或使用脚本自动启动)
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 --user-data-dir=$HOME/boss-chrome-profile

# 2. 在 Chrome 中访问 https://www.zhipin.com

# 3. 点击右上角"登录/注册",完成登录

# 4. 登录后脚本会自动检测并验证登录状态
```

### Q: 脚本提示未登录怎么办?

A: 脚本会自动检查登录状态,如果检测到未登录:
1. 在 Chrome 浏览器中访问 https://www.zhipin.com
2. 点击右上角"登录/注册"
3. 完成登录后重新运行脚本

### Q: 什么情况下需要跳过登录检查?

A: 一般不建议跳过登录检查。仅在以下情况考虑使用 `--skip-login-check`:
- 已经确认已登录但脚本误判
- 使用代理或其他特殊网络环境

### Q: 登录状态检查是如何工作的?

A: 脚本通过以下方式检查登录状态:
- 检查本地存储中的登录 token (`__zp_stoken__`)
- 检查 Cookie 中的登录标识
- 检查页面上的用户导航元素

这些检查确保爬虫能够正常访问职位数据。

## 文件结构

```
.
├── boss.js           # 入口文件
├── index.js          # 主逻辑(包含自动启动功能)
├── model.js          # 数据模型
├── cities.js         # 城市映射
└── shared/           # 包内共享工具（CDP/JSON/运行时）
```

## 更新日志

### 2026-03-24
- 🧹 清理仓库产物与测试/调试脚本
- ✅ 新增 `.gitignore` 忽略 `output/`、`.playwright-cli/`、`._*` 等文件

### 2026-03-19
- ✅ 新增自动检查 CDP 连接功能
- ✅ 新增自动启动 Chrome 功能(默认启用)
- ✅ 新增 `--no-auto-start` 参数
- ✅ 优化 `resolveListTarget`:自动打开目标 URL
- ✅ 修复 CDP 连接检查逻辑
- ✅ 更新使用文档

## 技术细节

### CDP 连接检查
使用 `http://127.0.0.1:{port}/json/version` 端点检查 Chrome 是否可用。

### 自动启动流程
1. 检查 CDP 连接
2. 如果未连接,启动 Chrome 进程
3. 每 500ms 检查一次连接状态
4. 最多等待 15 秒(30 次检查)
5. 成功连接后继续执行

### 后台进程
Chrome 使用 `spawn` 启动,配置为:
- `detached: true` - 独立进程
- `stdio: 'ignore'` - 忽略 I/O
- `unref()` - 允许父进程退出

## 注意事项

1. **Chrome 路径**: 当前配置为 macOS 路径,其他系统需要修改 `CHROME_PATH`
2. **Profile 路径**: 使用 `~/boss-chrome-profile`,保留登录状态
3. **端口占用**: 确保指定的 CDP 端口未被占用
4. **网络连接**: 需要 Chrome 能够访问 Boss 直聘网站
5. **登录状态**: 首次使用需要在 Chrome 中登录 Boss 直聘
