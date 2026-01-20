const CONFIG_SHEET = "Config";
const STUDENTS_SHEET = "Students";
const DEFAULT_TIMEZONE = "Asia/Jerusalem";

function doGet(e) {
  return handleRequest_(e);
}

function doPost(e) {
  return handleRequest_(e);
}

function handleRequest_(e) {
  if (e && e.parameter && e.parameter.action === "ping") {
    return jsonResponse_({ ok: true, version: "1.0.0" });
  }

  if (e && e.parameter && e.parameter.action === "options") {
    return jsonResponse_({ ok: true });
  }

  if (e && e.postData && e.postData.contents) {
    try {
      const payload = JSON.parse(e.postData.contents);
      return routeAction_(payload);
    } catch (err) {
      return jsonResponse_({ ok: false, error: "Invalid JSON" });
    }
  }

  return jsonResponse_({ ok: false, error: "Unsupported request" });
}

function doOptions() {
  return jsonResponse_({ ok: true });
}

function routeAction_(payload) {
  if (!payload || !payload.action) {
    return jsonResponse_({ ok: false, error: "Missing action" });
  }

  switch (payload.action) {
    case "studentStatus":
      return handleStudentStatus_(payload);
    case "register":
      return handleRegister_(payload);
    case "teacherListStudents":
      return handleTeacherListStudents_(payload);
    case "teacherAddStudent":
      return handleTeacherAddStudent_(payload);
    case "teacherAdjustLessons":
      return handleTeacherAdjustLessons_(payload);
    case "teacherClearRegistrations":
      return handleTeacherClearRegistrations_(payload);
    case "teacherSetNextLesson":
      return handleTeacherSetNextLesson_(payload);
    case "teacherCancelNextLesson":
      return handleTeacherCancelNextLesson_(payload);
    case "ping":
      return jsonResponse_({ ok: true, version: "1.0.0" });
    default:
      return jsonResponse_({ ok: false, error: "Unknown action" });
  }
}

function handleStudentStatus_(payload) {
  const token = payload.token;
  if (!token) {
    return jsonResponse_({ ok: false, error: "Missing token" });
  }

  const { student, config } = getStudentAndConfig_(token);
  if (!student) {
    return jsonResponse_({ ok: false, error: "Invalid token" });
  }

  return jsonResponse_({
    ok: true,
    studentName: student.studentName,
    lessonsRemaining: student.lessonsRemaining,
    isRegistered: student.isRegistered,
    nextLessonISO: config.nextLessonISO,
    eventTitle: config.eventTitle,
    eventLocation: config.eventLocation
  });
}

function handleRegister_(payload) {
  const token = payload.token;
  if (!token) {
    return jsonResponse_({ ok: false, error: "Missing token" });
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const { student, studentRow, config } = getStudentAndConfig_(token);
    if (!student) {
      return jsonResponse_({ ok: false, error: "Invalid token" });
    }
    if (!config.nextLessonISO) {
      return jsonResponse_({ ok: false, error: "Next lesson is not scheduled" });
    }

    if (student.isRegistered) {
      return jsonResponse_({ ok: true, message: "Already registered" });
    }

    if (student.lessonsRemaining <= 0) {
      return jsonResponse_({ ok: false, error: "No lessons remaining" });
    }

    const sheet = getStudentsSheet_();
    const nowIso = new Date().toISOString();
    sheet.getRange(studentRow, 3).setValue(student.lessonsRemaining - 1);
    sheet.getRange(studentRow, 4).setValue(true);
    sheet.getRange(studentRow, 5).setValue(nowIso);
    sheet.getRange(studentRow, 6).setValue(nowIso);

    return jsonResponse_({ ok: true, message: "Registered" });
  } catch (err) {
    return jsonResponse_({ ok: false, error: "Registration failed" });
  } finally {
    lock.releaseLock();
  }
}

function handleTeacherListStudents_(payload) {
  if (!isAdmin_(payload.adminToken)) {
    return jsonResponse_({ ok: false, error: "Unauthorized" });
  }

  const sheet = getStudentsSheet_();
  const values = sheet.getDataRange().getValues();
  const students = values.slice(1).filter((row) => row[0]).map((row) => ({
    token: row[0],
    studentName: row[1],
    lessonsRemaining: Number(row[2]) || 0,
    isRegistered: Boolean(row[3]),
    registeredAt: row[4] || ""
  }));

  const config = getConfig_();

  return jsonResponse_({
    ok: true,
    students,
    nextLessonISO: config.nextLessonISO
  });
}

function handleTeacherAddStudent_(payload) {
  if (!isAdmin_(payload.adminToken)) {
    return jsonResponse_({ ok: false, error: "Unauthorized" });
  }

  const studentName = (payload.studentName || "").trim();
  if (!studentName) {
    return jsonResponse_({ ok: false, error: "Student name required" });
  }

  const sheet = getStudentsSheet_();
  const token = generateToken_();
  const nowIso = new Date().toISOString();
  sheet.appendRow([token, studentName, 0, false, "", nowIso, ""]);

  const baseUrl = payload.baseUrl || "";
  const studentLink = baseUrl ? `${baseUrl}/student/?t=${token}` : token;

  return jsonResponse_({ ok: true, token, studentLink });
}

