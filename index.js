import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';

import { createCdpClient } from './shared/cdp-client.js';
import { loadJsonFile, saveJsonFile } from './shared/json-io.js';
import { gaussianJitter, jitter, sleep, writeError, writeLine } from './shared/runtime.js';
import { resolveCity } from './cities.js';
import { buildBossJob } from './model.js';

export const HELP = `
boss-scripts - Boss直聘智能爬虫

用法:
  boss-scripts list   [选项]   抓取职位列表，结果存为JSON到output/（快，每页仅1次API请求）
  boss-scripts search [选项]   自动新开搜索页后抓列表（无现成Boss页面时用）
  boss-scripts detail [选项]   补抓职位详情JD（慢，每条1次API请求）

通用选项:
  --cdp-port <端口>    Chrome调试端口，默认9222
  --verbose            显示详细调试日志
  --no-auto-start      禁用自动启动Chrome（需手动启动）
  --skip-login-check   跳过登录状态检查（不推荐）

list / search 选项:
  --query  <关键词>   搜索关键词，如"前端开发"（必填）
  --city   <城市>     城市名，如"深圳"，默认全国
  --page   <N>        抓取页数，默认5
  --count  <N>        目标条数，自动估算滚动次数
  --delay  <ms>       滚动间隔，默认5000ms（建议≥5000）
  --slow               慢速模式（delay=8000ms，适合大规模抓取）
  --output <路径>      输出JSON文件，默认./output/boss_<query>.json

detail 选项:
  --input  <路径>     list命令输出的JSON文件（必填）
  --output <路径>     输出文件，默认覆盖input
  --delay  <ms>       每条请求间隔，默认3000ms

示例:
  boss-scripts list   --query "前端开发" --city "深圳" --page 5
  boss-scripts search --query "AI应用"  --count 100 --slow
  boss-scripts detail --input ./output/boss_前端开发.json
`.trim();

export function parseArgs(argv) {
  const [, , cmd, ...rest] = argv;
  const opts = { cmd, cdpPort: 9222, verbose: false, slow: false, autoStartChrome: true, skipLoginCheck: false };

  for (let i = 0; i < rest.length; i++) {
    const current = rest[i];
    const next = rest[i + 1];

    if (current === '--query') {
      opts.query = next;
      i++;
    } else if (current === '--city') {
      opts.city = next;
      i++;
    } else if (current === '--page') {
      opts.page = parseInt(next, 10);
      i++;
    } else if (current === '--count') {
      opts.count = parseInt(next, 10);
      i++;
    } else if (current === '--delay') {
      opts.delay = parseInt(next, 10);
      i++;
    } else if (current === '--output') {
      opts.output = resolve(process.cwd(), next);
      i++;
    } else if (current === '--input') {
      opts.input = resolve(process.cwd(), next);
      i++;
    } else if (current === '--cdp-port') {
      opts.cdpPort = parseInt(next, 10);
      i++;
    } else if (current === '--verbose') {
      opts.verbose = true;
    } else if (current === '--slow') {
      opts.slow = true;
    } else if (current === '--no-auto-start') {
      opts.autoStartChrome = false;
    } else if (current === '--skip-login-check') {
      opts.skipLoginCheck = true;
    }
  }

  return opts;
}

export const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const CHROME_PROFILE = homedir() + '/boss-chrome-profile';

export async function checkCdpConnection(cdpPort) {
  try {
    const response = await fetch(`http://127.0.0.1:${cdpPort}/json/version`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) {
      return false;
    }
    const data = await response.json();
    return data && data['Browser'];
  } catch (error) {
    return false;
  }
}

