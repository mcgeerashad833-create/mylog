import mysql from 'mysql2/promise'

export type Pool = mysql.Pool

export function createPool(url = process.env.DATABASE_URL ?? 'mysql://mylog:mylog_dev@localhost:3306/mylog'): Pool {
  return mysql.createPool({ uri: url, connectionLimit: 10, charset: 'utf8mb4', timezone: 'Z' })
}

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS users (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(254) NOT NULL UNIQUE,
    password_hash VARCHAR(200) NOT NULL,
    -- 每次有记录变化就加一，作为客户端拉取的游标
    seq BIGINT UNSIGNED NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS sessions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    token_hash CHAR(64) NOT NULL UNIQUE,
    user_id BIGINT UNSIGNED NOT NULL,
    device VARCHAR(100) NOT NULL DEFAULT '',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX (user_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // 任务和每日记录都以 JSON 整条存储，按 updated_at 做「后写者胜」合并
  `CREATE TABLE IF NOT EXISTS tasks (
    user_id BIGINT UNSIGNED NOT NULL,
    id VARCHAR(64) NOT NULL,
    data JSON NOT NULL,
    updated_at VARCHAR(30) NOT NULL,
    seq BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (user_id, id),
    INDEX (user_id, seq),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS days (
    user_id BIGINT UNSIGNED NOT NULL,
    date CHAR(10) NOT NULL,
    data JSON NOT NULL,
    updated_at VARCHAR(30) NOT NULL,
    seq BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (user_id, date),
    INDEX (user_id, seq),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // 会议（含会中记录、纪要、会前备注）也整条存，规则和任务一样
  `CREATE TABLE IF NOT EXISTS meetings (
    user_id BIGINT UNSIGNED NOT NULL,
    id VARCHAR(64) NOT NULL,
    data JSON NOT NULL,
    updated_at VARCHAR(30) NOT NULL,
    seq BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (user_id, id),
    INDEX (user_id, seq),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
]

export async function migrate(pool: Pool): Promise<void> {
  for (const sql of MIGRATIONS) await pool.query(sql)
  // 早期版本用邮箱验证码登录，没有密码列
  const [cols] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'password_hash'",
  )
  if (!cols.length) await pool.query("ALTER TABLE users ADD COLUMN password_hash VARCHAR(200) NOT NULL DEFAULT '' AFTER email")
  await pool.query('DROP TABLE IF EXISTS login_codes')
}
