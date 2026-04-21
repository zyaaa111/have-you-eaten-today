"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  confirmPasswordReset,
  loginAccount,
  registerAccount,
  requestPasswordReset,
} from "@/lib/auth-client";
import { useAuth } from "@/components/auth-provider";

type AuthMode = "login" | "register" | "forgot" | "reset";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { refreshSession, user, passwordResetConfigured } = useAuth();
  const [mode, setMode] = useState<AuthMode>(() => (searchParams.get("mode") === "reset" ? "reset" : "login"));
  const [email, setEmail] = useState(searchParams.get("email") || "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const redirectTo = useMemo(() => searchParams.get("redirect") || "/settings", [searchParams]);
  const resetToken = searchParams.get("token") || "";

  const submitLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email.trim() || !password) {
      setMessage("请输入邮箱和密码");
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      await loginAccount(email.trim(), password);
      await refreshSession();
      router.push(redirectTo);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "登录失败");
    } finally {
      setLoading(false);
    }
  };

  const submitRegister = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email.trim() || !password || !confirmPassword) {
      setMessage("请完整填写注册信息");
      return;
    }
    if (password !== confirmPassword) {
      setMessage("两次输入的密码不一致");
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      await registerAccount(email.trim(), password);
      await refreshSession();
      router.push(redirectTo);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "注册失败");
    } finally {
      setLoading(false);
    }
  };

  const submitForgot = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email.trim()) {
      setMessage("请输入邮箱地址");
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      await requestPasswordReset(email.trim());
      setMessage("如果邮箱对应的账号存在，系统会向该邮箱发送设置/重置密码邮件。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "发送找回密码邮件失败");
    } finally {
      setLoading(false);
    }
  };

  const submitReset = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email.trim() || !resetToken || !password || !confirmPassword) {
      setMessage("缺少重置密码所需信息");
      return;
    }
    if (password !== confirmPassword) {
      setMessage("两次输入的密码不一致");
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      await confirmPasswordReset(email.trim(), resetToken, password);
      setMessage("密码已重置，请使用新密码登录");
      setMode("login");
      setPassword("");
      setConfirmPassword("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "重置密码失败");
    } finally {
      setLoading(false);
    }
  };

  const activeTitle =
    mode === "register" ? "注册账号" : mode === "forgot" ? "忘记密码" : mode === "reset" ? "设置新密码" : "登录账号";

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="w-full max-w-md space-y-6 rounded-2xl border bg-card p-6 shadow-sm">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-bold">{activeTitle}</h1>
          <p className="text-sm text-muted-foreground">
            账号用于跨设备识别你本人；共享空间内仍然显示你的空间昵称。
          </p>
        </div>

        {user && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
            当前已登录：{user.email}
          </div>
        )}

        {mode !== "reset" && (
          <div className="flex rounded-lg border bg-muted p-1">
            {([
              { key: "login", label: "登录" },
              { key: "register", label: "注册" },
              { key: "forgot", label: "忘记密码" },
            ] as const).map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  setMode(item.key);
                  setMessage("");
                }}
                className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition ${
                  mode === item.key ? "bg-background shadow-sm" : "text-muted-foreground"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}

        {!passwordResetConfigured && (mode === "forgot" || mode === "reset") && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
            当前还没有配置 QQ SMTP，暂时无法通过邮件找回或首次设置密码。
          </div>
        )}

        {mode === "login" && (
          <form onSubmit={submitLogin} className="space-y-4">
            <AuthFields
              email={email}
              onEmailChange={setEmail}
              password={password}
              onPasswordChange={setPassword}
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {loading ? "登录中…" : "登录并继续"}
            </button>
          </form>
        )}

        {mode === "register" && (
          <form onSubmit={submitRegister} className="space-y-4">
            <AuthFields
              email={email}
              onEmailChange={setEmail}
              password={password}
              onPasswordChange={setPassword}
            />
            <div className="space-y-1">
              <label className="block text-sm font-medium">确认密码</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="再次输入密码"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {loading ? "注册中…" : "注册并继续"}
            </button>
          </form>
        )}

        {mode === "forgot" && (
          <form onSubmit={submitForgot} className="space-y-4">
            <div className="space-y-1">
              <label className="block text-sm font-medium">邮箱地址</label>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={loading || !passwordResetConfigured}
              className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {loading ? "发送中…" : "发送设置/重置密码邮件"}
            </button>
          </form>
        )}

        {mode === "reset" && (
          <form onSubmit={submitReset} className="space-y-4">
            <div className="space-y-1">
              <label className="block text-sm font-medium">邮箱地址</label>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-sm font-medium">新密码</label>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="至少 8 位，包含字母和数字"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-sm font-medium">确认新密码</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="再次输入新密码"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={loading || !passwordResetConfigured}
              className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {loading ? "提交中…" : "确认设置新密码"}
            </button>
          </form>
        )}

        {message && <div className="rounded-md bg-muted p-3 text-sm text-foreground">{message}</div>}
      </div>
    </div>
  );
}

function AuthFields(props: {
  email: string;
  onEmailChange: (value: string) => void;
  password: string;
  onPasswordChange: (value: string) => void;
}) {
  return (
    <>
      <div className="space-y-1">
        <label className="block text-sm font-medium">邮箱地址</label>
        <input
          type="email"
          value={props.email}
          onChange={(event) => props.onEmailChange(event.target.value)}
          placeholder="you@example.com"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
        />
      </div>
      <div className="space-y-1">
        <label className="block text-sm font-medium">密码</label>
        <input
          type="password"
          value={props.password}
          onChange={(event) => props.onPasswordChange(event.target.value)}
          placeholder="至少 8 位，包含字母和数字"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
        />
      </div>
    </>
  );
}
