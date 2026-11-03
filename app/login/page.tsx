import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { LoginForm } from "@/components/auth/LoginForm";
import { getSessionUserId } from "@/lib/data/session";

export const metadata: Metadata = { title: "Log in" };

/** Already signed in → straight to the Dashboard. */
async function SignedInRedirect() {
  if (await getSessionUserId()) redirect("/");
  return null;
}

function TruckMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="login-brand-mark">
      <path
        d="M3 6.5h11v10H3zM14 10h3.8l3.2 3.3v3.2h-7z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M6.5 19a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6ZM18 19a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6Z" fill="currentColor" />
    </svg>
  );
}

export default function LoginPage() {
  return (
    <main className="login-page">
      <Suspense>
        <SignedInRedirect />
      </Suspense>
      <div className="login-glow login-glow-blue" aria-hidden="true" />
      <div className="login-glow login-glow-teal" aria-hidden="true" />
      <svg className="login-map" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          <pattern id="login-grid" width="48" height="48" patternUnits="userSpaceOnUse">
            <path d="M48 0H0v48" fill="none" stroke="white" strokeOpacity=".045" />
          </pattern>
        </defs>
        <path fill="url(#login-grid)" d="M0 0h1440v900H0z" />
        <path id="login-truck-route" className="login-route login-route-blue" d="M-40 680C160 540 225 720 430 565s262-40 405-205 270-120 650-345" />
        <path className="login-route login-route-teal" d="M-20 200c220 110 300-65 485 70s265 340 475 260 290-125 540 80" />
        <g className="login-moving-truck" aria-hidden="true">
          <animateMotion dur="30s" repeatCount="indefinite" rotate="auto" calcMode="linear">
            <mpath href="#login-truck-route" />
          </animateMotion>
          <g transform="translate(-27 -14)">
            <path d="M2 -10h31v19H2z" fill="#91a8ff" stroke="#e8eeff" strokeWidth="1.5" />
            <path d="M33 -7h11l8 8v8H33z" fill="#5ee0c4" stroke="#e8eeff" strokeWidth="1.5" strokeLinejoin="round" />
            <path d="M36 -4h6l5 5H36z" fill="#0a1530" />
            <g className="login-wheel" transform="translate(13 10)">
              <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="0.45s" repeatCount="indefinite" additive="sum" />
              <circle r="5" fill="#101c38" stroke="#dce5ff" strokeWidth="1.5" />
              <path d="M0 0v-3.5" stroke="#5ee0c4" strokeWidth="1.5" />
            </g>
            <g className="login-wheel" transform="translate(40 10)">
              <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="0.45s" repeatCount="indefinite" additive="sum" />
              <circle r="5" fill="#101c38" stroke="#dce5ff" strokeWidth="1.5" />
              <path d="M0 0v-3.5" stroke="#5ee0c4" strokeWidth="1.5" />
            </g>
          </g>
        </g>
        <circle className="login-map-pulse" cx="834" cy="360" r="7" />
        <circle cx="834" cy="360" r="4" fill="#5ee0c4" />
        <circle cx="338" cy="600" r="4" fill="#91a8ff" />
        <circle cx="1167" cy="593" r="4" fill="#91a8ff" />
      </svg>

      <div className="login-content">
        <header className="login-header">
          <a href="/login" className="login-brand" aria-label="LR Manager home">
            <span className="login-brand-icon"><TruckMark /></span>
            <span>LR <strong>Manager</strong></span>
          </a>
          <span className="login-header-note"><span className="login-status-dot" /> Transport operations, in sync</span>
        </header>

        <section className="login-stage" aria-labelledby="login-title">
          <div className="login-intro">
            <p className="login-eyebrow"><span /> YOUR OPERATIONS, MOVING FORWARD</p>
            <h1 id="login-title">Every consignment.<br /><span>Under control.</span></h1>
            <p className="login-intro-copy">A clearer view of your loads, documents, and deliveries starts here.</p>
            <div className="login-feature-list" aria-label="LR Manager features">
              <div><span className="login-feature-icon">✓</span><span>Track every LR from dispatch to delivery</span></div>
              <div><span className="login-feature-icon">✓</span><span>Keep invoices and PODs together</span></div>
              <div><span className="login-feature-icon">✓</span><span>See what needs attention, at a glance</span></div>
            </div>
          </div>

          <div className="login-card-wrap">
            <div className="login-card-accent" aria-hidden="true" />
            <div className="login-card">
              <div className="login-card-heading">
                <div className="login-card-mark"><TruckMark /></div>
                <p className="login-card-kicker">WELCOME BACK</p>
                <h2>Log in to your account</h2>
                <p className="login-card-copy">Use your company code and account details to continue.</p>
              </div>
              <Suspense fallback={<div className="login-form-loading" aria-label="Loading login form" />}>
                <LoginForm />
              </Suspense>
              <p className="login-security"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.5 16 5v4.2c0 4-2.6 6.9-6 8.3-3.4-1.4-6-4.3-6-8.3V5l6-2.5Z" /><path d="m7.5 9.8 1.7 1.7 3.5-3.7" /></svg> Your account is protected with secure sign-in</p>
            </div>
            <div className="login-float login-float-top"><span>✓</span> Delivery confirmed</div>
            <div className="login-float login-float-bottom"><span className="login-float-pin">↗</span> Live fleet overview</div>
          </div>
        </section>

        <footer className="login-footer">
          <span>LR Manager <span className="login-footer-sep">·</span> Freight operations, made simpler</span>
          <span className="login-footer-right">Built for the road ahead <span aria-hidden="true">↗</span></span>
        </footer>
      </div>

      <style>{`
        .login-page,.login-page *{box-sizing:border-box}.login-page{position:relative;isolation:isolate;display:flex;min-height:100svh;overflow:hidden;background:#0a1530;color:#e8eeff;font-family:var(--font-sans);}
        .login-glow{position:absolute;z-index:-1;border-radius:999px;filter:blur(90px);pointer-events:none}
        .login-glow-blue{width:440px;height:440px;left:-190px;top:-180px;background:#2848c4;opacity:.42}
        .login-glow-teal{width:420px;height:420px;right:-160px;bottom:-220px;background:#0c9c8d;opacity:.22}
        .login-map{position:absolute;inset:0;width:100%;height:100%;z-index:-1;pointer-events:none}
        .login-route{fill:none;stroke-width:1.5;stroke-dasharray:6 10;animation:login-route-flow 34s linear infinite}
        .login-route-blue{stroke:#6f8cff;stroke-opacity:.36}.login-route-teal{stroke:#5ee0c4;stroke-opacity:.25;animation-direction:reverse}
        .login-map-pulse{fill:none;stroke:#5ee0c4;stroke-width:1.5;animation:login-pulse 2.8s ease-out infinite;transform-box:fill-box;transform-origin:center}
        .login-content{box-sizing:border-box;width:min(1120px,100%);min-height:100svh;margin:auto;padding:30px 38px 22px;display:flex;flex-direction:column}
        .login-header,.login-footer{display:flex;align-items:center;justify-content:space-between;gap:20px}
        .login-brand{display:inline-flex;align-items:center;gap:10px;color:#f7f9ff;text-decoration:none;font-size:19px;font-weight:500;letter-spacing:-.04em}
        .login-brand strong{color:#8ea5ff;font-weight:600}.login-brand-icon{display:grid;width:36px;height:36px;place-items:center;border:1px solid rgba(255,255,255,.14);border-radius:11px;background:rgba(255,255,255,.08);color:#83a0ff}
        .login-brand-mark{width:23px;height:23px}.login-header-note{display:flex;align-items:center;gap:9px;color:#9caed5;font-size:12px;letter-spacing:.02em}
        .login-status-dot{width:7px;height:7px;border-radius:50%;background:#5ee0c4;box-shadow:0 0 12px #5ee0c4}
        .login-stage{display:grid;grid-template-columns:minmax(0,1fr) minmax(360px,440px);align-items:center;gap:clamp(48px,9vw,130px);flex:1;padding:48px 4.5%}
        .login-intro{max-width:475px;animation:login-rise .65s ease-out both}.login-eyebrow{display:flex;align-items:center;gap:9px;margin:0 0 22px;color:#8ea5ff;font-size:10px;font-weight:700;letter-spacing:.17em}
        .login-eyebrow span{width:21px;height:1px;background:#5ee0c4}.login-intro h1{margin:0;color:#f8faff;font-size:clamp(38px,5.2vw,61px);font-weight:500;line-height:1.08;letter-spacing:-.055em}.login-intro h1 span{color:#9aafff}
        .login-intro-copy{max-width:370px;margin:20px 0 0;color:#a8b6d6;font-size:15px;line-height:1.7}
        .login-feature-list{display:grid;gap:15px;margin-top:34px;color:#d5def1;font-size:13px}.login-feature-list>div{display:flex;align-items:center;gap:11px}
        .login-feature-icon{display:grid;width:20px;height:20px;place-items:center;border:1px solid rgba(94,224,196,.35);border-radius:50%;color:#5ee0c4;font-size:12px}
        .login-card-wrap{position:relative;box-sizing:border-box;animation:login-rise .75s cubic-bezier(.2,.8,.2,1) .08s both}.login-card-accent{position:absolute;inset:-1px;border-radius:21px;background:linear-gradient(135deg,rgba(142,165,255,.5),rgba(94,224,196,.14) 48%,rgba(142,165,255,.08));filter:blur(1px)}
        .login-card{position:relative;box-sizing:border-box;width:100%;border:1px solid rgba(255,255,255,.75);border-radius:20px;background:#fff;padding:31px 32px 23px;color:#111827;box-shadow:0 32px 90px rgba(0,0,0,.38)}
        .login-card-heading{text-align:center}.login-card-mark{display:grid;width:43px;height:43px;margin:0 auto 15px;place-items:center;border-radius:13px;background:#edf1ff;color:#24428f}.login-card-mark .login-brand-mark{width:25px;height:25px}
        .login-card-kicker{margin:0 0 7px;color:#5169b1;font-size:10px;font-weight:700;letter-spacing:.16em}.login-card-heading h2{margin:0;color:#18233c;font-size:23px;font-weight:600;letter-spacing:-.035em}
        .login-card-copy{margin:8px 0 22px;color:#68748a;font-size:13px;line-height:1.55}.login-security{display:flex;align-items:center;justify-content:center;gap:7px;margin:19px 0 0;color:#778197;font-size:11px}.login-security svg{width:15px;height:15px;fill:none;stroke:#7182ad;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
        .login-form-loading{height:310px;border-radius:10px;background:linear-gradient(90deg,#f4f6fa,#fff,#f4f6fa);background-size:200% 100%;animation:login-loading 1.4s ease infinite}
        .login-float{position:absolute;z-index:1;display:flex;align-items:center;gap:8px;padding:10px 13px;border:1px solid rgba(255,255,255,.14);border-radius:12px;background:rgba(18,34,69,.84);box-shadow:0 12px 30px rgba(0,0,0,.2);color:#e5ecff;font-size:11px;backdrop-filter:blur(12px);animation:login-float 5s ease-in-out infinite alternate}
        .login-float-top{top:62px;right:-34px}.login-float-top>span{display:grid;width:18px;height:18px;place-items:center;border-radius:50%;background:rgba(94,224,196,.16);color:#5ee0c4}.login-float-bottom{bottom:18px;left:-42px;animation-delay:-2.2s}.login-float-pin{color:#7e9aff;font-size:17px}
        .login-footer{padding-top:18px;color:#8192b8;font-size:11px}.login-footer-sep{padding:0 5px;color:#5ee0c4}.login-footer-right{display:flex;align-items:center;gap:8px}.login-footer-right span{color:#5ee0c4}
        @keyframes login-route-flow{to{stroke-dashoffset:-320}}@keyframes login-pulse{0%{transform:scale(.7);opacity:.8}100%{transform:scale(3.2);opacity:0}}
        @keyframes login-rise{from{opacity:0;transform:translateY(15px)}to{opacity:1;transform:translateY(0)}}@keyframes login-float{to{transform:translateY(-7px)}}
        @keyframes login-loading{to{background-position:-200% 0}}
        @media(max-width:850px){.login-content{padding:24px 26px 18px}.login-stage{grid-template-columns:minmax(0,1fr) minmax(330px,400px);gap:32px;padding:38px 1%}.login-intro h1{font-size:clamp(34px,5vw,48px)}.login-float-top{right:-15px}.login-float-bottom{left:-15px}}
        @media(max-width:680px){.login-page{width:100%;max-width:100vw;overflow-x:hidden;overflow-y:auto}.login-content{width:100%;max-width:100vw;padding:20px 18px 16px}.login-header-note{font-size:0}.login-header-note .login-status-dot{width:8px;height:8px}.login-stage{display:flex;flex-direction:column;justify-content:center;gap:25px;width:100%;min-width:0;max-width:calc(100vw - 36px);padding:32px 0}.login-intro{width:100%;max-width:calc(100vw - 36px);text-align:center}.login-eyebrow{justify-content:center;margin-bottom:12px;font-size:9px}.login-intro h1{font-size:clamp(27px,7.5vw,35px)}.login-intro-copy{max-width:calc(100vw - 56px);margin:11px auto 0;font-size:13px}.login-feature-list{display:none}.login-card-wrap{flex:0 1 auto;width:calc(100vw - 36px);max-width:420px;min-width:0}.login-card{width:100%;max-width:100%;padding:25px 23px 20px}.login-card-copy{margin-bottom:18px}.login-float{display:none}.login-footer{font-size:10px}.login-footer-right{display:none}}
        @media(max-width:390px){.login-card{padding:22px 18px 18px}.login-card-heading h2{font-size:21px}.login-content{padding-inline:14px}}
        @media(prefers-reduced-motion:reduce){.login-route,.login-map-pulse,.login-card-wrap,.login-intro,.login-float,.login-form-loading{animation:none!important}.login-route{stroke-dasharray:none}.login-moving-truck{display:none}}
      `}</style>
    </main>
  );
}
