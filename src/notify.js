async function notify(payload) {
  const baseUrl = process.env.NOTIFICATIONS_URL || 'http://notifications:4004';
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    await fetch(`${baseUrl}/notifications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    clearTimeout(timeout);
  } catch (err) {
    console.warn('notify failed', err.message);
  }
}

module.exports = { notify };
