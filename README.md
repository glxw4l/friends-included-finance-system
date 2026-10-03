# Friends Included finance system

This project implements the Day 4 wedding guests finance assignment as a small Vercel website with server-side API routes. Supabase is the source of truth. The site writes an updatable copy to Google Sheets, accepts Telegram staff submissions, applies manager decisions, and calculates financial results from saved records.

The project starts with no practice transactions. The Test 1 and Test 2 amounts are not hard-coded; enter the supplied transactions through the channels named in the homework and make the listed decisions. The dashboard recalculates from the live Supabase records.

## What is included

- Demonstration role selector for Svetlana, Richard, Anastasia, Jean-Claude, and Kevin.
- Server-side role checks for website submissions, decisions, Telegram linking, and retry actions.
- One shared validation and persistence path for website and Telegram submissions.
- Unique transaction references, pending sale approval, expense allocation, immutable original proposals, and idempotent repeated decisions.
- Ten-percent commission pool calculation with cent rounding and the assignment’s tie-breaking order.
- Live Project A, Project B, company, overhead, awaiting-allocation, and commission totals.
- Google Sheets row updates keyed by a database-assigned row number, including after manager decisions and sync retries.
- Telegram confirmations and decision notifications sent to the chat stored on the transaction. Delivery status and errors remain on the record.
- A setup screen, manager Telegram-link form, transaction forms, approvals, retry controls, and staff record views.

## Connect the services

### 1. Supabase

Create a Supabase project and run `supabase/migrations/001_finance_system.sql` in its SQL editor. It creates the employee records and the transaction ledger. Use a Supabase secret key in the server settings; never put that key in `app.js`, `index.html`, or a public setting. The app also supports the legacy service role key while Supabase phases it out.

### 2. Google Sheets

Create a blank spreadsheet and share it with the Google service-account email as Editor. Enable the Google Sheets API in the matching Google Cloud project. The app creates the `Sales` and `Expenses` tabs and their headings on first sync. Keep those tabs blank apart from their headings because the database assigns stable row numbers for retry-safe updates. Give the instructor Viewer access after the spreadsheet is ready.

Set the service account email and private key in server-side deployment settings. For `GOOGLE_PRIVATE_KEY`, preserve the newlines or enter them as `\\n` sequences. Do not share the service-account key with the instructor.

### 3. Telegram

Create a bot with Telegram’s BotFather and set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, and a long random `TELEGRAM_WEBHOOK_SECRET`. Set a different long random value for `TELEGRAM_SETUP_SECRET`.

After deployment, select Svetlana and use **Connect Telegram bot**. The browser prompts for the setup secret and calls the protected webhook setup endpoint. Open the bot’s private chat and send `/id`; this is allowed before an employee is linked. Svetlana links the displayed numeric user ID to the employee. The employee then sends `/start`, which saves the chat ID for later website notifications.

Telegram submission formats are:

```text
/sale|S01|Olivia Rose|A|One proud uncle and an emotional grandmother|1000|50|30|20
/expense|E01|Rented suit and fake pearl necklace|Materials|120|A
```

Sale fields are reference, customer, project, description, amount, and Richard / Anastasia / Jean-Claude percentages. Expense fields are reference, description, category, amount, and proposed allocation. Use `A`, `B`, or `overhead` for the allocation. Send `/help` to the bot for the formats.

The bot identifies the employee by Telegram user ID. It will refuse submissions from an unlinked account. A user cannot assign their own employee role in the bot.

### 4. Vercel settings

Connect this folder’s GitHub repository to Vercel as a static site with Node.js API functions. The root directory is the project folder; no build command or third-party package install is needed. Add these settings in Vercel’s server-side environment variables, then redeploy:

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SECRET_KEY` | Private server-only Supabase secret key (preferred); legacy `SUPABASE_SERVICE_ROLE_KEY` also works |
| `GOOGLE_SHEETS_ID` | Spreadsheet ID from its URL |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Google service-account email |
| `GOOGLE_PRIVATE_KEY` | Google service-account private key |
| `TELEGRAM_BOT_TOKEN` | Bot token |
| `TELEGRAM_WEBHOOK_SECRET` | Secret Telegram sends with webhook requests |
| `TELEGRAM_SETUP_SECRET` | Secret required to connect the webhook from the manager screen |
| `APP_BASE_URL` | Deployed site URL, including `https://` |
| `APP_STUDENT_NAME` | Student name shown at the top of the page |
| `TELEGRAM_BOT_USERNAME` | Bot username, with or without `@` |
| `GOOGLE_SHEETS_URL` | Shareable instructor-view link |
| `GITHUB_REPOSITORY_URL` | Instructor-accessible repository link |

The application only exposes the student name and the three share links through `/api/status`. Private tokens and keys stay in server settings.

## Run locally

Copy `.env.example` to `.env`, add the service settings, then run:

```text
node local-dev.mjs
```

Open `http://localhost:3000`. The local server uses only Node’s built-in modules. It reads `.env` if present; never commit that file.

## Run the homework checks

Use the supplied order so the chat-ID behavior is visible:

1. Start the Telegram bot. Link your Telegram user ID to Richard in the manager screen. Submit S01 through the real bot.
2. Change the link to Kevin. Submit E01 through the real bot. S01 must still show Richard as its submitter and retain the original chat as its notification destination.
3. Submit S02 and E02 through the website with their matching employee roles. Submit E03 as Kevin with Company overhead.
4. Approve S01 unchanged, change S02 to 20 / 40 / 40 and approve it, allocate E01 to A, and move E02 from B to A.
5. Confirm Test 1 results: A result €700, B result €1,800, company result €2,400; commissions Richard €90, Anastasia €110, and Jean-Claude €100.
6. Add S03, S04, S05, E04, E05, E06, and E07 with the assignment’s supplied details. Link Jean-Claude before deciding S03, then link Kevin before deciding E04 and E05.
7. Change S03 to 20 / 30 / 50 and approve; approve S04 unchanged; leave S05 pending; allocate E04 to B; move E05 from A to B; leave E07 awaiting allocation.
8. Confirm Test 2 cumulative results: A €2,050, B €2,180, company €3,930; commission earned Richard €140, Anastasia €175, Jean-Claude €215. Check the actual two Sheets tabs and the Telegram delivery statuses.
9. Try the invalid split, duplicate reference, zero amount, and wrong-role actions. They must be denied by the API as well as by the interface. Use the manager retry controls to recover a failed Sheets or Telegram delivery without duplicating a row or financial record.

Share the Google Sheet with the instructor as Viewer. Submit the deployed Vercel URL in your own course spreadsheet row, without editing anyone else’s row. The assignment requires the first sale and expense to pass through the actual bot; a website-only demonstration does not satisfy that check.

## Demonstration access

The role selector is a classroom demonstration mechanism, not an account login. The API checks the selected employee’s role before processing each action as required by the assignment. Do not treat the demonstration selector as authentication for a public production finance service.
