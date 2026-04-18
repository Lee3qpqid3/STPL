import { Suspense } from 'react'
import ChatShell from '../../components/ChatShell'

export default function ChatPage() {
  return (
    <Suspense fallback={<ChatLoading />}>
      <ChatShell />
    </Suspense>
  )
}

function ChatLoading() {
  return (
    <main className="centerShell">
      <section className="card narrow">
        <p className="eyebrow">STPL</p>
        <h1>대화창 준비 중</h1>
        <p className="muted">학습 비서 대화창을 불러오고 있다.</p>
      </section>
    </main>
  )
}
