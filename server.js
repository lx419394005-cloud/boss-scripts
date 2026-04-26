#!/usr/bin/env node

/**
 * Boss 直聘数据仪表盘服务器
 * 
 * 功能：
 * - 读取 output/ 目录下的职位 JSON 数据
 * - 提供 REST API 给前端
 * - 聚合多数据源进行分析
 */

import { createServer } from 'node:http';
import { readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';


const __dirname = fileURLToPath(new URL('.', import.meta.url));
const OUTPUT_DIR = join(__dirname, 'output');
const DATA_DIR = join(__dirname, 'data');
const STATS_FILE = join(DATA_DIR, 'stats.json');
const PORT = process.env.PORT || 3000;
const STATIC_DIR = join(__dirname, 'public');

const ACTION_TIMEOUT_MS = 10 * 60 * 1000;

// 确保数据目录存在
import { mkdir } from 'node:fs/promises';
await mkdir(DATA_DIR, { recursive: true }).catch(() => {});

// 相对时间
function getRelativeTime(date) {
  const now = new Date();
  const diff = now - date;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days} 天前`;
  if (hours > 0) return `${hours} 小时前`;
  if (minutes > 0) return `${minutes} 分钟前`;
  return '刚刚';
}

// ============ 每日统计 ============

function getToday() {
  return new Date().toISOString().split('T')[0];
}

async function getStats() {
  try {
    const content = await readFile(STATS_FILE, 'utf8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

async function updateStats(type, count = 1) {
  const stats = await getStats();
  const today = getToday();
  
  if (!stats[today]) {
    stats[today] = { viewed: 0, applied: 0, replied: 0, greeted: 0, updatedAt: new Date().toISOString() };
  }
  
  stats[today][type] = (stats[today][type] || 0) + count;
  stats[today].updatedAt = new Date().toISOString();
  
  // 清理旧数据（保留最近30天）
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  for (const date of Object.keys(stats)) {
    if (date < cutoff.toISOString().split('T')[0]) {
      delete stats[date];
    }
  }
  
  await writeFile(STATS_FILE, JSON.stringify(stats, null, 2));
  return stats[today];
}

async function getTodayStats() {
  const stats = await getStats();
  const today = getToday();
  return stats[today] || { viewed: 0, applied: 0, replied: 0, greeted: 0, updatedAt: null };
}

// ============ 招呼历史记录 ============

const GREETINGS_FILE = join(DATA_DIR, 'greetings.json');

async function getGreetings() {
  try {
    const content = await readFile(GREETINGS_FILE, 'utf8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

async function addGreeting(message, jobInfo = {}) {
  const greetings = await getGreetings();
  const today = getToday();
  
  if (!greetings[today]) {
    greetings[today] = [];
  }
  
  greetings[today].push({
    message,
    time: new Date().toISOString(),
    jobTitle: jobInfo.jobTitle || null,
    company: jobInfo.company || null,
    jobUrl: jobInfo.jobUrl || null
  });
  
  // 清理旧数据（保留最近30天）
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  for (const date of Object.keys(greetings)) {
    if (date < cutoff.toISOString().split('T')[0]) {
      delete greetings[date];
    }
  }
  
  await writeFile(GREETINGS_FILE, JSON.stringify(greetings, null, 2));
  return greetings[today];
}

async function getTodayGreetings() {
  const greetings = await getGreetings();
  const today = getToday();
  return greetings[today] || [];
}

// MIME 类型
const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// ============ 数据读取 ============

function parseJobFile(filename) {
  return basename(filename, '.json').replace(/^boss_/, '');
}

async function readJobFiles() {
  const files = await readdir(OUTPUT_DIR);
  const jobFiles = files.filter(f => f.startsWith('boss_') && f.endsWith('.json'));
  
  const allJobs = [];
  const sources = [];
  
  for (const file of jobFiles) {
    try {
      const content = await readFile(join(OUTPUT_DIR, file), 'utf8');
      const data = JSON.parse(content);
      
      const jobs = data.jobs || data.job_list || [];
      const meta = data.meta || {};
      
      allJobs.push(...jobs.map(job => ({
        ...job,
        _source: parseJobFile(file),
        _sourceFile: file,
        _query: meta.query || parseJobFile(file),
        _city: meta.city || '未知',
      })));
      
      const updatedAt = meta.updated_at || null;
      sources.push({
        file,
        query: meta.query || parseJobFile(file),
        city: meta.city || '未知',
        count: jobs.length,
        totalCount: meta.total_count || jobs.length,
        updatedAt,
        updatedAtFormatted: updatedAt ? new Date(updatedAt).toLocaleString('zh-CN') : '未知',
        updatedAtRel: updatedAt ? getRelativeTime(new Date(updatedAt)) : '未知',
      });
    } catch (error) {
      console.error(`读取 ${file} 失败:`, error.message);
    }
  }
  
  return { jobs: allJobs, sources };
}

async function readJsonBody(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : {};
}

function runBossCommand(args, timeoutMs = ACTION_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['boss.js', ...args], {
      cwd: __dirname,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      reject(new Error(`命令执行超时 (${Math.round(timeoutMs / 1000)}s)`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: code === 0,
        code,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });
  });
}

async function runDashboardAction(payload) {
  const action = payload?.action;

  if (action === 'list') {
    if (!payload.query) throw new Error('缺少 query');
    const args = ['list', '--query', payload.query];
    if (payload.city) args.push('--city', payload.city);
    return runBossCommand(args);
  }

  if (action === 'jd-open') {
    if (!payload.url) throw new Error('缺少 url');
    return runBossCommand(['jd-open', '--url', payload.url]);
  }

  if (action === 'send-chat') {
    if (!payload.message) throw new Error('缺少 message');
    const args = ['send-chat', '--message', payload.message, '--timeout', String(payload.timeout || 60000)];
    const result = runBossCommand(args);
    // 发送成功后记录招呼内容（包含职位信息）
    result.then(async (res) => {
      if (res.ok) {
        await addGreeting(payload.message, {
          jobTitle: payload.jobTitle || null,
          company: payload.company || null,
          jobUrl: payload.jobUrl || null
        });
      }
    }).catch(() => {});
    return result;
  }

  if (action === 'chat-unread') {
    const limit = Number.isFinite(payload.limit) && payload.limit > 0 ? payload.limit : 10;
    return runBossCommand(['chat-unread', '--limit', String(limit)]);
  }

  throw new Error('未知动作');
}

// ============ 数据分析 ============

function parseSalary(salary) {
  if (!salary) return null;
  
  // 匹配 K 为单位的薪资: 20-30K
  const kMatch = salary.match(/(\d+)-(\d+)K/);
  if (kMatch) {
    return {
      low: parseInt(kMatch[1]),
      high: parseInt(kMatch[2]),
      mid: (parseInt(kMatch[1]) + parseInt(kMatch[2])) / 2,
      raw: salary,
      unit: 'K'
    };
  }
  
  // 匹配天薪: 200-300元/天
  const dayMatch = salary.match(/(\d+)-(\d+)元\/天/);
  if (dayMatch) {
    const low = parseInt(dayMatch[1]) * 21.75 / 1000;
    const high = parseInt(dayMatch[2]) * 21.75 / 1000;
    return { low, high, mid: (low + high) / 2, raw: salary, unit: 'K' };
  }
  
  // 匹配月薪带薪: 15K·13薪
  const monthMatch = salary.match(/^(\d+)K·\d+薪$/);
  if (monthMatch) {
    const val = parseInt(monthMatch[1]);
    return { low: val, high: val, mid: val, raw: salary, unit: 'K' };
  }
  
  return null;
}

function parseExperience(exp) {
  if (!exp) return null;
  const rangeMatch = exp.match(/(\d+)-(\d+)年/);
  if (rangeMatch) {
    return { low: parseInt(rangeMatch[1]), high: parseInt(rangeMatch[2]), mid: (parseInt(rangeMatch[1]) + parseInt(rangeMatch[2])) / 2 };
  }
  const singleMatch = exp.match(/^(\d+)年/);
  if (singleMatch) {
    return { low: parseInt(singleMatch[1]), high: parseInt(singleMatch[1]), mid: parseInt(singleMatch[1]) };
  }
  if (exp.includes('不限') || exp.includes('经验不限')) {
    return { low: 0, high: 0, mid: 0 };
  }
  return null;
}

function parseDistrict(district) {
  if (!district) return '其他';
  if (district.includes('南山')) return '南山';
  if (district.includes('福田')) return '福田';
  if (district.includes('宝安')) return '宝安';
  if (district.includes('龙岗')) return '龙岗';
  if (district.includes('龙华')) return '龙华';
  if (district.includes('罗湖')) return '罗湖';
  if (district.includes('盐田')) return '盐田';
  return '其他';
}

function analyzeJobs(jobs) {
  // 薪资分析
  const salaries = jobs.map(j => parseSalary(j.salary)).filter(Boolean);
  const mids = salaries.map(s => s.mid).sort((a, b) => a - b);
  
  // 去掉异常值 (IQR 方法)
  const q1 = mids[Math.floor(mids.length * 0.25)];
  const q3 = mids[Math.floor(mids.length * 0.75)];
  const iqr = q3 - q1;
  const trimmed = mids.filter(v => v >= q1 - 1.5 * iqr && v <= q3 + 1.5 * iqr);
  const outliers = mids.length - trimmed.length;
  
  const mean = trimmed.length > 0 ? trimmed.reduce((a, b) => a + b, 0) / trimmed.length : 0;
  const median = mids[Math.floor(mids.length / 2)] || 0;
  const max = Math.max(...salaries.map(s => s.high));
  const min = Math.min(...salaries.map(s => s.low));
  
  // 薪资分布
  const salaryDist = {
    '<15K': 0,
    '15-20K': 0,
    '20-30K': 0,
    '30-50K': 0,
    '50-80K': 0,
    '80K+': 0,
  };
  salaries.forEach(s => {
    if (s.low < 15) salaryDist['<15K']++;
    else if (s.low < 20) salaryDist['15-20K']++;
    else if (s.low < 30) salaryDist['20-30K']++;
    else if (s.low < 50) salaryDist['30-50K']++;
    else if (s.low < 80) salaryDist['50-80K']++;
    else salaryDist['80K+']++;
  });
  
  // 经验分布
  const expDist = {};
  jobs.forEach(j => {
    const exp = j.experience || '不限';
    expDist[exp] = (expDist[exp] || 0) + 1;
  });
  
  // 学历分布
  const degreeDist = {};
  jobs.forEach(j => {
    const deg = j.degree || '不限';
    degreeDist[deg] = (degreeDist[deg] || 0) + 1;
  });
  
  // 公司规模分布
  const sizeDist = {};
  jobs.forEach(j => {
    const size = j.company_size || '未知';
    sizeDist[size] = (sizeDist[size] || 0) + 1;
  });
  
  // 公司阶段分布
  const stageDist = {};
  jobs.forEach(j => {
    const stage = j.company_stage || '未知';
    stageDist[stage] = (stageDist[stage] || 0) + 1;
  });
  
  // 区域分布
  const districtDist = {};
  jobs.forEach(j => {
    const district = parseDistrict(j.district);
    if (!districtDist[district]) districtDist[district] = { count: 0, totalSalary: 0, jobs: [] };
    districtDist[district].count++;
    const salary = parseSalary(j.salary);
    if (salary) districtDist[district].totalSalary += salary.mid;
    districtDist[district].jobs.push(j);
  });
  
  // 各区平均薪资
  Object.keys(districtDist).forEach(d => {
    districtDist[d].avgSalary = districtDist[d].count > 0 
      ? Math.round(districtDist[d].totalSalary / districtDist[d].count) 
      : 0;
  });
  
  // 技能词云
  const skillCount = {};
  jobs.forEach(j => {
    (j.skills || []).forEach(s => {
      if (s && s.trim().length >= 2) {
        const skill = s.trim();
        skillCount[skill] = (skillCount[skill] || 0) + 1;
      }
    });
  });
  const topSkills = Object.entries(skillCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);
  
  // 高薪职位 TOP 10
  const topJobs = [...jobs]
    .map(j => ({ ...j, _salaryParsed: parseSalary(j.salary) }))
    .filter(j => j._salaryParsed)
    .sort((a, b) => b._salaryParsed.mid - a._salaryParsed.mid)
    .slice(0, 10);
  
  return {
    summary: {
      totalJobs: jobs.length,
      sourcesCount: new Set(jobs.map(j => j._source)).size,
      mean: Math.round(mean * 10) / 10,
      median: Math.round(median * 10) / 10,
      max: max,
      min: min,
      outliers,
    },
    salaryDist,
    expDist,
    degreeDist,
    sizeDist,
    stageDist,
    districtDist,
    topSkills,
    topJobs: topJobs.map(j => ({
      title: j.title,
      company: j.company,
      salary: j.salary,
      city: j.city,
      district: j.district,
      experience: j.experience,
      url: j.job_url,
    })),
  };
}

// ============ HTTP 服务器 ============

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;
  
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  
  try {
    // API: 获取所有职位数据和统计
    if (pathname === '/api/jobs') {
      const { jobs, sources } = await readJobFiles();
      const analysis = analyzeJobs(jobs);
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        jobs: jobs.map(j => ({
          id: j.id,
          title: j.title,
          company: j.company,
          salary: j.salary,
          city: j.city,
          district: j.district,
          experience: j.experience,
          degree: j.degree,
          skills: j.skills,
          company_size: j.company_size,
          company_stage: j.company_stage,
          boss_name: j.boss_name,
          job_url: j.job_url,
          jd: j.jd,
          _source: j._source,
          _query: j._query,
          _city: j._city,
          source: j._source,
          fetched_at: j.fetched_at,
        })),
        sources,
        analysis,
      }, null, 2));
      return;
    }
    
    // API: 获取数据源列表
    if (pathname === '/api/sources') {
      const { sources } = await readJobFiles();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(sources, null, 2));
      return;
    }
    
    // API: 获取今日统计
    if (pathname === '/api/stats' && req.method === 'GET') {
      const todayStats = await getTodayStats();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(todayStats, null, 2));
      return;
    }
    
    // API: 获取今日招呼历史
    if (pathname === '/api/greetings' && req.method === 'GET') {
      const todayGreetings = await getTodayGreetings();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(todayGreetings, null, 2));
      return;
    }
    
    // API: 更新统计
    if (pathname === '/api/stats' && req.method === 'POST') {
      const { type, count = 1 } = await readJsonBody(req);
      
      if (!['viewed', 'applied', 'replied', 'greeted'].includes(type)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid type' }));
        return;
      }
      
      const updated = await updateStats(type, count);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(updated, null, 2));
      return;
    }

    if (pathname === '/api/actions' && req.method === 'POST') {
      const payload = await readJsonBody(req);
      const result = await runDashboardAction(payload);

      res.writeHead(result.ok ? 200 : 500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result, null, 2));
      return;
    }
    
    // 静态文件服务
    let filePath = pathname === '/' ? '/index.html' : pathname;
    filePath = join(STATIC_DIR, filePath);
    
    // 安全检查：防止路径遍历
    if (!filePath.startsWith(STATIC_DIR)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    
    const fileStat = await stat(filePath);
    if (fileStat.isDirectory()) {
      filePath = join(filePath, 'index.html');
    }
    
    const ext = '.' + filePath.split('.').pop();
    const mimeType = MIME_TYPES[ext] || 'application/octet-stream';
    
    const content = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': mimeType });
    res.end(content);
    
  } catch (error) {
    if (error.code === 'ENOENT') {
      res.writeHead(404);
      res.end('Not Found');
    } else {
      console.error('Server error:', error);
      res.writeHead(500);
      res.end('Internal Server Error: ' + error.message);
    }
  }
}

// ============ 启动 ============

const server = createServer(handleRequest);

server.listen(PORT, () => {
  console.log(`
🚀 Boss 直聘数据仪表盘已启动

   本地:  http://localhost:${PORT}
   API:   http://localhost:${PORT}/api/jobs
   数据源: http://localhost:${PORT}/api/sources

按 Ctrl+C 停止服务器
  `);
});
