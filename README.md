# Asset Closet - IT Asset Inventory Management
https://sunil-agasti.github.io/asset-closet-app/storyboard.html
Enterprise IT asset tracking system for global storage closet operations. Manages check-in, check-out, inventory tracking, user audit, and reporting for laptops, monitors, keyboards, and other equipment.

## Tech Stack

- **Frontend**: Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS
- **Backend**: Next.js API Routes (server-side)
- **Data**: Mixed flat-file storage (`users.csv`, `login_audit.csv`, `assets.xlsx`)
- **Auth**: JWT sessions (jose), encrypted PINs (AES-128-CBC + HMAC-SHA256)

## Getting Started

```bash
npm install
npm run dev
```

Open http://localhost:3000 (or the port shown in terminal).

### Required Files

- `users.csv` — Employee records (Emp_ID, Name, Role, PIN, Security Question/Answer)
- `assets.xlsx` — Asset inventory records (auto-created from legacy `assets.csv` on first run)
- `secret.key` — Encryption key for PIN storage (base64-encoded, 32 bytes)

## Features

### Login System
- Employee ID + 4-digit PIN authentication
- First-time PIN setup with security question
- Forgot PIN reset via security question validation
- PIN keypad UI optimized for iPad

### Dashboard (role-based)
| Tab | Admin | Editor | Viewer |
|-----|-------|--------|--------|
| Check-In | Y | Y | - |
| Check-Out | Y | Y | - |
| Inventory | Y | Y | Y (read-only) |
| User Audit | Y | - | - |
| Asset Log | Y | - | - |
| Reports | Y | - | - |

### Asset Operations
- **Check-In**: Register new assets or return existing ones with full metadata (Serial, Config, Type, Status, Assigned To, etc.)
- **Check-Out**: Assign available assets to users
- **Inventory**: View/search/edit all assets with inline editing, pagination, search, Excel export

## Security

### Authentication & Sessions
- JWT tokens (HS256) with 15-minute expiry, httpOnly cookies
- PIN encryption using AES-128-CBC with HMAC-SHA256 verification
- Server-side session validation via `/api/auth/me` endpoint

### Protection Measures
- **CSRF**: Double-submit cookie pattern planned
- **Rate Limiting**: In-memory rate limiter on login (10 req/min) and PIN (5 req/min) endpoints
- **Input Sanitization**: All API inputs sanitized (HTML tag stripping, digits-only for IDs)
- **Security Headers**: CSP, X-Frame-Options: DENY, X-Content-Type-Options: nosniff, X-XSS-Protection, Referrer-Policy, Permissions-Policy
- **Cookie Security**: `secure` flag in production, `sameSite: lax`, `httpOnly: true` for session

### API Routes

| Route | Method | Auth | Description |
|-------|--------|------|-------------|
| `/api/auth/login` | POST | - | Employee ID + PIN login |
| `/api/auth/logout` | POST | Session | Destroy session |
| `/api/auth/pin` | POST | Rate-limited | Set/reset PIN with security Q&A |
| `/api/auth/me` | GET | Session | Return current user from JWT |
| `/api/assets` | GET/POST | Session | List/create assets |
| `/api/assets/checkout` | POST | Session + role | Check out asset |
| `/api/assets/edit` | PATCH | Session + role | Edit asset fields |
| `/api/audit` | GET | Session + admin | Login audit log |
| `/api/reports` | GET | Session | Dashboard analytics |

## Project Structure

```
src/
  app/
    page.tsx              # Login page (Apple-style UI)
    layout.tsx            # Root layout
    globals.css           # All styles (login + dashboard)
    dashboard/page.tsx    # Main dashboard with all tabs
    api/
      auth/
        login/route.ts    # Login endpoint
        logout/route.ts   # Logout endpoint
        pin/route.ts      # PIN set/reset endpoint
        me/route.ts       # Session info endpoint
      assets/
        route.ts          # Asset CRUD
        checkout/route.ts # Check-out endpoint
        edit/route.ts     # Asset edit endpoint
      audit/route.ts      # Login audit data
      reports/route.ts    # Analytics data
  lib/
    auth.ts               # JWT session management
    crypto.ts             # PIN encryption/decryption
    csv.ts                # CSV read/write utilities
    assets-store.ts       # Asset workbook read/write + CSV migration
    constants.ts          # Status colors, roles
    rate-limit.ts         # In-memory rate limiter
    sanitize.ts           # Input sanitization
public/
  asset-logo.png          # App logo
  bg-image.avif           # Login background image
```

## Deployment

The app runs on a local network, accessed primarily via iPad (Safari). The `run_app.sh` script starts the production server.

```bash
./run_app.sh
```

## Accessibility

- WCAG AA+ compliant color contrast
- Keyboard navigation with visible focus indicators
- ARIA labels on all interactive elements
- Reduced motion and high contrast media query support
- Color-blind safe error states (icon + text + border, not color alone)
