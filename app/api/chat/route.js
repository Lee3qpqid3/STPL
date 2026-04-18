import { NextResponse } from 'next/server'
import { getSql } from '../../../lib/db'
import { requireUser } from '../../../lib/auth'
import { analyzeLearningMessage } from '../../../lib/learning-ai'

function getKoreaNowParts(date = new Date()) {
  const korea = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }))

  const y = korea.getFullYear()
  const m = String(korea.getMonth() + 1).padStart(2, '0')
  const d = String(korea.getDate()).padStart(2, '0')
  const hh = String(korea.getHours()).padStart(2, '0')
  const mm = String(korea.getMinutes()).padStart(2, '0')

  return {
    korea,
    koreaDate: `${y}-${m}-${d}`,
    koreaNowText: `${y}년 ${Number(m)}월 ${Number(d)}일 ${hh}:${mm}`,
  }
}

function getWeekRange(date = new Date()) {
  const { korea } = getKoreaNowParts(date)
  const day = korea.getDay()
  const diffToMonday = day === 0 ? -6 : 1 - day

  const monday = new Date(korea)
  monday.setDate(korea.getDate() + diffToMonday)

  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)

  const fmt = (d) => {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }

  return {
    weekStart: fmt(monday),
    weekEnd: fmt(sunday),
  }
}