export async function checkLoginStatus(client) {
  try {
    // 使用 Network.getCookies 命令来获取 Cookie
    // 这比使用 document.cookie 更可靠
    const cookiesResult = await client.send('Network.getCookies');
    
    if (!cookiesResult || !cookiesResult.result || !Array.isArray(cookiesResult.result.cookies)) {
      return null;
    }

    const cookies = cookiesResult.result.cookies;
    const hasWt2 = cookies.some(c => c.name === 'wt2');
    const hasStoken = cookies.some(c => c.name === '__zp_stoken__');

    if (hasWt2 && hasStoken) {
      return true;
    }

    return false;
  } catch (error) {
    // 如果 Network.getCookies 不可用，尝试其他方法
    // 如果页面还没加载,暂时不报错
    return null;
  }
}

export async function startChrome(cdpPort) {
  writeLine(`🚀 启动 Chrome (端口 ${cdpPort})...`);

  return new Promise((resolve, reject) => {
    const args = [
      '--remote-debugging-port=' + cdpPort,
      '--user-data-dir=' + CHROME_PROFILE,
    ];

    const chrome = spawn(CHROME_PATH, args, {
      detached: true,
      stdio: 'ignore',
    });

    chrome.unref();

    let checkCount = 0;
    const maxChecks = 30;

    const interval = setInterval(async () => {
      checkCount++;
      const connected = await checkCdpConnection(cdpPort);

      if (connected) {
        clearInterval(interval);
        writeLine(`✓ Chrome 已启动`);
        await sleep(1000);
        resolve();
      } else if (checkCount >= maxChecks) {
        clearInterval(interval);
        reject(new Error(`Chrome 启动超时，请手动执行:\n${CHROME_PATH} --remote-debugging-port=${cdpPort} --user-data-dir=${CHROME_PROFILE}`));
      }
    }, 500);
  });
}

export async function ensureChromeReady(cdpPort, autoStart = true) {
  const connected = await checkCdpConnection(cdpPort);
  if (connected) {
    return;
  }

  if (!autoStart) {
    throw new Error(`Chrome 未在端口 ${cdpPort} 上运行。请手动启动:\n${CHROME_PATH} --remote-debugging-port=${cdpPort} --user-data-dir=${CHROME_PROFILE}`);
  }

  await startChrome(cdpPort);
}

export async function ensureLogin(client, checkLoginFn = checkLoginStatus) {
  const isLoggedIn = await checkLoginFn(client);

  if (isLoggedIn === null) {
    // 页面还没加载,无法检查登录状态,暂时跳过
    return true;
  }

  if (!isLoggedIn) {
    writeError('\n❌ 检测到未登录状态!');
    writeError('请先在 Chrome 浏览器中登录 Boss 直聘:');
    writeError('  1. 访问: https://www.zhipin.com');
    writeError('  2. 点击右上角"登录/注册"');
    writeError('  3. 完成登录后重新运行脚本');
    writeError('');
    throw new Error('未登录,请先在 Boss 直聘网站登录');
  }

  writeLine('✓ 登录状态正常');
  return true;
}

async function findTarget(cdpPort) {
  const response = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
  if (!response.ok) throw new Error(`CDP /json/list 响应 ${response.status}`);
  const targets = await response.json();
  const page = targets.find((item) => item.type === 'page' && item.url.includes('zhipin.com'));
  if (!page) {
    const urls = targets.filter((item) => item.type === 'page').map((item) => `  ${item.url}`).join('\n');
    throw new Error(`未找到 zhipin.com 的 Tab，当前页面：\n${urls}`);
  }
  return page;
}

async function openTarget(cdpPort, url) {
  const endpoint = `http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent(url)}`;
  let response = await fetch(endpoint, { method: 'PUT' });

  if (!response.ok && (response.status === 404 || response.status === 405 || response.status === 501)) {
    response = await fetch(endpoint);
  }

  if (!response.ok) {
    throw new Error(`CDP 新建 Tab 失败: ${response.status}`);
  }

  return response.json();
}

export function buildBossSearchUrl(query, cityCode) {
  return `https://www.zhipin.com/web/geek/jobs?query=${encodeURIComponent(query)}&city=${cityCode}`;
}

export function buildBossOutputPath(cwd, query) {
  return resolve(cwd, 'output', `boss_${query}.json`);
}

