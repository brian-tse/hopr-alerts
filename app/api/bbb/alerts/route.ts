import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/app/lib/supabase';
import type { BBBAlert, CreateBBBAlertInput, TimePeriod } from '@/app/lib/bbb-types';

// GET /api/bbb/alerts - Fetch all alerts
export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from('bbb_alerts')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching BBB alerts:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ alerts: data as BBBAlert[] });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST /api/bbb/alerts - Create a new alert
export async function POST(req: NextRequest) {
  try {
    const body: CreateBBBAlertInput = await req.json();

    // Validate input
    if (!body.target_date) {
      return NextResponse.json(
        { error: 'Target date is required' },
        { status: 400 }
      );
    }

    // Validate date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(body.target_date)) {
      return NextResponse.json(
        { error: 'Invalid date format. Use YYYY-MM-DD' },
        { status: 400 }
      );
    }

    // Validate date is in the future
    const targetDate = new Date(body.target_date + 'T12:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (targetDate < today) {
      return NextResponse.json(
        { error: 'Target date must be in the future' },
        { status: 400 }
      );
    }

    if (!body.num_guests || body.num_guests < 1 || body.num_guests > 10) {
      return NextResponse.json(
        { error: 'Number of guests must be between 1 and 10' },
        { status: 400 }
      );
    }

    if (!body.time_preferences || body.time_preferences.length === 0) {
      return NextResponse.json(
        { error: 'At least one time preference is required' },
        { status: 400 }
      );
    }

    const validPeriods: TimePeriod[] = ['morning', 'afternoon', 'evening'];
    if (!body.time_preferences.every(p => validPeriods.includes(p))) {
      return NextResponse.json(
        { error: 'Invalid time preference. Must be morning, afternoon, or evening' },
        { status: 400 }
      );
    }

    if (!body.notify_email || !body.notify_email.includes('@')) {
      return NextResponse.json(
        { error: 'Valid email address is required' },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from('bbb_alerts')
      .insert({
        target_date: body.target_date,
        num_guests: body.num_guests,
        time_preferences: body.time_preferences,
        notify_email: body.notify_email,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating BBB alert:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ alert: data as BBBAlert }, { status: 201 });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// PATCH /api/bbb/alerts?id=xxx - Update an alert
export async function PATCH(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { error: 'Alert ID is required' },
        { status: 400 }
      );
    }

    const body = await req.json();

    const { data, error } = await supabaseAdmin
      .from('bbb_alerts')
      .update(body)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating BBB alert:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ alert: data as BBBAlert });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE /api/bbb/alerts?id=xxx - Delete an alert
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { error: 'Alert ID is required' },
        { status: 400 }
      );
    }

    const { error } = await supabaseAdmin
      .from('bbb_alerts')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting BBB alert:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
