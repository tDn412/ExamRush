import { swaggerHtml, openApiSpec } from './openapi.js'

const encoder = new TextEncoder()
const loginAttempts = new Map()

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname === '/docs' || url.pathname === '/docs/' || url.pathname === '/api/docs') {
      return new Response(swaggerHtml(), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    }
    if (url.pathname === '/api/openapi.json') {
      return json(openApiSpec)
    }
    if (!url.pathname.startsWith('/api')) return env.ASSETS.fetch(request)
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() })

    try {
      return await route(request, env, url)
    } catch (error) {
      console.error(error)
      return json({ detail: 'Lỗi máy chủ' }, 500)
    }
  },
}

async function route(request, env, url) {
  const { pathname } = url
  const method = request.method

  if (pathname === '/api' || pathname === '/api/health') {
    return json({ status: 'ok', app: 'ExamRush API', version: '2.0.0', database: 'Cloudflare D1' })
  }

  if (pathname === '/api/auth/register' && method === 'POST') return register(request, env)
  if (pathname === '/api/auth/login' && method === 'POST') return login(request, env)
  if (pathname === '/api/auth/me' && method === 'GET') {
    const user = await requireUser(request, env)
    return user.response || json(publicUser(user))
  }

  if (pathname === '/api/exams' && method === 'GET') return listExams(env)
  if (pathname === '/api/exams' && method === 'POST') return createExam(request, env)

  const fullMatch = pathname.match(/^\/api\/exams\/(\d+)\/full$/)
  if (fullMatch && method === 'GET') return getExamFull(request, env, Number(fullMatch[1]))

  const submitMatch = pathname.match(/^\/api\/exams\/(\d+)\/submit$/)
  if (submitMatch && method === 'POST') return submitExam(request, env, Number(submitMatch[1]))

  const examMatch = pathname.match(/^\/api\/exams\/(\d+)$/)
  if (examMatch && method === 'GET') return getExam(env, Number(examMatch[1]), false)
  if (examMatch && method === 'PUT') return updateExam(request, env, Number(examMatch[1]))
  if (examMatch && method === 'DELETE') return deleteExam(request, env, Number(examMatch[1]))

  if (pathname === '/api/attempts' && method === 'GET') return listAttempts(request, env)
  const attemptMatch = pathname.match(/^\/api\/attempts\/(\d+)$/)
  if (attemptMatch && method === 'GET') return getAttempt(request, env, Number(attemptMatch[1]))

  return json({ detail: 'Không tìm thấy API' }, 404)
}

async function register(request, env) {
  const body = await readJson(request)
  if (!body) return invalidJson()
  const username = String(body.username || '').trim()
  const password = String(body.password || '')
  const displayName = body.display_name == null ? username : String(body.display_name).trim()
  if (username.length < 3 || username.length > 50 || !/^[\p{L}\p{N}_.]+$/u.test(username)) {
    return json({ detail: 'Tên đăng nhập chỉ gồm chữ, số, dấu chấm hoặc gạch dưới và dài 3–50 ký tự' }, 422)
  }
  if (password.length < 3 || password.length > 128) return json({ detail: 'Mật khẩu phải dài 3–128 ký tự' }, 422)
  if (displayName.length > 100) return json({ detail: 'Tên hiển thị quá dài' }, 422)
  const exists = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first()
  if (exists) return json({ detail: 'Tên đăng nhập đã tồn tại' }, 400)

  const passwordHash = await hashPassword(password)
  const result = await env.DB.prepare(
    'INSERT INTO users (username, display_name, password_hash) VALUES (?, ?, ?)',
  ).bind(username, displayName || username, passwordHash).run()
  const user = await env.DB.prepare('SELECT id, username, display_name, created_at FROM users WHERE id = ?')
    .bind(result.meta.last_row_id).first()
  return json(await authPayload(user, env), 201)
}

async function login(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
  const now = Date.now()
  const recent = (loginAttempts.get(ip) || []).filter((time) => now - time < 60_000)
  if (recent.length >= 10) return json({ detail: 'Quá nhiều lần thử. Vui lòng đợi 1 phút.' }, 429)
  recent.push(now)
  loginAttempts.set(ip, recent)

  const body = await readJson(request)
  if (!body) return invalidJson()
  const user = await env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(String(body.username || '').trim()).first()
  if (!user || !(await verifyPassword(String(body.password || ''), user.password_hash))) {
    return json({ detail: 'Tên đăng nhập hoặc mật khẩu không đúng' }, 401)
  }
  loginAttempts.delete(ip)
  return json(await authPayload(user, env))
}

