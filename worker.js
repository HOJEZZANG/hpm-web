const ALLOWED_ORIGIN = 'https://hojezzang.github.io';
const API_ORIGIN = 'https://hpmanagement-web.lotusland1995.workers.dev';
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Expose-Headers': 'ETag',
  'Vary': 'Origin',
};
class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: {
    ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
  } });
}
function array(value) {
  try { const parsed = typeof value === 'string' ? JSON.parse(value) : value; return Array.isArray(parsed) ? parsed : []; }
  catch { return []; }
}
const fields = {
  id: 'id', issueNo: 'issue_no', occurDate: 'occur_date', registerDate: 'register_date',
  product: 'product', projectNo: 'project_no', processPnd: 'process_pnd', deliveryDate: 'delivery_date',
  process: 'process', issueType: 'issue_type', title: 'title', description: 'description',
  finder: 'finder', reporter: 'reporter', reporterId: 'reporter_id', responsibleDept: 'responsible_dept',
  status: 'status', priority: 'priority', dueDate: 'due_date', feedbackOwner: 'feedback_owner',
  causeFeedback: 'cause_feedback', actionDetail: 'action_detail', completedDate: 'completed_date',
  verifier: 'verifier', prevention: 'prevention', createdAt: 'created_at', updatedAt: 'updated_at',
};
function bool(value) { return value === true || value === 1 || value === '1' || value === 'true'; }
function validId(id) { return typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id); }
function validKey(key) {
  return typeof key === 'string' && /^issues\/[A-Za-z0-9_-]{1,128}\/(before|after)\/[A-Za-z0-9_-]{1,128}\.(jpg|jpeg|png|webp)$/.test(key);
}
function photoKey(value) {
  if (validKey(value)) return value;
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value, API_ORIGIN);
    if (url.origin !== API_ORIGIN || url.search || url.hash || !url.pathname.startsWith('/api/photos/')) return null;
    const key = decodeURIComponent(url.pathname.slice('/api/photos/'.length));
    return validKey(key) ? key : null;
  } catch { return null; }
}
function photoUrl(key) { return API_ORIGIN + '/api/photos/' + key; }
function readablePhotos(value) {
  return array(value).flatMap(item => {
    const key = photoKey(item);
    if (key) return [photoUrl(key)];
    // Legacy inline photos are readable but cannot be written back to D1.
    return typeof item === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=\s]+$/.test(item) ? [item] : [];
  });
}
function toIssue(row) {
  const issue = {};
  for (const [camel, snake] of Object.entries(fields)) issue[camel] = String(row[snake] ?? row[camel] ?? '');
  issue.registerDate ||= issue.occurDate;
  issue.product ||= '미분류'; issue.status ||= '접수'; issue.priority ||= '보통';
  issue.updatedAt ||= issue.createdAt;
  if (/^조립[123]$/.test(issue.process)) issue.process = '조립';
  issue.followupFlag = bool(row.followup_flag ?? row.followupFlag);
  issue.sample = bool(row.sample);
  issue.images = readablePhotos(row.images);
  issue.afterImages = readablePhotos(row.after_images ?? row.afterImages);
  issue.history = array(row.history).filter(h => h && typeof h === 'object' && !Array.isArray(h)).map(h => ({
    at: String(h.at ?? ''), actor: String(h.actor ?? ''), status: String(h.status ?? ''), note: String(h.note ?? ''),
  }));
  return issue;
}
async function readLimited(request, maxBytes) {
  if (Number(request.headers.get('Content-Length')) > maxBytes) throw new ApiError(413, '요청 용량이 너무 큽니다.');
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, '요청 본문이 필요합니다.');
  const chunks = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); throw new ApiError(413, '요청 용량이 너무 큽니다.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
async function readJson(request) {
  if (!request.headers.get('Content-Type')?.includes('application/json')) throw new ApiError(400, 'JSON 요청이 필요합니다.');
  const bytes = await readLimited(request, 1024 * 1024);
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new ApiError(400, '올바른 JSON 형식이 아닙니다.'); }
}
function validateIssue(body, id) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || !validId(id) || (body.id !== undefined && body.id !== id)) {
    throw new ApiError(400, '문제점 ID 또는 데이터 형식이 올바르지 않습니다.');
  }
  const issue = {};
  for (const camel of Object.keys(fields)) {
    const value = body[camel] ?? '';
    if (typeof value !== 'string' || value.length > 20000) throw new ApiError(400, camel + ' 값이 올바르지 않습니다.');
    issue[camel] = value;
  }
  if (!issue.title.trim()) throw new ApiError(400, '문제점 제목이 필요합니다.');
  issue.id = id;
  issue.followupFlag = bool(body.followupFlag); issue.sample = bool(body.sample);
  for (const name of ['images', 'afterImages']) {
    const photos = body[name] ?? [];
    if (!Array.isArray(photos) || photos.length > 3 || photos.some(p => !photoKey(p))) {
      throw new ApiError(400, '사진은 항목별 최대 3개의 Worker 사진 주소여야 합니다.');
    }
    issue[name] = photos.map(photoKey);
  }
  const history = body.history ?? [];
  if (!Array.isArray(history) || history.length > 2000 || history.some(h => !h || typeof h !== 'object' || Array.isArray(h))) {
    throw new ApiError(400, '이력 형식이 올바르지 않습니다.');
  }
  issue.history = history.map(h => {
    const entry = {};
    for (const key of ['at', 'status', 'actor', 'note']) {
      if (h[key] != null && (typeof h[key] !== 'string' || h[key].length > 20000)) throw new ApiError(400, '이력 값이 올바르지 않습니다.');
      entry[key] = h[key] || '';
    }
    return entry;
  });
  return issue;
}
const UPSERT_ISSUE = `INSERT INTO issues (
  id, issue_no, occur_date, register_date, product, project_no, process_pnd, delivery_date,
  process, issue_type, title, description, finder, reporter, reporter_id, responsible_dept,
  status, priority, due_date, feedback_owner, cause_feedback, action_detail, completed_date,
  verifier, prevention, followup_flag, images, after_images, created_at, updated_at, history, sample
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  issue_no=excluded.issue_no, occur_date=excluded.occur_date, register_date=excluded.register_date,
  product=excluded.product, project_no=excluded.project_no, process_pnd=excluded.process_pnd,
  delivery_date=excluded.delivery_date, process=excluded.process, issue_type=excluded.issue_type,
  title=excluded.title, description=excluded.description, finder=excluded.finder,
  reporter=excluded.reporter, reporter_id=excluded.reporter_id, responsible_dept=excluded.responsible_dept,
  status=excluded.status, priority=excluded.priority, due_date=excluded.due_date,
  feedback_owner=excluded.feedback_owner, cause_feedback=excluded.cause_feedback,
  action_detail=excluded.action_detail, completed_date=excluded.completed_date,
  verifier=excluded.verifier, prevention=excluded.prevention, followup_flag=excluded.followup_flag,
  images=excluded.images, after_images=excluded.after_images, updated_at=excluded.updated_at,
  history=excluded.history, sample=excluded.sample`;