function handleTeacherAdjustLessons_(payload) {
  if (!isAdmin_(payload.adminToken)) {
    return jsonResponse_({ ok: false, error: "Unauthorized" });
  }

  const token = payload.token;
  const delta = Number(payload.delta);
  if (!token || !Number.isInteger(delta)) {
    return jsonResponse_({ ok: false, error: "Token and integer delta required" });
  }

  const { student, studentRow } = getStudentAndConfig_(token);
  if (!student) {
    return jsonResponse_({ ok: false, error: "Invalid token" });
  }

  const sheet = getStudentsSheet_();
  const newValue = student.lessonsRemaining + delta;
  sheet.getRange(studentRow, 3).setValue(newValue);
  sheet.getRange(studentRow, 6).setValue(new Date().toISOString());

  return jsonResponse_({ ok: true, lessonsRemaining: newValue });
}

function handleTeacherClearRegistrations_(payload) {
  if (!isAdmin_(payload.adminToken)) {
    return jsonResponse_({ ok: false, error: "Unauthorized" });
  }

  const sheet = getStudentsSheet_();
  const range = sheet.getDataRange();
  const values = range.getValues();

  for (let i = 1; i < values.length; i++) {
    values[i][3] = false;
    values[i][4] = "";
  }

  range.setValues(values);

  return jsonResponse_({ ok: true });
}

function handleTeacherSetNextLesson_(payload) {
  if (!isAdmin_(payload.adminToken)) {
    return jsonResponse_({ ok: false, error: "Unauthorized" });
  }

  const nextLessonISO = payload.nextLessonISO;
  if (!nextLessonISO) {
    return jsonResponse_({ ok: false, error: "nextLessonISO required" });
  }

  const sheet = getConfigSheet_();
  sheet.getRange("A1").setValue(nextLessonISO);

  return jsonResponse_({ ok: true, nextLessonISO });
}

function handleTeacherCancelNextLesson_(payload) {
  if (!isAdmin_(payload.adminToken)) {
    return jsonResponse_({ ok: false, error: "Unauthorized" });
  }

  const sheet = getStudentsSheet_();
  const range = sheet.getDataRange();
  const values = range.getValues();
  const nowIso = new Date().toISOString();
  let refunded = 0;

  for (let i = 1; i < values.length; i++) {
    const isRegistered = Boolean(values[i][3]);
    if (isRegistered) {
      const lessons = Number(values[i][2]) || 0;
      values[i][2] = lessons + 1;
      values[i][3] = false;
      values[i][4] = "";
      values[i][5] = nowIso;
      refunded += 1;
    }
  }

  range.setValues(values);

  const config = getConfigSheet_();
  config.getRange("A1").setValue("");

  return jsonResponse_({ ok: true, refunded });
}

function getStudentAndConfig_(token) {
  const sheet = getStudentsSheet_();
  const values = sheet.getDataRange().getValues();
  let student = null;
  let studentRow = null;

  for (let i = 1; i < values.length; i++) {
    if (values[i][0] === token) {
      student = {
        token: values[i][0],
        studentName: values[i][1],
        lessonsRemaining: Number(values[i][2]) || 0,
        isRegistered: Boolean(values[i][3]),
        registeredAt: values[i][4] || ""
      };
      studentRow = i + 1;
      break;
    }
  }

  return { student, studentRow, config: getConfig_() };
}

function getConfig_() {
  const sheet = getConfigSheet_();
  const values = sheet.getRange("A1:B4").getValues();
  return {
    nextLessonISO: values[0][0] || "",
    timezone: values[1][0] || DEFAULT_TIMEZONE,
    eventTitle: values[3][0] || "Tango Lesson",
    eventLocation: values[3][1] || ""
  };
}

function getConfigSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG_SHEET);
    sheet.getRange("A1").setValue("");
    sheet.getRange("A2").setValue(DEFAULT_TIMEZONE);
    sheet.getRange("A3").setValue("");
    sheet.getRange("A4").setValue("Tango Lesson");
    sheet.getRange("B4").setValue("Studio");
  }
  return sheet;
}

function getStudentsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(STUDENTS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(STUDENTS_SHEET);
    sheet.appendRow([
      "token",
      "studentName",
      "lessonsRemaining",
      "isRegistered",
      "registeredAt",
      "lastActionAt",
      "notes"
    ]);
  }
  return sheet;
}

function isAdmin_(providedToken) {
  const stored = PropertiesService.getScriptProperties().getProperty("ADMIN_TOKEN");
  if (!stored) {
    return false;
  }
  return stored === providedToken;
}

function generateToken_() {
  const bytes = Utilities.getUuid().replace(/-/g, "");
  const random = Utilities.getUuid().replace(/-/g, "");
  return `${bytes}${random}`.slice(0, 32);
}

function jsonResponse_(obj) {
  const output = ContentService.createTextOutput(JSON.stringify(obj));
  output.setMimeType(ContentService.MimeType.JSON);
  if (typeof output.setHeader === "function") {
    output.setHeader("Access-Control-Allow-Origin", "*");
    output.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    output.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
  return output;
}
