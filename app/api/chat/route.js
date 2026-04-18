import { NextResponse } from 'next/server'
import { getSql } from '../../../lib/db'
import { requireUser } from '../../../lib/auth'
import { analyzeLearningMessage } from '../../../lib/learning-ai'

export const dynamic = 'force-dynamic'

const SUBJECTS = [
  '수학',
  '국어',
  '영어',
  '물리',
  '화학',
  '생명',
  '지구',
  '한국사',
  '사회',
  '과학',
]

const UNITS = [
  '문제',
  '지문',
  '쪽',
  '페이지',
  '개',
  '작품',
  '강',
  '단원',
]

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

function findSubject(text) {
  return SUBJECTS.find((subject) => text.includes(subject)) || null
}

function findQuantityNear(text, subject) {
  const escapedUnits = UNITS.join('|')

  if (subject && text.includes(subject)) {
    const idx = text.indexOf(subject)
    const piece = text.slice(idx, idx + 60)
    const match = piece.match(new RegExp(`(\\d+)\\s*(${escapedUnits})`))
    if (match) {
      return {
        quantity: Number(match[1]),
        unit: match[2],
      }
    }
  }

  const general = text.match(new RegExp(`(\\d+)\\s*(${escapedUnits})`))
  if (general) {
    return {
      quantity: Number(general[1]),
      unit: general[2],
    }
  }

  return {
    quantity: null,
    unit: null,
  }
}

function inferDifficulty(text) {
  if (
    text.includes('어려') ||
    text.includes('힘들') ||
    text.includes('막힘') ||
    text.includes('안 풀') ||
    text.includes('별로')
  ) {
    return 'hard'
  }

  if (
    text.includes('쉬웠') ||
    text.includes('잘됨') ||
    text.includes('괜찮') ||
    text.includes('무난')
  ) {
    return 'easy'
  }

  return 'unknown'
}

function inferFocus(text) {
  if (text.includes('집중 잘') || text.includes('집중은 괜찮') || text.includes('몰입')) {
    return 'high'
  }

  if (text.includes('집중 안') || text.includes('산만') || text.includes('졸림')) {
    return 'low'
  }

  return 'unknown'
}

function splitWeeklyPlans(text) {
  if (!text.includes('이번 주') && !text.includes('주간')) return []

  const plans = []

  for (const subject of SUBJECTS) {
    if (!text.includes(subject)) continue

    const idx = text.indexOf(subject)
    const piece = text.slice(idx, idx + 80)
    const { quantity, unit } = findQuantityNear(piece, subject)

    let description = piece
      .split(/[,.，。]/)[0]
      .replace(/이번 주에/g, '')
      .replace(/이번 주/g, '')
      .replace(/주간/g, '')
      .replace(/해야 한다/g, '')
      .replace(/해야 함/g, '')
      .replace(/추가되었다/g, '')
      .replace(/추가됨/g, '')
      .trim()

    if (!description) {
      description = `${subject}${quantity ? ` ${quantity}${unit || ''}` : ''}`
    }

    plans.push({
      subject,
      targetDescription: description,
      targetQuantity: quantity,
      unit,
      estimatedRequiredTime: null,
      priority: 3,
      riskLevel: 'unknown',
    })
  }

  return plans
}

