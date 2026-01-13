import { chromium } from 'playwright';
import type { BBBSlot, TimePeriod } from './bbb-types';

export interface BBBScrapeOptions {
  targetDate: string; // YYYY-MM-DD format
  numGuests: number;
  timePeriods: TimePeriod[];
}

export interface BBBScrapeResult {
  period: TimePeriod;
  slots: BBBSlot[];
  error?: string;
}

const BBB_BOOKING_URL = 'https://disneyland.disney.go.com/enchanting-extras-collection/booking-bibbidi-bobbidi-boutique/';

export async function scrapeBBBAvailability(
  options: BBBScrapeOptions
): Promise<BBBScrapeResult[]> {
  const { targetDate, numGuests, timePeriods } = options;
  const startTime = Date.now();
  const results: BBBScrapeResult[] = [];

  console.log(`Scraping BBB for ${numGuests} guest(s) on ${targetDate}, periods: ${timePeriods.join(', ')}`);

  let browser;
  try {
    // Launch browser with stealth settings
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
      ],
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });

    const page = await context.newPage();

    // Navigate to BBB booking page
    console.log(`Navigating to: ${BBB_BOOKING_URL}`);
    await page.goto(BBB_BOOKING_URL, {
      waitUntil: 'networkidle',
      timeout: 30000,
    });

    // Wait for page to load
    await page.waitForTimeout(3000);

    // Step 1: Select the target date from calendar
    console.log(`Selecting date: ${targetDate}`);
    const dateSelected = await selectDate(page, targetDate);
    if (!dateSelected) {
      throw new Error('Failed to select target date');
    }

    // Click Next to proceed
    await page.click('button:has-text("Next")');
    await page.waitForTimeout(2000);

    // Step 2: Set number of guests
    console.log(`Setting guests to: ${numGuests}`);
    await setGuestCount(page, numGuests);

    // Click Next to proceed
    await page.click('button:has-text("Next")');
    await page.waitForTimeout(2000);

    // Step 3: Check each time period
    for (const period of timePeriods) {
      try {
        console.log(`Checking ${period} availability...`);
        const slots = await checkTimePeriod(page, period, targetDate);
        results.push({ period, slots });
        console.log(`Found ${slots.length} slot(s) for ${period}`);
      } catch (error) {
        console.error(`Error checking ${period}:`, error);
        results.push({
          period,
          slots: [],
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    const duration = Date.now() - startTime;
    console.log(`BBB scraping completed in ${duration}ms`);

    return results;
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`BBB scraping failed after ${duration}ms:`, error);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

async function selectDate(page: any, targetDate: string): Promise<boolean> {
  const targetDateObj = new Date(targetDate + 'T12:00:00');
  const targetDay = targetDateObj.getDate();
  const targetMonth = targetDateObj.getMonth();
  const targetYear = targetDateObj.getFullYear();

  // Navigate to correct month if needed
  const maxNavigations = 12;
  for (let i = 0; i < maxNavigations; i++) {
    // Check current month displayed
    const monthYearText = await page.locator('text=/[A-Z][a-z]+ \\d{4}/').first().textContent();
    if (!monthYearText) {
      await page.waitForTimeout(1000);
      continue;
    }

    const currentMonth = new Date(monthYearText + ' 1').getMonth();
    const currentYear = new Date(monthYearText + ' 1').getFullYear();

    if (currentMonth === targetMonth && currentYear === targetYear) {
      // Found the right month, now click the day
      break;
    }

    // Navigate forward
    const nextButton = page.locator('button[aria-label*="next"], button:has(svg[aria-label*="chevron-right"])').first();
    if (await nextButton.isVisible()) {
      await nextButton.click();
      await page.waitForTimeout(500);
    } else {
      // Try clicking the > arrow button
      await page.click('button:has-text(">")').catch(() => {});
      await page.waitForTimeout(500);
    }
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
          console.log(`Clicked on day ${targetDay}`);
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
  // Look for the guest counter (+ and - buttons)
  const currentCount = await page.locator('text=/\\d+/').first().textContent();
  const current = parseInt(currentCount || '1');

  if (numGuests > current) {
    // Click + button
    const plusButton = page.locator('button:has-text("+")').first();
    for (let i = current; i < numGuests; i++) {
      await plusButton.click();
      await page.waitForTimeout(300);
    }
  } else if (numGuests < current) {
    // Click - button
    const minusButton = page.locator('button:has-text("-")').first();
    for (let i = current; i > numGuests; i--) {
      await minusButton.click();
      await page.waitForTimeout(300);
    }
  }
}

async function checkTimePeriod(page: any, period: TimePeriod, targetDate: string): Promise<BBBSlot[]> {
  const slots: BBBSlot[] = [];

  // Click on the time period tab
  const periodLabels: Record<TimePeriod, string> = {
    morning: 'Morning',
    afternoon: 'Afternoon',
    evening: 'Evening',
  };

  const label = periodLabels[period];
  const periodButton = page.locator(`button:has-text("${label}")`).first();

  if (await periodButton.isVisible()) {
    await periodButton.click();
    await page.waitForTimeout(2000);
  }

  // Check for "no availability" message
  const noAvailCount = await page
    .locator('text=/no.*availability|sold.*out|fully.*booked|no.*tables|not available/i')
    .count();

  if (noAvailCount > 0) {
    console.log(`No availability for ${period}`);
    return [];
  }

  // Look for time slot buttons
  const allButtons = await page.$$('button');

  for (const button of allButtons) {
    try {
      const text = await button.textContent();
      if (!text) continue;

      // Look for time patterns (8:00 AM, 2:30 PM, etc.)
      const timeMatch = text.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
      if (!timeMatch) continue;

      // Check if available
      const isDisabled = await button.getAttribute('disabled');
      const ariaDisabled = await button.getAttribute('aria-disabled');
      const className = (await button.getAttribute('class')) || '';

      const available =
        isDisabled === null &&
        ariaDisabled !== 'true' &&
        !className.includes('disabled');

      if (available) {
        console.log(`Found available slot: ${timeMatch[0]} (${period})`);
        slots.push({
          time: timeMatch[0],
          period,
          available: true,
        });
      }
    } catch (e) {
      continue;
    }
  }

  return slots;
}

// Helper to convert time string to period
export function getTimePeriod(timeStr: string): TimePeriod {
  const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!match) return 'morning';

  let hours = parseInt(match[1]);
  const meridiem = match[3]?.toUpperCase();

  if (meridiem === 'PM' && hours !== 12) {
    hours += 12;
  } else if (meridiem === 'AM' && hours === 12) {
    hours = 0;
  }

  if (hours < 12) return 'morning';
  if (hours < 16) return 'afternoon';
  return 'evening';
}
