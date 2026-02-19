from __future__ import annotations

import asyncio
import json
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import asyncpg
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@db:5432/openclaw")

app = FastAPI(title="OpenClaw Dashboard API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_pool: Optional[asyncpg.Pool] = None


class HealthPayload(BaseModel):
    robot_id: str
    hostname: Optional[str] = None
    platform: Optional[str] = None
    report_at: Optional[str] = None
    health: Dict[str, Any] = Field(default_factory=dict)
    status: Dict[str, Any] = Field(default_factory=dict)
    metrics: Dict[str, Any] = Field(default_factory=dict)


class RobotRow(BaseModel):
    robot_id: str
    hostname: Optional[str]
    platform: Optional[str]
    last_seen_at: Optional[str]
    version: Optional[str]
    ok: Optional[bool]
    health_score: Optional[int]


class JobPayload(BaseModel):
    job_id: str
    robot_id: str
    job_type: Optional[str] = None
    title: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[int] = None
    created_at: Optional[str] = None
    started_at: Optional[str] = None
    ended_at: Optional[str] = None
    progress: Optional[float] = None
    stage: Optional[str] = None
    work_units_total: Optional[int] = None
    work_units_done: Optional[int] = None
    metrics: Dict[str, Any] = Field(default_factory=dict)
    last_error: Optional[Dict[str, Any]] = None


class ErrorPayload(BaseModel):
    robot_id: str
    job_id: Optional[str] = None
    ts: Optional[str] = None
    code: Optional[str] = None
    message: Optional[str] = None
    fingerprint: Optional[str] = None
    context: Dict[str, Any] = Field(default_factory=dict)


class FleetOverview(BaseModel):
    total_count: int
    online_count: int
    error_count: int
    running_count: int
    idle_count: int
    today_work_units_total: int
    avg_utilization_today: float
    today_jobs_done: int
    stuck_jobs_count: int


class FleetAnomaly(BaseModel):
    robot_id: str
    type: str
    message: str
    last_seen_at: Optional[str]


class _Broadcaster:
    def __init__(self) -> None:
        self._clients: List[WebSocket] = []
        self._lock = asyncio.Lock()

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        async with self._lock:
            self._clients.append(ws)

    async def disconnect(self, ws: WebSocket) -> None:
        async with self._lock:
            if ws in self._clients:
                self._clients.remove(ws)

    async def broadcast(self, event: Dict[str, Any]) -> None:
        data = json.dumps(event, ensure_ascii=False)
        async with self._lock:
            clients = list(self._clients)
        for ws in clients:
            try:
                await ws.send_text(data)
            except Exception:
                await self.disconnect(ws)


broadcaster = _Broadcaster()


async def _get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=5)
    return _pool


async def _ensure_schema() -> None:
    pool = await _get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """
            create table if not exists robots (
                robot_id text primary key,
                hostname text,
                platform text,
                first_seen_at timestamptz,
                last_seen_at timestamptz,
                version text,
                ok boolean,
                health_score integer
            );
            create table if not exists health_reports (
                id bigserial primary key,
                robot_id text references robots(robot_id),
                report_at timestamptz,
                ok boolean,
                payload jsonb
            );
            create table if not exists jobs (
                job_id text primary key,
                robot_id text references robots(robot_id),
                job_type text,
                title text,
                status text,
                priority integer,
                created_at timestamptz,
                started_at timestamptz,
                ended_at timestamptz,
                progress real,
                stage text,
                work_units_total integer,
                work_units_done integer,
                metrics jsonb,
                last_error jsonb,
                updated_at timestamptz
            );
            create table if not exists errors (
                id bigserial primary key,
                robot_id text references robots(robot_id),
                job_id text,
                ts timestamptz,
                code text,
                message text,
                fingerprint text,
                context jsonb
            );
            create table if not exists error_analyses (
                id bigserial primary key,
                error_id bigint references errors(id),
                robot_id text,
                fingerprint text,
                analysis jsonb,
                created_at timestamptz
            );
            create table if not exists reports_daily (
                id bigserial primary key,
                robot_id text references robots(robot_id),
                report_date date,
                summary jsonb,
                created_at timestamptz
            );
            """
        )
        await conn.execute(
            """
            alter table robots add column if not exists health_score integer;
            """
        )
        await conn.execute(
            """
            alter table jobs add column if not exists updated_at timestamptz;
            """
        )


