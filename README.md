# House of Prime Rib Reservation Monitor

Automated OpenTable reservation monitoring system for House of Prime Rib in San Francisco. Get notified via email when reservations become available for your preferred party size, days, and time windows.

## Features

- 🔍 Automated OpenTable scraping every 15 minutes
- 📧 Email notifications via Resend
- 🎯 Customizable alerts (party size, days, time windows)
- 🎨 Beautiful UI for managing alerts
- 💾 PostgreSQL database via Supabase
- ⚡ Serverless deployment on Vercel

## Tech Stack

- **Framework**: Next.js 16+ with App Router
- **Language**: TypeScript
- **Database**: Supabase (PostgreSQL)
- **Scraping**: Playwright with stealth plugin
- **Emails**: Resend
- **Hosting**: Vercel
- **Scheduling**: Vercel Cron Jobs

## Setup Instructions

### 1. Prerequisites

- Node.js 18+ installed
- Supabase account (free tier works)
- Resend account (free tier: 3,000 emails/month)
- Vercel account (free tier works)

### 2. Clone and Install

\`\`\`bash
cd hopr-alerts
npm install
\`\`\`

### 3. Set Up Supabase

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to SQL Editor and run the schema:

\`\`\`bash
# Copy the contents of supabase/schema.sql
\`\`\`

3. Get your credentials:
   - Project URL: Settings → API → Project URL
   - Anon Key: Settings → API → Project API keys → anon public
   - Service Role Key: Settings → API → Project API keys → service_role (keep secret!)

### 4. Set Up Resend

1. Sign up at [resend.com](https://resend.com)
2. Add and verify your domain (or use their test domain)
3. Create an API key: API Keys → Create API Key
4. Update `app/lib/notifications.ts` line 23 with your verified sender email

### 5. Configure Environment Variables

Copy the `.env.local` file and fill in your credentials:

\`\`\`bash
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Resend API for email notifications
RESEND_API_KEY=re_your_api_key

# Cron job security (generate a random string)
CRON_SECRET=your-random-secret-here

# OpenTable Configuration
HOPR_RESTAURANT_URL=https://www.opentable.com/house-of-prime-rib-reservations-san-francisco
\`\`\`

To generate a secure CRON_SECRET:
\`\`\`bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
\`\`\`

### 6. Test Locally

\`\`\`bash
npm run dev
\`\`\`

Visit http://localhost:3000

### 7. Test the Scraper

Before deploying, test if the scraper works:

\`\`\`bash
# Visit this URL in your browser:
http://localhost:3000/api/check?partySize=4&day=Friday
\`\`\`

If you get errors about selectors not found, you'll need to:
1. Visit OpenTable manually in a browser
2. Inspect the DOM to find the correct selectors for time slots
3. Update `app/lib/scraper.ts` with the actual selectors

### 8. Deploy to Vercel

\`\`\`bash
# Install Vercel CLI
npm install -g vercel

# Deploy
vercel

# Set environment variables in Vercel dashboard:
# Project Settings → Environment Variables
# Add all variables from .env.local
\`\`\`

The cron job will automatically start running every 15 minutes.

## Usage

### Create an Alert

1. Visit your deployed URL
2. Click "Create New Alert"
3. Fill in:
   - Party size (4, 6, or 8)
   - Days (Friday, Saturday, or both)
   - Time window (default 4pm-8pm)
   - Email address
4. Click "Create Alert"

### Manage Alerts

- **Pause**: Temporarily stop checking
- **Activate**: Resume checking
- **Delete**: Remove alert permanently

### Monitor Activity

Check Supabase dashboard:
- `hopr_check_history`: See all check attempts and results
- `hopr_notifications`: See all sent notifications

## How It Works

1. **Vercel Cron** triggers `/api/cron` every 15 minutes
2. **Cron handler** fetches active alerts from Supabase
3. **Scraper** uses Playwright to check OpenTable for each alert
4. **Filter** applies time window preferences
5. **Notifier** sends emails for new availability (deduplicates)
6. **Logger** records all checks to database

## Troubleshooting

### Scraper Not Finding Slots

OpenTable's DOM structure may have changed. To fix:

1. Visit OpenTable manually
2. Open DevTools (F12) → Elements
3. Find time slot elements
4. Update selectors in `app/lib/scraper.ts` lines 62-68

### Not Receiving Emails

1. Check Resend dashboard for sending errors
2. Verify sender email is verified in Resend
3. Check spam folder
4. Review `hopr_notifications` table in Supabase

### Cron Job Not Running

1. Check Vercel dashboard → Project → Cron
2. Verify `CRON_SECRET` environment variable is set
3. Check deployment logs in Vercel

### OpenTable Blocking Requests

If getting blocked:
1. Reduce check frequency in `vercel.json`
2. Consider using a proxy service (ScraperAPI, Bright Data)
3. Update user agent in `app/lib/scraper.ts`

## API Endpoints

### GET /api/alerts
Fetch all alerts

### POST /api/alerts
Create new alert
\`\`\`json
{
  "party_size": 4,
  "target_days": ["Friday", "Saturday"],
  "window_start": "16:00:00",
  "window_end": "20:00:00",
  "notify_email": "your@email.com"
}
\`\`\`

### PATCH /api/alerts?id=xxx
Update alert (toggle active status, etc.)

### DELETE /api/alerts?id=xxx
Delete alert

### GET /api/check?partySize=4&day=Friday
Manual scraper test (no auth required locally)

### GET /api/cron
Triggered by Vercel Cron (requires CRON_SECRET)

## Database Schema

### hopr_alerts
Stores user alert preferences

### hopr_check_history
Logs every check attempt (for debugging)

### hopr_notifications
Tracks sent notifications (prevents duplicates)

## Cost Estimate

With default configuration:
- **Vercel**: $0 (Hobby tier)
- **Supabase**: $0 (Free tier: 500MB database)
- **Resend**: $0 (Free tier: 3,000 emails/month)
- **Total**: $0/month

## Security Notes

- Never commit `.env.local` to git
- Keep `SUPABASE_SERVICE_ROLE_KEY` secret
- Keep `CRON_SECRET` secret
- Use environment variables in Vercel dashboard

## Legal Considerations

Web scraping exists in a legal gray area. While scraping publicly available data is generally legal (hiQ Labs v. LinkedIn), always:
- Review OpenTable's Terms of Service
- Use reasonable request rates (15 min is conservative)
- Don't overwhelm their servers
- This tool is for personal use

## Future Enhancements

- [ ] Support for multiple restaurants
- [ ] SMS notifications via Twilio
- [ ] Date range selection (not just next Fri/Sat)
- [ ] Auto-booking (requires OpenTable API access)
- [ ] Analytics dashboard
- [ ] Multi-user authentication

## Support

Issues? Questions?
1. Check troubleshooting section above
2. Review Vercel deployment logs
3. Check Supabase SQL logs
4. Verify all environment variables are set

## License

MIT - Use at your own risk
