PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS exams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  time_limit_seconds INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('single', 'multiple')),
  text TEXT NOT NULL,
  options TEXT NOT NULL,
  correct TEXT NOT NULL,
  explanation TEXT,
  order_index INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  score INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  percentage REAL NOT NULL DEFAULT 0,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  detail TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS ix_questions_exam_id ON questions(exam_id);
CREATE INDEX IF NOT EXISTS ix_attempts_user_id ON attempts(user_id);
CREATE INDEX IF NOT EXISTS ix_attempts_exam_id ON attempts(exam_id);
CREATE INDEX IF NOT EXISTS ix_attempts_created_at ON attempts(created_at);
CREATE INDEX IF NOT EXISTS ix_exams_owner_id ON exams(owner_id);

INSERT OR IGNORE INTO users (id, username, display_name, password_hash)
VALUES (1, 'demo', 'Người dùng Demo', 'pbkdf2$100000$MUcgXIF2anFeS3XSv9qp6w$M-xHdcBHoZ-PINf2zWpzUfyhVaA5uCpcUjn6PtQqibU');

INSERT OR IGNORE INTO exams (id, owner_id, title, description, image_url, time_limit_seconds)
VALUES
  (1, 1, 'Kiến thức Python cơ bản', 'Bài ôn tập nhanh về cú pháp và khái niệm nền tảng của Python.', 'https://images.unsplash.com/photo-1526379095098-d400fd0bf935?w=800&q=80', 300),
  (2, 1, 'Tổng quan về HTTP & Web', 'Các khái niệm cơ bản về giao thức HTTP và hoạt động của web.', 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&q=80', NULL);

INSERT OR IGNORE INTO questions (id, exam_id, type, text, options, correct, explanation, order_index)
VALUES
  (1, 1, 'single', 'Từ khóa nào dùng để định nghĩa một hàm trong Python?', '[{"key":"A","text":"func"},{"key":"B","text":"def"},{"key":"C","text":"function"},{"key":"D","text":"lambda"}]', '["B"]', 'Hàm trong Python được định nghĩa bằng từ khóa def.', 0),
  (2, 1, 'multiple', 'Những kiểu dữ liệu nào sau đây là immutable (bất biến) trong Python?', '[{"key":"A","text":"tuple"},{"key":"B","text":"list"},{"key":"C","text":"str"},{"key":"D","text":"dict"}]', '["A","C"]', 'tuple và str là immutable; list và dict là mutable.', 1),
  (3, 1, 'single', 'Kết quả của biểu thức 3 // 2 là gì?', '[{"key":"A","text":"1.5"},{"key":"B","text":"1"},{"key":"C","text":"2"},{"key":"D","text":"Lỗi"}]', '["B"]', 'Toán tử // là chia lấy phần nguyên, 3 // 2 = 1.', 2),
  (4, 2, 'single', 'Mã trạng thái HTTP 404 có ý nghĩa gì?', '[{"key":"A","text":"Thành công"},{"key":"B","text":"Không tìm thấy"},{"key":"C","text":"Lỗi máy chủ"},{"key":"D","text":"Chuyển hướng"}]', '["B"]', '404 Not Found nghĩa là tài nguyên không tồn tại.', 0),
  (5, 2, 'multiple', 'Những phương thức (method) nào sau đây là của HTTP?', '[{"key":"A","text":"GET"},{"key":"B","text":"PUSH"},{"key":"C","text":"POST"},{"key":"D","text":"DELETE"}]', '["A","C","D"]', 'GET, POST, DELETE là method HTTP. PUSH không phải.', 1);
