-- ── 1. Extend diamond_logs.type enum ─────────────────────────────────────────
ALTER TABLE diamond_logs MODIFY COLUMN type
  ENUM('sentence','lesson_complete','course_complete','share_invite','chat') NOT NULL;

-- ── 2. Task logs (share dedup by day, invite dedup by registered user) ────────
CREATE TABLE IF NOT EXISTS task_logs (
  id          VARCHAR(36)  NOT NULL PRIMARY KEY DEFAULT (UUID()),
  user_id     VARCHAR(36)  NOT NULL,
  task_type   ENUM('share_invite','invite_register') NOT NULL,
  reward_type ENUM('diamond','trial_days') NOT NULL,
  reward_amount INT        NOT NULL,
  date        VARCHAR(10)  NOT NULL,       -- YYYY-MM-DD
  ref_id      VARCHAR(36)  DEFAULT NULL,   -- invite_register: registered user id
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_task_user_type_date (user_id, task_type, date),
  UNIQUE KEY uk_invite_ref        (ref_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 3. Posts (dynamic feed) ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS posts (
  id            VARCHAR(36)  NOT NULL PRIMARY KEY DEFAULT (UUID()),
  user_id       VARCHAR(36)  NOT NULL,
  content       TEXT         NOT NULL,
  like_count    INT          NOT NULL DEFAULT 0,
  comment_count INT          NOT NULL DEFAULT 0,
  status        ENUM('published','deleted') NOT NULL DEFAULT 'published',
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_posts_user    (user_id),
  INDEX idx_posts_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 4. Post likes ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS post_likes (
  id         VARCHAR(36)  NOT NULL PRIMARY KEY DEFAULT (UUID()),
  post_id    VARCHAR(36)  NOT NULL,
  user_id    VARCHAR(36)  NOT NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_post_like (post_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 5. User feedback ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_feedback (
  id         VARCHAR(36)  NOT NULL PRIMARY KEY DEFAULT (UUID()),
  user_id    VARCHAR(36)  NOT NULL,
  category   ENUM('bug','feature','suggestion','other') NOT NULL DEFAULT 'other',
  content    TEXT         NOT NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_feedback_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
