import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { login } from "../lib/api";
import { Store, Loader2 } from "lucide-react";

export default function Login() {
  const [mobile, setMobile] = useState("9800000001");
  const [password, setPassword] = useState("demo1234");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const nav = useNavigate();

  async function submit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(mobile.trim(), password);
      toast.success("Signed in");
      nav("/");
    } catch (e) {
      const msg = e?.response?.data?.error || e.message;
      const code = e?.response?.data?.code;
      setError(code === "DEVICE_LIMIT_EXCEEDED"
        ? `Too many devices — visit the Devices page on another logged-in device to sign one out.`
        : msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <form onSubmit={submit} className="card p-8 w-full max-w-md space-y-6" data-testid="login-form">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-violet-600 text-white grid place-items-center">
            <Store size={20} />
          </div>
          <div>
            <div className="text-lg font-semibold" data-testid="login-heading">KiranaOS</div>
            <div className="text-sm text-slate-500">Sign in to your shop</div>
          </div>
        </div>

        <div className="space-y-4">
          <label className="block">
            <span className="block text-sm text-slate-600 mb-1">Mobile</span>
            <input
              className="w-full border border-slate-300 rounded-lg px-3 py-2"
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              required
              inputMode="tel"
              data-testid="login-mobile-input"
            />
          </label>
          <label className="block">
            <span className="block text-sm text-slate-600 mb-1">Password</span>
            <input
              type="password"
              className="w-full border border-slate-300 rounded-lg px-3 py-2"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              data-testid="login-password-input"
            />
          </label>
        </div>

        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 p-2 rounded" data-testid="login-error">
            {error}
          </div>
        )}

        <button type="submit" className="btn btn-primary w-full justify-center" disabled={loading} data-testid="login-submit">
          {loading ? <Loader2 size={16} className="animate-spin" /> : null} Sign in
        </button>

        <p className="text-xs text-slate-400 text-center">
          Demo: <b>9800000001</b> / <b>demo1234</b> · owner PIN <b>1234</b>
        </p>
      </form>
    </div>
  );
}