@app.on_event("startup")
async def _startup() -> None:
    await _ensure_schema()


@app.on_event("shutdown")
async def _shutdown() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


@app.post("/api/ingest/health")
async def ingest_health(payload: HealthPayload) -> Dict[str, Any]:
    pool = await _get_pool()
    report_at = payload.report_at
    if report_at:
        try:
            report_dt = datetime.fromisoformat(report_at.replace("Z", "+00:00"))
        except ValueError:
            report_dt = datetime.now(timezone.utc)
    else:
        report_dt = datetime.now(timezone.utc)

    ok = bool(payload.health.get("ok")) if payload.health else None
    version = payload.health.get("version") if payload.health else None
    health_score = 100
    if ok is False:
        health_score -= 40
    totalmem = payload.metrics.get("totalmem") if payload.metrics else None
    freemem = payload.metrics.get("freemem") if payload.metrics else None
    if totalmem and freemem is not None:
        try:
            if freemem / totalmem < 0.15:
                health_score -= 15
        except Exception:
            pass
    loadavg = payload.metrics.get("loadavg") if payload.metrics else None
    if isinstance(loadavg, list) and loadavg:
        try:
            if float(loadavg[0]) > 4.0:
                health_score -= 10
        except Exception:
            pass
    if health_score < 0:
        health_score = 0

    async with pool.acquire() as conn:
        await conn.execute(
            """
            insert into robots (robot_id, hostname, platform, first_seen_at, last_seen_at, version, ok, health_score)
            values ($1, $2, $3, $4, $4, $5, $6, $7)
            on conflict (robot_id) do update set
                hostname = excluded.hostname,
                platform = excluded.platform,
                last_seen_at = excluded.last_seen_at,
                version = excluded.version,
                ok = excluded.ok,
                health_score = excluded.health_score
            """,
            payload.robot_id,
            payload.hostname,
            payload.platform,
            report_dt,
            version,
            ok,
            health_score,
        )
        await conn.execute(
            """
            insert into health_reports (robot_id, report_at, ok, payload)
            values ($1, $2, $3, $4)
            """,
            payload.robot_id,
            report_dt,
            ok,
            json.loads(payload.model_dump_json()),
        )

    await broadcaster.broadcast(
        {
            "type": "robot.heartbeat",
            "ts": report_dt.isoformat(),
            "robot_id": payload.robot_id,
            "ok": ok,
            "health_score": health_score,
        }
    )
    return {"ok": True}


@app.post("/api/ingest/job")
async def ingest_job(payload: JobPayload) -> Dict[str, Any]:
    pool = await _get_pool()
    def _parse_dt(value: Optional[str]) -> Optional[datetime]:
        if not value:
            return None
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None

    now = datetime.now(timezone.utc)
    async with pool.acquire() as conn:
        await conn.execute(
            """
            insert into jobs (
                job_id, robot_id, job_type, title, status, priority,
                created_at, started_at, ended_at, progress, stage,
                work_units_total, work_units_done, metrics, last_error, updated_at
            )
            values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
            on conflict (job_id) do update set
                robot_id = excluded.robot_id,
                job_type = excluded.job_type,
                title = excluded.title,
                status = excluded.status,
                priority = excluded.priority,
                created_at = excluded.created_at,
                started_at = excluded.started_at,
                ended_at = excluded.ended_at,
                progress = excluded.progress,
                stage = excluded.stage,
                work_units_total = excluded.work_units_total,
                work_units_done = excluded.work_units_done,
                metrics = excluded.metrics,
                last_error = excluded.last_error,
                updated_at = excluded.updated_at
            """,
            payload.job_id,
            payload.robot_id,
            payload.job_type,
            payload.title,
            payload.status,
            payload.priority,
            _parse_dt(payload.created_at),
            _parse_dt(payload.started_at),
            _parse_dt(payload.ended_at),
            payload.progress,
            payload.stage,
            payload.work_units_total,
            payload.work_units_done,
            payload.metrics,
            payload.last_error,
            now,
        )

    await broadcaster.broadcast(
        {
            "type": "job.updated",
            "ts": datetime.now(timezone.utc).isoformat(),
            "robot_id": payload.robot_id,
            "job_id": payload.job_id,
            "status": payload.status,
            "progress": payload.progress,
        }
    )
    return {"ok": True}


