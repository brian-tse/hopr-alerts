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
  // Parse date string directly to avoid timezone issues
  // targetDate is in YYYY-MM-DD format
  const [year, month, day] = targetDate.split('-').map(Number);
  const targetDay = day;
  const targetMonth = month - 1; // JavaScript months are 0-indexed
  const targetYear = year;

  console.log(`Selecting date: ${targetDate} (day=${targetDay}, month=${targetMonth}, year=${targetYear})`);

  // Month name mapping for parsing displayed month
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  // Navigate to correct month if needed
  const maxNavigations = 12;
  for (let i = 0; i < maxNavigations; i++) {
    // Check current month displayed
    const monthYearLocator = page.locator('text=/[A-Z][a-z]+ \\d{4}/').first();
    let monthYearText: string | null = null;

    try {
      monthYearText = await monthYearLocator.textContent({ timeout: 2000 });
    } catch (e) {
      await page.waitForTimeout(1000);
      continue;
    }

    if (!monthYearText) {
      await page.waitForTimeout(1000);
      continue;
    }

    // Parse month and year from text like "February 2026"
    const match = monthYearText.match(/([A-Z][a-z]+)\s+(\d{4})/);
    if (!match) {
      await page.waitForTimeout(500);
      continue;
    }

    const displayedMonthName = match[1];
    const displayedYear = parseInt(match[2]);
    const displayedMonth = monthNames.indexOf(displayedMonthName);

    console.log(`Calendar showing: ${displayedMonthName} ${displayedYear} (month index: ${displayedMonth})`);

    if (displayedMonth === targetMonth && displayedYear === targetYear) {
      // Found the right month, now click the day
      console.log('Found correct month');
      break;
    }

    // Determine if we need to go forward or backward
    const currentDate = new Date(displayedYear, displayedMonth, 1);
    const targetDateObj = new Date(targetYear, targetMonth, 1);

    if (targetDateObj > currentDate) {
      // Navigate forward
      const nextButton = page.locator('button[aria-label*="next"], button[aria-label*="Next"], button:has(svg[aria-label*="chevron-right"])').first();
      if (await nextButton.isVisible()) {
        await nextButton.click();
        await page.waitForTimeout(500);
      } else {
        // Try clicking a > arrow button
        await page.click('button:has-text(">")').catch(() => {});
        await page.waitForTimeout(500);
      }
    } else {
      // Navigate backward
      const prevButton = page.locator('button[aria-label*="prev"], button[aria-label*="Prev"], button:has(svg[aria-label*="chevron-left"])').first();
      if (await prevButton.isVisible()) {
        await prevButton.click();
        await page.waitForTimeout(500);
      } else {
        await page.click('button:has-text("<")').catch(() => {});
        await page.waitForTimeout(500);
      }
    }
  }

  // Try specific selectors for calendar day buttons first
  const daySelectors = [
    `[data-day="${targetDay}"]`,
    `[aria-label*="${targetDay}"]`,
    `button[data-test="day-${targetDay}"]`,
    `[role="gridcell"] button:has-text("${targetDay}")`,
  ];

  for (const selector of daySelectors) {
    try {
      const dayButton = page.locator(selector).first();
      if (await dayButton.isVisible({ timeout: 500 })) {
        const isDisabled = await dayButton.getAttribute('disabled');
        const ariaDisabled = await dayButton.getAttribute('aria-disabled');
        if (!isDisabled && ariaDisabled !== 'true') {
          await dayButton.click();
          console.log(`Clicked on day ${targetDay} using selector: ${selector}`);
          return true;
        }
      }
    } catch (e) {
      // Try next selector
    }
  }

  // Fallback: search through buttons more carefully
  const dayButtons = await page.$$('button');
  for (const button of dayButtons) {
    try {
      const text = await button.textContent();
      // Only match exact day number
      if (text && text.trim() === targetDay.toString()) {
        const isDisabled = await button.getAttribute('disabled');
        const ariaDisabled = await button.getAttribute('aria-disabled');
        if (!isDisabled && ariaDisabled !== 'true') {
          await button.click();
          console.log(`Clicked on day ${targetDay} via fallback search`);
          return true;
        }
      }
    } catch (e) {
      continue;
    }
  }

  console.error(`Failed to find clickable button for day ${targetDay}`);
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
