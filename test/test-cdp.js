#!/usr/bin/env node

/**
 * CDP 连接测试脚本
 * 用于快速检查并启动 Chrome CDP 连接
 */

import { checkCdpConnection, startChrome, CHROME_PATH, CHROME_PROFILE } from './index.js';

const CDP_PORT = process.env.CDP_PORT || 9222;

async function main() {
  console.log(`🔍 检查 CDP 连接 (端口 ${CDP_PORT})...`);

  const connected = await checkCdpConnection(CDP_PORT);

  if (connected) {
    console.log(`✅ Chrome 已在端口 ${CDP_PORT} 运行，CDP 可用`);
    console.log(`\n💡 可以直接运行 boss 命令了`);
    console.log(`   boss list --query "前端开发"`);
  } else {
    console.log(`❌ Chrome 未在端口 ${CDP_PORT} 运行`);
    console.log(`\n🚀 正在启动 Chrome...`);

    try {
      await startChrome(CDP_PORT);
      console.log(`\n✅ Chrome 已启动，CDP 端口 ${CDP_PORT} 可用`);
      console.log(`\n💡 可以直接运行 boss 命令了`);
      console.log(`   boss list --query "前端开发"`);
    } catch (error) {
      console.error(`\n❌ 启动失败: ${error.message}`);
      console.log(`\n手动启动命令:`);
      console.log(`   ${CHROME_PATH} --remote-debugging-port=${CDP_PORT} --user-data-dir=${CHROME_PROFILE}`);
      process.exit(1);
    }
  }
}

main();