export function buildBossDetailUrl(job) {
  const params = new URLSearchParams();
  if (job.security_id) params.set('securityId', job.security_id);
  else if (job.id) params.set('encryptJobId', job.id);
  if (job.lid) params.set('lid', job.lid);
  return `https://www.zhipin.com/wapi/zpgeek/job/detail.json?${params.toString()}`;
}

export function shouldFetchBossDetail(job) {
  return Boolean(job?.id) && (job.jd === null || job.jd === '');
}

export function extractBossDetailPayload(json) {
  const code = json?.code ?? null;
  const message = json?.message || '';
  const jd = json?.zpData?.jobInfo?.postDescription || '';
  const retryable = code === 37 || (code === 0 && !jd);

  return { code, message, jd, retryable };
}

export function mergeBossJob(existing, incoming) {
  if (!existing) return incoming;

  const merged = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    if (key === 'jd' || key === 'fetched_at') continue;
    if (merged[key] === undefined || merged[key] === null || merged[key] === '') {
      merged[key] = value;
    }
  }

  merged.fetched_at = incoming.fetched_at || existing.fetched_at;
  return merged;
}

export function readBossJobs(data) {
  if (Array.isArray(data?.jobs)) return data.jobs;
  if (Array.isArray(data?.job_list)) return data.job_list;
  return [];
}

export function extractBossJobList(json) {
  return extractBossJobListPayload(json).jobs;
}

export function extractBossJobListPayload(json) {
  const candidates = [
    json?.zpData?.jobList,
    json?.zpData?.job_list,
    json?.zpData?.data?.jobList,
    json?.zpData?.data?.job_list,
    json?.jobList,
    json?.job_list,
  ];

  const list = candidates.find((candidate) => Array.isArray(candidate));
  if (!list) {
    throw new Error('joblist 响应中未找到职位列表字段');
  }

  return {
    jobs: list,
    totalCount:
      json?.zpData?.count ??
      json?.zpData?.totalCount ??
      json?.zpData?.total ??
      json?.zpData?.data?.count ??
      json?.zpData?.data?.totalCount ??
      json?.zpData?.data?.total ??
      null,
    hasMore:
      json?.zpData?.hasMoreNext ??
      json?.zpData?.hasMore ??
      json?.zpData?.data?.hasMoreNext ??
      json?.zpData?.data?.hasMore ??
      null,
  };
}

export async function resolveListTarget({
  cmd,
  cdpPort,
  searchUrl,
  findTargetFn = findTarget,
  openTargetFn = openTarget,
  autoStartChrome = true,
}) {
  await ensureChromeReady(cdpPort, autoStartChrome);

  try {
    return await findTargetFn(cdpPort);
  } catch (error) {
    if (cmd !== 'search') {
      return await openTargetFn(cdpPort, searchUrl);
    }
    return await openTargetFn(cdpPort, 'about:blank');
  }
}

async function cdpFetch(client, url, verbose = false) {
  if (verbose) writeLine(`  [fetch] ${url}`);

  const result = await client.send('Runtime.evaluate', {
    expression: `
      (async () => {
        const r = await fetch(${JSON.stringify(url)}, {
          credentials: 'include',
          headers: {
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'zh-CN,zh;q=0.9',
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'same-origin',
          }
        });
        return JSON.stringify({ status: r.status, body: await r.text() });
      })()
    `,
    awaitPromise: true,
    returnByValue: true,
  });

  if (result.exceptionDetails) throw new Error(`eval: ${result.exceptionDetails.text}`);

  const { status, body } = JSON.parse(result.result?.value || '{}');
  if (status !== 200) throw new Error(`HTTP ${status}`);
  return JSON.parse(body);
}

async function navigateToBossPage(client, url, waitMs = 2500, verbose = false) {
  if (!url) return;
  if (verbose) writeLine(`  [navigate] ${url}`);
  await client.send('Page.navigate', { url });
  await sleep(waitMs);
}

