const nodemailer = require('nodemailer');

let transporter = null;

async function getTransporter() {
  if (transporter) return transporter;

  if (process.env.SMTP_USER && process.env.SMTP_PASS) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.ethereal.email',
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: false,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  } else {
    const testAccount = await nodemailer.createTestAccount();
    transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: { user: testAccount.user, pass: testAccount.pass },
    });
    console.log('📧 Using Ethereal test email account');
    console.log(`   User: ${testAccount.user}`);
  }
  return transporter;
}

async function sendVerificationEmail(to, token) {
  const transport = await getTransporter();
  const verifyUrl = `${process.env.CLIENT_URL}/verify-email?token=${token}`;

  const info = await transport.sendMail({
    from: `"Quizzit" <${process.env.EMAIL_FROM || 'noreply@quizzit.com'}>`,
    to,
    subject: 'Verify your Quizzit account',
    html: `
      <div style="max-width:600px;margin:0 auto;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;background:#0f1117;color:#e8eaf0;padding:40px 20px;">
        <div style="text-align:center;margin-bottom:30px;">
          <h1 style="color:#7c5cfc;font-size:32px;margin:0;letter-spacing:-1px;">Quizzit</h1>
          <p style="color:#8b92a8;margin-top:5px;">Live Quiz Platform</p>
        </div>
        <div style="background:#1a1d2e;border-radius:12px;padding:30px;border:1px solid #2a2e45;">
          <h2 style="margin-top:0;color:#e8eaf0;">Verify your email</h2>
          <p style="color:#8b92a8;line-height:1.6;">Thanks for signing up! Click the button below to verify your email address and start using Quizzit.</p>
          <div style="text-align:center;margin:30px 0;">
            <a href="${verifyUrl}" style="background:#7c5cfc;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">Verify Email</a>
          </div>
          <p style="color:#5c6380;font-size:14px;">This link expires in 24 hours. If you didn't create an account, you can safely ignore this email.</p>
        </div>
        <div style="text-align:center;margin-top:30px;">
          <p style="color:#5c6380;font-size:12px;">&copy; 2026 Quizzit. All rights reserved.</p>
        </div>
      </div>
    `,
  });

  if (info.messageId) {
    const previewUrl = nodemailer.getTestMessageUrl(info);
    if (previewUrl) {
      console.log(`📧 Preview verification email: ${previewUrl}`);
    }
  }
  return info;
}

async function sendPasswordResetEmail(to, token) {
  const transport = await getTransporter();
  const resetUrl = `${process.env.CLIENT_URL}/reset-password?token=${token}`;

  const info = await transport.sendMail({
    from: `"Quizzit" <${process.env.EMAIL_FROM || 'noreply@quizzit.com'}>`,
    to,
    subject: 'Reset your Quizzit password',
    html: `
      <div style="max-width:600px;margin:0 auto;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;background:#0f1117;color:#e8eaf0;padding:40px 20px;">
        <div style="text-align:center;margin-bottom:30px;">
          <h1 style="color:#7c5cfc;font-size:32px;margin:0;">Quizzit</h1>
        </div>
        <div style="background:#1a1d2e;border-radius:12px;padding:30px;border:1px solid #2a2e45;">
          <h2 style="margin-top:0;color:#e8eaf0;">Reset your password</h2>
          <p style="color:#8b92a8;line-height:1.6;">Click below to reset your password. If you didn't request this, ignore this email.</p>
          <div style="text-align:center;margin:30px 0;">
            <a href="${resetUrl}" style="background:#7c5cfc;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">Reset Password</a>
          </div>
          <p style="color:#5c6380;font-size:14px;">This link expires in 1 hour.</p>
        </div>
      </div>
    `,
  });
  return info;
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail };
