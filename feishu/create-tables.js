/**
 * 飞书多维表格创建脚本
 * 创建机群管理所需的四张表
 */

const axios = require('axios');

const FEISHU_CONFIG = {
  APP_ID: process.env.FEISHU_APP_ID,
  APP_SECRET: process.env.FEISHU_APP_SECRET,
  BITABLE_APP_TOKEN: process.env.FEISHU_BITABLE_APP_TOKEN
};

let accessToken = null;

async function getAccessToken() {
  const response = await axios.post('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    app_id: FEISHU_CONFIG.APP_ID,
    app_secret: FEISHU_CONFIG.APP_SECRET
  });
  
  if (response.data.code === 0) {
    return response.data.tenant_access_token;
  }
  throw new Error(response.data.msg);
}

// 表 1: Robots 机器人资产表
const ROBOTS_TABLE = {
  table_name: 'Robots',
  fields: [
    { field_name: 'Robot ID', field_type: 1 }, // Text
    { field_name: 'Name', field_type: 1 }, // Text
    { field_name: 'Location', field_type: 1 }, // Text
    { field_name: 'Owner', field_type: 1 }, // Text
    { field_name: 'IP', field_type: 1 }, // Text
    { field_name: 'OpenClaw Version', field_type: 1 }, // Text
    { field_name: 'Last Seen', field_type: 5 }, // DateTime
    { field_name: 'Status', field_type: 3, field_property: { options: ['Online', 'Degraded', 'Offline'] } }, // SingleSelect
    { field_name: 'Saturation', field_type: 2 }, // Number
    { field_name: 'Current Job', field_type: 1 }, // Text
    { field_name: 'Last Error', field_type: 1 } // Text
  ]
};

// 表 2: Jobs 任务流水表
const JOBS_TABLE = {
  table_name: 'Jobs',
  fields: [
    { field_name: 'Job ID', field_type: 1 }, // Text
    { field_name: 'Robot ID', field_type: 1 }, // Text
    { field_name: 'Job Type', field_type: 1 }, // Text
    { field_name: 'Started At', field_type: 5 }, // DateTime
    { field_name: 'Ended At', field_type: 5 }, // DateTime
    { field_name: 'State', field_type: 3, field_property: { options: ['Running', 'Success', 'Fail', 'Cancelled'] } }, // SingleSelect
    { field_name: 'Progress', field_type: 2 }, // Number
    { field_name: 'Work Units', field_type: 2 }, // Number
    { field_name: 'Error Summary', field_type: 1 } // Text
  ]
};

// 表 3: Daily Summary 日汇总表
const DAILY_SUMMARY_TABLE = {
  table_name: 'DailySummary',
  fields: [
    { field_name: 'Date', field_type: 5 }, // DateTime
    { field_name: 'Robot ID', field_type: 1 }, // Text
    { field_name: 'Completed Jobs', field_type: 2 }, // Number
    { field_name: 'Work Units Total', field_type: 2 }, // Number
    { field_name: 'Uptime Minutes', field_type: 2 }, // Number
    { field_name: 'Error Count', field_type: 2 }, // Number
    { field_name: 'AI Summary', field_type: 1 } // Text
  ]
};

// 表 4: Alerts 告警表
const ALERTS_TABLE = {
  table_name: 'Alerts',
  fields: [
    { field_name: 'Alert ID', field_type: 1 }, // Text
    { field_name: 'Robot ID', field_type: 1 }, // Text
    { field_name: 'Severity', field_type: 3, field_property: { options: ['P0', 'P1', 'P2'] } }, // SingleSelect
    { field_name: 'Type', field_type: 3, field_property: { options: ['offline', 'error', 'spike', 'version_lag'] } }, // SingleSelect
    { field_name: 'Message', field_type: 1 }, // Text
    { field_name: 'Fired At', field_type: 5 }, // DateTime
    { field_name: 'Ack Status', field_type: 3, field_property: { options: ['pending', 'acknowledged', 'resolved'] } }, // SingleSelect
    { field_name: 'Ack By', field_type: 1 }, // Text
    { field_name: 'Ack At', field_type: 5 } // DateTime
  ]
};

async function createTable(token, tableConfig) {
  try {
    const response = await axios.post(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${FEISHU_CONFIG.BITABLE_APP_TOKEN}/tables`,
      tableConfig,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    
    if (response.data.code === 0) {
      console.log(`✅ 表 [${tableConfig.table_name}] 创建成功`);
      return response.data.data;
    } else {
      console.log(`⚠️ 表 [${tableConfig.table_name}]: ${response.data.msg}`);
      return null;
    }
  } catch (e) {
    console.error(`❌ 创建表失败: ${e.message}`);
    return null;
  }
}

async function main() {
  console.log(`
╔════════════════════════════════════════╗
║  飞书多维表格创建工具                  ║
║  需要先创建 Bitable App               ║
╚════════════════════════════════════════╝
  `);

  if (!FEISHU_CONFIG.APP_ID || !FEISHU_CONFIG.APP_SECRET) {
    console.log('请设置环境变量:');
    console.log('  FEISHU_APP_ID=xxx');
    console.log('  FEISHU_APP_SECRET=xxx');
    console.log('  FEISHU_BITABLE_APP_TOKEN=xxx');
    process.exit(1);
  }

  const token = await getAccessToken();
  console.log('🔑 获取 Token 成功\n');

  // 创建四张表
  await createTable(token, ROBOTS_TABLE);
  await createTable(token, JOBS_TABLE);
  await createTable(token, DAILY_SUMMARY_TABLE);
  await createTable(token, ALERTS_TABLE);

  console.log('\n✨ 完成！请记录各表的 table_id 并配置到 Fleet Hub');
}

main().catch(console.error);
