import { chromium } from 'playwright';

type TimePeriod = 'morning' | 'afternoon' | 'evening';

interface BBBAlert {
  id: string;
  target_date: string;
  num_guests: number;
  time_preferences: TimePeriod[];
  notify_email: string;
  is_active: boolean;
}

interface BBBSlot {
  time: string;
  period: TimePeriod;
}

const BBB_BOOKING_URL = 'https://disneyland.disney.go.com/enchanting-extras-collection/booking-bibbidi-bobbidi-boutique/';
const API_BASE_URL = process.env.VERCEL_DEPLOYMENT_URL || 'https://hopr-alerts.vercel.app';
const CRON_SECRET = process.env.CRON_SECRET;

async function main() {
  if (!CRON_SECRET) {
    console.error('CRON_SECRET is required');
    process.exit(1);
  }

  console.log('Fetching active BBB alerts...');

  // Fetch active alerts from API
  const alertsResponse = await fetch(`${API_BASE_URL}/api/bbb/notify`, {
    headers: {
      'Authorization': `Bearer ${CRON_SECRET}`,
    },
  });

  if (!alertsResponse.ok) {
    console.error('Failed to fetch alerts:', await alertsResponse.text());
    process.exit(1);
  }

  const { alerts } = await alertsResponse.json() as { alerts: BBBAlert[] };

  if (alerts.length === 0) {
    console.log('No active alerts found');
    return;
  }

  console.log(`Found ${alerts.length} active alert(s)`);

  // Process each alert
  for (const alert of alerts) {
    console.log(`\nProcessing alert ${alert.id}: ${alert.target_date}, ${alert.num_guests} guest(s), periods: ${alert.time_preferences.join(', ')}`);

    try {
      const slots = await scrapeDisney(alert);

      // Report results to API
      await reportResults(alert.id, slots, alert.time_preferences.join(','));

    } catch (error) {
      console.error(`Error processing alert ${alert.id}:`, error);
      // Report error to API
      await reportResults(alert.id, [], 'all', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  console.log('\nDone!');
}

async function scrapeDisney(alert: BBBAlert): Promise<BBBSlot[]> {
  const allSlots: BBBSlot[] = [];

  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });

    const page = await context.newPage();

    // Navigate to booking page
    console.log('Navigating to Disney booking page...');
    await page.goto(BBB_BOOKING_URL, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(3000);

    // Step 1: Select date
    console.log(`Selecting date: ${alert.target_date}`);
    const dateSelected = await selectDate(page, alert.target_date);
    if (!dateSelected) {
      throw new Error('Failed to select date');
    }

    // Click Next
    await page.click('button:has-text("Next")');
    await page.waitForTimeout(2000);

    // Step 2: Set guest count
    console.log(`Setting guest count to: ${alert.num_guests}`);
    await setGuestCount(page, alert.num_guests);

    // Click Next
    await page.click('button:has-text("Next")');
    await page.waitForTimeout(2000);

    // Step 3: Check each time period
    for (const period of alert.time_preferences) {
      console.log(`Checking ${period} availability...`);
      const slots = await checkTimePeriod(page, period);
      allSlots.push(...slots);
      console.log(`Found ${slots.length} slot(s) for ${period}`);
    }

  } finally {
    await browser.close();
  }

  return allSlots;
}

async function selectDate(page: any, targetDate: string): Promise<boolean> {
  const targetDateObj = new Date(targetDate + 'T12:00:00');
  const targetDay = targetDateObj.getDate();
  const targetMonth = targetDateObj.getMonth();
  const targetYear = targetDateObj.getFullYear();

  // Navigate to correct month
  for (let i = 0; i < 12; i++) {
    try {
      const monthYearText = await page.locator('text=/[A-Z][a-z]+ \\d{4}/').first().textContent();
      if (monthYearText) {
        const displayedDate = new Date(monthYearText + ' 1');
        if (displayedDate.getMonth() === targetMonth && displayedDate.getFullYear() === targetYear) {
          break;
        }
      }
    } catch (e) {
      // Continue
    }

    // Click next month
    try {
      await page.click('button[aria-label*="next"]');
    } catch (e) {
      await page.click('button:has-text(">")').catch(() => {});
    }
    await page.waitForTimeout(500);
  }

  // Click on the target day
  const dayButtons = await page.$$('button');
  for (const button of dayButtons) {
    try {
      const text = await button.textContent();
      if (text && text.trim() === targetDay.toString()) {
        const isDisabled = await button.getAttribute('disabled');
        const ariaDisabled = await button.getAttribute('aria-disabled');
        if (!isDisabled && ariaDisabled !== 'true') {
          await button.click();
          return true;
        }
      }
    } catch (e) {
      continue;
    }
  }

  return false;
}

async function setGuestCount(page: any, numGuests: number): Promise<void> {
  // Default is 1, click + to increase
  const plusButton = page.locator('button:has-text("+")').first();
  for (let i = 1; i < numGuests; i++) {
    await plusButton.click();
    await page.waitForTimeout(300);
  }
}

async function checkTimePeriod(page: any, period: TimePeriod): Promise<BBBSlot[]> {
  const slots: BBBSlot[] = [];

  // Click on the period tab
  const periodLabels: Record<TimePeriod, string> = {
    morning: 'Morning',
    afternoon: 'Afternoon',
    evening: 'Evening',
  };

  try {
    const periodButton = page.locator(`button:has-text("${periodLabels[period]}")`).first();
    if (await periodButton.isVisible()) {
      await periodButton.click();
      await page.waitForTimeout(2000);
    }
  } catch (e) {
    console.log(`Could not click ${period} button`);
  }

  // Check for no availability
  const noAvailCount = await page
    .locator('text=/no.*availability|sold.*out|fully.*booked|not available/i')
    .count();

  if (noAvailCount > 0) {
    return [];
  }

  // Find time slots
  const allButtons = await page.$$('button');
  for (const button of allButtons) {
    try {
      const text = await button.textContent();
      if (!text) continue;

      const timeMatch = text.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
      if (!timeMatch) continue;

      const isDisabled = await button.getAttribute('disabled');
      const ariaDisabled = await button.getAttribute('aria-disabled');
      const className = (await button.getAttribute('class')) || '';

      if (!isDisabled && ariaDisabled !== 'true' && !className.includes('disabled')) {
        slots.push({
          time: timeMatch[0],
          period,
        });
      }
    } catch (e) {
      continue;
    }
  }

  return slots;
}

async function reportResults(alertId: string, slots: BBBSlot[], timePeriod: string, error?: string) {
  console.log(`Reporting results for alert ${alertId}: ${slots.length} slot(s)${error ? ', error: ' + error : ''}`);

  const response = await fetch(`${API_BASE_URL}/api/bbb/notify`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CRON_SECRET}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      alertId,
      slots,
      timePeriod,
      error,
    }),
  });

  if (!response.ok) {
    console.error('Failed to report results:', await response.text());
  } else {
    const result = await response.json();
    console.log('Report result:', result);
  }
}

main().catch(console.error);
