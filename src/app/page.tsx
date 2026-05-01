"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

const SECURITY_QUESTIONS = [
  "Favorite movie",
  "First pet's name",
  "First city where you got your job",
];

type Step = "emp_id" | "enter_pin" | "set_pin" | "reset_pin";

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("emp_id");
  const [empId, setEmpId] = useState("");
  const [pin, setPin] = useState("");
  const [userName, setUserName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [dark, setDark] = useState(false);
  const empRef = useRef<HTMLInputElement>(null);

  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [secQuestion, setSecQuestion] = useState("");
  const [secAnswer, setSecAnswer] = useState("");

  useEffect(() => {
    const saved = localStorage.getItem("ac_theme");
    if (saved === "dark") { setDark(true); document.documentElement.setAttribute("data-theme", "dark"); }
    const t = setTimeout(() => {
      if (empRef.current) { empRef.current.focus(); empRef.current.select(); }
    }, 300);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (step === "emp_id") {
      const t = setTimeout(() => {
        if (empRef.current) { empRef.current.focus(); empRef.current.select(); }
      }, 300);
      return () => clearTimeout(t);
    }
  }, [step]);

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.setAttribute("data-theme", next ? "dark" : "light");
    localStorage.setItem("ac_theme", next ? "dark" : "light");
  };

  const detectDevice = () => {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes("ipad") || (ua.includes("macintosh") && "ontouchend" in document)) return "iPad";
    if (ua.includes("iphone")) return "iPhone";
    if (ua.includes("macintosh")) return "MacBook";
    return "Unknown";
  };

  const resetForm = () => {
    setNewPin(""); setConfirmPin(""); setSecQuestion(""); setSecAnswer(""); setError("");
  };

  const handleEmpId = async () => {
    if (!empId.trim()) return;
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-device": detectDevice() },
        body: JSON.stringify({ emp_id: empId.trim() }),
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      else {
        setUserName(data.name);
        resetForm();
        setStep(data.step === "set_pin" ? "set_pin" : "enter_pin");
      }
    } catch { setError("Connection error. Please try again."); }
    setLoading(false);
  };

  const handlePinKeypad = (digit: string) => {
    if (pin.length < 4) {
      const updated = pin + digit;
      setPin(updated);
      setError("");
      if (updated.length === 4) {
        setTimeout(() => loginWithPin(updated), 200);
      }
    }
  };

  const handlePinDelete = () => {
    setPin(pin.slice(0, -1));
    setError("");
  };

  const loginWithPin = async (p: string) => {
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-device": detectDevice() },
        body: JSON.stringify({ emp_id: empId.trim(), pin: p }),
      });
      const data = await res.json();
      if (data.error) { setError(data.error); setPin(""); setLoading(false); }
      else if (data.success) { router.push("/dashboard"); return; }
    } catch { setError("Connection error"); setPin(""); setLoading(false); }
  };

  const handleSetOrResetPin = async () => {
    setError("");
    if (!newPin || newPin.length !== 4 || !/^\d{4}$/.test(newPin)) {
      setError("PIN must be exactly 4 digits"); return;
    }
    if (newPin !== confirmPin) {
      setError("PINs do not match"); return;
    }
    if (!secQuestion) {
      setError("Please select a security question"); return;
    }
    if (!secAnswer.trim()) {
      setError("Security answer is required"); return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emp_id: empId.trim(),
          pin: newPin,
          confirm_pin: confirmPin,
          security_question: secQuestion,
          security_answer: secAnswer.trim(),
          mode: step === "reset_pin" ? "reset" : "set",
        }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        setLoading(false);
      } else {
        await loginWithPin(newPin);
      }
    } catch { setError("Connection error"); setLoading(false); }
  };

  return (
    <div className="lp" role="main">
      <a href="#login-form" className="skip-link">Skip to login form</a>

      <button onClick={toggleTheme} className="lp-theme" aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}>
        {dark ? "☀️ Light" : "🌙 Dark"}
      </button>

      <div className="lp-card" id="login-form" aria-label="Sign in to Asset Closet">
        <img src="/asset-logo.png" alt="Asset Closet Inventory" className="lp-logo" />

        {error && (
          <div className="lp-error" role="alert" aria-live="assertive">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M8 4.5v4M8 10.5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            {error}
          </div>
        )}

        {/* Step 1: Employee ID */}
        {step === "emp_id" && (
          <div className="lp-section" key="emp">
            <div className="lp-field">
              <input
                ref={empRef}
                id="empid"
                className={`lp-float-input ${empId ? "has-value" : ""} ${error ? "lp-input-err" : ""}`}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={8}
                value={empId}
                autoFocus
                placeholder=" "
                onChange={(e) => { setEmpId(e.target.value.replace(/\D/g, "")); setError(""); }}
                onKeyDown={(e) => e.key === "Enter" && empId && handleEmpId()}
                aria-label="Employee ID"
                aria-invalid={!!error}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                data-1p-ignore
                data-lpignore="true"
                data-form-type="other"
              />
              <label htmlFor="empid" className="lp-float-label">Employee ID</label>
            </div>

            <button className="lp-btn" onClick={handleEmpId} disabled={!empId.trim() || loading} aria-busy={loading}>
              {loading ? <><span className="lp-spinner" aria-hidden="true" /> Verifying...</> : "Continue"}
            </button>
          </div>
        )}

        {/* Step 2: Enter PIN */}
        {step === "enter_pin" && (
          <div className="lp-section" key="pin">
            <p className="lp-welcome" aria-live="polite">Welcome, <strong>{userName}</strong></p>
            <p className="lp-pin-label">Enter your PIN</p>

            <div className="lp-dots" aria-label={`PIN entered: ${pin.length} of 4 digits`}>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className={`lp-dot ${i < pin.length ? "filled" : ""}`} />
              ))}
            </div>

            <div className="lp-keypad" role="group" aria-label="PIN keypad">
              {["1","2","3","4","5","6","7","8","9","","0","del"].map((key) => (
                <button
                  key={key || "blank"}
                  className={`lp-key ${key === "del" ? "lp-key-del" : ""} ${key === "" ? "lp-key-blank" : ""}`}
                  onClick={() => {
                    if (key === "del") handlePinDelete();
                    else if (key) handlePinKeypad(key);
                  }}
                  disabled={key === "" || loading || (key !== "del" && pin.length >= 4)}
                  aria-label={key === "del" ? "Delete last digit" : key || undefined}
                  aria-hidden={key === "" ? "true" : undefined}
                  tabIndex={key === "" ? -1 : 0}
                >
                  {key === "del" ? "⌫" : key}
                </button>
              ))}
            </div>

            {loading && <p className="lp-loading" aria-live="polite"><span className="lp-spinner" aria-hidden="true" /> Signing in...</p>}

            <div className="lp-pin-actions">
              <button className="lp-back" onClick={() => { setStep("emp_id"); setPin(""); setError(""); }} aria-label="Go back to Employee ID entry">
                ← Different user
              </button>
              <button className="lp-forgot" onClick={() => { resetForm(); setPin(""); setStep("reset_pin"); }}>
                Forgot PIN? →
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Set PIN (first time) or Reset PIN (forgot) */}
        {(step === "set_pin" || step === "reset_pin") && (
          <div className="lp-section" key="setpin">
            <button className="lp-back-top" onClick={() => {
              resetForm();
              setStep(step === "reset_pin" ? "enter_pin" : "emp_id");
            }}>
              ← Back
            </button>

            <p className="lp-welcome">
              {step === "set_pin"
                ? <>Hello <strong>{userName}</strong>, please set your PIN.</>
                : <>Reset PIN for <strong>{userName}</strong></>
              }
            </p>

            <div className="lp-field">
              <input
                id="ac-code-1"
                name="ac-code-1"
                className={`lp-float-input ${newPin ? "has-value" : ""}`}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={4}
                value={newPin}
                onChange={(e) => { setNewPin(e.target.value.replace(/\D/g, "").slice(0, 4)); setError(""); }}
                autoComplete="off"
                placeholder=" "
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                data-1p-ignore
                data-lpignore="true"
                data-form-type="other"
                data-protonpass-ignore
              />
              <label htmlFor="ac-code-1" className="lp-float-label">New PIN (4 digits)</label>
            </div>

            <div className="lp-field">
              <input
                id="ac-code-2"
                name="ac-code-2"
                className={`lp-float-input ${confirmPin ? "has-value" : ""}`}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={4}
                value={confirmPin}
                onChange={(e) => { setConfirmPin(e.target.value.replace(/\D/g, "").slice(0, 4)); setError(""); }}
                autoComplete="off"
                placeholder=" "
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                data-1p-ignore
                data-lpignore="true"
                data-form-type="other"
                data-protonpass-ignore
              />
              <label htmlFor="ac-code-2" className="lp-float-label">Confirm PIN</label>
            </div>

            <div className="lp-field">
              <select
                id="secquestion"
                className={`lp-float-input lp-select ${secQuestion ? "has-value" : ""}`}
                value={secQuestion}
                onChange={(e) => { setSecQuestion(e.target.value); setError(""); }}
              >
                <option value="">Select security question</option>
                {SECURITY_QUESTIONS.map((q) => <option key={q} value={q}>{q}</option>)}
              </select>
              <label htmlFor="secquestion" className="lp-float-label">Security Question</label>
            </div>

            <div className="lp-field">
              <input
                id="secanswer"
                className={`lp-float-input ${secAnswer ? "has-value" : ""}`}
                type="text"
                value={secAnswer}
                onChange={(e) => { setSecAnswer(e.target.value); setError(""); }}
                autoComplete="off"
                placeholder=" "
              />
              <label htmlFor="secanswer" className="lp-float-label">Security Answer</label>
            </div>

            <button
              className="lp-btn"
              onClick={handleSetOrResetPin}
              disabled={loading || !newPin || !confirmPin || !secQuestion || !secAnswer.trim()}
              aria-busy={loading}
            >
              {loading
                ? <><span className="lp-spinner" aria-hidden="true" /> {step === "reset_pin" ? "Resetting..." : "Setting up..."}</>
                : step === "reset_pin" ? "Reset PIN & Sign In" : "Set PIN & Sign In"
              }
            </button>
          </div>
        )}

        <p className="lp-footer">Secure access for authorized personnel</p>
      </div>
    </div>
  );
}
