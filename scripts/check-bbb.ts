import { chromium, Browser } from 'playwright';

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

// Retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;

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

    let lastError: Error | null = null;
    let slots: BBBSlot[] = [];

    // Retry loop
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        console.log(`Attempt ${attempt}/${MAX_RETRIES}...`);
        slots = await scrapeDisney(alert);
        lastError = null;
        break; // Success, exit retry loop
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.error(`Attempt ${attempt} failed:`, lastError.message);

        if (attempt < MAX_RETRIES) {
          console.log(`Waiting ${RETRY_DELAY_MS}ms before retry...`);
          await sleep(RETRY_DELAY_MS);
        }
      }
    }

    if (lastError) {
      // All retries failed
      await reportResults(alert.id, [], 'all', lastError.message);
    } else {
      // Success
      await reportResults(alert.id, slots, alert.time_preferences.join(','));
    }
  }

  console.log('\nDone!');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function scrapeDisney(alert: BBBAlert): Promise<BBBSlot[]> {
  const allSlots: BBBSlot[] = [];

  console.log('Launching browser with stealth settings...');

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      '--disable-blink-features=AutomationControlled',
    ],
  });

  try {
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      locale: 'en-US',
      timezoneId: 'America/Los_Angeles',
      geolocation: { latitude: 33.8121, longitude: -117.9190 }, // Anaheim, CA
      permissions: ['geolocation'],
      extraHTTPHeaders: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Sec-Ch-Ua': '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
      },
    });

    // Add stealth scripts to evade detection
    await context.addInitScript(() => {
      // Override webdriver property
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });

      // Override plugins
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
      });

      // Override languages
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
      });

      // Override chrome property
      (window as any).chrome = {
        runtime: {},
      };

      // Override permissions
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters: any) =>
        parameters.name === 'notifications'
          ? Promise.resolve({ state: 'prompt', onchange: null } as PermissionStatus)
          : originalQuery(parameters);
    });

    const page = await context.newPage();

    // Enable console logging to see JavaScript errors
    page.on('console', (msg: any) => {
      if (msg.type() === 'error' || msg.type() === 'warn') {
        console.log(`Browser ${msg.type()}: ${msg.text()}`);
      }
    });

    page.on('pageerror', (err: Error) => {
      console.log(`Page error: ${err.message}`);
    });

    // Navigate to booking page with retry
    console.log('Navigating to Disney booking page...');
    await page.goto(BBB_BOOKING_URL, {
      waitUntil: 'networkidle',
      timeout: 60000
    });

    // Wait for page to stabilize
    await page.waitForTimeout(8000);

    // Debug: Log page info
    const pageTitle = await page.title();
    const pageUrl = page.url();
    console.log(`Page title: ${pageTitle}`);
    console.log(`Page URL: ${pageUrl}`);

    // Check if we got blocked
    const pageContent = await page.content();
    if (pageContent.includes('Access Denied') || pageContent.includes('blocked') || pageContent.includes('captcha')) {
      throw new Error('Access blocked by Disney - possible bot detection');
    }

    // Debug: Check what's on the page
    const bodyText = await page.locator('body').innerText().catch(() => '');
    console.log(`Page text (first 500 chars): ${bodyText.substring(0, 500)}`);

    // Check for common Disney page elements
    const hasForm = await page.locator('form').count();
    const hasInput = await page.locator('input').count();
    const hasSelect = await page.locator('select').count();
    const buttonCount = await page.locator('button').count();
    console.log(`Page has: ${hasForm} forms, ${hasInput} inputs, ${hasSelect} selects, ${buttonCount} buttons`);

    // Check for iframes
    const iframeCount = await page.locator('iframe').count();
    console.log(`Page has ${iframeCount} iframes`);

    // If there are iframes, try to find the booking iframe
    if (iframeCount > 0) {
      const frames = page.frames();
      console.log(`Found ${frames.length} frames total`);
      for (let i = 0; i < frames.length; i++) {
        const frame = frames[i];
        const frameName = frame.name() || 'unnamed';
        const frameUrl = frame.url();
        console.log(`Frame ${i}: name='${frameName}', url='${frameUrl}'`);
      }
    }

    // Check for shadow DOM elements
    const shadowHostCount = await page.locator('*').evaluateAll((elements) => {
      return elements.filter(el => el.shadowRoot).length;
    });
    console.log(`Page has ${shadowHostCount} shadow DOM hosts`);

    // Log all div IDs to understand page structure
    const divIds = await page.locator('div[id]').evaluateAll((elements) => {
      return elements.map(el => el.id).slice(0, 20);
    });
    console.log(`Div IDs on page: ${divIds.join(', ')}`);

    // Log the raw HTML structure
    const html = await page.content();
    console.log(`HTML length: ${html.length}`);

    // Look for the body content specifically
    const bodyHtml = html.match(/<body[^>]*>([\s\S]*?)<\/body>/)?.[1] || '';
    console.log(`Body HTML length: ${bodyHtml.length}`);
    console.log(`Body HTML (first 3000 chars): ${bodyHtml.substring(0, 3000)}`);

    // Check for noscript tags which might indicate JS dependency
    const noscriptContent = html.match(/<noscript[^>]*>([\s\S]*?)<\/noscript>/g) || [];
    console.log(`Noscript tags: ${noscriptContent.length}`);
    for (const noscript of noscriptContent) {
      console.log(`Noscript content: ${noscript.substring(0, 1000)}`);
    }

    // Check what's inside the body (first div structure)
    const firstDivs = bodyHtml.match(/<div[^>]*>/g) || [];
    console.log(`First 10 div tags: ${firstDivs.slice(0, 10).join(' ')}`);

    // Check for loading indicators or app container
    const loadingIndicators = await page.locator('text=/loading|spinner|please wait/i').count();
    console.log(`Loading indicators: ${loadingIndicators}`);

    // Check for React or app root elements
    const appRoot = await page.locator('#__next, #root, #app, [data-reactroot]').count();
    console.log(`React/App root elements: ${appRoot}`);

    // Check for script tags
    const scriptCount = await page.locator('script').count();
    console.log(`Script tags: ${scriptCount}`);

    // Step 1: Select date
    console.log(`Selecting date: ${alert.target_date}`);
    const dateSelected = await selectDate(page, alert.target_date);
    if (!dateSelected) {
      throw new Error('Failed to select date');
    }

    // Click Next
    await page.click('button:has-text("Next")');
    await page.waitForTimeout(3000);

    // Step 2: Set guest count
    console.log(`Setting guest count to: ${alert.num_guests}`);
    await setGuestCount(page, alert.num_guests);

    // Click Next
    await page.click('button:has-text("Next")');
    await page.waitForTimeout(3000);

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

  console.log(`Looking for ${targetMonth + 1}/${targetDay}/${targetYear}`);

  // Wait for calendar to be visible
  try {
    await page.waitForSelector('button', { timeout: 10000 });
  } catch (e) {
    console.log('Calendar not found');
    return false;
  }

  // Navigate to correct month (with timeout per iteration)
  for (let i = 0; i < 6; i++) {
    try {
      // Look for month/year text with timeout
      const monthYearLocator = page.locator('text=/[A-Z][a-z]+ \\d{4}/').first();
      const monthYearText = await monthYearLocator.textContent({ timeout: 3000 });

      if (monthYearText) {
        console.log(`Current calendar shows: ${monthYearText}`);
        const displayedDate = new Date(monthYearText + ' 1');
        if (displayedDate.getMonth() === targetMonth && displayedDate.getFullYear() === targetYear) {
          console.log('Found correct month');
          break;
        }
      }
    } catch (e) {
      console.log('Could not read month/year, trying to navigate anyway');
    }

    // Click next month button
    console.log('Clicking next month...');
    try {
      const nextBtn = page.locator('button[aria-label*="next"], button[aria-label*="Next"], button:has-text(">")').first();
      await nextBtn.click({ timeout: 3000 });
      await page.waitForTimeout(1000);
    } catch (e) {
      console.log('Could not click next month button');
      break;
    }
  }

  // Click on the target day
  console.log(`Looking for day ${targetDay}...`);
  const dayButtons = await page.$$('button');
  console.log(`Found ${dayButtons.length} buttons to check`);

  for (const button of dayButtons) {
    try {
      const text = await button.textContent();
      if (text && text.trim() === targetDay.toString()) {
        const isDisabled = await button.getAttribute('disabled');
        const ariaDisabled = await button.getAttribute('aria-disabled');
        if (!isDisabled && ariaDisabled !== 'true') {
          console.log(`Clicking on day ${targetDay}`);
          await button.click();
          await page.waitForTimeout(1000);
          return true;
        } else {
          console.log(`Day ${targetDay} is disabled`);
        }
      }
    } catch (e) {
      continue;
    }
  }

  console.log(`Could not find clickable day ${targetDay}`);
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
