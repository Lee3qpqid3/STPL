'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

export default function HomePrompt() {
  const router = useRouter()
  const [value, setValue] = useState('')
  const [me, setMe] = useState(null)

  useEffect(() => {
    fetch('/api/auth/me')
      .then((res) => res.json())
      .then((data) => setMe(data.user || null))
      .catch(() => setMe(null))
  }, [])

  function submitPrompt(e) {
    e.preventDefault()
    const text = value.trim()
    if (!text) return

    if (!me) {
      router.push(`/login?next=${encodeURIComponent(`/chat?message=${encodeURIComponent(text)}`)}`)
      return
    }

    router.push(`/chat?message=${encodeURIComponent(text)}`)
  }

  return (
    <main className="homeShell">
      <section className="homeCenter">
        <p className="eyebrow">STPL</p>
        <h1 className="homeTitle">말하면, 학습 데이터가 된다.</h1>
        <p className="homeDesc">
          “수학 시작”, “끝. 12문제 풀었고 어려웠음”, “이번 주 물리 회로 40문제 추가됨”처럼
          자유롭게 말하면 AI가 학습 기록과 계획으로 바꾼다.
        </p>

        <form className="promptForm" onSubmit={submitPrompt}>
          <textarea
            className="promptInput"
            rows={4}
            placeholder="예: 오늘부터 내 공부를 운영해줘. 수학만 하지 않게 주간 계획 기준으로 조절해줘."
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <div className="row">
            <button className="primaryButton" type="submit">AI와 시작하기</button>
            {me ? (
              <>
                <a className="ghostButton" href="/chat">대화창</a>
                <a className="ghostButton" href="/today">오늘 계획</a>
                <a className="ghostButton" href="/week">주간 계획</a>
                <a className="ghostButton" href="/settings">설정</a>
              </>
            ) : (
              <a className="ghostButton" href="/login">로그인</a>
            )}
          </div>
        </form>
      </section>
    </main>
  )
}