const UPSERT_ISSUE_WITH_PAYLOAD = `INSERT INTO issues (
  id, issue_no, occur_date, register_date, product, project_no, process_pnd, delivery_date,
  process, issue_type, title, description, finder, reporter, reporter_id, responsible_dept,
  status, priority, due_date, feedback_owner, cause_feedback, action_detail, completed_date,
  verifier, prevention, followup_flag, images, after_images, created_at, updated_at, history, sample, payload
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  issue_no=excluded.issue_no, occur_date=excluded.occur_date, register_date=excluded.register_date,
  product=excluded.product, project_no=excluded.project_no, process_pnd=excluded.process_pnd,
  delivery_date=excluded.delivery_date, process=excluded.process, issue_type=excluded.issue_type,
  title=excluded.title, description=excluded.description, finder=excluded.finder,
  reporter=excluded.reporter, reporter_id=excluded.reporter_id, responsible_dept=excluded.responsible_dept,
  status=excluded.status, priority=excluded.priority, due_date=excluded.due_date,
  feedback_owner=excluded.feedback_owner, cause_feedback=excluded.cause_feedback,
  action_detail=excluded.action_detail, completed_date=excluded.completed_date,
  verifier=excluded.verifier, prevention=excluded.prevention, followup_flag=excluded.followup_flag,
  images=excluded.images, after_images=excluded.after_images, updated_at=excluded.updated_at,
  history=excluded.history, sample=excluded.sample, payload=excluded.payload`;
