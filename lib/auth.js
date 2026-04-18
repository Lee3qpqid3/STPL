import crypto from 'crypto'
import { cookies } from 'next/headers'
import { ensureSchema, getSql } from './db'

const COOKIE_NAME = 'stpl_session'

function getSecret() {
  const secret = process.env.AUTH_SECRET
  if (!secret) throw new Error('AUTH_SECRET 환경변수가 없습니다.')
  return secret
}

export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false
  const [salt, hash] = stored.split(':')
  const candidate = hashPassword(password, salt).split(':')[1]
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(candidate, 'hex'))
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = crypto.createHmac('sha256', getSecret()).update(body).digest('base64url')
  return `${body}.${sig}`
}

function verify(token) {
  if (!token || !token.includes('.')) return null
  const [body, sig] = token.split('.')
  const expected = crypto.createHmac('sha256', getSecret()).update(body).digest('base64url')
  if (sig !== expected) return null

  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  if (payload.exp && Date.now() > payload.exp) return null
  return payload
}

export async function setSession(user, rememberMe = true) {
  const jar = await cookies()

  const maxAge = rememberMe
    ? 60 * 60 * 24 * 30
    : 60 * 60 * 8

  const token = sign({
    userId: user.id,
    username: user.username,
    exp: Date.now() + maxAge * 1000,
  })

  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    path: '/',
    maxAge,
  })
}

export async function clearSession() {
  const jar = await cookies()
  jar.set(COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    path: '/',
    maxAge: 0,
  })
}

export async function getCurrentUser() {
  await ensureSchema()
  const jar = await cookies()
  const token = jar.get(COOKIE_NAME)?.value
  const payload = verify(token)
  if (!payload?.userId) return null

  const db = getSql()
  const rows = await db`
    SELECT id, username, created_at
    FROM app_users
    WHERE id = ${payload.userId}
    LIMIT 1
  `
  return rows[0] || null
}

export async function requireUser() {
  const user = await getCurrentUser()
  if (!user) {
    const error = new Error('인증 필요')
    error.status = 401
    throw error
  }
  return user
}
