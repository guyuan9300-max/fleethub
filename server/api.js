// Vercel Serverless API
const axios = require('axios');

const APP_TOKEN = process.env.FEISHU_APP_TOKEN || 'RQmBbdNJ3au4MCsFxP8c2vuenPf';
const TABLE_ID = process.env.FEISHU_TABLE_ID || 'tblrUXp6i9aIWrn7';
const FEISHU_APP_ID = process.env.FEISHU_APP_ID || 'cli_a7bbc7195fbd500d';
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET || '2GWM9hD2GWM9hD2GWM9hD2';

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
        }
    } catch (error) {
        console.error('获取 token 失败:', error.message);
    }
    return null;
}

function mapStatus(status) {
    if (!status) return '离线';
    const statusMap = {
        'Online': '在线',
        'online': '在线',
        'Offline': '离线',
        'offline': '离线',
        '执行中': '执行中',
        'running': '执行中'
    };
    return statusMap[status] || status;
}

module.exports = async function(req, res) {
    const token = await getAccessToken();
    
    if (!token) {
        return res.status(500).json({ error: 'Failed to get access token' });
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
            const robots = response.data.data.items
                .map(record => record.fields)
                .filter(robot => robot['Name'] && robot['Status'])
                .map(robot => ({
                    name: robot['Name'] || '',
                    status: mapStatus(robot['Status']),
                    currentTask: robot['当前任务'] || '-',
                    progress: robot['任务进度'] || 0,
                    cpu: robot['CPU负载'] || 0,
                    memory: robot['内存使用率'] || 0,
                    lastSeen: robot['Last Seen'],
                    location: robot['Location'] || '-',
                    owner: robot['Owner'] || '-',
                    version: robot['Version'] || '-',
                    issueStatus: robot['问题状态'] || '正常',
                    tasksCompleted: robot['今日完成任务'] || 0,
                    uptime: robot['运行时长'] || '-'
                }));
            
            res.json(robots);
        } else {
            res.status(500).json({ error: response.data.msg });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
