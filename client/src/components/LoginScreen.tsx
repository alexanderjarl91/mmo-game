import { useState } from "react";

interface Props {
  onLogin: (token: string) => void;
}

const API_BASE = `${window.location.protocol}//${window.location.host}`;

type Mode = "login" | "register" | "forgot" | "reset";

export default function LoginScreen({ onLogin }: Props) {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Login failed");
        return;
      }
      onLogin(data.token);
    } catch {
      setError("Connection failed");
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Registration failed");
        return;
      }
      onLogin(data.token);
    } catch {
      setError("Connection failed");
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    setError("");
    setSuccess("");
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed");
        return;
      }
      setSuccess("If that email exists, a reset code has been generated. Check the server console.");
      setMode("reset");
    } catch {
      setError("Connection failed");
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    setError("");
    setSuccess("");
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), token: resetCode.trim(), newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Reset failed");
        return;
      }
      setSuccess("Password updated! You can now log in.");
      setMode("login");
      setPassword("");
      setResetCode("");
      setNewPassword("");
    } catch {
      setError("Connection failed");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "login") handleLogin();
    else if (mode === "register") handleRegister();
    else if (mode === "forgot") handleForgotPassword();
    else if (mode === "reset") handleResetPassword();
  };

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)",
        color: "#fff",
        padding: 20,
        overflowY: "auto",
      }}
    >
      <h1 style={{ fontSize: 48, marginBottom: 8, letterSpacing: 2 }}>🌍 MMO World</h1>
      <p style={{ color: "#aaa", marginBottom: 24, fontSize: 16 }}>
        {mode === "login" && "Welcome back, adventurer"}
        {mode === "register" && "Create your account"}
        {mode === "forgot" && "Reset your password"}
        {mode === "reset" && "Enter your reset code"}
      </p>

      {/* Mode toggle (login / register) */}
      {(mode === "login" || mode === "register") && (
        <div style={{ display: "flex", gap: 4, marginBottom: 20 }}>
          <button
            onClick={() => { setMode("login"); setError(""); setSuccess(""); }}
            style={{
              padding: "10px 28px", fontSize: 16, borderRadius: "8px 0 0 8px",
              border: "2px solid rgba(255,255,255,0.2)",
              background: mode === "login" ? "rgba(255,255,255,0.15)" : "transparent",
              color: mode === "login" ? "#fff" : "#888",
              cursor: "pointer", fontWeight: mode === "login" ? "bold" : "normal",
            }}
          >
            Login
          </button>
          <button
            onClick={() => { setMode("register"); setError(""); setSuccess(""); }}
            style={{
              padding: "10px 28px", fontSize: 16, borderRadius: "0 8px 8px 0",
              border: "2px solid rgba(255,255,255,0.2)",
              background: mode === "register" ? "rgba(255,255,255,0.15)" : "transparent",
              color: mode === "register" ? "#fff" : "#888",
              cursor: "pointer", fontWeight: mode === "register" ? "bold" : "normal",
            }}
          >
            Register
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "center", width: 320 }}>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          autoFocus
          style={{
            padding: "12px 20px", fontSize: 18, borderRadius: 8,
            border: "2px solid rgba(255,255,255,0.2)",
            background: "rgba(255,255,255,0.1)", color: "#fff",
            outline: "none", width: "100%",
          }}
        />

        {(mode === "login" || mode === "register") && (
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            style={{
              padding: "12px 20px", fontSize: 18, borderRadius: 8,
              border: "2px solid rgba(255,255,255,0.2)",
              background: "rgba(255,255,255,0.1)", color: "#fff",
              outline: "none", width: "100%",
            }}
          />
        )}

        {mode === "reset" && (
          <>
            <input
              type="text"
              value={resetCode}
              onChange={(e) => setResetCode(e.target.value)}
              placeholder="6-digit reset code"
              maxLength={6}
              style={{
                padding: "12px 20px", fontSize: 18, borderRadius: 8,
                border: "2px solid rgba(255,255,255,0.2)",
                background: "rgba(255,255,255,0.1)", color: "#fff",
                outline: "none", width: "100%", textAlign: "center",
                letterSpacing: 8,
              }}
            />
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="New Password"
              style={{
                padding: "12px 20px", fontSize: 18, borderRadius: 8,
                border: "2px solid rgba(255,255,255,0.2)",
                background: "rgba(255,255,255,0.1)", color: "#fff",
                outline: "none", width: "100%",
              }}
            />
          </>
        )}

        {error && <div style={{ color: "#e74c3c", fontSize: 14, textAlign: "center" }}>{error}</div>}
        {success && <div style={{ color: "#2ecc71", fontSize: 14, textAlign: "center" }}>{success}</div>}

        <button
          type="submit"
          disabled={loading || !email.trim() || (mode === "login" && !password) || (mode === "register" && !password) || (mode === "reset" && (!resetCode || !newPassword))}
          style={{
            padding: "14px 32px", fontSize: 18, borderRadius: 8,
            border: "none", width: "100%",
            background: loading ? "#555" : "#3498db",
            color: "#fff", cursor: loading ? "default" : "pointer",
            fontWeight: "bold", transition: "background 0.2s",
          }}
        >
          {loading ? "..." :
            mode === "login" ? "Login" :
            mode === "register" ? "Create Account" :
            mode === "forgot" ? "Send Reset Code" :
            "Reset Password"
          }
        </button>

        {/* Forgot password link */}
        {mode === "login" && (
          <button
            type="button"
            onClick={() => { setMode("forgot"); setError(""); setSuccess(""); }}
            style={{
              background: "none", border: "none", color: "#888",
              cursor: "pointer", fontSize: 13, textDecoration: "underline",
              marginTop: 4,
            }}
          >
            Forgot password?
          </button>
        )}

        {/* Back to login from forgot/reset */}
        {(mode === "forgot" || mode === "reset") && (
          <button
            type="button"
            onClick={() => { setMode("login"); setError(""); setSuccess(""); }}
            style={{
              background: "none", border: "none", color: "#888",
              cursor: "pointer", fontSize: 13, textDecoration: "underline",
              marginTop: 4,
            }}
          >
            ← Back to Login
          </button>
        )}
      </form>
    </div>
  );
}
