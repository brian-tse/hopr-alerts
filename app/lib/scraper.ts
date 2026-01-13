import { chromium } from 'playwright';
import type { ReservationSlot } from './types';

export interface ScrapeOptions {
  partySize: number;
  targetDate: string; // YYYY-MM-DD format
}

export async function scrapeOpenTable(
  options: ScrapeOptions
): Promise<ReservationSlot[]> {
  const { partySize, targetDate } = options;
  const startTime = Date.now();

  console.log(`Scraping OpenTable for ${partySize} people on ${targetDate}`);

  let browser;
  try {
    // Launch browser
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

    // Navigate to restaurant page (not with query params, those don't work well)
    const baseUrl = 'https://www.opentable.com/house-of-prime-rib';
    console.log(`Navigating to: ${baseUrl}`);

    await page.goto(baseUrl, {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    // Wait for page to fully load
    await page.waitForTimeout(3000);

    // Scroll to reveal booking widget
    await page.evaluate(() => window.scrollBy(0, 300));
    await page.waitForTimeout(1000);

    // Set party size (use second selector - sticky widget)
    console.log(`Setting party size to ${partySize}...`);
    const partySizeSelector = page.locator('select[data-test="party-size-picker"]').nth(1);
    await partySizeSelector.waitFor({ state: 'attached', timeout: 10000 });
    await partySizeSelector.selectOption(partySize.toString());
    await page.waitForTimeout(1500);

    // Click date picker
    const datePicker = page.locator('[data-test="day-picker"]').nth(1);
    await datePicker.waitFor({ state: 'attached', timeout: 10000 });
    await datePicker.click();
    await page.waitForTimeout(2000);

    // Try to select the target date
    const targetDay = new Date(targetDate).getDate();
    console.log(`Looking for date: ${targetDay}`);

    const dateButtons = await page.$$('button');
    let dateClicked = false;

    for (const button of dateButtons) {
      try {
        const text = await button.textContent();
        if (text && text.trim() === targetDay.toString()) {
          const isDisabled = await button.getAttribute('disabled');
          if (!isDisabled) {
            await button.click();
            dateClicked = true;
            console.log(`Clicked date ${targetDay}`);
            break;
          }
        }
      } catch (e) {
        // Continue
      }
    }

    if (!dateClicked) {
      console.log('Could not click specific date, using default');
    }

    // Wait for times to load
    await page.waitForTimeout(3000);

    // Check for "no availability" message
    const noAvailCount = await page
      .locator('text=/no.*availability|sold.*out|fully.*booked|no.*tables/i')
      .count();

    if (noAvailCount > 0) {
      console.log('No availability message found');
      return [];
    }

    // Extract time slots from buttons
    const slots: ReservationSlot[] = [];
    const allButtons = await page.$$('button');

    console.log(`Checking ${allButtons.length} buttons for time slots...`);

    for (const button of allButtons) {
      try {
        const text = await button.textContent();
        if (!text) continue;

        // Look for time patterns (7:30 PM, 9:30 PM, etc.)
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
          console.log(`Found available slot: ${timeMatch[0]}`);
          slots.push({
            date: targetDate,
            time: timeMatch[0],
            partySize: partySize,
            available: true,
          });
        }
      } catch (e) {
        // Skip elements that cause errors
        continue;
      }
    }

    const duration = Date.now() - startTime;
    console.log(
      `Scraping completed in ${duration}ms. Found ${slots.length} available slots`
    );

    return slots;
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`Scraping failed after ${duration}ms:`, error);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// Helper function to get the next occurrence of a specific day
export function getNextDayOfWeek(dayName: string): string {
  const days = [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
  ];
  const targetDay = days.indexOf(dayName);

  if (targetDay === -1) {
    throw new Error(`Invalid day name: ${dayName}`);
  }

  const today = new Date();
  const todayDay = today.getDay();

  let daysUntilTarget = targetDay - todayDay;
  if (daysUntilTarget <= 0) {
    daysUntilTarget += 7;
  }

  const targetDate = new Date(today);
  targetDate.setDate(today.getDate() + daysUntilTarget);

  return targetDate.toISOString().split('T')[0];
}

// Helper function to filter slots by time window
export function filterSlotsByTimeWindow(
  slots: ReservationSlot[],
  windowStart: string,
  windowEnd: string
): ReservationSlot[] {
  return slots.filter((slot) => {
    // Convert time to 24-hour format for comparison
    let slotTime = slot.time;

    // Parse time like "4:00 PM" or "16:00"
    const match = slotTime.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
    if (!match) return false;

    let hours = parseInt(match[1]);
    const minutes = match[2];
    const meridiem = match[3]?.toUpperCase();

    if (meridiem === 'PM' && hours !== 12) {
      hours += 12;
    } else if (meridiem === 'AM' && hours === 12) {
      hours = 0;
    }

    const slotTime24 = `${hours.toString().padStart(2, '0')}:${minutes}:00`;

    return slotTime24 >= windowStart && slotTime24 <= windowEnd;
  });
}
