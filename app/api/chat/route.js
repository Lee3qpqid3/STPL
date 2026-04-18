import { NextResponse } from 'next/server'
import { getSql } from '../../../lib/db'
import { requireUser } from '../../../lib/auth'
import { analyzeLearningMessage } from '../../../lib/learning-ai'

export const dynamic = 'force-dynamic'

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

function extractPlansFromText(message) {
  const text = message || ''
  if (!text.includes('이번 주') && !text.includes('주간')) return []

  const subjects = ['수학', '국어', '영어', '물리', '화학', '생명', '지구', '한국사', '사회', '과학']
  const plans = []

  for (const subject of subjects) {
    if (!text.includes(subject)) continue

    const index = text.indexOf(subject)
    const piece = text.slice(index, index + 40)

    const quantityMatch = piece.match(/(\d+)\s*(문제|쪽|페이지|강|개|지문|작품|단원)/)
    const quantity = quantityMatch ? Number(quantityMatch[1]) : null
    const unit = quantityMatch ? quantityMatch[2] : ''

    let description = piece
      .split(/[,.，。]/)[0]
      .replace(/해야 한다|해야 함|추가되었다|추가됨|이번 주에|이번 주|주간/g, '')
      .trim()

    if (!description) {
      description = `${subject}${quantity ? ` ${quantity}${unit}` : ''}`
    }

    plans.push({
      subject,
      targetDescription: description,
      targetQuantity: quantity,
      estimatedRequiredTime: null,
      priority: 3,
      riskLevel: 'unknown',
    })
  }

  return plans
}

function buildPlanUpdatesFromAnalysis({ analysis, message }) {
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

  const deterministicPlans = extractPlansFromText(message)
  planUpdates.push(...deterministicPlans)

  const unique = []
  const seen = new Set()

  for (const plan of planUpdates) {
    const key = `${plan.subject}-${plan.targetDescription}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(plan)
  }

  return unique
}

async function saveExtractedEvents({ db, user, userMessageId, analysis }) {
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
  }
}

async function handleStudyStart({ db, user, event, message }) {
  await db`
    UPDATE study_sessions
    SET status = 'interrupted',
        end_time = NOW(),
        updated_at = NOW()
    WHERE user_id = ${user.id}
      AND status = 'active'
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

async function handleStudyEnd({ db, user, event, message }) {
  const active = await db`
    SELECT *
    FROM study_sessions
    WHERE user_id = ${user.id}
      AND status = 'active'
    ORDER BY start_time DESC
    LIMIT 1
  `

  if (active.length > 0) {
    await db`
      UPDATE study_sessions
      SET
        end_time = NOW(),
        duration_minutes = GREATEST(
          1,
          FLOOR(EXTRACT(EPOCH FROM (NOW() - start_time)) / 60)::int
        ),
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
      (
        user_id,
        subject,
        start_time,
        end_time,
        duration_minutes,
        task_description,
        quantity_done,
        perceived_difficulty,
        focus_level,
        quality_label,
        efficiency_label,
        source_message,
        confidence,
        status
      )
      VALUES (
        ${user.id},
        ${event.subject || '미상'},
        NOW(),
        NOW(),
        NULL,
        ${event.taskDescription || message},
        ${event.quantityDone || null},
        ${event.perceivedDifficulty || null},
        ${event.focusLevel || null},
        ${event.qualityLabel || null},
        ${event.efficiencyLabel || null},
        ${message},
        ${event.confidence || 0.45},
        'completed'
      )
    `
  }
}

async function handleProgressReport({ db, user, event, message }) {
  await db`
    INSERT INTO study_sessions
    (
      user_id,
      subject,
      start_time,
      end_time,
      task_description,
      quantity_done,
      perceived_difficulty,
      focus_level,
      quality_label,
      efficiency_label,
      source_message,
      confidence,
      status
    )
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

async function saveWeeklyPlanUpdates({ db, user, analysis, message }) {
  const { weekStart, weekEnd } = getWeekRange()
  const planUpdates = buildPlanUpdatesFromAnalysis({ analysis, message })

  for (const plan of planUpdates) {
    await db`
      INSERT INTO weekly_plans
      (
        user_id,
        week_start,
        week_end,
        subject,
        target_description,
        target_quantity,
        estimated_required_time,
        priority,
        risk_level,
        status
      )
      VALUES (
        ${user.id},
        ${weekStart},
        ${weekEnd},
        ${plan.subject || '미상'},
        ${plan.targetDescription || message},
        ${plan.targetQuantity || null},
        ${plan.estimatedRequiredTime || null},
        ${plan.priority || 3},
        ${plan.riskLevel || 'unknown'},
        'active'
      )
    `
  }
}

async function applyEvents({ db, user, userMessageId, message, analysis }) {
  await saveExtractedEvents({ db, user, userMessageId, analysis })

  for (const event of analysis.events || []) {
    if (event.eventType === 'study_start') {
      await handleStudyStart({ db, user, event, message })
      continue
    }

    if (event.eventType === 'study_end') {
      await handleStudyEnd({ db, user, event, message })
      continue
    }

    if (event.eventType === 'progress_report') {
      await handleProgressReport({ db, user, event, message })
      continue
    }
  }

  await saveWeeklyPlanUpdates({ db, user, analysis, message })
}

export async function POST(req) {
  try {
    const user = await requireUser()
    const db = getSql()
    const { message } = await req.json()

    if (!message || !message.trim()) {
      return NextResponse.json(
        { error: '메시지가 비어 있다.' },
        { status: 400 }
      )
    }

    const trimmedMessage = message.trim()

    const userMsg = await db`
      INSERT INTO conversation_messages (user_id, role, content)
      VALUES (${user.id}, 'user', ${trimmedMessage})
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
      WHERE user_id = ${user.id}
        AND status = 'active'
      ORDER BY start_time DESC
      LIMIT 1
    `

    const weeklyPlans = await db`
      SELECT *
      FROM weekly_plans
      WHERE user_id = ${user.id}
        AND status = 'active'
      ORDER BY created_at DESC
      LIMIT 20
    `

    const todaySessions = await db`
      SELECT *
      FROM study_sessions
      WHERE user_id = ${user.id}
      ORDER BY created_at DESC
      LIMIT 20
    `

    const koreaTime = getKoreaNowParts()

    const context = {
      serverNow: new Date().toISOString(),
      koreaNow: koreaTime.koreaNowText,
      koreaDate: koreaTime.koreaDate,
      timezone: 'Asia/Seoul',
      user: {
        id: user.id,
        username: user.username,
      },
      activeSession: activeSessions[0] || null,
      weeklyPlans,
      todaySessions,
      recentMessages: recentMessages.reverse(),
    }

    const analysis = await analyzeLearningMessage({
      message: trimmedMessage,
      context,
    })

    await applyEvents({
      db,
      user,
      userMessageId: userMsg[0].id,
      message: trimmedMessage,
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
