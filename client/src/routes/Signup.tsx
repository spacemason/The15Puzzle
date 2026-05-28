import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useAuth } from "../auth";

export function SignupPage() {
  const { signup } = useAuth();
  const nav = useNavigate();
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await signup(u, p);
      nav("/", { replace: true });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <motion.form
        className="card auth-card"
        onSubmit={onSubmit}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <h2>Create your account</h2>
        <div className="field">
          <label>Pick a name</label>
          <input value={u} onChange={(e) => setU(e.target.value)} autoFocus />
        </div>
        <div className="field">
          <label>Password</label>
          <input type="password" value={p} onChange={(e) => setP(e.target.value)} />
        </div>
        {err ? <div className="error">{err}</div> : null}
        <button className="btn btn-primary" disabled={busy} type="submit">
          {busy ? "Setting things up…" : "Let’s play"}
        </button>
        <div className="switch">
          Already have an account? <Link to="/login">Sign in</Link>
        </div>
      </motion.form>
    </div>
  );
}
