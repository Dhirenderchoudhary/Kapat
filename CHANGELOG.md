# Changelog

## v0.0.4

[compare changes](https://github.com/Dhirenderchoudhary/Kapat/compare/v0.0.3...v0.0.4)

### 🩹 Fixes

- **ci:** Retry bun audit on advisory registry timeouts ([3f01280](https://github.com/Dhirenderchoudhary/Kapat/commit/3f01280))
- **ci:** Treat npm audit 503 as a registry outage, not a vuln ([271a062](https://github.com/Dhirenderchoudhary/Kapat/commit/271a062))
- **scripts:** Typecheck via @packages/db instead of a relative src import ([34dcd03](https://github.com/Dhirenderchoudhary/Kapat/commit/34dcd03))
- **auth:** Include bun types so tsdown.config typechecks ([110c465](https://github.com/Dhirenderchoudhary/Kapat/commit/110c465))
- **ci:** Do not run tsc -p when tests have no tsconfig ([3f7babb](https://github.com/Dhirenderchoudhary/Kapat/commit/3f7babb))
- **ci:** Rename bun tests so bun test tests finds them ([ab93c54](https://github.com/Dhirenderchoudhary/Kapat/commit/ab93c54))

### 📖 Documentation

- Judge-facing architecture and fix CI format plus audit timeout ([f2d8df6](https://github.com/Dhirenderchoudhary/Kapat/commit/f2d8df6))

### 🏡 Chore

- **ci:** Bump Bun to 1.4.1 so audit no longer times out ([a97c0a7](https://github.com/Dhirenderchoudhary/Kapat/commit/a97c0a7))

### 🎨 Styles

- Format docs/submission-draft.md for oxfmt ([0c0f4a7](https://github.com/Dhirenderchoudhary/Kapat/commit/0c0f4a7))

### ❤️ Contributors

- Dhirender Choudhary @Dhirenderchoudhary

## v0.0.3

[compare changes](https://github.com/Dhirenderchoudhary/Kapat/compare/v0.0.2...v0.0.3)

### 🚀 Enhancements

- **voice:** Live Sarvam agent; keep API hosts in env only ([0f5087b](https://github.com/Dhirenderchoudhary/Kapat/commit/0f5087b))

### ❤️ Contributors

- Dhirender Choudhary @Dhirenderchoudhary

## v0.0.2

[compare changes](https://github.com/Dhirenderchoudhary/Razorpay_Buildathon/compare/v0.0.1...v0.0.2)

### 🚀 Enhancements

- **detector-service:** Gate timing and promo signals on repeat occasions ([ad7fba4](https://github.com/Dhirenderchoudhary/Razorpay_Buildathon/commit/ad7fba4))
- **api:** Port Louvain into the TS fallback and report which engine ran ([7ed9d14](https://github.com/Dhirenderchoudhary/Razorpay_Buildathon/commit/7ed9d14))
- **web:** Refresh the console shell, hero and charts ([fd60e9b](https://github.com/Dhirenderchoudhary/Razorpay_Buildathon/commit/fd60e9b))

### 📖 Documentation

- Record the two-engine split and the regenerated numbers ([ce0379e](https://github.com/Dhirenderchoudhary/Razorpay_Buildathon/commit/ce0379e))

### 🏡 Chore

- **data:** Regenerate model and evaluation artifacts ([3814bae](https://github.com/Dhirenderchoudhary/Razorpay_Buildathon/commit/3814bae))

### ✅ Tests

- Pin cross-engine detector parity and the occasion floor ([73db13b](https://github.com/Dhirenderchoudhary/Razorpay_Buildathon/commit/73db13b))

### ❤️ Contributors

- Dhirender Choudhary @Dhirenderchoudhary

## v0.0.1

### 🚀 Enhancements

- Build fraud ring detection platform and agentic verification ([a60c833](https://github.com/Dhirenderchoudhary/Razorpay_Buildathon/commit/a60c833))
- **api:** Export app instance for external server adapters ([353417f](https://github.com/Dhirenderchoudhary/Razorpay_Buildathon/commit/353417f))
- **api:** Bundle synthetic demo data and evidence reports into serverless build ([842d166](https://github.com/Dhirenderchoudhary/Razorpay_Buildathon/commit/842d166))
- **detector:** Add pure TypeScript graph detection fallback for serverless execution ([b1bcd41](https://github.com/Dhirenderchoudhary/Razorpay_Buildathon/commit/b1bcd41))
- **db,api:** Add razorpay session persistence and live sync polling ([3fe62f8](https://github.com/Dhirenderchoudhary/Razorpay_Buildathon/commit/3fe62f8))
- **detector:** Implement ML comparison, hard dataset generator, and model scoring ([5f88c0f](https://github.com/Dhirenderchoudhary/Razorpay_Buildathon/commit/5f88c0f))
- **data:** Add model benchmark artifacts and comparison datasets ([2c9f7ff](https://github.com/Dhirenderchoudhary/Razorpay_Buildathon/commit/2c9f7ff))
- **web:** Update interactive fraud dashboard, animated charts, and evidence visualizers ([f45605a](https://github.com/Dhirenderchoudhary/Razorpay_Buildathon/commit/f45605a))

### 🔥 Performance

- **db:** Increase connection pool capacity for concurrent analytics ([3f1bf77](https://github.com/Dhirenderchoudhary/Razorpay_Buildathon/commit/3f1bf77))
- **analytics:** Optimize analytics query path for zero cold-start latency ([8a59fb5](https://github.com/Dhirenderchoudhary/Razorpay_Buildathon/commit/8a59fb5))

### 🩹 Fixes

- **ci:** Make migrate-on-deploy resilient against db timeouts ([78c5f1c](https://github.com/Dhirenderchoudhary/Razorpay_Buildathon/commit/78c5f1c))
- **web:** Prevent self-referencing API rewrite loop ([6bbc22e](https://github.com/Dhirenderchoudhary/Razorpay_Buildathon/commit/6bbc22e))
- **vercel:** Use turbo run in vercel.json configurations ([d6fa694](https://github.com/Dhirenderchoudhary/Razorpay_Buildathon/commit/d6fa694))
- **db:** Switch to postgres.js driver with universal SSL support ([95a8a14](https://github.com/Dhirenderchoudhary/Razorpay_Buildathon/commit/95a8a14))
- **api:** Improve error handler diagnostics ([e134961](https://github.com/Dhirenderchoudhary/Razorpay_Buildathon/commit/e134961))
- **db:** Disable prepared statements for Supabase pooler compatibility ([73d68ce](https://github.com/Dhirenderchoudhary/Razorpay_Buildathon/commit/73d68ce))
- **web:** Directly target NEXT_PUBLIC_API_URL in browser client ([71406c4](https://github.com/Dhirenderchoudhary/Razorpay_Buildathon/commit/71406c4))
- **web:** Hardcode live api fallback url in client config and rewrites ([f914777](https://github.com/Dhirenderchoudhary/Razorpay_Buildathon/commit/f914777))
- **clusters:** Fix conditional where query and total count in list handler ([2da7509](https://github.com/Dhirenderchoudhary/Razorpay_Buildathon/commit/2da7509))
- **clusters:** Safe Date conversion and direct total paging ([16f5a10](https://github.com/Dhirenderchoudhary/Razorpay_Buildathon/commit/16f5a10))

### 📖 Documentation

- Update algorithm writeup, buildathon submission draft, README, and handoff ([1115fa1](https://github.com/Dhirenderchoudhary/Razorpay_Buildathon/commit/1115fa1))

### 📦 Build

- **turbo:** Add razorpay env vars to globalEnv ([59e49c7](https://github.com/Dhirenderchoudhary/Razorpay_Buildathon/commit/59e49c7))

### 🎨 Styles

- **web:** Enhance Pro Max UI visuals, glassmorphic layout, and network graph ([86eb723](https://github.com/Dhirenderchoudhary/Razorpay_Buildathon/commit/86eb723))

### ❤️ Contributors

- Dhirender Choudhary @Dhirenderchoudhary
