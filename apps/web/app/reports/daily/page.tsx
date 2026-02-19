import '../../globals.css'
import Link from 'next/link'

async function getReport() {
  const base = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000'
  const res = await fetch(`${base}/api/reports/daily`, { cache: 'no-store' })
  if (!res.ok) {
    return null
  }
  return res.json()
}

export default async function DailyReport() {
  const data = await getReport()
  const reports = data?.reports || []

  return (
    <main>
      <header>
        <h1>日报</h1>
        <p>管理层视角 · 产出与异常</p>
      </header>
      <nav>
        <Link href="/">总览</Link>
        <Link href="/workboard">任务看板</Link>
        <Link className="active" href="/reports/daily">日报</Link>
      </nav>

      <section className="grid">
        {reports.map((r: any) => (
          <div className="card" key={r.robot_id}>
            <h3>{r.robot_id}</h3>
            <div className="meta">日期：{r.date}</div>
            <div className="meta">完成任务：{r.jobs_done}</div>
            <div className="meta">工作量：{r.work_units}</div>
            <div className="meta">Top 错误：{(r.top_errors || []).map((e: any) => `${e.code}(${e.count})`).join(', ') || '-'}</div>
            <div className="meta">总结：{r.summary}</div>
          </div>
        ))}
        {reports.length === 0 && (
          <div className="card">
            <div className="meta">暂无日报数据</div>
          </div>
        )}
      </section>
    </main>
  )
}