async function listExams(env) {
  const { results } = await env.DB.prepare(`
    SELECT e.id, e.title, e.description, e.image_url, e.time_limit_seconds, e.created_at,
           u.username AS owner_username, COUNT(q.id) AS question_count
    FROM exams e JOIN users u ON u.id = e.owner_id
    LEFT JOIN questions q ON q.exam_id = e.id
    GROUP BY e.id ORDER BY e.created_at DESC
  `).all()
  return json(results.map((row) => ({ ...row, question_count: Number(row.question_count) })))
}

async function getExam(env, examId, includeAnswers) {
  const exam = await env.DB.prepare(
    'SELECT id, owner_id, title, description, image_url, time_limit_seconds, created_at FROM exams WHERE id = ?',
  ).bind(examId).first()
  if (!exam) return json({ detail: 'Không tìm thấy bài thi' }, 404)
  const { results } = await env.DB.prepare(
    'SELECT id, type, text, options, correct, explanation, order_index FROM questions WHERE exam_id = ? ORDER BY order_index, id',
  ).bind(examId).all()
  exam.questions = results.map((q) => questionOut(q, includeAnswers))
  return json(exam)
}

async function getExamFull(request, env, examId) {
  const user = await requireUser(request, env)
  if (user.response) return user.response
  const exam = await env.DB.prepare('SELECT owner_id FROM exams WHERE id = ?').bind(examId).first()
  if (!exam) return json({ detail: 'Không tìm thấy bài thi' }, 404)
  if (exam.owner_id !== user.id) return json({ detail: 'Bạn không có quyền sửa bài thi này' }, 403)
  return getExam(env, examId, true)
}

async function createExam(request, env) {
  const user = await requireUser(request, env)
  if (user.response) return user.response
  const body = await readJson(request)
  const error = validateExam(body, false)
  if (error) return json({ detail: error }, 422)
  const result = await env.DB.prepare(
    'INSERT INTO exams (owner_id, title, description, image_url, time_limit_seconds) VALUES (?, ?, ?, ?, ?)',
  ).bind(user.id, body.title.trim(), nullable(body.description), nullable(body.image_url), positiveOrNull(body.time_limit_seconds)).run()
  await replaceQuestions(env, Number(result.meta.last_row_id), body.questions || [])
  return getExamWithStatus(env, Number(result.meta.last_row_id), true, 201)
}

async function updateExam(request, env, examId) {
  const user = await requireUser(request, env)
  if (user.response) return user.response
  const exam = await env.DB.prepare('SELECT * FROM exams WHERE id = ?').bind(examId).first()
  if (!exam) return json({ detail: 'Không tìm thấy bài thi' }, 404)
  if (exam.owner_id !== user.id) return json({ detail: 'Bạn không có quyền sửa bài thi này' }, 403)
  const body = await readJson(request)
  const error = validateExam(body, true)
  if (error) return json({ detail: error }, 422)

  const title = body.title === undefined ? exam.title : body.title.trim()
  const description = body.description === undefined ? exam.description : nullable(body.description)
  const imageUrl = body.image_url === undefined ? exam.image_url : nullable(body.image_url)
  const timeLimit = body.time_limit_seconds === undefined ? exam.time_limit_seconds : positiveOrNull(body.time_limit_seconds)
  await env.DB.prepare(`
    UPDATE exams SET title = ?, description = ?, image_url = ?, time_limit_seconds = ?,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?
  `).bind(title, description, imageUrl, timeLimit, examId).run()
  if (body.questions !== undefined) await replaceQuestions(env, examId, body.questions)
  return getExam(env, examId, true)
}

async function deleteExam(request, env, examId) {
  const user = await requireUser(request, env)
  if (user.response) return user.response
  const exam = await env.DB.prepare('SELECT owner_id FROM exams WHERE id = ?').bind(examId).first()
  if (!exam) return json({ detail: 'Không tìm thấy bài thi' }, 404)
  if (exam.owner_id !== user.id) return json({ detail: 'Bạn không có quyền xóa bài thi này' }, 403)
  await env.DB.prepare('DELETE FROM exams WHERE id = ?').bind(examId).run()
  return new Response(null, { status: 204, headers: corsHeaders() })
}

