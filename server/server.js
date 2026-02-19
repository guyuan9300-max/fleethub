const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Feishu Bitable 配置
const APP_TOKEN = 'RQmBbdNJ3au4MCsFxP8c2vuenPf';
const TABLE_ID = 'tblrUXp6i9aIWrn7';

// 从环境变量获取 OpenClaw 配置
const FEISHU_APP_ID = process.env.FEISHU_APP_ID;
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET;

app.use(cors());
app.use(express.json());

// 获取飞书访问令牌
let accessToken = null;
let tokenExpireTime = 0;

async function getAccessToken() {
    if (accessToken && Date.now() < tokenExpireTime) {
        return accessToken;
    }

    try {
        const response = await axios.post('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
            app_id: FEISHU_APP_ID,
            app_secret: FEISHU_APP_SECRET
        });

        if (response.data.code === 0) {
            accessToken = response.data.tenant_access_token;
            tokenExpireTime = Date.now() + (response.data.expire - 60) * 1000;
            return accessToken;
        } else {
            throw new Error(`Failed to get token: ${response.data.msg}`);
        }
    } catch (error) {
        console.error('Error getting access token:', error.message);
        // 如果没有配置，返回模拟数据
        return null;
    }
}

// 获取 Bitable 记录
async function getRecords() {
    const token = await getAccessToken();
    
    if (!token) {
        // 返回模拟数据用于测试
        return getMockData();
    }

    try {
        const response = await axios.get(
            `https://open.feishu.cn/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE_ID}/records`,
            {
                headers: { Authorization: `Bearer ${token}` },
                params: { page_size: 100 }
            }
        );

        if (response.data.code === 0) {
            return response.data.data.items.map(record => record.fields);
        } else {
            console.error('Error fetching records:', response.data.msg);
            return getMockData();
        }
    } catch (error) {
        console.error('Error fetching records:', error.message);
        return getMockData();
    }
}

// 模拟数据（当无法连接 Feishu 时使用）
function getMockData() {
    return [
        {
            '机器人ID': 'robot-001',
            '名称': '大周',
            '状态': '在线',
            '当前任务': '监控任务',
            '任务进度': 75,
            'CPU负载': 45,
            '内存使用率': 62,
            '问题状态': '正常',
            '最后活跃': new Date().toISOString()
        },
        {
            '机器人ID': 'robot-002',
            '名称': '默默',
            '状态': '执行中',
            '当前任务': '数据同步',
            '任务进度': 30,
            'CPU负载': 78,
            '内存使用率': 55,
            '问题状态': '正常',
            '最后活跃': new Date(Date.now() - 300000).toISOString()
        }
    ];
}

// API 路由
app.get('/api/robots', async (req, res) => {
    try {
        const robots = await getRecords();
        res.json(robots);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Failed to fetch robot data' });
    }
});

// 健康检查
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
    console.log(`FleetHub API server running on http://localhost:${PORT}`);
    console.log(`Dashboard: http://localhost:${PORT}/dashboard/index.html`);
});