export async function injectBossPageActivity(client, waitMs = 1600) {
  const result = await client.send('Runtime.evaluate', {
    expression: `
      (async () => {
        const body = document.body;
        const root = document.scrollingElement || document.documentElement;
        const viewportHeight = window.innerHeight || 800;
        const maxScroll = Math.max(root.scrollHeight - viewportHeight, 0);
        const steps = [
          Math.floor(maxScroll * 0.12),
          Math.floor(maxScroll * 0.26),
          Math.floor(maxScroll * 0.18)
        ];

        window.focus();
        document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
        body?.dispatchEvent(new MouseEvent('mousemove', { clientX: 180, clientY: 220, bubbles: true }));
        body?.dispatchEvent(new MouseEvent('mousemove', { clientX: 420, clientY: 260, bubbles: true }));
        body?.dispatchEvent(new MouseEvent('mouseover', { clientX: 420, clientY: 260, bubbles: true }));

        const selection = window.getSelection?.();
        if (selection) selection.removeAllRanges();

        for (const nextY of steps) {
          const deltaY = Math.max(120, nextY - (window.scrollY || 0));
          window.dispatchEvent(new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true }));
          window.scrollTo({ top: Math.max(0, Math.min(nextY, maxScroll)), behavior: 'smooth' });
          window.dispatchEvent(new Event('scroll', { bubbles: true }));
          await new Promise((resolve) => setTimeout(resolve, 180 + Math.floor(Math.random() * 180)));
        }

        const backtrack = Math.max(0, Math.floor(maxScroll * 0.08));
        window.dispatchEvent(new WheelEvent('wheel', { deltaY: -160, bubbles: true, cancelable: true }));
        window.scrollTo({ top: backtrack, behavior: 'smooth' });
        window.dispatchEvent(new Event('scroll', { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, ${waitMs}));

        return {
          finalY: window.scrollY || 0,
          maxScroll,
          href: location.href
        };
      })()
    `,
    awaitPromise: true,
    returnByValue: true,
  });

  return result.result?.value ?? null;
}

async function getResponseBodyText(client, requestId) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await client.send('Network.getResponseBody', { requestId });
      return raw.base64Encoded ? Buffer.from(raw.body, 'base64').toString('utf8') : raw.body;
    } catch (error) {
      if (!String(error.message).includes('No data found for resource') || attempt === 1) throw error;
      await sleep(250);
    }
  }

  throw new Error('未能读取响应体');
}

function waitForJobList(client, timeout = 120000) {
  return new Promise((resolve, reject) => {
    function cleanup() {
      clearTimeout(timer);
      client.off('Network.responseReceived', handler);
    }

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('等待 joblist 超时（60s）'));
    }, timeout);

    async function handler({ requestId, response }) {
      if (!response?.url?.includes('/wapi/zpgeek/search/joblist.json')) return;

      if (response.status !== 200) {
        cleanup();
        reject(new Error(`joblist HTTP ${response.status} ${response.url}`));
        return;
      }

      try {
        const text = await getResponseBodyText(client, requestId);
        const json = JSON.parse(text);
        cleanup();
        if (json?.code !== 0) {
          reject(new Error(`joblist code=${json?.code} ${json?.message}`));
          return;
        }
        resolve(extractBossJobListPayload(json));
      } catch (error) {
        cleanup();
        reject(new Error(`joblist 解析失败: ${error.message}`));
      }
    }

    client.on('Network.responseReceived', handler);
  });
}

export async function waitForJobListAfterAction(
  client,
  action,
  timeout = 60000,
  createWatcher = (currentClient, currentTimeout) => ({ promise: waitForJobList(currentClient, currentTimeout) })
) {
  const watcher = createWatcher(client, timeout);
  await action();
  return watcher.promise;
}

export function estimateBossScrollRounds({ targetCount, existingCount = 0, batchSize = 15 }) {
  if (!Number.isFinite(targetCount) || targetCount <= existingCount) return 1;
  return Math.max(1, Math.ceil((targetCount - existingCount) / batchSize));
}