function parseUserMessage(message) {
  const text = message.trim()
  const subject = findSubject(text)
  const { quantity, unit } = findQuantityNear(text, subject)
  const difficulty = inferDifficulty(text)
  const focusLevel = inferFocus(text)

  if (subject && text.includes('시작')) {
    return {
      type: 'study_start',
      confidence: 1,
      subject,
      taskDescription: text,
    }
  }

  if (
    text === '끝' ||
    text.startsWith('끝.') ||
    text.startsWith('끝 ') ||
    text.includes('종료') ||
    text.includes('마침')
  ) {
    return {
      type: 'study_end',
      confidence: 0.95,
      subject,
      quantityDone: quantity,
      unit,
      perceivedDifficulty: difficulty,
      focusLevel,
      taskDescription: text,
    }
  }

  if (text.includes('오늘 마감') || text.includes('오늘 종료') || text.includes('일일 마감')) {
    return {
      type: 'daily_close',
      confidence: 1,
      taskDescription: text,
    }
  }

  const weeklyPlans = splitWeeklyPlans(text)
  if (weeklyPlans.length > 0) {
    return {
      type: 'weekly_plan_upsert',
      confidence: 0.95,
      weeklyPlans,
      taskDescription: text,
    }
  }

  if (
    text.includes('계획') ||
    text.includes('뭐 해야') ||
    text.includes('뭘 해야') ||
    text.includes('정리해줘')
  ) {
    return {
      type: 'plan_request',
      confidence: 0.75,
      subject,
      taskDescription: text,
    }
  }

  if (subject && quantity) {
    return {
      type: 'progress_report',
      confidence: 0.8,
      subject,
      quantityDone: quantity,
      unit,
      perceivedDifficulty: difficulty,
      focusLevel,
      taskDescription: text,
    }
  }

  return {
    type: 'conversation',
    confidence: 0.3,
    subject,
    taskDescription: text,
  }
}

function buildDeterministicReply(parsed, context) {
  if (parsed.type === 'study_start') {
    return (
      `${parsed.subject} 학습 시작으로 기록했다.\n\n` +
      `시작 시각은 서버 기준 현재 시각이며, 한국 시간 기준 ${context.koreaNow}이다. ` +
      `끝나면 “끝. 12문제 풀었고 어려웠음”처럼 말해라. 그러면 직전 활성 세션을 종료하고 소요시간을 계산하겠다.`
    )
  }

  if (parsed.type === 'study_end') {
    return (
      `직전 학습 세션을 종료했다.\n\n` +
      `진행량: ${parsed.quantityDone ? `${parsed.quantityDone}${parsed.unit || ''}` : '명확하지 않음'}\n` +
      `난도: ${parsed.perceivedDifficulty || 'unknown'}\n` +
      `집중도: ${parsed.focusLevel || 'unknown'}\n\n` +
      `이제 오늘 계획 탭에서 세션 기록과 소요시간을 확인할 수 있다.`
    )
  }

  if (parsed.type === 'weekly_plan_upsert') {
    const lines = parsed.weeklyPlans
      .map((p) => `- ${p.subject}: ${p.targetDescription}`)
      .join('\n')

    return (
      `이번 주 계획으로 저장했다.\n\n` +
      `${lines}\n\n` +
      `이번 주는 일요일 시작, 토요일 종료 기준으로 계산한다. ` +
      `주간 계획 탭에서 저장된 항목을 확인해라.`
    )
  }

  if (parsed.type === 'daily_close') {
    return (
      `오늘 마감 요청으로 기록했다.\n\n` +
      `현재 MVP에서는 오늘 세션과 주간 계획 데이터를 바탕으로 요약할 준비만 한다. ` +
      `다음 단계에서 오늘 수행률, 부족 과목, 내일 우선순위를 자동 생성하도록 붙이면 된다.`
    )
  }

  if (parsed.type === 'progress_report') {
    return (
      `학습 보고로 기록했다.\n\n` +
      `과목: ${parsed.subject || '미상'}\n` +
      `진행량: ${parsed.quantityDone ? `${parsed.quantityDone}${parsed.unit || ''}` : '명확하지 않음'}\n` +
      `난도: ${parsed.perceivedDifficulty || 'unknown'}\n\n` +
      `다만 시작/종료 시각이 없으므로 정식 소요시간 세션으로는 계산하지 않았다. ` +
      `시간 기록이 필요하면 “${parsed.subject || '과목'} 시작” 후 끝날 때 “끝”이라고 말해라.`
    )
  }

  if (parsed.type === 'plan_request') {
    return (
      `계획 요청으로 이해했다.\n\n` +
      `현재 저장된 주간 계획과 오늘 세션을 기준으로 계획을 조정해야 한다. ` +
      `정확한 추천을 위해서는 이번 주 목표가 먼저 저장되어 있어야 한다. ` +
      `아직 없다면 “이번 주에 수학 40문제, 영어 6지문”처럼 말해라.`
    )
  }

  return (
    `대화로 기록했다.\n\n` +
    `이 입력은 학습 세션이나 주간 계획으로 확정 저장하기에는 정보가 부족하다. ` +
    `공식 기록을 원하면 “수학 시작”, “끝. 12문제”, “이번 주 물리 40문제”처럼 말해라.`
  )
}

