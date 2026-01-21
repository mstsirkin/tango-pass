const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Token, X-Admin-Token-Encoded'
};

function jsonResponse(status, data) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function parseUrl(request) {
  const url = new URL(request.url);
  return { url, path: url.pathname, params: url.searchParams };
}

function nowIso() {
  return new Date().toISOString();
}

function addMonthsUtc(date, months) {
  const d = new Date(date.getTime());
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

function addDaysUtc(date, days) {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

async function readJson(request) {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) return null;
  return await request.json();
}

async function requireAdmin(request, env) {
  const headerToken = request.headers.get('x-admin-token');
  const headerEncoded = request.headers.get('x-admin-token-encoded');
  const url = new URL(request.url);
  const queryToken = url.searchParams.get('adminToken');
  let token = headerToken || queryToken;
  if (!token && headerEncoded) {
    try {
      token = decodeURIComponent(headerEncoded);
    } catch (err) {
      return false;
    }
  }
  if (!token || token !== env.ADMIN_TOKEN) {
    return false;
  }
  return true;
}

async function getStudentByToken(db, token) {
  return await db.prepare('SELECT * FROM students WHERE token = ?').bind(token).first();
}

async function getNextLesson(db, now) {
  return await db.prepare(
    'SELECT * FROM lesson_events WHERE starts_at >= ? ORDER BY starts_at ASC LIMIT 1'
  ).bind(now).first();
}

async function getBalance(db, studentId) {
  const row = await db.prepare(
    'SELECT balance_after FROM ledger_events WHERE student_id = ? ORDER BY id DESC LIMIT 1'
  ).bind(studentId).first();
  return row ? row.balance_after : 0;
}

async function appendLedger(db, studentId, type, delta, refLotId, refLessonId) {
  const currentBalance = await getBalance(db, studentId);
  const nextBalance = currentBalance + delta;
  await db.prepare(
    'INSERT INTO ledger_events (student_id, ts, type, delta_credits, balance_after, ref_lot_id, ref_lesson_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(studentId, nowIso(), type, delta, nextBalance, refLotId || null, refLessonId || null).run();
  return nextBalance;
}

async function expireLots(db, studentId, now) {
  const expiring = await db.prepare(
    'SELECT id, credits_remaining FROM lots WHERE student_id = ? AND expires_at <= ? AND credits_remaining > 0 ORDER BY expires_at ASC, id ASC'
  ).bind(studentId, now).all();

  if (!expiring.results.length) return;

  for (const lot of expiring.results) {
    await db.prepare('UPDATE lots SET credits_remaining = 0 WHERE id = ?').bind(lot.id).run();
    if (lot.credits_remaining > 0) {
      await appendLedger(db, studentId, 'EXPIRE', -lot.credits_remaining, lot.id, null);
    }
  }

  const lastLotId = expiring.results[expiring.results.length - 1].id;
  await appendLedger(db, studentId, 'OLDEST', 0, lastLotId, null);
}

async function availableCredits(db, studentId, now) {
  const row = await db.prepare(
    'SELECT COALESCE(SUM(credits_remaining), 0) AS credits FROM lots WHERE student_id = ? AND expires_at > ?'
  ).bind(studentId, now).first();
  return row ? row.credits : 0;
}

async function consumeCreditFIFO(db, studentId, now) {
  const lot = await db.prepare(
    'SELECT id, credits_remaining FROM lots WHERE student_id = ? AND expires_at > ? AND credits_remaining > 0 ORDER BY purchased_at ASC, id ASC LIMIT 1'
  ).bind(studentId, now).first();

  if (!lot) return null;

  await db.prepare('UPDATE lots SET credits_remaining = ? WHERE id = ?')
    .bind(lot.credits_remaining - 1, lot.id)
    .run();

  return lot;
}

async function restoreCredit(db, lotId, now) {
  const lot = await db.prepare('SELECT credits_remaining, credits_total, expires_at FROM lots WHERE id = ?')
    .bind(lotId).first();
  if (!lot) return { refunded: false };

  if (lot.expires_at <= now) {
    return { refunded: false };
  }

  const nextRemaining = Math.min(lot.credits_total, lot.credits_remaining + 1);
  if (nextRemaining === lot.credits_remaining) {
    return { refunded: false };
  }

  await db.prepare('UPDATE lots SET credits_remaining = ? WHERE id = ?')
    .bind(nextRemaining, lotId)
    .run();

  return { refunded: true };
}

function registrationOpen(lessonStartsAt, now) {
  if (!lessonStartsAt) return false;
  const start = new Date(lessonStartsAt).getTime();
  const cutoff = start - 2 * 60 * 60 * 1000;
  return new Date(now).getTime() < cutoff;
}

async function withTransaction(db, fn) {
  await db.exec('BEGIN');
  try {
    const result = await fn();
    await db.exec('COMMIT');
    return result;
  } catch (err) {
    await db.exec('ROLLBACK');
    throw err;
  }
}

async function handleStatus(request, env) {
  const { params } = parseUrl(request);
  const token = params.get('t');
  if (!token) return jsonResponse(400, { error: 'missing_token' });

  const student = await getStudentByToken(env.DB, token);
  if (!student) return jsonResponse(404, { error: 'student_not_found' });

  const now = nowIso();
  await withTransaction(env.DB, async () => {
    await expireLots(env.DB, student.id, now);
  });

  const nextLesson = await getNextLesson(env.DB, now);
  const reg = nextLesson
    ? await env.DB.prepare(
        'SELECT consumed_lot_id FROM registrations WHERE student_id = ? AND lesson_id = ?'
      ).bind(student.id, nextLesson.id).first()
    : null;

  const credits = await availableCredits(env.DB, student.id, now);
  const open = nextLesson ? registrationOpen(nextLesson.starts_at, now) : false;

  if (params.has('ledger')) {
    const includeAll = params.get('ledger') === 'all';
    let cutoffId = null;
    if (!includeAll) {
      const row = await env.DB.prepare(
        'SELECT id FROM ledger_events WHERE student_id = ? AND type = ? ORDER BY id DESC LIMIT 1'
      ).bind(student.id, 'OLDEST').first();
      cutoffId = row ? row.id : null;
    }

    const ledger = cutoffId
      ? await env.DB.prepare(
          'SELECT * FROM ledger_events WHERE student_id = ? AND id >= ? ORDER BY id ASC'
        ).bind(student.id, cutoffId).all()
      : await env.DB.prepare(
          'SELECT * FROM ledger_events WHERE student_id = ? ORDER BY id ASC'
        ).bind(student.id).all();

    return jsonResponse(200, {
      student: { id: student.id, name: student.name },
      credits_available: credits,
      next_lesson: nextLesson || null,
      registered: Boolean(reg),
      registered_lot_id: reg ? reg.consumed_lot_id : null,
      registration_open: open,
      ledger: ledger.results,
      ledger_cutoff_applied: Boolean(cutoffId)
    });
  }

  return jsonResponse(200, {
    student: { id: student.id, name: student.name },
    credits_available: credits,
    next_lesson: nextLesson || null,
    registered: Boolean(reg),
    registered_lot_id: reg ? reg.consumed_lot_id : null,
    registration_open: open
  });
}

async function handleRegister(request, env) {
  const { params } = parseUrl(request);
  const token = params.get('t');
  if (!token) return jsonResponse(400, { error: 'missing_token' });

  const student = await getStudentByToken(env.DB, token);
  if (!student) return jsonResponse(404, { error: 'student_not_found' });

  const now = nowIso();
  const nextLesson = await getNextLesson(env.DB, now);
  if (!nextLesson) return jsonResponse(400, { error: 'no_next_lesson' });

  if (!registrationOpen(nextLesson.starts_at, now)) {
    return jsonResponse(403, { error: 'registration_closed' });
  }

  return await withTransaction(env.DB, async () => {
    await expireLots(env.DB, student.id, now);

    const existing = await env.DB.prepare(
      'SELECT id FROM registrations WHERE student_id = ? AND lesson_id = ?'
    ).bind(student.id, nextLesson.id).first();

    if (existing) {
      return jsonResponse(200, { ok: true, already_registered: true });
    }

    const lot = await consumeCreditFIFO(env.DB, student.id, now);
    if (!lot) {
      return jsonResponse(400, { error: 'no_credits' });
    }

    await env.DB.prepare(
      'INSERT INTO registrations (student_id, lesson_id, consumed_lot_id, registered_at) VALUES (?, ?, ?, ?)'
    ).bind(student.id, nextLesson.id, lot.id, now).run();

    await appendLedger(env.DB, student.id, 'REGISTER', -1, lot.id, nextLesson.id);

    return jsonResponse(200, { ok: true, lot_id: lot.id });
  });
}

async function cancelRegistration(db, studentId, lessonId, allowLate, now) {
  const registration = await db.prepare(
    'SELECT id, consumed_lot_id FROM registrations WHERE student_id = ? AND lesson_id = ?'
  ).bind(studentId, lessonId).first();

  if (!registration) return { ok: true, not_registered: true };

  if (!allowLate) {
    const lesson = await db.prepare('SELECT starts_at FROM lesson_events WHERE id = ?')
      .bind(lessonId).first();
    if (!lesson) return { ok: false, error: 'lesson_not_found' };
    if (!registrationOpen(lesson.starts_at, now)) {
      return { ok: false, error: 'registration_closed' };
    }
  }

  await db.prepare('DELETE FROM registrations WHERE id = ?').bind(registration.id).run();
  const refund = await restoreCredit(db, registration.consumed_lot_id, now);
  if (refund.refunded) {
    await appendLedger(db, studentId, 'ADJUST', 1, registration.consumed_lot_id, lessonId);
  }
  return { ok: true, refunded: refund.refunded };
}

async function handleCancel(request, env) {
  const { params } = parseUrl(request);
  const token = params.get('t');
  if (!token) return jsonResponse(400, { error: 'missing_token' });

  const student = await getStudentByToken(env.DB, token);
  if (!student) return jsonResponse(404, { error: 'student_not_found' });

  const now = nowIso();
  const nextLesson = await getNextLesson(env.DB, now);
  if (!nextLesson) return jsonResponse(400, { error: 'no_next_lesson' });

  return await withTransaction(env.DB, async () => {
    await expireLots(env.DB, student.id, now);
    const result = await cancelRegistration(env.DB, student.id, nextLesson.id, false, now);
    if (!result.ok) return jsonResponse(403, { error: result.error });
    return jsonResponse(200, result);
  });
}

async function handleAddStudent(request, env) {
  const isAdmin = await requireAdmin(request, env);
  if (!isAdmin) return jsonResponse(403, { error: 'forbidden' });

  const body = await readJson(request);
  const name = body && body.name ? String(body.name).trim() : '';
  if (!name) return jsonResponse(400, { error: 'missing_name' });

  const tokenBytes = new Uint8Array(16);
  crypto.getRandomValues(tokenBytes);
  const token = Array.from(tokenBytes).map((b) => b.toString(16).padStart(2, '0')).join('');

  await env.DB.prepare(
    'INSERT INTO students (token, name, created_at) VALUES (?, ?, ?)'
  ).bind(token, name, nowIso()).run();

  const student = await env.DB.prepare('SELECT * FROM students WHERE token = ?').bind(token).first();
  return jsonResponse(200, { ok: true, student });
}

async function handleAddPurchase(request, env) {
  const isAdmin = await requireAdmin(request, env);
  if (!isAdmin) return jsonResponse(403, { error: 'forbidden' });

  const body = await readJson(request);
  if (!body) return jsonResponse(400, { error: 'missing_body' });

  const studentId = body.student_id ? Number(body.student_id) : null;
  const token = body.token ? String(body.token).trim() : null;
  const credits = Number(body.credits_total);
  const validityMonths = Number(body.validity_months);

  if (!credits || credits <= 0) return jsonResponse(400, { error: 'invalid_credits' });
  if (![1, 3].includes(validityMonths)) return jsonResponse(400, { error: 'invalid_validity' });

  let student = null;
  if (studentId) {
    student = await env.DB.prepare('SELECT * FROM students WHERE id = ?').bind(studentId).first();
  } else if (token) {
    student = await getStudentByToken(env.DB, token);
  }
  if (!student) return jsonResponse(404, { error: 'student_not_found' });

  const purchasedAt = new Date();
  const expiresAt = addMonthsUtc(purchasedAt, validityMonths);
  const now = purchasedAt.toISOString();
  const expiresIso = expiresAt.toISOString();

  return await withTransaction(env.DB, async () => {
    await env.DB.prepare(
      'INSERT INTO lots (student_id, purchased_at, validity_months, expires_at, credits_total, credits_remaining) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(student.id, now, validityMonths, expiresIso, credits, credits).run();

    const lot = await env.DB.prepare(
      'SELECT * FROM lots WHERE student_id = ? ORDER BY id DESC LIMIT 1'
    ).bind(student.id).first();

    await appendLedger(env.DB, student.id, 'PURCHASE', credits, lot.id, null);

    return jsonResponse(200, { ok: true, lot });
  });
}

async function handleSetNextLesson(request, env) {
  const isAdmin = await requireAdmin(request, env);
  if (!isAdmin) return jsonResponse(403, { error: 'forbidden' });

  const body = await readJson(request);
  if (!body || !body.starts_at) return jsonResponse(400, { error: 'missing_starts_at' });

  const startsAt = new Date(body.starts_at);
  if (Number.isNaN(startsAt.getTime())) return jsonResponse(400, { error: 'invalid_starts_at' });

  const startsIso = startsAt.toISOString();

  return await withTransaction(env.DB, async () => {
    const now = nowIso();
    await env.DB.prepare('DELETE FROM lesson_events WHERE starts_at >= ?').bind(now).run();
    await env.DB.prepare('INSERT INTO lesson_events (starts_at) VALUES (?)').bind(startsIso).run();

    const lesson = await env.DB.prepare(
      'SELECT * FROM lesson_events WHERE starts_at = ?'
    ).bind(startsIso).first();

    return jsonResponse(200, { ok: true, lesson });
  });
}

async function handleClearRegistrations(request, env) {
  const isAdmin = await requireAdmin(request, env);
  if (!isAdmin) return jsonResponse(403, { error: 'forbidden' });

  const body = await readJson(request);
  const lessonId = body && body.lesson_id ? Number(body.lesson_id) : null;
  if (!lessonId) return jsonResponse(400, { error: 'missing_lesson_id' });

  await env.DB.prepare('DELETE FROM registrations WHERE lesson_id = ?').bind(lessonId).run();
  return jsonResponse(200, { ok: true });
}

async function handleExtendValidity(request, env) {
  const isAdmin = await requireAdmin(request, env);
  if (!isAdmin) return jsonResponse(403, { error: 'forbidden' });

  const body = await readJson(request);
  const extendDays = body && body.extend_days ? Number(body.extend_days) : null;
  if (!extendDays || extendDays <= 0) return jsonResponse(400, { error: 'invalid_extend_days' });

  const now = nowIso();
  const lots = await env.DB.prepare(
    'SELECT id, student_id, expires_at FROM lots WHERE expires_at > ?'
  ).bind(now).all();

  return await withTransaction(env.DB, async () => {
    for (const lot of lots.results) {
      const newExpiry = addDaysUtc(new Date(lot.expires_at), extendDays).toISOString();
      await env.DB.prepare('UPDATE lots SET expires_at = ? WHERE id = ?').bind(newExpiry, lot.id).run();
      await appendLedger(env.DB, lot.student_id, 'EXTEND', 0, lot.id, null);
    }

    return jsonResponse(200, { ok: true, updated_lots: lots.results.length });
  });
}

async function handleAdminCancel(request, env) {
  const isAdmin = await requireAdmin(request, env);
  if (!isAdmin) return jsonResponse(403, { error: 'forbidden' });

  const body = await readJson(request);
  if (!body || !body.student_id || !body.lesson_id) {
    return jsonResponse(400, { error: 'missing_params' });
  }

  const now = nowIso();
  return await withTransaction(env.DB, async () => {
    const result = await cancelRegistration(env.DB, Number(body.student_id), Number(body.lesson_id), true, now);
    if (!result.ok) return jsonResponse(400, { error: result.error });
    return jsonResponse(200, result);
  });
}

async function handleAdminList(request, env) {
  const isAdmin = await requireAdmin(request, env);
  if (!isAdmin) return jsonResponse(403, { error: 'forbidden' });

  const now = nowIso();
  const students = await env.DB.prepare('SELECT * FROM students ORDER BY created_at ASC').all();
  const lots = await env.DB.prepare('SELECT * FROM lots ORDER BY purchased_at ASC').all();
  const nextLesson = await getNextLesson(env.DB, now);
  const regs = nextLesson
    ? await env.DB.prepare(
        'SELECT registrations.*, students.name FROM registrations JOIN students ON registrations.student_id = students.id WHERE lesson_id = ? ORDER BY registered_at ASC'
      ).bind(nextLesson.id).all()
    : { results: [] };

  const creditsRows = await env.DB.prepare(
    'SELECT student_id, COALESCE(SUM(credits_remaining), 0) AS credits FROM lots WHERE expires_at > ? GROUP BY student_id'
  ).bind(now).all();
  const creditsByStudent = new Map(creditsRows.results.map((row) => [row.student_id, row.credits]));
  const registeredByStudent = new Set(regs.results.map((row) => row.student_id));

  const student_overview = students.results.map((student) => ({
    id: student.id,
    name: student.name,
    credits_available: creditsByStudent.get(student.id) || 0,
    registered_for_next: registeredByStudent.has(student.id)
  }));

  return jsonResponse(200, {
    students: students.results,
    lots: lots.results,
    next_lesson: nextLesson || null,
    registrations: regs.results,
    student_overview
  });
}

async function exportLedgerSnapshot(env) {
  if (!env.LEDGER_BACKUPS) {
    throw new Error('missing_r2_binding');
  }

  const rows = await env.DB.prepare(
    'SELECT * FROM ledger_events ORDER BY id ASC'
  ).all();

  const now = new Date();
  const datePart = now.toISOString().slice(0, 10);
  const key = `ledger/${datePart.replace(/-/g, '/')}/ledger-${now.toISOString().replace(/[:.]/g, '-')}.json`;

  const payload = JSON.stringify({
    generated_at: now.toISOString(),
    count: rows.results.length,
    rows: rows.results
  });

  await env.LEDGER_BACKUPS.put(key, payload, {
    httpMetadata: { contentType: 'application/json' }
  });

  return { key, count: rows.results.length };
}

async function latestBackup(env) {
  if (!env.LEDGER_BACKUPS) {
    throw new Error('missing_r2_binding');
  }

  const listing = await env.LEDGER_BACKUPS.list({ prefix: 'ledger/', limit: 1000 });
  if (!listing.objects || listing.objects.length === 0) {
    return null;
  }
  const latest = listing.objects[listing.objects.length - 1];
  return {
    key: latest.key,
    size: latest.size,
    uploaded: latest.uploaded
  };
}

async function handleExportLedger(request, env) {
  const isAdmin = await requireAdmin(request, env);
  if (!isAdmin) return jsonResponse(403, { error: 'forbidden' });

  try {
    const result = await exportLedgerSnapshot(env);
    return jsonResponse(200, { ok: true, ...result });
  } catch (err) {
    return jsonResponse(500, { error: 'export_failed', details: String(err) });
  }
}

async function handleBackupStatus(request, env) {
  const isAdmin = await requireAdmin(request, env);
  if (!isAdmin) return jsonResponse(403, { error: 'forbidden' });

  try {
    const latest = await latestBackup(env);
    return jsonResponse(200, { ok: true, latest });
  } catch (err) {
    return jsonResponse(500, { error: 'backup_status_failed', details: String(err) });
  }
}

async function handleRequest(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: JSON_HEADERS });

  const { path } = parseUrl(request);

  if (request.method === 'GET' && path === '/status') return await handleStatus(request, env);
  if (request.method === 'POST' && path === '/register') return await handleRegister(request, env);
  if (request.method === 'POST' && path === '/cancel') return await handleCancel(request, env);

  if (request.method === 'POST' && path === '/admin/addStudent') return await handleAddStudent(request, env);
  if (request.method === 'POST' && path === '/admin/addPurchase') return await handleAddPurchase(request, env);
  if (request.method === 'POST' && path === '/admin/setNextLesson') return await handleSetNextLesson(request, env);
  if (request.method === 'POST' && path === '/admin/clearRegistrations') return await handleClearRegistrations(request, env);
  if (request.method === 'POST' && path === '/admin/extendValidity') return await handleExtendValidity(request, env);
  if (request.method === 'POST' && path === '/admin/cancelRegistration') return await handleAdminCancel(request, env);
  if (request.method === 'POST' && path === '/admin/exportLedger') return await handleExportLedger(request, env);
  if (request.method === 'GET' && path === '/admin/backupStatus') return await handleBackupStatus(request, env);
  if (request.method === 'GET' && path === '/admin/list') return await handleAdminList(request, env);

  return jsonResponse(404, { error: 'not_found' });
}

export default {
  async fetch(request, env) {
    try {
      return await handleRequest(request, env);
    } catch (err) {
      return jsonResponse(500, { error: 'server_error', details: String(err) });
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      exportLedgerSnapshot(env).catch(() => {})
    );
  }
};