export async function injectBossScroll(client, waitMs = 2000) {
  const result = await client.send('Runtime.evaluate', {
    expression: `
      (async () => {
        const viewport = window.innerHeight || 800;
        const maxScroll = Math.max(document.documentElement.scrollHeight - viewport, 0);
        const checkpoints = [0.55, 0.72, 0.86, 0.94, 0.985]
          .map((ratio) => Math.max(0, Math.floor(maxScroll * ratio)));
        let lastY = window.scrollY;

        for (const nextY of checkpoints) {
          if (nextY <= lastY) continue;
          const deltaY = Math.max(nextY - lastY, 120);
          window.dispatchEvent(new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true }));
          window.scrollTo({ top: nextY, behavior: 'smooth' });
          window.dispatchEvent(new Event('scroll', { bubbles: true }));
          await new Promise((resolve) => setTimeout(resolve, 180 + Math.floor(Math.random() * 140)));
          lastY = nextY;
        }

        const finalY = Math.max(0, maxScroll - Math.floor(viewport * 0.15));
        const finalDeltaY = Math.max(finalY - lastY, 160);
        window.dispatchEvent(new WheelEvent('wheel', { deltaY: finalDeltaY, bubbles: true, cancelable: true }));
        window.dispatchEvent(new Event('scroll', { bubbles: true }));
        window.scrollTo({ top: finalY, behavior: 'smooth' });
        await new Promise((resolve) => setTimeout(resolve, ${waitMs}));

        return {
          startY: window.scrollY,
          finalY,
          viewport,
          documentHeight: document.documentElement.scrollHeight,
          maxScroll
        };
      })()
    `,
    awaitPromise: true,
    returnByValue: true,
  });

  return result.result?.value ?? 0;
}

async function checkScrollHeight(client) {
  const result = await client.send('Runtime.evaluate', {
    expression: 'document.documentElement.scrollHeight',
    returnByValue: true,
  });
  return result.result?.value ?? 0;
}

function buildMeta(query, cityName, cityCode, jobs, totalCount = null) {
  return {
    meta: {
      query,
      city: cityName,
      city_code: cityCode,
      total: jobs.length,
      fetched_count: jobs.length,
      total_count: totalCount ?? jobs.length,
      updated_at: new Date().toISOString(),
    },
    jobs,
  };
}

