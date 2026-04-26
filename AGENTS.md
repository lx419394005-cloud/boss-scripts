# AGENTS.md

1. 不可以使用 `curl` 访问 `zhipin` 相关页面、接口或资源。
2. 只可以通过 Chrome CDP 访问 `zhipin`。
3. 每次访问 `zhipin` 后，下一次访问必须间隔 10 秒以上。

## 技术栈

- 运行时：Node.js 18+
- 模块系统：ES Modules
- 浏览器通信：Chrome DevTools Protocol (CDP)
- WebSocket 客户端：`ws`
- 数据存储：本地 JSON 文件

## 明确不使用

- 不使用 `playwright`
- 不使用 `puppeteer`
- 不使用任何基于 `playwright` 或 `puppeteer` 的二次封装

## 测试脚本规范

- 测试脚本统一放在 `test/` 目录下
- 命名规范：`test-<功能>.js`（如 `test-cdp.js`、`test-login.js`）
- 测试脚本直接导入项目模块进行验证，不依赖外部测试框架

## 仪表盘服务

- 入口：`node server.js`（或 `bun server.js`）
- 端口：默认 3000，可通过 `PORT` 环境变量修改
- 目录结构：
  - `server.js` - HTTP 服务器，读取 `output/` 目录数据
  - `public/` - 前端静态文件
- API 端点：
  - `GET /` - 返回仪表盘页面
  - `GET /api/jobs` - 返回所有职位数据 + 统计分析
  - `GET /api/sources` - 返回数据源列表

## 执行约定

- 对 `zhipin` 的页面打开、导航、请求、元素读取、元素交互，都必须走 CDP。
- 涉及页面元素定位时，不允许自行猜测、试探或枚举选择器。
- 抓取或交互所需的 XPath 由用户提供，拿到后再接入代码。
- 实现新功能时，优先复用现有的 CDP、节流、日志与 JSON 读写能力。
- 若现有代码路径违反以上规则，应先修正规则符合性，再继续开发。
