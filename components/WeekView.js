'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

export default function WeekView() {
  const router = useRouter()
  const [data, setData] = useState(null)

  async function load() {
    const res = await fetch('/api/summary?scope=week', {
      cache: 'no-store',
    })

    if (res.status === 401) {
      router.push('/login?next=/week')
      return
    }

    const json = await res.json()
    setData(json)
  }

  useEffect(() => {
    load()
  }, [])

  const plans = data?.weeklyPlans || []
  const allPlans = data?.allWeeklyPlans || []

  return (
    <main className="centerShell">
      <section className="card wide">
        <p className="eyebrow">WEEK</p>
        <h1>주간 계획</h1>
        <p className="muted">
          이번 주: {data?.weekStart || '-'} ~ {data?.weekEnd || '-'}
        </p>

        <div className="row">
          <button className="ghostButton" onClick={load}>새로고침</button>
          <a className="primaryButton" href="/chat">AI와 주간 계획 만들기</a>
        </div>

        <h2>이번 주 활성 계획</h2>
        <div className="list">
          {plans.map((p) => (
            <div className="listItem" key={p.id}>
              <b>{p.subject}</b>
              <span>{p.target_description}</span>
              <span>
                진행 {p.current_progress || 0}/{p.target_quantity || '?'} · 예상 {p.estimated_required_time || '?'}분 · 위험도 {p.risk_level || 'unknown'}
              </span>
            </div>
          ))}

          {plans.length === 0 && (
            <div className="listItem">
              <b>이번 주 계획이 아직 화면에 없음</b>
              <span>
                대화창에서 “이번 주에 수학 미분 문제 40문제, 국어 문학 작품 3개, 영어 독해 6지문을 해야 한다.”라고 입력해라.
              </span>
            </div>
          )}
        </div>

        <h2>최근 저장된 모든 주간 계획</h2>
        <div className="list">
          {allPlans.map((p) => (
            <div className="listItem" key={p.id}>
              <b>{p.subject} · {p.week_start}~{p.week_end}</b>
              <span>{p.target_description}</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  )
}