export async function cmdList(opts) {
  if (!opts.query) {
    writeError('❌ 缺少 --query 参数');
    process.exit(1);
  }

  const cityCode = resolveCity(opts.city);
  const cityName = opts.city || '全国';
  const delay = opts.slow ? 8000 : opts.delay || 5000;
  const output = opts.output || buildBossOutputPath(process.cwd(), opts.query);

  const searchUrl = buildBossSearchUrl(opts.query, cityCode);
  const target = await resolveListTarget({
    cmd: opts.cmd,
    cdpPort: opts.cdpPort,
    searchUrl,
    autoStartChrome: opts.autoStartChrome ?? true,
  });
  writeLine(`✓ 连接 Tab: ${target.url}`);

  const client = createCdpClient(target.webSocketDebuggerUrl);
  const existing = await loadJsonFile(output);
  const existingJobs = readBossJobs(existing);
  const jobsById = new Map(existingJobs.map((job) => [job.id, job]).filter(([id]) => Boolean(id)));
  const existingIds = new Set(existingJobs.map((job) => job.id).filter(Boolean));
  const jobs = [...existingJobs];
  let totalCount = existing?.meta?.total_count ?? null;
  const targetCount = Number.isFinite(opts.count) && opts.count > 0 ? opts.count : null;
  const plannedRounds = targetCount ? estimateBossScrollRounds({ targetCount, existingCount: jobs.length }) : opts.page || 5;

  writeLine(`\n城市: ${cityName} (${cityCode})  关键词: ${opts.query}  计划: ${plannedRounds} 轮`);
  if (targetCount) writeLine(`目标条数: ${targetCount}（按每次约15条估算）`);
  writeLine(`输出: ${output}\n`);

  writeLine(`已有 ${jobs.length} 条，续跑中...\n`);

  try {
    await client.send('Network.enable');
    await client.send('Page.enable');
    await sleep(500);

    writeLine(`导航: ${searchUrl}`);
    let payload = await waitForJobListAfterAction(client, async () => {
      await client.send('Page.navigate', { url: searchUrl });
      writeLine('等待页面加载...');
      await sleep(3000);
    }, 15000);
    let rawJobs = payload.jobs;
    totalCount = payload.totalCount ?? totalCount;

    // 检查登录状态
    if (!opts.skipLoginCheck) {
      await ensureLogin(client);
    } else {
      writeLine('⚠️  已跳过登录状态检查');
    }

    let scrollCount = 0;
    let consecutiveNoNew = 0;

    while (scrollCount < plannedRounds) {
      scrollCount++;
      writeLine(`\n[滚动 ${scrollCount}/${plannedRounds}] 等待列表...`);

      writeLine(`  收到 ${rawJobs.length} 条`);
      if (scrollCount === 1 && totalCount !== null) {
        writeLine(`  接口总数: ${totalCount} 条`);
      }

      let added = 0;
      let enriched = 0;
      for (const raw of rawJobs) {
        const job = buildBossJob(raw);
        if (!job.id) continue;

        if (existingIds.has(job.id)) {
          const current = jobsById.get(job.id);
          const merged = mergeBossJob(current, job);
          if (merged !== current && JSON.stringify(merged) !== JSON.stringify(current)) {
            Object.assign(current, merged);
            enriched++;
          }
          continue;
        }

        jobs.push(job);
        jobsById.set(job.id, job);
        existingIds.add(job.id);
        added++;
        if (opts.verbose) writeLine(`  + ${job.title} | ${job.company} | ${job.salary}`);
      }

      writeLine(`  新增 ${added} 条，补全 ${enriched} 条，累计 ${jobs.length} 条`);
      await saveJsonFile(output, buildMeta(opts.query, cityName, cityCode, jobs, totalCount));

      if (targetCount && jobs.length >= targetCount) {
        writeLine(`  已达到目标条数 ${targetCount}`);
        break;
      }

      if (totalCount !== null && jobs.length >= totalCount) {
        writeLine('  已达到接口总数，停止继续滚动');
        break;
      }

      if (added === 0) {
        consecutiveNoNew++;
        if (consecutiveNoNew >= 2) {
          writeLine('  连续两次无新数据，可能已到底');
          break;
        }
      } else {
        consecutiveNoNew = 0;
      }

      if (scrollCount >= plannedRounds) {
        writeLine('  已达到设定滚动次数');
        break;
      }

      const waitMs = jitter(delay, 1000);
      writeLine(`  等待 ${waitMs}ms 后滚动...`);
      let beforeHeight = 0;
      let afterHeight = 0;

      try {
        payload = await waitForJobListAfterAction(client, async () => {
          await sleep(waitMs);
          beforeHeight = await checkScrollHeight(client);
          await injectBossScroll(client, 1600);
          afterHeight = await checkScrollHeight(client);
        }, 15000);
        rawJobs = payload.jobs;
        totalCount = payload.totalCount ?? totalCount;
      } catch (error) {
        writeError(`  ✗ ${error.message}`);
        break;
      }

      if (opts.verbose) writeLine(`  滚动前高度: ${beforeHeight}, 滚动后高度: ${afterHeight}`);
      if (afterHeight <= beforeHeight && consecutiveNoNew >= 1) {
        writeLine('  页面高度未变化，已到底');
        break;
      }
    }
  } finally {
    await client.close();
  }

  if (totalCount !== null) {
    writeLine(`\n✅ list 完成！已抓 ${jobs.length} / 总数 ${totalCount} 条 → ${output}`);
  } else {
    writeLine(`\n✅ list 完成！共 ${jobs.length} 条 → ${output}`);
  }
}

