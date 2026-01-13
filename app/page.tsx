'use client';

import { useState, useEffect } from 'react';
import type { Alert, CheckHistory } from './lib/types';

export default function Home() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [expandedAlertId, setExpandedAlertId] = useState<string | null>(null);
  const [history, setHistory] = useState<{ [alertId: string]: CheckHistory[] }>({});

  // Form state
  const [formData, setFormData] = useState({
    party_size: 4,
    target_days: ['Friday', 'Saturday'],
    window_start: '16:00',
    window_end: '20:00',
    notify_email: '',
  });

  useEffect(() => {
    fetchAlerts();
  }, []);

  const fetchAlerts = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/alerts');
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to fetch alerts');
      }

      setAlerts(data.alerts || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      const res = await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          window_start: `${formData.window_start}:00`,
          window_end: `${formData.window_end}:00`,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to create alert');
      }

      setShowForm(false);
      setFormData({
        party_size: 4,
        target_days: ['Friday', 'Saturday'],
        window_start: '16:00',
        window_end: '20:00',
        notify_email: '',
      });
      fetchAlerts();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create alert');
    }
  };

  const toggleAlert = async (id: string, currentState: boolean) => {
    try {
      const res = await fetch(`/api/alerts?id=${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !currentState }),
      });

      if (!res.ok) {
        throw new Error('Failed to update alert');
      }

      fetchAlerts();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update alert');
    }
  };

  const deleteAlert = async (id: string) => {
    if (!confirm('Are you sure you want to delete this alert?')) return;

    try {
      const res = await fetch(`/api/alerts?id=${id}`, { method: 'DELETE' });

      if (!res.ok) {
        throw new Error('Failed to delete alert');
      }

      fetchAlerts();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete alert');
    }
  };

  const toggleDay = (day: string) => {
    setFormData((prev) => {
      const days = prev.target_days.includes(day)
        ? prev.target_days.filter((d) => d !== day)
        : [...prev.target_days, day];
      return { ...prev, target_days: days };
    });
  };

  const fetchHistory = async (alertId: string) => {
    if (history[alertId]) {
      // Already fetched, just toggle
      setExpandedAlertId(expandedAlertId === alertId ? null : alertId);
      return;
    }

    try {
      const res = await fetch(`/api/history?alertId=${alertId}`);
      const data = await res.json();

      if (res.ok) {
        setHistory((prev) => ({ ...prev, [alertId]: data.history || [] }));
        setExpandedAlertId(alertId);
      }
    } catch (err) {
      console.error('Failed to fetch history:', err);
    }
  };

  const getLastCheckStatus = (alertHistory: CheckHistory[] | undefined) => {
    if (!alertHistory || alertHistory.length === 0) {
      return { text: 'No checks yet', color: 'text-gray-400', time: null };
    }

    const lastCheck = alertHistory[0];
    const timeAgo = formatTimeAgo(new Date(lastCheck.checked_at));

    if (lastCheck.status === 'error') {
      return { text: `Error ${timeAgo}`, color: 'text-red-500', time: lastCheck.checked_at };
    }
    if (lastCheck.status === 'success' && lastCheck.slots_found > 0) {
      return { text: `Found ${lastCheck.slots_found} slot(s) ${timeAgo}`, color: 'text-green-600', time: lastCheck.checked_at };
    }
    return { text: `No availability ${timeAgo}`, color: 'text-gray-500', time: lastCheck.checked_at };
  };

  const formatTimeAgo = (date: Date) => {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50">
      <div className="max-w-6xl mx-auto p-6">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            House of Prime Rib
          </h1>
          <p className="text-gray-600">
            Get notified when reservations become available
          </p>
        </div>

        {/* Stats Card */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-gray-500 text-sm">Active Alerts</div>
            <div className="text-3xl font-bold text-purple-600">
              {alerts.filter((a) => a.is_active).length}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-gray-500 text-sm">Total Alerts</div>
            <div className="text-3xl font-bold text-blue-600">
              {alerts.length}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-gray-500 text-sm">Check Frequency</div>
            <div className="text-3xl font-bold text-green-600">15 min</div>
          </div>
        </div>

        {/* Create Alert Button */}
        <div className="mb-6">
          <button
            onClick={() => setShowForm(!showForm)}
            className="bg-gradient-to-r from-purple-600 to-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:from-purple-700 hover:to-blue-700 transition-all shadow-lg"
          >
            {showForm ? 'Cancel' : '+ Create New Alert'}
          </button>
        </div>

        {/* Create Alert Form */}
        {showForm && (
          <div className="bg-white rounded-lg shadow-lg p-6 mb-8">
            <h2 className="text-2xl font-bold mb-4">Create Alert</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Party Size
                </label>
                <select
                  value={formData.party_size}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      party_size: parseInt(e.target.value),
                    }))
                  }
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                >
                  <option value={4}>4 people</option>
                  <option value={6}>6 people</option>
                  <option value={8}>8 people</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Target Days
                </label>
                <div className="flex gap-4">
                  {['Friday', 'Saturday'].map((day) => (
                    <label key={day} className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        checked={formData.target_days.includes(day)}
                        onChange={() => toggleDay(day)}
                        className="w-4 h-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500"
                      />
                      <span className="text-gray-700">{day}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Start Time
                  </label>
                  <input
                    type="time"
                    value={formData.window_start}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        window_start: e.target.value,
                      }))
                    }
                    className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    End Time
                  </label>
                  <input
                    type="time"
                    value={formData.window_end}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        window_end: e.target.value,
                      }))
                    }
                    className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Email Address
                </label>
                <input
                  type="email"
                  value={formData.notify_email}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      notify_email: e.target.value,
                    }))
                  }
                  required
                  placeholder="your@email.com"
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
              </div>

              <button
                type="submit"
                className="w-full bg-gradient-to-r from-purple-600 to-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:from-purple-700 hover:to-blue-700 transition-all"
              >
                Create Alert
              </button>
            </form>
          </div>
        )}

        {/* Alerts List */}
        <div className="bg-white rounded-lg shadow-lg">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-2xl font-bold">Your Alerts</h2>
          </div>

          {loading ? (
            <div className="p-8 text-center text-gray-500">Loading...</div>
          ) : error ? (
            <div className="p-8 text-center text-red-500">{error}</div>
          ) : alerts.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              No alerts yet. Create one to get started!
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {alerts.map((alert) => {
                const alertHistory = history[alert.id];
                const lastCheckStatus = getLastCheckStatus(alertHistory);
                const isExpanded = expandedAlertId === alert.id;

                return (
                  <div key={alert.id} className="hover:bg-gray-50 transition-colors">
                    <div className="p-6">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <span
                              className={`px-3 py-1 rounded-full text-sm font-semibold ${
                                alert.is_active
                                  ? 'bg-green-100 text-green-800'
                                  : 'bg-gray-100 text-gray-800'
                              }`}
                            >
                              {alert.is_active ? 'Active' : 'Inactive'}
                            </span>
                            <span className="text-lg font-semibold text-gray-900">
                              Party of {alert.party_size}
                            </span>
                          </div>
                          <div className="space-y-1 text-sm text-gray-600">
                            <div>
                              <strong>Days:</strong> {alert.target_days.join(', ')}
                            </div>
                            <div>
                              <strong>Time:</strong>{' '}
                              {alert.window_start.substring(0, 5)} -{' '}
                              {alert.window_end.substring(0, 5)}
                            </div>
                            <div>
                              <strong>Email:</strong> {alert.notify_email}
                            </div>
                            <div className="flex items-center gap-2 text-xs">
                              <span className="text-gray-400">
                                Created {new Date(alert.created_at).toLocaleDateString()}
                              </span>
                              <span className="text-gray-300">•</span>
                              <span className={lastCheckStatus.color}>
                                {lastCheckStatus.text}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => fetchHistory(alert.id)}
                            className="px-4 py-2 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 transition-colors"
                          >
                            {isExpanded ? 'Hide History' : 'View History'}
                          </button>
                          <button
                            onClick={() => toggleAlert(alert.id, alert.is_active)}
                            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                              alert.is_active
                                ? 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                                : 'bg-green-500 text-white hover:bg-green-600'
                            }`}
                          >
                            {alert.is_active ? 'Pause' : 'Activate'}
                          </button>
                          <button
                            onClick={() => deleteAlert(alert.id)}
                            className="px-4 py-2 bg-red-500 text-white rounded-lg font-medium hover:bg-red-600 transition-colors"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Expandable History Section */}
                    {isExpanded && alertHistory && (
                      <div className="px-6 pb-6 bg-gray-50">
                        <div className="bg-white rounded-lg border border-gray-200 p-4">
                          <h3 className="font-semibold text-gray-900 mb-3">
                            Recent Checks (Last 20)
                          </h3>
                          {alertHistory.length === 0 ? (
                            <div className="text-sm text-gray-500 text-center py-4">
                              No checks recorded yet
                            </div>
                          ) : (
                            <div className="space-y-2 max-h-96 overflow-y-auto">
                              {alertHistory.map((check) => (
                                <div
                                  key={check.id}
                                  className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                                >
                                  <div className="flex-1">
                                    <div className="flex items-center gap-2">
                                      <span className="text-sm font-medium text-gray-900">
                                        {new Date(check.target_date).toLocaleDateString('en-US', {
                                          weekday: 'short',
                                          month: 'short',
                                          day: 'numeric',
                                        })}
                                      </span>
                                      {check.status === 'success' && check.slots_found > 0 && (
                                        <span className="px-2 py-0.5 bg-green-100 text-green-800 text-xs font-semibold rounded">
                                          {check.slots_found} slot{check.slots_found > 1 ? 's' : ''}
                                        </span>
                                      )}
                                      {check.status === 'error' && (
                                        <span className="px-2 py-0.5 bg-red-100 text-red-800 text-xs font-semibold rounded">
                                          Error
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-xs text-gray-500 mt-1">
                                      {new Date(check.checked_at).toLocaleString()}
                                    </div>
                                    {check.found_slots && check.found_slots.length > 0 && (
                                      <div className="mt-2 flex flex-wrap gap-1">
                                        {check.found_slots.map((slot, idx) => (
                                          <span
                                            key={idx}
                                            className="px-2 py-1 bg-green-50 text-green-700 text-xs rounded border border-green-200"
                                          >
                                            {slot.time}
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                    {check.error_message && (
                                      <div className="mt-1 text-xs text-red-600">
                                        {check.error_message}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer Info */}
        <div className="mt-8 text-center text-sm text-gray-500">
          <p>
            The system checks OpenTable every 15 minutes for available reservations.
          </p>
          <p className="mt-2">
            You'll receive an email notification when a matching reservation is found.
          </p>
        </div>
      </div>
    </div>
  );
}
