// 简易评论系统：Render + Neon (Postgres)
// - 自动创建表 comments
// - 接口：POST /comments, GET /comments?thread=&limit=&offset=
// - 静态托管：当前目录（index.html）

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(__dirname));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS comments (
      id BIGSERIAL PRIMARY KEY,
      thread TEXT NOT NULL DEFAULT 'main',
      author TEXT,
      content TEXT NOT NULL,
      at_seconds INT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      likes_count INT NOT NULL DEFAULT 0
    );
    ALTER TABLE comments ADD COLUMN IF NOT EXISTS at_seconds INT;
    ALTER TABLE comments ADD COLUMN IF NOT EXISTS likes_count INT NOT NULL DEFAULT 0;
    CREATE INDEX IF NOT EXISTS idx_comments_thread_created_at
      ON comments(thread, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_comments_thread_at ON comments(thread, at_seconds);
  `);
}

app.get('/api/ping', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.get('/comments', async (req, res) => {
  try {
    const thread = (req.query.thread || 'main').slice(0, 128);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '50', 10), 1), 100);
    const offset = Math.max(parseInt(req.query.offset || '0', 10), 0);

    const result = await pool.query(
      `SELECT id, thread, author, content, at_seconds, created_at, likes_count
       FROM comments
       WHERE thread = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [thread, limit, offset]
    );
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, thread, count: result.rowCount, items: result.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.post('/comments', async (req, res) => {
  try {
    const body = req.body || {};
    const thread = (body.thread || 'main').slice(0, 128);
    const author = (body.author || '').slice(0, 128);
    const content = (body.content || '').trim();
    const at = Number.isFinite(body.at_seconds) ? Math.max(0, Math.min(36000, Math.floor(body.at_seconds))) : null;

    if (!content) return res.status(400).json({ ok: false, error: '内容不能为空' });
    if (content.length > 2000) return res.status(413).json({ ok: false, error: '内容过长（最多2000字符）' });

    const result = await pool.query(
      `INSERT INTO comments (thread, author, content, at_seconds)
       VALUES ($1, $2, $3, $4)
       RETURNING id, thread, author, content, at_seconds, created_at, likes_count`,
      [thread, author, content, at]
    );
    res.status(201).json({ ok: true, item: result.rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// 点赞：将某条评论的 likes_count + 1
app.post('/comments/:id/like', async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, error: '无效的评论 ID' });
    }
    const result = await pool.query(
      `UPDATE comments
       SET likes_count = likes_count + 1
       WHERE id = $1
       RETURNING likes_count`,
      [id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ ok: false, error: '评论不存在' });
    }
    res.json({ ok: true, likes_count: result.rows[0].likes_count });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});
initDb()
  .then(() => app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  }))
  .catch(err => {
    console.error('DB init failed:', err);
    process.exit(1);
  });