export async function cmdDetail(opts) {
  if (!opts.input) {
    writeError('❌ 缺少 --input 参数');
    process.exit(1);
  }

  const delay = Math.max(opts.delay || 3000, 3000);
  const output = opts.output || opts.input;
  const data = JSON.parse(await readFile(opts.input, 'utf8'));
  const jobs = readBossJobs(data);
  const todo = jobs.filter(shouldFetchBossDetail);

  writeLine(`\n待补抓 JD: ${todo.length} 条（已有 ${jobs.length - todo.length} 条跳过）`);
  writeLine(`输出: ${output}\n`);

  if (!todo.length) {
    writeLine('全部已有 JD，无需操作');
    return;
  }

  await ensureChromeReady(opts.cdpPort, opts.autoStartChrome ?? true);
  const target = await findTarget(opts.cdpPort);
  writeLine(`✓ 连接 Tab: ${target.url}`);
  const client = createCdpClient(target.webSocketDebuggerUrl);

  // 启用 Network domain 以支持 Cookie 检查
  await client.send('Network.enable');

  // 检查登录状态
  if (!opts.skipLoginCheck) {
    await ensureLogin(client);
  } else {
    writeLine('⚠️  已跳过登录状态检查');
  }

  let done = 0;
  try {
    for (const job of todo) {
      await sleep(gaussianJitter(delay, 900, 3000));
      const detailUrl = buildBossDetailUrl(job);
      let success = false;

      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await navigateToBossPage(client, job.job_url, gaussianJitter(2200, 500, 1800), opts.verbose);
          await injectBossPageActivity(client, gaussianJitter(1400, 350, 1000));
          const json = await cdpFetch(client, detailUrl, opts.verbose);
          const detail = extractBossDetailPayload(json);

          job.detail_code = detail.code;
          job.detail_message = detail.message;
          job.jd = detail.jd;

          if (detail.jd) {
            done++;
            success = true;
            writeLine(`  ✓ [${done}/${todo.length}] ${job.title} | ${job.company}`);
            break;
          }

          if (!detail.retryable || attempt === 3) {
            writeError(`  ✗ [${job.title}] code=${detail.code} message=${detail.message || 'empty'} jd=empty`);
            break;
          }

          const retryDelay = gaussianJitter(delay, 1200, 3000);
          writeError(`  ↻ [${job.title}] code=${detail.code} message=${detail.message || 'empty'}，${retryDelay}ms 后重试 (${attempt}/3)`);
          await sleep(retryDelay);
        } catch (error) {
          if (attempt === 3) {
            writeError(`  ✗ [${job.title}]: ${error.message}`);
            break;
          }

          const retryDelay = gaussianJitter(delay, 1200, 3000);
          writeError(`  ↻ [${job.title}] ${error.message}，${retryDelay}ms 后重试 (${attempt}/3)`);
          await sleep(retryDelay);
        }
      }

      if (!success && (job.detail_code === undefined || job.detail_message === undefined)) {
        job.detail_code = null;
        job.detail_message = '';
      }

      if (done % 5 === 0) {
        data.meta.updated_at = new Date().toISOString();
        await saveJsonFile(output, data);
      }
    }
  } finally {
    await client.close();
  }

  data.meta.updated_at = new Date().toISOString();
  await saveJsonFile(output, data);
  writeLine(`\n✅ detail 完成！补抓 ${done} 条 → ${output}`);
}

export async function main(argv = process.argv) {
  const opts = parseArgs(argv);

  if (!opts.cmd || opts.cmd === '--help' || opts.cmd === '-h') {
    writeLine(HELP);
    process.exit(0);
  }

  if (opts.cmd === 'list' || opts.cmd === 'search') await cmdList(opts);
  else if (opts.cmd === 'detail') await cmdDetail(opts);
  else {
    writeError(`未知命令: ${opts.cmd}\n\n${HELP}`);
    process.exit(1);
  }
}