async function submitExam(request, env, examId) {
  const user = await requireUser(request, env)
  if (user.response) return user.response
  const body = await readJson(request)
  if (!body) return invalidJson()
  const exam = await env.DB.prepare('SELECT id, title FROM exams WHERE id = ?').bind(examId).first()
  if (!exam) return json({ detail: 'Không tìm thấy bài thi' }, 404)
  const { results: questions } = await env.DB.prepare(
    'SELECT id, text, correct, explanation FROM questions WHERE exam_id = ? ORDER BY order_index, id',
  ).bind(examId).all()
  const answerMap = new Map((Array.isArray(body.answers) ? body.answers : []).map((a) => [Number(a.question_id), new Set(a.selected || [])]))
  let score = 0
  const detail = questions.map((q) => {
    const correct = parseArray(q.correct).sort()
    const selected = [...(answerMap.get(q.id) || [])].map(String).sort()
    const isCorrect = selected.length > 0 && arraysEqual(selected, correct)
    if (isCorrect) score += 1
    return { question_id: q.id, text: q.text, selected, correct, is_correct: isCorrect, explanation: q.explanation }
  })
  const total = questions.length
  const percentage = total ? Math.round((score / total) * 1000) / 10 : 0
  const duration = Math.max(0, Number(body.duration_seconds) || 0)
  const result = await env.DB.prepare(`
    INSERT INTO attempts (user_id, exam_id, score, total, percentage, duration_seconds, detail)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(user.id, examId, score, total, percentage, duration, JSON.stringify(detail)).run()
  const created = await env.DB.prepare('SELECT created_at FROM attempts WHERE id = ?').bind(result.meta.last_row_id).first()
  return json({ id: result.meta.last_row_id, exam_id: examId, exam_title: exam.title, score, total, percentage, duration_seconds: duration, created_at: created.created_at, detail })
}

async function listAttempts(request, env) {
  const user = await requireUser(request, env)
  if (user.response) return user.response
  const { results } = await env.DB.prepare(`
    SELECT a.id, a.exam_id, COALESCE(e.title, '(Đã xóa)') AS exam_title, a.score, a.total,
           a.percentage, a.duration_seconds, a.created_at
    FROM attempts a LEFT JOIN exams e ON e.id = a.exam_id
    WHERE a.user_id = ? ORDER BY a.created_at DESC
  `).bind(user.id).all()
  return json(results)
}

async function getAttempt(request, env, attemptId) {
  const user = await requireUser(request, env)
  if (user.response) return user.response
  const row = await env.DB.prepare(`
    SELECT a.*, COALESCE(e.title, '(Đã xóa)') AS exam_title
    FROM attempts a LEFT JOIN exams e ON e.id = a.exam_id WHERE a.id = ?
  `).bind(attemptId).first()
  if (!row) return json({ detail: 'Không tìm thấy lịch sử làm bài' }, 404)
  if (row.user_id !== user.id) return json({ detail: 'Không có quyền xem' }, 403)
  return json({ id: row.id, exam_id: row.exam_id, exam_title: row.exam_title, score: row.score, total: row.total, percentage: row.percentage, duration_seconds: row.duration_seconds, created_at: row.created_at, detail: parseArray(row.detail) })
}

async function replaceQuestions(env, examId, questions) {
  await env.DB.prepare('DELETE FROM questions WHERE exam_id = ?').bind(examId).run()
  if (!questions.length) return
  await env.DB.batch(questions.map((q, index) => env.DB.prepare(`
    INSERT INTO questions (exam_id, type, text, options, correct, explanation, order_index)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(examId, q.type || 'single', q.text.trim(), JSON.stringify(q.options), JSON.stringify(q.correct), nullable(q.explanation), Number.isInteger(q.order_index) ? q.order_index : index)))
}