function rowPhotoKeys(row) {
  return [...array(row?.images), ...array(row?.after_images ?? row?.afterImages)].map(photoKey).filter(Boolean);
}
async function referencedKeys(env) {
  const { results } = await env.DB.prepare('SELECT images, after_images FROM issues').all();
  return new Set(results.flatMap(rowPhotoKeys));
}
async function cleanupPhotos(env, candidates) {
  if (!candidates.length) return true;
  try {
    const referenced = await referencedKeys(env);
    for (const key of new Set(candidates)) if (!referenced.has(key)) await env.PHOTOS.delete(key);
    return true;
  } catch { console.error('Photo cleanup failed; unreferenced objects may remain.'); return false; }
}
async function saveIssue(request, env, id) {
  const issue = validateIssue(await readJson(request), id);
  const old = await env.DB.prepare('SELECT * FROM issues WHERE id = ?').bind(id).first();
  for (const key of new Set([...issue.images, ...issue.afterImages])) {
    if (!await env.PHOTOS.head(key)) throw new ApiError(400, '사진이 존재하지 않습니다. 사진을 다시 선택하세요.');
  }
  const now = new Date().toISOString();
  const created = old?.created_at ?? (issue.createdAt && Number.isFinite(Date.parse(issue.createdAt)) ? new Date(issue.createdAt).toISOString() : now);
  const columns = await env.DB.prepare('PRAGMA table_info(issues)').all();
  const hasLegacyPayload = columns.results.some(column => column.name === 'payload');
  const values = [
    id, issue.issueNo, issue.occurDate, issue.registerDate || issue.occurDate, issue.product,
    issue.projectNo, issue.processPnd, issue.deliveryDate, issue.process, issue.issueType, issue.title,
    issue.description, issue.finder, issue.reporter, issue.reporterId, issue.responsibleDept,
    issue.status || '접수', issue.priority || '보통', issue.dueDate, issue.feedbackOwner, issue.causeFeedback,
    issue.actionDetail, issue.completedDate, issue.verifier, issue.prevention, Number(issue.followupFlag),
    JSON.stringify(issue.images), JSON.stringify(issue.afterImages), created, now,
    JSON.stringify(issue.history), Number(issue.sample),
  ];
  // Older installations require payload; retain the column and supply normalized JSON.
  if (hasLegacyPayload) values.push(JSON.stringify({ ...issue, createdAt: created, updatedAt: now }));
  await env.DB.prepare(hasLegacyPayload ? UPSERT_ISSUE_WITH_PAYLOAD : UPSERT_ISSUE).bind(...values).run();
  const photosCleaned = await cleanupPhotos(env, rowPhotoKeys(old));
  return json({ ok: true, issue: toIssue({ ...issue, created_at: created, updated_at: now }), photosCleaned });
}
async function deleteIssues(env, ids) {
  const rows = [];
  for (const id of ids) {
    const row = await env.DB.prepare('SELECT * FROM issues WHERE id = ?').bind(id).first();
    if (row) rows.push(row);
  }
  // Commit D1 first: a database failure must not leave live records with missing photos.
  // D1 batch is transactional; cleanup checks every remaining reference.
  await env.DB.batch(ids.map(id => env.DB.prepare('DELETE FROM issues WHERE id = ?').bind(id)));
  const photosCleaned = await cleanupPhotos(env, rows.flatMap(rowPhotoKeys));
  return json({ ok: true, deleted: rows.length, ids, photosCleaned });
}
function imageType(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return ['image/jpeg', 'jpg'];
  if ([137,80,78,71,13,10,26,10].every((b, i) => bytes[i] === b)) return ['image/png', 'png'];
  const head = new TextDecoder().decode(bytes.slice(0, 12));
  if (head.startsWith('RIFF') && head.slice(8) === 'WEBP') return ['image/webp', 'webp'];
  return null;
}
async function uploadPhoto(request, env) {
  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.startsWith('multipart/form-data')) throw new ApiError(400, '사진 업로드 형식이 올바르지 않습니다.');
  const bytes = await readLimited(request, MAX_PHOTO_BYTES + 65536);
  let form;
  try { form = await new Response(bytes, { headers: { 'Content-Type': contentType } }).formData(); }
  catch { throw new ApiError(400, '사진 업로드 형식이 올바르지 않습니다.'); }
  const file = form.get('file'), id = form.get('issueId'), category = form.get('category');
  if (!(file instanceof File) || !validId(id) || !['before', 'after'].includes(category)) throw new ApiError(400, '파일, 문제점 ID, 사진 구분을 확인하세요.');
  if (file.size > MAX_PHOTO_BYTES) throw new ApiError(413, '사진은 5MB 이하로 업로드하세요.');
  const data = new Uint8Array(await file.arrayBuffer());
  const detected = imageType(data);
  if (!detected || file.type !== detected[0]) throw new ApiError(400, 'JPEG, PNG, WebP 이미지 파일만 업로드할 수 있습니다.');
  const key = 'issues/' + id + '/' + category + '/' + crypto.randomUUID() + '.' + detected[1];
  await env.PHOTOS.put(key, data, { httpMetadata: { contentType: detected[0] }, customMetadata: { issueId: id, category } });
  return json({ ok: true, key, url: photoUrl(key), contentType: detected[0] }, 201);
}
const calendarDefinitions = {
  'as-events': {
    fields: ['id', 'startDate', 'endDate', 'yard', 'hullNo', 'asType', 'asDetail', 'workerInfo', 'carInfo', 'memo', 'createdById', 'createdByName', 'createdAt', 'updatedAt'],
    required: ['yard', 'asType', 'carInfo'],
    list: 'SELECT * FROM as_events ORDER BY start_date, end_date, id',
    get: 'SELECT * FROM as_events WHERE id = ?',
    remove: 'DELETE FROM as_events WHERE id = ?',
    upsert: `INSERT INTO as_events (
      id, start_date, end_date, yard, hull_no, as_type, as_detail, worker_info, car_info, memo,
      created_by_id, created_by_name, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      start_date=excluded.start_date, end_date=excluded.end_date, yard=excluded.yard,
      hull_no=excluded.hull_no, as_type=excluded.as_type, as_detail=excluded.as_detail,
      worker_info=excluded.worker_info, car_info=excluded.car_info, memo=excluded.memo,
      updated_at=excluded.updated_at
    RETURNING *`,
  },
  'team-events': {
    fields: ['id', 'startDate', 'endDate', 'startTime', 'endTime', 'teamType', 'title', 'members', 'location', 'detail', 'createdById', 'createdByName', 'createdAt', 'updatedAt'],
    required: ['teamType', 'title'],
    list: 'SELECT * FROM team_events ORDER BY start_date, start_time, end_date, id',
    get: 'SELECT * FROM team_events WHERE id = ?',
    remove: 'DELETE FROM team_events WHERE id = ?',
    upsert: `INSERT INTO team_events (
      id, start_date, end_date, start_time, end_time, team_type, title, members, location, detail,
      created_by_id, created_by_name, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      start_date=excluded.start_date, end_date=excluded.end_date,
      start_time=excluded.start_time, end_time=excluded.end_time, team_type=excluded.team_type,
      title=excluded.title, members=excluded.members, location=excluded.location, detail=excluded.detail,
      updated_at=excluded.updated_at
    RETURNING *`,
  },
};
function calendarToClient(row, definition) {
  const event = {};
  for (const name of definition.fields) {
    const column = name.replace(/[A-Z]/g, letter => '_' + letter.toLowerCase());
    event[name] = String(row[column] ?? '');
  }
  return event;
}
function validCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
async function calendarApi(request, env, collection, id) {
  if (!env.DB) throw new ApiError(503, '데이터베이스 연결을 확인하세요.');
  const definition = calendarDefinitions[collection];
  if (!id && request.method === 'GET') {
    const { results } = await env.DB.prepare(definition.list).all();
    return json({ ok: true, events: results.map(row => calendarToClient(row, definition)) });
  }
  if (!validId(id)) throw new ApiError(400, '일정 ID가 올바르지 않습니다.');
  if (request.method === 'DELETE') {
    const result = await env.DB.prepare(definition.remove).bind(id).run();
    return json({ ok: true, id, deleted: result.meta?.changes > 0 });
  }
  const body = await readJson(request);
  if (!body || typeof body !== 'object' || Array.isArray(body) || (body.id !== undefined && body.id !== id)) {
    throw new ApiError(400, '일정 데이터 또는 ID가 올바르지 않습니다.');
  }
  const event = {};
  for (const name of definition.fields) {
    const value = body[name] ?? '';
    if (typeof value !== 'string' || value.length > 20000) throw new ApiError(400, '일정의 ' + name + ' 값을 확인하세요.');
    event[name] = value;
  }
  event.id = id;
  if (!validCalendarDate(event.startDate) || !validCalendarDate(event.endDate) || event.endDate < event.startDate) {
    throw new ApiError(400, '시작일과 종료일을 올바르게 입력하세요.');
  }
  if (definition.required.some(name => !event[name].trim())) throw new ApiError(400, '일정 필수 항목을 입력하세요.');
  if (collection === 'team-events') {
    for (const name of ['startTime', 'endTime']) {
      if (event[name] && !/^([01]\d|2[0-3]):[0-5]\d$/.test(event[name])) throw new ApiError(400, '시간 형식이 올바르지 않습니다.');
    }
    if (!!event.startTime !== !!event.endTime ||
        (event.startDate === event.endDate && event.startTime && event.endTime <= event.startTime)) {
      throw new ApiError(400, '종료시간은 시작시간보다 늦어야 합니다.');
    }
  }
  const now = new Date().toISOString();
  if (event.createdAt && !Number.isFinite(Date.parse(event.createdAt))) throw new ApiError(400, '등록 시각이 올바르지 않습니다.');
  event.createdAt = event.createdAt ? new Date(event.createdAt).toISOString() : now;
  event.updatedAt = now;
  // Import old browser backups without overwriting a newer shared record, including on retry.
  const importOnly = new URL(request.url).searchParams.get('migration') === '1';
  const sql = importOnly
    ? definition.upsert.split('ON CONFLICT(id)')[0] + 'ON CONFLICT(id) DO NOTHING RETURNING *'
    : definition.upsert;
  let saved = await env.DB.prepare(sql).bind(...definition.fields.map(name => event[name])).first();
  if (!saved && importOnly) saved = await env.DB.prepare(definition.get).bind(id).first();
  if (!saved) throw new ApiError(409, '일정이 변경되었습니다. 다시 불러온 뒤 재시도하세요.');
  return json({ ok: true, event: calendarToClient(saved, definition) });
}
async function route(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  const url = new URL(request.url), method = request.method;
  // CORS is not authentication. Existing browser accounts do not authenticate API calls.
  const origin = request.headers.get('Origin');
  if (origin && origin !== ALLOWED_ORIGIN && !['GET', 'HEAD'].includes(method)) throw new ApiError(403, '허용되지 않은 요청 출처입니다.');
  if (method === 'GET' && url.pathname === '/api/health') {
    let database = false;
    try { database = !!env.DB && (await env.DB.prepare('SELECT 1 AS ok').first())?.ok === 1; } catch {}
    const photos = !!env.PHOTOS;
    return json({ ok: database && photos, database, photos }, database && photos ? 200 : 503);
  }
  const calendarMatch = url.pathname.match(/^\/api\/(as-events|team-events)(?:\/([^/]+))?$/);
  if (calendarMatch && ((!calendarMatch[2] && method === 'GET') || (calendarMatch[2] && ['PUT', 'DELETE'].includes(method)))) {
    return calendarApi(request, env, calendarMatch[1], calendarMatch[2]);
  }
  if (url.pathname.startsWith('/api/photos/') && ['GET', 'DELETE'].includes(method)) {
    if (!env.PHOTOS) throw new ApiError(503, '사진 저장소 연결을 확인하세요.');
    let key;
    try { key = decodeURIComponent(url.pathname.slice('/api/photos/'.length)); } catch { throw new ApiError(400, '사진 경로가 올바르지 않습니다.'); }
    if (!validKey(key)) throw new ApiError(400, '사진 경로가 올바르지 않습니다.');
    if (method === 'DELETE') {
      if (!env.DB) throw new ApiError(503, '데이터베이스 연결을 확인하세요.');
      if ((await referencedKeys(env)).has(key)) return json({ ok: true, deleted: false, reason: 'referenced' });
      await env.PHOTOS.delete(key);
      return json({ ok: true, deleted: true });
    }
    const object = await env.PHOTOS.get(key);
    if (!object) throw new ApiError(404, '사진을 찾을 수 없습니다.');
    const headers = new Headers(corsHeaders);
    object.writeHttpMetadata(headers);
    headers.set('ETag', object.httpEtag);
    headers.set('Cache-Control', 'private, max-age=300, must-revalidate');
    headers.set('X-Content-Type-Options', 'nosniff');
    if (request.headers.get('If-None-Match') === object.httpEtag) return new Response(null, { status: 304, headers });
    return new Response(object.body, { headers });
  }
  if (url.pathname === '/api/issues' && method === 'GET') {
    if (!env.DB) throw new ApiError(503, '데이터베이스 연결을 확인하세요.');
    const { results } = await env.DB.prepare("SELECT * FROM issues ORDER BY COALESCE(NULLIF(updated_at, ''), created_at, '') DESC, id DESC").all();
    return json({ ok: true, issues: results.map(toIssue) });
  }
  const issueMatch = url.pathname.match(/^\/api\/issues\/([A-Za-z0-9_-]{1,128})$/);
  if ((url.pathname === '/api/photos' && method === 'POST') ||
      (url.pathname === '/api/issues/bulk-delete' && method === 'POST') ||
      (issueMatch && ['PUT', 'DELETE'].includes(method))) {
    if (!env.DB || !env.PHOTOS) throw new ApiError(503, 'DB 및 PHOTOS 연결을 확인하세요.');
    if (url.pathname === '/api/photos') return uploadPhoto(request, env);
    if (method === 'POST') {
      const body = await readJson(request);
      if (!Array.isArray(body?.ids) || !body.ids.length || body.ids.length > 100 || body.ids.some(id => !validId(id))) {
        throw new ApiError(400, '삭제할 ID를 1~100개 지정하세요.');
      }
      return deleteIssues(env, [...new Set(body.ids)]);
    }
    return method === 'PUT' ? saveIssue(request, env, issueMatch[1]) : deleteIssues(env, [issueMatch[1]]);
  }
  throw new ApiError(404, '요청한 API를 찾을 수 없습니다.');
}
export default {
  async fetch(request, env) {
    try { return await route(request, env); }
    catch (error) {
      if (error instanceof ApiError) return json({ ok: false, error: error.message }, error.status);
      console.error('Worker request failed. Check database schema and storage bindings.');
      return json({ ok: false, error: '서버 처리 중 오류가 발생했습니다. 잠시 후 다시 시도하세요.' }, 500);
    }
  },
};