async function saveConversationMessage({ db, user, role, content }) {
  const rows = await db`
    INSERT INTO conversation_messages (user_id, role, content)
    VALUES (${user.id}, ${role}, ${content})
    RETURNING id
  `
  return rows[0]
}

async function saveLearningEvent({ db, user, messageId, parsed }) {
  await db`
    INSERT INTO extracted_learning_events
    (user_id, message_id, event_type, subject, inferred_data_json, confidence)
    VALUES (
      ${user.id},
      ${messageId},
      ${parsed.type},
      ${parsed.subject || null},
      ${db.json(parsed)},
      ${parsed.confidence || 0.5}
    )
  `
}

async function handleStudyStart({ db, user, parsed, message }) {
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
    (
      user_id,
      subject,
      start_time,
      task_description,
      source_message,
      confidence,
      status
    )
    VALUES (
      ${user.id},
      ${parsed.subject},
      NOW(),
      ${parsed.taskDescription || message},
      ${message},
      ${parsed.confidence},
      'active'
    )
  `
}

async function handleStudyEnd({ db, user, parsed, message }) {
  const active = await db`
    SELECT *
    FROM study_sessions
    WHERE user_id = ${user.id}
      AND status = 'active'
    ORDER BY start_time DESC
    LIMIT 1
  `

  if (active.length === 0) {
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
        ${parsed.subject || '미상'},
        NOW(),
        NOW(),
        NULL,
        ${parsed.taskDescription || message},
        ${parsed.quantityDone || null},
        ${parsed.perceivedDifficulty || 'unknown'},
        ${parsed.focusLevel || 'unknown'},
        'unknown',
        'unknown',
        ${message},
        ${parsed.confidence || 0.45},
        'reported_without_start'
      )
    `
    return
  }

  await db`
    UPDATE study_sessions
    SET
      end_time = NOW(),
      duration_minutes = GREATEST(
        1,
        FLOOR(EXTRACT(EPOCH FROM (NOW() - start_time)) / 60)::int
      ),
      task_description = COALESCE(${parsed.taskDescription || null}, task_description),
      quantity_done = ${parsed.quantityDone || null},
      perceived_difficulty = ${parsed.perceivedDifficulty || 'unknown'},
      focus_level = ${parsed.focusLevel || 'unknown'},
      quality_label = CASE
        WHEN ${parsed.perceivedDifficulty || 'unknown'} = 'hard' THEN 'low'
        WHEN ${parsed.perceivedDifficulty || 'unknown'} = 'easy' THEN 'high'
        ELSE 'unknown'
      END,
      efficiency_label = CASE
        WHEN ${parsed.perceivedDifficulty || 'unknown'} = 'hard' THEN 'low'
        WHEN ${parsed.perceivedDifficulty || 'unknown'} = 'easy' THEN 'normal'
        ELSE 'unknown'
      END,
      source_message = ${message},
      confidence = ${parsed.confidence || 0.95},
      status = 'completed',
      updated_at = NOW()
    WHERE id = ${active[0].id}
  `
}

