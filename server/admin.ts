// 账号管理命令，在服务器上运行。用 Docker 部署时：
//   docker compose exec app node server/admin.ts add-user 张三@公司.com
//   docker compose exec app node server/admin.ts reset-password 张三@公司.com
//   docker compose exec app node server/admin.ts list-users
//   docker compose exec app node server/admin.ts delete-user 张三@公司.com
// 不指定密码时自动生成一个，打印出来交给本人；登录后可以在「设置 → 修改密码」里改掉。
import { createInterface } from 'node:readline/promises'
import { createPool, migrate } from './db.ts'
import { createUser, deleteUser, listUsers, randomPassword, resetPassword } from './users.ts'

const USAGE = `用法：node server/admin.ts <命令> [参数]

  add-user <邮箱> [密码]        创建账号；不写密码就自动生成一个
  reset-password <邮箱> [密码]  重置密码（忘记密码时用），这个账号所有设备都会退出登录
  list-users                    列出所有账号
  delete-user <邮箱>            删除账号和它的全部数据（会再问一次）`

const fmt = (d: Date | null) => (d ? d.toLocaleString('zh-CN', { hour12: false }) : '—')

async function main(): Promise<number> {
  const [cmd, email, given] = process.argv.slice(2)
  if (!cmd || cmd === 'help' || cmd === '--help') {
    console.log(USAGE)
    return cmd ? 0 : 1
  }
  const pool = createPool()
  try {
    await migrate(pool)
    switch (cmd) {
      case 'add-user':
      case 'reset-password': {
        if (!email) throw new Error(`请写上邮箱，例如：node server/admin.ts ${cmd} 张三@公司.com`)
        const password = given ?? randomPassword()
        if (cmd === 'add-user') await createUser(pool, email, password)
        else await resetPassword(pool, email, password)
        console.log(cmd === 'add-user' ? `已创建账号：${email.trim().toLowerCase()}` : `已重置密码：${email.trim().toLowerCase()}（所有设备已退出登录）`)
        if (!given) console.log(`密码：${password}\n请把密码交给本人，登录后在「设置 → 修改密码」里改掉。`)
        return 0
      }
      case 'list-users': {
        const users = await listUsers(pool)
        if (!users.length) console.log('还没有账号。用 add-user 创建。')
        for (const u of users) {
          console.log(`${u.email}\t创建于 ${fmt(u.createdAt)}\t已登录设备 ${u.devices} 台\t最近使用 ${fmt(u.lastSeen)}`)
        }
        return 0
      }
      case 'delete-user': {
        if (!email) throw new Error('请写上要删除的邮箱')
        const rl = createInterface({ input: process.stdin, output: process.stdout })
        const answer = await rl.question(`会删除 ${email} 的账号和全部任务、日志、会议，不能恢复。确定请输入 yes：`)
        rl.close()
        if (answer.trim() !== 'yes') {
          console.log('已取消。')
          return 1
        }
        await deleteUser(pool, email)
        console.log(`已删除：${email}`)
        return 0
      }
      default:
        console.log(`不认识的命令：${cmd}\n\n${USAGE}`)
        return 1
    }
  } catch (e) {
    console.error('出错了：' + (e instanceof Error ? e.message : String(e)))
    return 1
  } finally {
    await pool.end()
  }
}

process.exitCode = await main()
