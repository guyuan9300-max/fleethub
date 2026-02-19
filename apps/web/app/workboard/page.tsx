import '../globals.css'
import Link from 'next/link'

async function getJobs() {
  const base = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000'
  const res = await fetch(`${base}/api/jobs`, { cache: 'no-store' })
  if (!res.ok) {
    return []
  }
  return res.json()
}

export default async function Workboard() {
  const jobs = await getJobs()
  const columns = [
    { key: 'BACKLOG', title: 'Backlog' },
    { key: 'ASSIGNED', title: 'Assigned' },
    { key: 'RUNNING', title: 'Running' },
    { key: 'BLOCKED', title: 'Blocked' },
    { key: 'DONE', title: 'Done' },
    { key: 'FAILED', title: 'Failed' },
  ]
  const grouped: Record<string, any[]> = {}
  for (const col of columns) grouped[col.key] = []
  for (const j of jobs) {
    const status = j.status || 'BACKLOG'
    if (!grouped[status]) grouped[status] = []
    grouped[status].push(j)
  }

  return (
    <main>
      <header>
        <h1>任务看板</h1>
        <p>工作流可视化 · Kanban</p>
      </header>
      <nav>
        <Link href="/">总览</Link>
        <Link className="active" href="/workboard">任务看板</Link>
        <Link href="/reports/daily">日报</Link>
      </nav>

      <section className="kanban">
        {columns.map((col) => (
          <div className="column" key={col.key}>
            <h3>{col.title}</h3>
            {(grouped[col.key] || []).map((j: any) => (
              <div className="card" key={j.job_id}>
                <h3>{j.title || j.job_id}</h3>
                <div className="meta">机器人：{j.robot_id}</div>
                <div className="meta">进度：{j.progress ?? '-'}</div>
                <div className="meta">阶段：{j.stage || '-'}</div>
              </div>
            ))}
          </div>
        ))}
      </section>
    </main>
  )
}
