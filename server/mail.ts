import nodemailer from 'nodemailer'

export type SendCode = (email: string, code: string) => Promise<void>

/**
 * 配置了 SMTP_HOST 就真的发邮件；否则（本地开发）把验证码打印到控制台。
 * 环境变量：SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASS MAIL_FROM
 */
export function createMailer(env = process.env): SendCode {
  if (!env.SMTP_HOST) {
    return async (email, code) => {
      console.log(`[mail] 未配置 SMTP，${email} 的验证码：${code}`)
    }
  }
  const port = Number(env.SMTP_PORT ?? 465)
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  })
  return async (email, code) => {
    await transport.sendMail({
      from: env.MAIL_FROM ?? env.SMTP_USER,
      to: email,
      subject: `MyLog 验证码：${code}`,
      text: `你的 MyLog 登录验证码是 ${code}，10 分钟内有效。\n\n如果不是你本人操作，忽略这封邮件即可。`,
    })
  }
}
