import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/app/lib/supabase';
import type { Alert, CreateAlertInput } from '@/app/lib/types';

// GET /api/alerts - Fetch all alerts
export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from('hopr_alerts')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching alerts:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ alerts: data as Alert[] });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST /api/alerts - Create a new alert
export async function POST(req: NextRequest) {
  try {
    const body: CreateAlertInput = await req.json();

    // Validate input
    if (!body.party_size || ![4, 6, 8].includes(body.party_size)) {
      return NextResponse.json(
        { error: 'Party size must be 4, 6, or 8' },
        { status: 400 }
      );
    }

    if (!body.target_days || body.target_days.length === 0) {
      return NextResponse.json(
        { error: 'At least one target day is required' },
        { status: 400 }
      );
    }

    const validDays = ['Friday', 'Saturday'];
    if (!body.target_days.every(day => validDays.includes(day))) {
      return NextResponse.json(
        { error: 'Target days must be Friday or Saturday' },
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
      .from('hopr_alerts')
      .insert({
        party_size: body.party_size,
        target_days: body.target_days,
        window_start: body.window_start || '16:00:00',
        window_end: body.window_end || '20:00:00',
        notify_email: body.notify_email,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating alert:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ alert: data as Alert }, { status: 201 });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// PATCH /api/alerts?id=xxx - Update an alert
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
      .from('hopr_alerts')
      .update(body)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating alert:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ alert: data as Alert });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE /api/alerts?id=xxx - Delete an alert
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
      .from('hopr_alerts')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting alert:', error);
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
