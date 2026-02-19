#!/usr/bin/env node
/**
 * OpenClaw Fleet Reporter
 * 运行在每台 OpenClaw 机器人上，定期上报状态到 Fleet Hub
 */

const https = require('https');
const http = require('http');
const { execSync } = require('child_process');
const os = require('os');

// ============ 配置 ============
const CONFIG = {
  // Fleet Hub 服务器地址
  HUB_URL: process.env.FLEET_HUB_URL || 'http://localhost:3000',
  // 机器人标识
  ROBOT_ID: process.env.ROBOT_ID || os.hostname(),
  // 上报间隔（毫秒）
  INTERVAL: parseInt(process.env.REPORT_INTERVAL) || 30000,
};

// ============ 工具函数 ============
function getOpenClawHealth() {
  try {
    const result = execSync('openclaw health --json 2>/dev/null', { 
      encoding: 'utf8',
      timeout: 5000 
    });
    return JSON.parse(result);
  } catch (e) {
    return { error: e.message };
  }
}

function getOpenClawStatus() {
  try {
    const result = execSync('openclaw status --json 2>/dev/null', { 
      encoding: 'utf8',
      timeout: 5000 
    });
    return JSON.parse(result);
  } catch (e) {
    return { error: e.message };
  }
}

function postData(url, data) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';
    const client = isHttps ? https : http;

    const postData = JSON.stringify(data);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 10000
    };

    const req = client.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ status: res.statusCode, body });
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${body}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => reject(new Error('Request timeout')));
    req.write(postData);
    req.end();
  });
}

// ============ 主逻辑 ============
async function report() {
  const timestamp = new Date().toISOString();
  
  console.log(`[${timestamp}] 正在采集机器人状态...`);
  
  // 采集健康状态
  const health = getOpenClawHealth();
  
  // 采集详细状态
  const status = getOpenClawStatus();
  
  // 构建上报数据
  const payload = {
    robot_id: CONFIG.ROBOT_ID,
    hostname: os.hostname(),
    platform: os.platform(),
    report_at: timestamp,
    health,
    status: status.error ? null : status,
    metrics: {
      uptime: os.uptime(),
      loadavg: os.loadavg(),
      totalmem: os.totalmem(),
      freemem: os.freemem()
    }
  };

  // 上报到 Fleet Hub
  try {
    await postData(`${CONFIG.HUB_URL}/api/ingest/health`, payload);
    console.log(`[${timestamp}] ✅ 状态上报成功`);
  } catch (e) {
    console.error(`[${timestamp}] ❌ 上报失败: ${e.message}`);
  }
}

// ============ 启动 ============
console.log(`
╔════════════════════════════════════════╗
║   OpenClaw Fleet Reporter v1.0        ║
║   Robot: ${CONFIG.ROBOT_ID.padEnd(28)}║
║   Hub:  ${CONFIG.HUB_URL.padEnd(28)}║
║   Interval: ${CONFIG.INTERVAL}ms              ║
╚════════════════════════════════════════╝
`);

// 立即执行一次
report();

// 定期上报
setInterval(report, CONFIG.INTERVAL);