@app.post("/api/ingest/error")
async def ingest_error(payload: ErrorPayload) -> Dict[str, Any]:
    pool = await _get_pool()
    ts = None
    if payload.ts:
        try:
            ts = datetime.fromisoformat(payload.ts.replace("Z", "+00:00"))
        except ValueError:
            ts = None
    if ts is None:
        ts = datetime.now(timezone.utc)
    async with pool.acquire() as conn:
        await conn.execute(
            """
            insert into errors (robot_id, job_id, ts, code, message, fingerprint, context)
            values ($1,$2,$3,$4,$5,$6,$7)
            """,
            payload.robot_id,
            payload.job_id,
            ts,
            payload.code,
            payload.message,
            payload.fingerprint,
            payload.context,
        )
    await broadcaster.broadcast(
        {
            "type": "error.raised",
            "ts": ts.isoformat(),
            "robot_id": payload.robot_id,
            "job_id": payload.job_id,
            "code": payload.code,
            "message": payload.message,
        }
    )
    return {"ok": True}


@app.get("/api/fleet/overview", response_model=FleetOverview)
async def fleet_overview() -> FleetOverview:
    pool = await _get_pool()
    now = datetime.now(timezone.utc)
    day_start = datetime(now.year, now.month, now.day, tzinfo=timezone.utc)
    async with pool.acquire() as conn:
        total = await conn.fetchval("select count(*) from robots")
        online = await conn.fetchval("select count(*) from robots where ok is true")
        error = await conn.fetchval("select count(*) from robots where ok is false")
        running = await conn.fetchval("select count(distinct robot_id) from jobs where status = 'RUNNING'")
        today_jobs_done = await conn.fetchval(
            """
            select count(*) from jobs
            where ended_at >= date_trunc('day', now() at time zone 'utc')
            """
        )
        today_work_units_total = await conn.fetchval(
            """
            select coalesce(sum(work_units_done), 0) from jobs
            where ended_at >= date_trunc('day', now() at time zone 'utc')
            """
        )
        stuck_jobs = await conn.fetchval(
            """
            select count(*) from jobs
            where status = 'RUNNING' and updated_at < (now() - interval '15 minutes')
            """
        )
        job_rows = await conn.fetch(
            """
            select robot_id, started_at, ended_at, status
            from jobs
            where (started_at >= $1 or ended_at >= $1 or status = 'RUNNING')
            """,
            day_start,
        )

    active_by_robot: Dict[str, float] = {}
    for row in job_rows:
        start = row["started_at"]
        end = row["ended_at"]
        if not start:
            continue
        if start < day_start:
            start = day_start
        if end is None:
            end = now
        if end < day_start:
            continue
        duration = (end - start).total_seconds()
        if duration < 0:
            continue
        active_by_robot[row["robot_id"]] = active_by_robot.get(row["robot_id"], 0.0) + duration
    total_window = max((now - day_start).total_seconds(), 1.0)
    utilization_values = [min(v / total_window, 1.0) for v in active_by_robot.values()]
    avg_util = sum(utilization_values) / len(utilization_values) if utilization_values else 0.0

    return FleetOverview(
        total_count=total or 0,
        online_count=online or 0,
        error_count=error or 0,
        running_count=running or 0,
        idle_count=max((online or 0) - (running or 0), 0),
        today_work_units_total=today_work_units_total or 0,
        avg_utilization_today=round(avg_util, 2),
        today_jobs_done=today_jobs_done or 0,
        stuck_jobs_count=stuck_jobs or 0,
    )


