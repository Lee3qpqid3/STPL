import { NextResponse } from 'next/server'
import { ensureSchema, getSql } from '../../../../lib/db'
import { hashPassword, setSession, verifyPassword } from '../../../../lib/auth'

export async function POST(req) {
  try {
    if (!process.env.DATABASE_URL) {
      return NextResponse.json(
        { error: 'DATABASE_URL 환경변수가 없다.' },
        { status: 500 }
      )
    }

    if (!process.env.AUTH_SECRET) {
      return NextResponse.json(
        { error: 'AUTH_SECRET 환경변수가 없다.' },
        { status: 500 }
      )
    }

    await ensureSchema()
    const db = getSql()
    const { username, password, rememberMe = true } = await req.json()

    if (!username || !password) {
      return NextResponse.json({ error: '아이디와 비밀번호를 입력해라.' }, { status: 400 })
    }

    const users = await db`
      SELECT *
      FROM app_users
      WHERE username = ${username}
      LIMIT 1
    `

    if (users.length === 0) {
      const count = await db`SELECT COUNT(*)::int AS count FROM app_users`
      const noUserYet = count[0].count === 0

      if (noUserYet && username === 'user' && password === '1234') {
        const created = await db`
          INSERT INTO app_users (username, password_hash)
          VALUES (${username}, ${hashPassword(password)})
          RETURNING id, username
        `

        await db`
          INSERT INTO user_profiles (user_id)
          VALUES (${created[0].id})
          ON CONFLICT DO NOTHING
        `

        await setSession(created[0], rememberMe)
        return NextResponse.json({ ok: true, user: created[0] })
      }

      return NextResponse.json({ error: '로그인 실패' }, { status: 401 })
    }

    const user = users[0]

    if (!verifyPassword(password, user.password_hash)) {
      return NextResponse.json({ error: '로그인 실패' }, { status: 401 })
    }

    await setSession(user, rememberMe)

    return NextResponse.json({
      ok: true,
      user: {
        id: user.id,
        username: user.username,
      },
    })
  } catch (err) {
    console.error('LOGIN_ERROR', err)

    return NextResponse.json(
      {
        error: '로그인 서버 오류가 발생했다.',
        detail: String(err?.message || err),
      },
      { status: 500 }
    )
  }
}