function validateExam(body, partial) {
  if (!body || typeof body !== 'object') return 'Dữ liệu không hợp lệ'
  if (!partial || body.title !== undefined) {
    if (typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 200) return 'Tiêu đề phải dài 1–200 ký tự'
  }
  if (body.time_limit_seconds != null && Number(body.time_limit_seconds) < 0) return 'Thời gian không hợp lệ'
  if (body.questions !== undefined) {
    if (!Array.isArray(body.questions)) return 'Danh sách câu hỏi không hợp lệ'
    for (const q of body.questions) {
      if (!q || !['single', 'multiple'].includes(q.type || 'single') || typeof q.text !== 'string' || !q.text.trim()) return 'Câu hỏi không hợp lệ'
      if (!Array.isArray(q.options) || q.options.length < 2 || !Array.isArray(q.correct) || !q.correct.length) return 'Mỗi câu hỏi cần ít nhất 2 lựa chọn và 1 đáp án đúng'
      const keys = q.options.map((o) => String(o.key || ''))
      if (new Set(keys).size !== keys.length || q.correct.some((key) => !keys.includes(key))) return 'Lựa chọn hoặc đáp án đúng không hợp lệ'
      if ((q.type || 'single') === 'single' && q.correct.length !== 1) return 'Câu hỏi chọn 1 chỉ được có một đáp án đúng'
    }
  }
  return null
}

async function getExamWithStatus(env, id, answers, status) {
  const response = await getExam(env, id, answers)
  return new Response(response.body, { status, headers: response.headers })
}

function questionOut(row, includeAnswers) {
  const result = { id: row.id, type: row.type, text: row.text, options: parseArray(row.options), order_index: row.order_index }
  if (includeAnswers) {
    result.correct = parseArray(row.correct)
    result.explanation = row.explanation
  }
  return result
}

async function requireUser(request, env) {
  const auth = request.headers.get('Authorization') || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  const payload = token && await verifyToken(token, env.SECRET_KEY)
  if (!payload?.sub) return { response: json({ detail: 'Không thể xác thực' }, 401) }
  const user = await env.DB.prepare('SELECT id, username, display_name, created_at FROM users WHERE id = ?').bind(Number(payload.sub)).first()
  return user || { response: json({ detail: 'Người dùng không tồn tại' }, 401) }
}

async function authPayload(user, env) {
  return { access_token: await signToken({ sub: String(user.id) }, env.SECRET_KEY), token_type: 'bearer', user: publicUser(user) }
}

function publicUser(user) {
  return { id: user.id, username: user.username, display_name: user.display_name, created_at: user.created_at }
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iterations = 100000
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256)
  return `pbkdf2$${iterations}$${base64url(salt)}$${base64url(new Uint8Array(bits))}`
}

async function verifyPassword(password, stored) {
  const [scheme, count, saltText, hashText] = String(stored || '').split('$')
  if (scheme !== 'pbkdf2' || !count || !saltText || !hashText) return false
  const salt = fromBase64url(saltText)
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: Number(count) }, key, 256))
  const expected = fromBase64url(hashText)
  return bits.length === expected.length && bits.every((byte, index) => byte === expected[index])
}

async function signToken(payload, secret) {
  const now = Math.floor(Date.now() / 1000)
  const header = base64url(encoder.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const body = base64url(encoder.encode(JSON.stringify({ ...payload, iat: now, exp: now + 7 * 86400 })))
  const data = `${header}.${body}`
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data))
  return `${data}.${base64url(new Uint8Array(signature))}`
}

async function verifyToken(token, secret) {
  try {
    const [header, body, signature] = token.split('.')
    if (!header || !body || !signature || !secret) return null
    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
    const ok = await crypto.subtle.verify('HMAC', key, fromBase64url(signature), encoder.encode(`${header}.${body}`))
    const payload = JSON.parse(new TextDecoder().decode(fromBase64url(body)))
    return ok && payload.exp > Date.now() / 1000 ? payload : null
  } catch { return null }
}

function base64url(bytes) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4))
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

function parseArray(value) {
  try { const result = typeof value === 'string' ? JSON.parse(value) : value; return Array.isArray(result) ? result : [] } catch { return [] }
}

function arraysEqual(a, b) { return a.length === b.length && a.every((value, index) => value === b[index]) }
function nullable(value) { return value == null || String(value).trim() === '' ? null : String(value).trim() }
function positiveOrNull(value) { const number = Number(value); return Number.isFinite(number) && number > 0 ? Math.floor(number) : null }
async function readJson(request) { try { return await request.json() } catch { return null } }
function invalidJson() { return json({ detail: 'JSON không hợp lệ' }, 400) }
function corsHeaders() { return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS' } }
function json(data, status = 200) { return Response.json(data, { status, headers: corsHeaders() }) }