@app.get("/api/robots", response_model=List[RobotRow])
async def list_robots() -> List[RobotRow]:
    pool = await _get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            select robot_id, hostname, platform, last_seen_at, version, ok, health_score
            from robots
            order by last_seen_at desc nulls last
            """
        )
    result: List[RobotRow] = []
    for r in rows:
        result.append(
            RobotRow(
                robot_id=r["robot_id"],
                hostname=r["hostname"],
                platform=r["platform"],
                last_seen_at=r["last_seen_at"].isoformat() if r["last_seen_at"] else None,
                version=r["version"],
                ok=r["ok"],
                health_score=r["health_score"],
            )
        )
    return result


@app.get("/api/fleet/anomalies", response_model=List[FleetAnomaly])
async def fleet_anomalies() -> List[FleetAnomaly]:
    pool = await _get_pool()
    anomalies: List[FleetAnomaly] = []
    async with pool.acquire() as conn:
        offline_rows = await conn.fetch(
            """
            select robot_id, last_seen_at from robots
            where last_seen_at < (now() - interval '10 minutes')
            """
        )
        for r in offline_rows:
            anomalies.append(
                FleetAnomaly(
                    robot_id=r["robot_id"],
                    type="offline",
                    message="超过10分钟无心跳",
                    last_seen_at=r["last_seen_at"].isoformat() if r["last_seen_at"] else None,
                )
            )
        error_rows = await conn.fetch(
            """
            select robot_id, count(*) as cnt
            from errors
            where ts > (now() - interval '60 minutes')
            group by robot_id
            having count(*) >= 3
            """
        )
        for r in error_rows:
            anomalies.append(
                FleetAnomaly(
                    robot_id=r["robot_id"],
                    type="error_burst",
                    message=f"过去1小时错误{r['cnt']}次",
                    last_seen_at=None,
                )
            )
        stuck_rows = await conn.fetch(
            """
            select robot_id from jobs
            where status = 'RUNNING' and updated_at < (now() - interval '15 minutes')
            """
        )
        for r in stuck_rows:
            anomalies.append(
                FleetAnomaly(
                    robot_id=r["robot_id"],
                    type="stuck",
                    message="任务卡住超过15分钟",
                    last_seen_at=None,
                )
            )
    return anomalies


@app.get("/api/jobs")
async def list_jobs(status: Optional[str] = None) -> List[Dict[str, Any]]:
    pool = await _get_pool()
    query = (
        "select job_id, robot_id, job_type, title, status, priority, created_at, started_at, ended_at, progress, stage, work_units_total, work_units_done "
        "from jobs"
    )
    args: List[Any] = []
    if status:
        query += " where status = $1"
        args.append(status)
    query += " order by created_at desc nulls last limit 200"
    async with pool.acquire() as conn:
        rows = await conn.fetch(query, *args)
    return [
        {
            "job_id": r["job_id"],
            "robot_id": r["robot_id"],
            "job_type": r["job_type"],
            "title": r["title"],
            "status": r["status"],
            "priority": r["priority"],
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
            "started_at": r["started_at"].isoformat() if r["started_at"] else None,
            "ended_at": r["ended_at"].isoformat() if r["ended_at"] else None,
            "progress": r["progress"],
            "stage": r["stage"],
            "work_units_total": r["work_units_total"],
            "work_units_done": r["work_units_done"],
        }
        for r in rows
    ]


@app.get("/api/reports/daily")
async def daily_report(date: Optional[str] = None) -> Dict[str, Any]:
    pool = await _get_pool()
    if date:
        try:
            report_date = datetime.fromisoformat(date).date()
        except ValueError:
            report_date = datetime.now(timezone.utc).date()
    else:
        report_date = datetime.now(timezone.utc).date()
    async with pool.acquire() as conn:
        robots = await conn.fetch("select robot_id from robots")
        reports = []
        for r in robots:
            robot_id = r["robot_id"]
            jobs = await conn.fetch(
                """
                select status, work_units_done
                from jobs
                where robot_id = $1 and ended_at::date = $2
                """,
                robot_id,
                report_date,
            )
            errors = await conn.fetch(
                """
                select code, count(*) as cnt
                from errors
                where robot_id = $1 and ts::date = $2
                group by code
                order by cnt desc
                limit 3
                """,
                robot_id,
                report_date,
            )
            jobs_done = sum(1 for j in jobs if j["status"] == "DONE")
            work_units = sum((j["work_units_done"] or 0) for j in jobs)
            reports.append(
                {
                    "robot_id": robot_id,
                    "date": report_date.isoformat(),
                    "jobs_done": jobs_done,
                    "work_units": work_units,
                    "top_errors": [{"code": e["code"], "count": e["cnt"]} for e in errors],
                    "summary": f"当日完成{jobs_done}个任务，产出{work_units}工作量。",
                }
            )
    return {"date": report_date.isoformat(), "reports": reports}


@app.post("/api/diagnostics/package")
async def diagnostics_package(payload: Dict[str, Any]) -> Dict[str, Any]:
    pool = await _get_pool()
    robot_id = payload.get("robot_id")
    fingerprint = payload.get("fingerprint")
    async with pool.acquire() as conn:
        error_row = await conn.fetchrow(
            """
            select id, ts, code, message, fingerprint, job_id, context
            from errors
            where robot_id = $1 and ($2::text is null or fingerprint = $2)
            order by ts desc nulls last
            limit 1
            """,
            robot_id,
            fingerprint,
        )
        job_row = None
        if error_row and error_row["job_id"]:
            job_row = await conn.fetchrow(
                """
                select job_id, job_type, title, status, progress, stage, metrics
                from jobs
                where job_id = $1
                """,
                error_row["job_id"],
            )
        latest = await conn.fetchrow(
            """
            select payload
            from health_reports
            where robot_id = $1
            order by report_at desc
            limit 1
            """,
            robot_id,
        )
    return {
        "robot_id": robot_id,
        "error": dict(error_row) if error_row else None,
        "job": dict(job_row) if job_row else None,
        "latest_health": latest["payload"] if latest else None,
    }


@app.post("/api/ai/analyze")
async def ai_analyze(payload: Dict[str, Any]) -> Dict[str, Any]:
    pool = await _get_pool()
    error_id = payload.get("error_id")
    robot_id = payload.get("robot_id")
    fingerprint = payload.get("fingerprint")
    analysis = payload.get("analysis", {})
    async with pool.acquire() as conn:
        await conn.execute(
            """
            insert into error_analyses (error_id, robot_id, fingerprint, analysis, created_at)
            values ($1,$2,$3,$4,$5)
            """,
            error_id,
            robot_id,
            fingerprint,
            analysis,
            datetime.now(timezone.utc),
        )
    await broadcaster.broadcast(
        {
            "type": "analysis.created",
            "ts": datetime.now(timezone.utc).isoformat(),
            "robot_id": robot_id,
            "fingerprint": fingerprint,
        }
    )
    return {"ok": True}
@app.get("/api/robots/{robot_id}/jobs")
async def list_jobs(robot_id: str) -> List[Dict[str, Any]]:
    pool = await _get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            select job_id, job_type, title, status, priority, created_at, started_at, ended_at,
                   progress, stage, work_units_total, work_units_done, metrics, last_error
            from jobs
            where robot_id = $1
            order by created_at desc nulls last
            limit 50
            """,
            robot_id,
        )
    return [
        {
            "job_id": r["job_id"],
            "job_type": r["job_type"],
            "title": r["title"],
            "status": r["status"],
            "priority": r["priority"],
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
            "started_at": r["started_at"].isoformat() if r["started_at"] else None,
            "ended_at": r["ended_at"].isoformat() if r["ended_at"] else None,
            "progress": r["progress"],
            "stage": r["stage"],
            "work_units_total": r["work_units_total"],
            "work_units_done": r["work_units_done"],
            "metrics": r["metrics"],
            "last_error": r["last_error"],
        }
        for r in rows
    ]


