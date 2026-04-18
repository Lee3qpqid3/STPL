'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'

export default function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const next = searchParams.get('next') || '/chat'

  const [username, setUsername] = useState('user')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function login(e) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })

      let data = {}
      try {
        data = await res.json()
      } catch {
        data = { error: '서버가 JSON 응답을 반환하지 않았다. Vercel Function Logs를 확인해야 한다.' }
      }

      if (!res.ok) {
        setError(data.error || `로그인 실패: ${res.status}`)
        return
      }

      router.push(next)
    } catch (err) {
      setError('로그인 요청 자체가 실패했다. DATABASE_URL 또는 AUTH_SECRET 환경변수를 확인해라.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="centerShell">
      <section className="card narrow">
        <p className="eyebrow">ADMIN LOGIN</p>
        <h1>로그인</h1>
        <p className="muted">
          회원가입은 열지 않는다. 초기 계정은 ID: <b>user</b>, PW: <b>1234</b> 이다.
        </p>

        <form onSubmit={login} className="form">
          <label>아이디</label>
          <input value={username} onChange={(e) => setUsername(e.target.value)} />

          <label>비밀번호</label>
          <input
            type="password"
            placeholder="1234"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          {error && <p className="errorText">{error}</p>}

          <button className="primaryButton full" type="submit" disabled={loading}>
            {loading ? '로그인 중...' : '로그인'}
          </button>
        </form>
      </section>
    </main>
  )
}
