# OpenClaw 多机器人看板（最小可用版）

## 启动（Docker Compose）

```bash
cd /Users/guyuanyuan/Documents/New\ project
docker compose up --build
```

- Web: http://localhost:3000
- API: http://localhost:8000

## 数据接入（示例）

```bash
curl -X POST http://localhost:8000/api/ingest/health \
  -H 'Content-Type: application/json' \
  -d '{
    "robot_id": "guyuanyuan-macbook-air",
    "hostname": "guyuanyuandeMacBook-Air.local",
    "platform": "darwin",
    "report_at": "2026-02-19T11:12:35.892Z",
    "health": {
      "ok": true,
      "ts": 1771470755892,
      "version": "2026.2.16",
      "uptime_seconds": 3600,
      "channels": {
        "feishu": {
          "configured": true,
          "running": false,
          "botOpenId": "ou_e4bff54a5a25ddbd264907be0f94f120"
        }
      },
      "heartbeatSeconds": 1800,
      "defaultAgentId": "main",
      "agents": [
        {
          "agentId": "main",
          "isDefault": true,
          "sessions_count": 2
        }
      ]
    },
    "status": {
      "model": "minimax-portal/MiniMax-M2.5",
      "context_percent": 28,
      "tokens_in": 119000,
      "tokens_out": 354
    },
    "metrics": {
      "uptime": 3600,
      "loadavg": [2.1, 1.8, 1.5],
      "totalmem": 17179869184,
      "freemem": 8589934592
    }
  }'
```

## 任务与错误接入（示例）

```bash
curl -X POST http://localhost:8000/api/ingest/job \
  -H 'Content-Type: application/json' \
  -d '{
    "job_id": "job-8921",
    "robot_id": "guyuanyuan-macbook-air",
    "job_type": "搬运",
    "title": "物料转运-批次 #52",
    "status": "RUNNING",
    "progress": 0.68,
    "stage": "PICKING",
    "work_units_total": 10,
    "work_units_done": 7
  }'
```

```bash
curl -X POST http://localhost:8000/api/ingest/error \
  -H 'Content-Type: application/json' \
  -d '{
    "robot_id": "guyuanyuan-macbook-air",
    "job_id": "job-8921",
    "ts": "2026-02-19T10:23:01Z",
    "code": "GRIPPER_TIMEOUT",
    "message": "gripper timeout after 3000ms",
    "fingerprint": "GRIPPER_TIMEOUT",
    "context": { "stage": "PICKING" }
  }'
```

## 诊断包与分析（占位接口）

```bash
curl -X POST http://localhost:8000/api/diagnostics/package \
  -H 'Content-Type: application/json' \
  -d '{ "robot_id": "guyuanyuan-macbook-air", "fingerprint": "GRIPPER_TIMEOUT" }'
```

```bash
curl -X POST http://localhost:8000/api/ai/analyze \
  -H 'Content-Type: application/json' \
  -d '{
    "error_id": 1,
    "robot_id": "guyuanyuan-macbook-air",
    "fingerprint": "GRIPPER_TIMEOUT",
    "analysis": { "summary": "夹爪超时", "actions": ["检查夹爪限位"] }
  }'
```

## 已实现

- 健康检查数据接入（HTTP POST）
- 任务与错误接入（HTTP POST）
- 机器人列表与总览 KPI
- WebSocket 广播心跳事件
 - 机器人详情页（最近错误/任务）
 - 任务看板（Kanban）
 - 日报接口与页面

## 下一步

- AI 诊断包与每日总结
- Work Units 与 Utilization 细化