@app.get("/api/robots/{robot_id}/errors")
async def list_errors(robot_id: str) -> List[Dict[str, Any]]:
    pool = await _get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            select ts, code, message, fingerprint, job_id, context
            from errors
            where robot_id = $1
            order by ts desc nulls last
            limit 50
            """,
            robot_id,
        )
    return [
        {
            "ts": r["ts"].isoformat() if r["ts"] else None,
            "code": r["code"],
            "message": r["message"],
            "fingerprint": r["fingerprint"],
            "job_id": r["job_id"],
            "context": r["context"],
        }
        for r in rows
    ]


@app.get("/api/robots/{robot_id}")
async def get_robot(robot_id: str) -> Dict[str, Any]:
    pool = await _get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            select robot_id, hostname, platform, last_seen_at, version, ok, health_score
            from robots
            where robot_id = $1
            """,
            robot_id,
        )
        if not row:
            return {"error": "not_found"}
        latest = await conn.fetchrow(
            """
            select payload
            from health_reports
            where robot_id = $1
            order by report_at desc
            limit 1
            """,
            robot_id,
        )
        jobs = await conn.fetch(
            """
            select job_id, job_type, title, status, priority, created_at, started_at, ended_at,
                   progress, stage, work_units_total, work_units_done, metrics, last_error
            from jobs
            where robot_id = $1
            order by created_at desc nulls last
            limit 20
            """,
            robot_id,
        )
        errors = await conn.fetch(
            """
            select ts, code, message, fingerprint, job_id, context
            from errors
            where robot_id = $1
            order by ts desc nulls last
            limit 20
            """,
            robot_id,
        )
    return {
        "robot": {
            "robot_id": row["robot_id"],
            "hostname": row["hostname"],
            "platform": row["platform"],
            "last_seen_at": row["last_seen_at"].isoformat() if row["last_seen_at"] else None,
            "version": row["version"],
            "ok": row["ok"],
            "health_score": row["health_score"],
        },
        "latest_report": latest["payload"] if latest else None,
        "jobs": [
            {
                "job_id": j["job_id"],
                "job_type": j["job_type"],
                "title": j["title"],
                "status": j["status"],
                "priority": j["priority"],
                "created_at": j["created_at"].isoformat() if j["created_at"] else None,
                "started_at": j["started_at"].isoformat() if j["started_at"] else None,
                "ended_at": j["ended_at"].isoformat() if j["ended_at"] else None,
                "progress": j["progress"],
                "stage": j["stage"],
                "work_units_total": j["work_units_total"],
                "work_units_done": j["work_units_done"],
                "metrics": j["metrics"],
                "last_error": j["last_error"],
            }
            for j in jobs
        ],
        "errors": [
            {
                "ts": e["ts"].isoformat() if e["ts"] else None,
                "code": e["code"],
                "message": e["message"],
                "fingerprint": e["fingerprint"],
                "job_id": e["job_id"],
                "context": e["context"],
            }
            for e in errors
        ],
    }


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket) -> None:
    await broadcaster.connect(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        await broadcaster.disconnect(ws)