async function handleProgressReport({ db, user, parsed, message }) {
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
      ${parsed.subject || '미상'},
      NOW(),
      NOW(),
      NULL,
      ${parsed.taskDescription || message},
      ${parsed.quantityDone || null},
      ${parsed.perceivedDifficulty || 'unknown'},
      ${parsed.focusLevel || 'unknown'},
      'unknown',
      'unknown',
      ${message},
      ${parsed.confidence || 0.7},
      'reported'
    )
  `
}

async function handleWeeklyPlanUpsert({ db, user, parsed }) {
  const { weekStart, weekEnd } = getWeekRange()

  for (const plan of parsed.weeklyPlans || []) {
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
        ${plan.subject},
        ${plan.targetDescription},
        ${plan.targetQuantity || null},
        ${plan.estimatedRequiredTime || null},
        ${plan.priority || 3},
        ${plan.riskLevel || 'unknown'},
        'active'
      )
    `
  }
}

async function getContext({ db, user }) {
  const koreaTime = getKoreaNowParts()
  const { weekStart, weekEnd } = getWeekRange()

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
      AND week_start = ${weekStart}::date
      AND week_end = ${weekEnd}::date
      AND status = 'active'
    ORDER BY priority ASC, created_at DESC
    LIMIT 30
  `

  const todaySessions = await db`
    SELECT *
    FROM study_sessions
    WHERE user_id = ${user.id}
    ORDER BY created_at DESC
    LIMIT 30
  `

  return {
    serverNow: new Date().toISOString(),
    koreaNow: koreaTime.koreaNowText,
    koreaDate: koreaTime.koreaDate,
    timezone: 'Asia/Seoul',
    weekStart,
    weekEnd,
    user: {
      id: user.id,
      username: user.username,
    },
    activeSession: activeSessions[0] || null,
    weeklyPlans,
    todaySessions,
    recentMessages: recentMessages.reverse(),
  }
}

async function getAiAdviceOrFallback({ message, context, deterministicReply }) {
  if (!process.env.OPENAI_API_KEY) {
    return deterministicReply
  }

  try {
    const analysis = await analyzeLearningMessage({
      message:
        `사용자 입력: ${message}\n\n` +
        `중요: DB 저장은 이미 서버 규칙 기반으로 처리되었다. ` +
        `너는 추가 저장용 JSON을 만들 필요가 없다. ` +
        `사용자에게 보여줄 학습 코칭 답변만 자연스럽게 작성하라.`,
      context,
    })

    if (analysis?.reply) {
      return analysis.reply
    }

    return deterministicReply
  } catch {
    return deterministicReply
  }
}

async function applyParsedAction({ db, user, parsed, message, messageId }) {
  await saveLearningEvent({ db, user, messageId, parsed })

  if (parsed.type === 'study_start') {
    await handleStudyStart({ db, user, parsed, message })
    return
  }

  if (parsed.type === 'study_end') {
    await handleStudyEnd({ db, user, parsed, message })
    return
  }

  if (parsed.type === 'weekly_plan_upsert') {
    await handleWeeklyPlanUpsert({ db, user, parsed })
    return
  }

  if (parsed.type === 'progress_report') {
    await handleProgressReport({ db, user, parsed, message })
    return
  }

  // conversation, plan_request, daily_close 등은 이벤트만 저장한다.
  // 세션/주간계획 DB에는 함부로 저장하지 않는다.
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
    const parsed = parseUserMessage(trimmedMessage)

    const userMsg = await saveConversationMessage({
      db,
      user,
      role: 'user',
      content: trimmedMessage,
    })

    await applyParsedAction({
      db,
      user,
      parsed,
      message: trimmedMessage,
      messageId: userMsg.id,
    })

    const context = await getContext({ db, user })
    const deterministicReply = buildDeterministicReply(parsed, context)

    const reply = await getAiAdviceOrFallback({
      message: trimmedMessage,
      context,
      deterministicReply,
    })

    await saveConversationMessage({
      db,
      user,
      role: 'assistant',
      content: reply,
    })

    return NextResponse.json({
      ok: true,
      reply,
      parsed,
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
