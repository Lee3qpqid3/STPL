import { Suspense } from 'react'
import LoginForm from '../../components/LoginForm'

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginLoading />}>
      <LoginForm />
    </Suspense>
  )
}

function LoginLoading() {
  return (
    <main className="centerShell">
      <section className="card narrow">
        <p className="eyebrow">STPL</p>
        <h1>로그인 준비 중</h1>
        <p className="muted">로그인 화면을 불러오고 있다.</p>
      </section>
    </main>
  )
}