async function applyEvents({ db, user, userMessageId, message, analysis }) {
  const now = new Date()
  const { weekStart, weekEnd } = getWeekRange(now)

  for (const event of analysis.events || []) {
    await db`
      INSERT INTO extracted_learning_events
      (user_id, message_id, event_type, subject, inferred_data_json, confidence)
      VALUES (
        ${user.id},
        ${userMessageId},
        ${event.eventType || 'unknown'},
        ${event.subject || null},
        ${db.json(event)},
        ${event.confidence || 0.5}
      )
    `

    if (event.eventType === 'study_start') {
      await db`
        UPDATE study_sessions
        SET status = 'interrupted', end_time = NOW(), updated_at = NOW()
        WHERE user_id = ${user.id} AND status = 'active'
      `

      await db`
        INSERT INTO study_sessions
        (user_id, subject, start_time, task_description, source_message, confidence, status)
        VALUES (
          ${user.id},
          ${event.subject || '미상'},
          NOW(),
          ${event.taskDescription || message},
          ${message},
          ${event.confidence || 0.5},
          'active'
        )
      `
    }

    if (event.eventType === 'study_end') {
      const active = await db`
        SELECT *
        FROM study_sessions
        WHERE user_id = ${user.id} AND status = 'active'
        ORDER BY start_time DESC
        LIMIT 1
      `

      if (active.length > 0) {
        await db`
          UPDATE study_sessions
          SET
            end_time = NOW(),
            duration_minutes = GREATEST(1, FLOOR(EXTRACT(EPOCH FROM (NOW() - start_time)) / 60)::int),
            task_description = COALESCE(${event.taskDescription || null}, task_description),
            quantity_done = ${event.quantityDone || null},
            perceived_difficulty = ${event.perceivedDifficulty || null},
            focus_level = ${event.focusLevel || null},
            quality_label = ${event.qualityLabel || null},
            efficiency_label = ${event.efficiencyLabel || null},
            source_message = ${message},
            confidence = ${event.confidence || 0.5},
            status = 'completed',
            updated_at = NOW()
          WHERE id = ${active[0].id}
        `
      } else {
        await db`
          INSERT INTO study_sessions
          (user_id, subject, start_time, end_time, duration_minutes, task_description, quantity_done, perceived_difficulty, source_message, confidence, status)
          VALUES (
            ${user.id},
            ${event.subject || '미상'},
            NOW(),
            NOW(),
            NULL,
            ${event.taskDescription || message},
            ${event.quantityDone || null},
            ${event.perceivedDifficulty || null},
            ${message},
            ${event.confidence || 0.45},
            'completed'
          )
        `
      }
    }

    if (event.eventType === 'progress_report') {
      await db`
        INSERT INTO study_sessions
        (user_id, subject, start_time, end_time, task_description, quantity_done, perceived_difficulty, focus_level, quality_label, efficiency_label, source_message, confidence, status)
        VALUES (
          ${user.id},
          ${event.subject || '미상'},
          NOW(),
          NOW(),
          ${event.taskDescription || message},
          ${event.quantityDone || null},
          ${event.perceivedDifficulty || null},
          ${event.focusLevel || null},
          ${event.qualityLabel || null},
          ${event.efficiencyLabel || null},
          ${message},
          ${event.confidence || 0.5},
          'reported'
        )
      `
    }

    if (event.eventType === 'daily_close') {
      // 지금은 이벤트만 저장한다.
      // 다음 단계에서 오늘 요약과 내일 계획 생성 로직을 붙인다.
    }
  }

  const planUpdates = [...(analysis.weeklyPlanUpdates || [])]

for (const event of analysis.events || []) {
  if (
    event.eventType === 'weekly_plan_upsert' ||
    event.eventType === 'weekly_plan_create' ||
    event.eventType === 'weekly_plan_update'
  ) {
    planUpdates.push({
      subject: event.subject || '미상',
      targetDescription: event.taskDescription || message,
      targetQuantity: event.targetQuantity || event.quantityDone || null,
      estimatedRequiredTime: event.inferredData?.estimatedRequiredTime || null,
      priority: event.inferredData?.priority || 3,
      riskLevel: event.inferredData?.riskLevel || 'unknown',
    })
  }
}

export async function POST(req) {
  try {
    const user = await requireUser()
    const db = getSql()
    const { message } = await req.json()

    if (!message || !message.trim()) {
      return NextResponse.json({ error: '메시지가 비어 있다.' }, { status: 400 })
    }

    const userMsg = await db`
      INSERT INTO conversation_messages (user_id, role, content)
      VALUES (${user.id}, 'user', ${message})
      RETURNING id
    `

    const recentMessages = await db`
      SELECT role, content, created_at
      FROM conversation_messages
      WHERE user_id = ${user.id}
      ORDER BY created_at DESC
      LIMIT 12
    `

    const activeSessions = await db`
      SELECT *
      FROM study_sessions
      WHERE user_id = ${user.id} AND status = 'active'
      ORDER BY start_time DESC
      LIMIT 1
    `

    const weeklyPlans = await db`
      SELECT *
      FROM weekly_plans
      WHERE user_id = ${user.id} AND status = 'active'
      ORDER BY created_at DESC
      LIMIT 20
    `

    const todaySessions = await db`
      SELECT *
      FROM study_sessions
      WHERE user_id = ${user.id}
      AND start_time::date = CURRENT_DATE
      ORDER BY created_at DESC
      LIMIT 20
    `

    const koreaTime = getKoreaNowParts()

const context = {
  serverNow: new Date().toISOString(),
  koreaNow: koreaTime.koreaNowText,
  koreaDate: koreaTime.koreaDate,
  timezone: 'Asia/Seoul',
  user: { id: user.id, username: user.username },
  activeSession: activeSessions[0] || null,
  weeklyPlans,
  todaySessions,
  recentMessages: recentMessages.reverse(),
}

    const analysis = await analyzeLearningMessage({ message, context })

    await applyEvents({
      db,
      user,
      userMessageId: userMsg[0].id,
      message,
      analysis,
    })

    await db`
      INSERT INTO conversation_messages (user_id, role, content)
      VALUES (${user.id}, 'assistant', ${analysis.reply || '처리했다.'})
    `

    return NextResponse.json({
      ok: true,
      reply: analysis.reply || '처리했다.',
      analysis,
    })
  } catch (err) {
    console.error('CHAT_ROUTE_ERROR', err)

    return NextResponse.json(
      {
        error: '서버 처리 중 오류가 발생했다.',
        detail: String(err?.message || err),
      },
      { status: err.status || 500 }
    )
  }
}
