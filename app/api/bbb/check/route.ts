import { NextRequest, NextResponse } from 'next/server';
import { scrapeBBBAvailability } from '@/app/lib/bbb-scraper';
import type { TimePeriod } from '@/app/lib/bbb-types';

// GET /api/bbb/check - Manual test endpoint for scraping
// Example: /api/bbb/check?date=2026-02-16&guests=1&periods=morning
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const targetDate = searchParams.get('date');
    const numGuests = parseInt(searchParams.get('guests') || '1');
    const periodsParam = searchParams.get('periods');

    if (!targetDate) {
      return NextResponse.json(
        { error: 'Date parameter is required (format: YYYY-MM-DD)' },
        { status: 400 }
      );
    }

    // Parse periods
    let timePeriods: TimePeriod[] = ['morning', 'afternoon', 'evening'];
    if (periodsParam) {
      timePeriods = periodsParam.split(',').map(p => p.trim() as TimePeriod);
    }

    console.log(`Manual BBB check: ${targetDate}, ${numGuests} guest(s), periods: ${timePeriods.join(', ')}`);

    const results = await scrapeBBBAvailability({
      targetDate,
      numGuests,
      timePeriods,
    });

    const totalSlots = results.reduce((sum, r) => sum + r.slots.length, 0);

    return NextResponse.json({
      success: true,
      targetDate,
      numGuests,
      timePeriods,
      results,
      totalSlotsFound: totalSlots,
    });
  } catch (error) {
    console.error('BBB check failed:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
