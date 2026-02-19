import './globals.css'
import Link from 'next/link'

async function getOverview() {
  const base = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000'
  const res = await fetch(`${base}/api/fleet/overview`, { cache: 'no-store' })
  if (!res.ok) {
    return null
  }
  return res.json()
}

async function getRobots() {
  const base = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000'
  const res = await fetch(`${base}/api/robots`, { cache: 'no-store' })
  if (!res.ok) {
    return []
  }
  return res.json()
}

async function getAnomalies() {
  const base = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000'
  const res = await fetch(`${base}/api/fleet/anomalies`, { cache: 'no-store' })
  if (!res.ok) {
    return []
  }
  return res.json()
}

export default async function Page() {
  const [overview, robots, anomalies] = await Promise.all([getOverview(), getRobots(), getAnomalies()])

  return (
    <main>
      <header>
        <h1>OpenClaw 多机器人看板</h1>
        <p>云端总览 · 实时健康检查 · 10 台以内规模</p>
      </header>
      <nav>
        <Link className="active" href="/">总览</Link>
        <Link href="/workboard">任务看板</Link>
        <Link href="/reports/daily">日报</Link>
      </nav>

      <section className="kpi">
        <div className="kpi-card">
          <div className="kpi-label">在线机器人</div>
          <div className="kpi-value">{overview?.online_count ?? '-'}/{overview?.total_count ?? '-'}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">异常</div>
          <div className="kpi-value" style={{ color: 'var(--err)' }}>{overview?.error_count ?? '-'}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">今日工作量</div>
          <div className="kpi-value">{overview?.today_work_units_total ?? '-'}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">平均饱和度</div>
          <div className="kpi-value">{overview?.avg_utilization_today ?? '-'}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">卡住任务</div>
          <div className="kpi-value">{overview?.stuck_jobs_count ?? '-'}</div>
        </div>
      </section>

      <div className="section-title">总览 + 异常队列</div>
      <section className="row">
        <div className="grid">
          {robots.map((r: any) => (
            <div className="card" key={r.robot_id}>
              <h3>{r.robot_id}</h3>
              <div className={r.ok ? 'badge ok' : 'badge err'}>
                {r.ok ? 'OK' : 'ERROR'}
              </div>
              <div className="meta">健康分：{r.health_score ?? '-'}</div>
              <div className="meta">主机名：{r.hostname || '-'}</div>
              <div className="meta">平台：{r.platform || '-'}</div>
              <div className="meta">版本：{r.version || '-'}</div>
              <div className="meta">最后心跳：{r.last_seen_at || '-'}</div>
              <div className="meta" style={{ marginTop: 6 }}>
                <Link href={`/robots/${r.robot_id}`} style={{ color: 'var(--accent)' }}>
                  查看详情 →
                </Link>
              </div>
            </div>
          ))}
        </div>
        <div>
          <div className="card">
            <h3>异常队列</h3>
            {(anomalies || []).length === 0 && <div className="meta">暂无异常</div>}
            {(anomalies || []).map((a: any, i: number) => (
              <div className="meta" key={`${a.robot_id}-${i}`}>
                {a.robot_id} · {a.type} · {a.message}
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="footer">提示：POST /api/ingest/health 即可接入你的健康检查 JSON。</div>
    </main>
  )
}
