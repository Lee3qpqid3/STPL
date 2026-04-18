import './globals.css'

export const metadata = {
  title: 'STPL',
  description: 'AI Study Partner and Learning Manager',
}

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  )
}
