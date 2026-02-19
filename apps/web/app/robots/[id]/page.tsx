import '../../globals.css'
import Link from 'next/link'

async function getRobot(id: string) {
  const base = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000'
  const res = await fetch(`${base}/api/robots/${id}`, { cache: 'no-store' })
  if (!res.ok) {
    return null
  }
  return res.json()
}

export default async function RobotDetail({ params }: { params: { id: string } }) {
  const data = await getRobot(params.id)

  if (!data || data.error) {
    return (
      <main>
        <header>
          <h1>机器人详情</h1>
          <p>未找到该机器人</p>
        </header>
      </main>
    )
  }

  const robot = data.robot
  const report = data.latest_report || {}
  const health = report.health || {}
  const metrics = report.metrics || {}

  return (
    <main>
      <header>
        <h1>{robot.robot_id}</h1>
        <p>单机详情 · 最近上报与错误概览</p>
      </header>
      <nav>
        <Link href="/">总览</Link>
        <Link href="/workboard">任务看板</Link>
        <Link href="/reports/daily">日报</Link>
      </nav>

      <section className="kpi">
        <div className="kpi-card">
          <div className="kpi-label">健康状态</div>
          <div className="kpi-value">{robot.ok ? 'OK' : 'ERROR'}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">健康分</div>
          <div className="kpi-value">{robot.health_score ?? '-'}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">版本</div>
          <div className="kpi-value">{robot.version ?? '-'}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">最后心跳</div>
          <div className="kpi-value">{robot.last_seen_at ?? '-'}</div>
        </div>
      </section>

      <div className="section-title">实时状态</div>
      <section className="grid">
        <div className="card">
          <h3>健康信息</h3>
          <div className="meta">ok：{String(health.ok ?? '-')}</div>
          <div className="meta">版本：{health.version ?? '-'}</div>
          <div className="meta">心跳间隔：{health.heartbeatSeconds ?? '-'} 秒</div>
          <div className="meta">默认 Agent：{health.defaultAgentId ?? '-'}</div>
        </div>
        <div className="card">
          <h3>系统指标</h3>
          <div className="meta">负载：{Array.isArray(metrics.loadavg) ? metrics.loadavg.join(', ') : '-'}</div>
          <div className="meta">总内存：{metrics.totalmem ?? '-'}</div>
          <div className="meta">空闲内存：{metrics.freemem ?? '-'}</div>
        </div>
        <div className="card">
          <h3>通道状态</h3>
          {health.channels ? (
            Object.entries(health.channels).map(([k, v]: any) => (
              <div className="meta" key={k}>{k}: {v?.running ? 'running' : 'stopped'}</div>
            ))
          ) : (
            <div className="meta">-</div>
          )}
        </div>
      </section>

      <div className="section-title">最近错误</div>
      <section className="grid">
        {(data.errors || []).length === 0 && <div className="card"><div className="meta">暂无错误</div></div>}
        {(data.errors || []).map((e: any, i: number) => (
          <div className="card" key={`${e.ts}-${i}`}>
            <h3>{e.code || 'ERROR'}</h3>
            <div className="meta">时间：{e.ts || '-'}</div>
            <div className="meta">消息：{e.message || '-'}</div>
            <div className="meta">任务：{e.job_id || '-'}</div>
          </div>
        ))}
      </section>

      <div className="section-title">最近任务</div>
      <section className="grid">
        {(data.jobs || []).length === 0 && <div className="card"><div className="meta">暂无任务</div></div>}
        {(data.jobs || []).map((j: any) => (
          <div className="card" key={j.job_id}>
            <h3>{j.title || j.job_id}</h3>
            <div className="meta">状态：{j.status || '-'}</div>
            <div className="meta">进度：{j.progress ?? '-'}</div>
            <div className="meta">阶段：{j.stage || '-'}</div>
          </div>
        ))}
      </section>
    </main>
  )
}
