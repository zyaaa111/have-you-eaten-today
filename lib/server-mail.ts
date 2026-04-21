import nodemailer from "nodemailer";

type MailContent = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export function isMailConfigured(): boolean {
  if (process.env.SMTP_HOST === "mock") {
    return true;
  }
  return Boolean(
    process.env.SMTP_HOST &&
      process.env.SMTP_PORT &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASS &&
      process.env.AUTH_FROM_EMAIL
  );
}

function getTransport() {
  if (!isMailConfigured()) {
    throw new Error("当前未配置 QQ SMTP 发信能力");
  }

  if (process.env.SMTP_HOST === "mock") {
    return nodemailer.createTransport({
      jsonTransport: true,
    });
  }

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: String(process.env.SMTP_SECURE ?? "true").toLowerCase() === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

export async function sendMail(content: MailContent): Promise<void> {
  const transporter = getTransport();
  await transporter.sendMail({
    from: process.env.AUTH_FROM_EMAIL,
    to: content.to,
    subject: content.subject,
    html: content.html,
    text: content.text,
  });
}

export function buildPasswordResetEmail(params: {
  email: string;
  resetUrl: string;
  isFirstPasswordSet?: boolean;
}): MailContent {
  const title = params.isFirstPasswordSet ? "设置你的登录密码" : "重置你的登录密码";
  const helper = params.isFirstPasswordSet
    ? "这是一个已有账号的首次设密链接。"
    : "如果这不是你的操作，可以忽略这封邮件。";

  return {
    to: params.email,
    subject: `Have You Eaten Today - ${title}`,
    text: [
      `${title}`,
      "",
      "请在 30 分钟内打开下面的链接完成操作：",
      params.resetUrl,
      "",
      helper,
    ].join("\n"),
    html: `
      <div style="font-family:Arial,'PingFang SC','Microsoft YaHei',sans-serif;line-height:1.6;color:#1f2937">
        <h2 style="margin-bottom:12px">${title}</h2>
        <p>请在 <strong>30 分钟内</strong> 打开下面的链接完成操作：</p>
        <p>
          <a href="${params.resetUrl}" style="display:inline-block;padding:10px 16px;background:#111827;color:#ffffff;border-radius:8px;text-decoration:none">
            ${title}
          </a>
        </p>
        <p style="word-break:break-all;color:#4b5563">${params.resetUrl}</p>
        <p style="color:#6b7280">${helper}</p>
      </div>
    `,
  };
}
