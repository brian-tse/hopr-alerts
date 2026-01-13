import { NextRequest, NextResponse } from 'next/server';
import {
  scrapeOpenTable,
  getNextDayOfWeek,
  filterSlotsByTimeWindow,
} from '@/app/lib/scraper';

// Manual endpoint for testing the scraper
// GET /api/check?partySize=4&day=Friday
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const partySizeParam = searchParams.get('partySize');
    const day = searchParams.get('day') || 'Friday';

    if (!partySizeParam) {
      return NextResponse.json(
        { error: 'partySize parameter is required' },
        { status: 400 }
      );
    }

    const partySize = parseInt(partySizeParam);
    if (![4, 6, 8].includes(partySize)) {
      return NextResponse.json(
        { error: 'partySize must be 4, 6, or 8' },
        { status: 400 }
      );
    }

    if (!['Friday', 'Saturday'].includes(day)) {
      return NextResponse.json(
        { error: 'day must be Friday or Saturday' },
        { status: 400 }
      );
    }

    const targetDate = getNextDayOfWeek(day);

    console.log(
      `Manual check: ${partySize} people on ${day} (${targetDate})`
    );

    const startTime = Date.now();
    const allSlots = await scrapeOpenTable({ partySize, targetDate });
    const duration = Date.now() - startTime;

    // Filter by default time window (4pm-8pm)
    const filteredSlots = filterSlotsByTimeWindow(
      allSlots,
      '16:00:00',
      '20:00:00'
    );

    return NextResponse.json({
      success: true,
      targetDate,
      day,
      partySize,
      duration: `${duration}ms`,
      allSlots: allSlots.length,
      slotsInWindow: filteredSlots.length,
      slots: filteredSlots,
    });
  } catch (error) {
    console.error('Check failed:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}
