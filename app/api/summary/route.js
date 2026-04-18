import { NextResponse } from 'next/server'
import { getSql } from '../../../lib/db'
import { requireUser } from '../../../lib/auth'

export const dynamic = 'force-dynamic'

function getKoreaDateString(date = new Date()) {
  const korea = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }))
  const y = korea.getFullYear()
  const m = String(korea.getMonth() + 1).padStart(2, '0')
  const d = String(korea.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function getKoreaWeekRange(date = new Date()) {
  const korea = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }))
  const day = korea.getDay()

  const sunday = new Date(korea)
  sunday.setDate(korea.getDate() - day)

  const saturday = new Date(sunday)
  saturday.setDate(sunday.getDate() + 6)

  const fmt = (d) => {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }

  return {
    weekStart: fmt(sunday),
    weekEnd: fmt(saturday),
  }
}

export async function GET(req) {
  try {
    const user = await requireUser()
    const db = getSql()
    const url = new URL(req.url)
    const scope = url.searchParams.get('scope') || 'today'

    const koreaToday = getKoreaDateString()
    const { weekStart, weekEnd } = getKoreaWeekRange()

    const activeSession = await db`
      SELECT *
      FROM study_sessions
      WHERE user_id = ${user.id} AND status = 'active'
      ORDER BY start_time DESC
      LIMIT 1
    `

    if (scope === 'today') {
      const sessions = await db`
        SELECT *
        FROM study_sessions
        WHERE user_id = ${user.id}
        ORDER BY created_at DESC
        LIMIT 50
      `

      const todaySessions = sessions.filter((s) => {
        const raw = s.start_time || s.created_at
        if (!raw) return false
        const kst = new Date(new Date(raw).toLocaleString('en-US', { timeZone: 'Asia/Seoul' }))
        const y = kst.getFullYear()
        const m = String(kst.getMonth() + 1).padStart(2, '0')
        const d = String(kst.getDate()).padStart(2, '0')
        return `${y}-${m}-${d}` === koreaToday
      })

      const events = await db`
        SELECT *
        FROM extracted_learning_events
        WHERE user_id = ${user.id}
        ORDER BY created_at DESC
        LIMIT 30
      `

      const todayMinutes = todaySessions.reduce(
        (sum, s) => sum + Number(s.duration_minutes || 0),
        0
      )

      return NextResponse.json({
        koreaToday,
        activeSession: activeSession[0] || null,
        sessions: todaySessions,
        events,
        todayMinutes,
      })
    }

    const weeklyPlans = await db`
      SELECT *
      FROM weekly_plans
      WHERE user_id = ${user.id}
      AND week_start = ${weekStart}::date
      AND week_end = ${weekEnd}::date
      AND status = 'active'
      ORDER BY priority ASC, created_at DESC
    `

    const allWeeklyPlans = await db`
      SELECT *
      FROM weekly_plans
      WHERE user_id = ${user.id}
      ORDER BY created_at DESC
      LIMIT 30
    `

    return NextResponse.json({
      weekStart,
      weekEnd,
      activeSession: activeSession[0] || null,
      weeklyPlans,
      allWeeklyPlans,
    })
  } catch (err) {
    return NextResponse.json(
      {
        error: '로그인이 필요하거나 요약 조회 중 오류가 발생했다.',
        detail: String(err?.message || err),
      },
      { status: 401 }
    )
  }
}
